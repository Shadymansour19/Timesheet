import { supabase } from './supabase.js';

// Live updates over PRIVATE broadcast channels (see migration 8). The database only announces "something changed
// in range X"; views then refetch through the normal RLS-protected queries. Channels:
//   user:<uid>  the person   dept:<id>  department admins   deptpub:<id>  everyone in the department (holidays)
// Every successful join (first or after a reconnect) sends watchers { t: 'resync' }: messages are not replayed.

const channels = new Map();        // topic -> { ch, state, joined }
const watchers = new Set();        // scoped to the current view (cleared by reset())
const globals = new Set();         // kept across views (cleared by dispose())
let viewStatusSubs = new Set();
let sweepTimer = null;

const overall = () => (!channels.size ? 'idle' : [...channels.values()].every((c) => c.state === 'live') ? 'live' : 'connecting');
const emitStatus = () => { const s = overall(); viewStatusSubs.forEach((f) => f(s)); };
const dispatch = (topic, payload) => { for (const w of [...watchers, ...globals]) if (w.topics.includes(topic)) w.fn(payload, topic); };

async function ensure(topic) {
  const cur = channels.get(topic);
  if (cur) return;
  const entry = { ch: null, state: 'connecting', joined: false };
  channels.set(topic, entry);
  const { data } = await supabase.auth.getSession();
  if (data.session) supabase.realtime.setAuth(data.session.access_token);   // private channels are authorised per user
  if (channels.get(topic) !== entry) return;                                // disposed while waiting
  entry.ch = supabase.channel(topic, { config: { private: true } });
  entry.ch.on('broadcast', { event: 'change' }, ({ payload }) => dispatch(topic, payload));
  entry.ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      entry.joined = true; entry.state = 'live';
      // Messages are not kept for late joiners, so catch up on every (re)join: anything that changed while the channel
      // was being (re)created, or while the connection was down, is picked up by a refetch.
      dispatch(topic, { t: 'resync' });
    } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) entry.state = 'connecting';   // supabase-js retries
    emitStatus();
  });
}

function sweep() {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    const needed = new Set([...watchers, ...globals].flatMap((w) => w.topics));
    for (const [topic, e] of channels) if (!needed.has(topic)) { if (e.ch) supabase.removeChannel(e.ch); channels.delete(topic); }
    emitStatus();
  }, 5000);
}

function add(set, topics, fn) {
  const w = { topics, fn };
  set.add(w);
  topics.forEach(ensure);
  return () => { set.delete(w); sweep(); };
}

// Watch topics for the current view. fn(payload) receives { t: 'day_status'|'overtime'|'holidays'|'profiles'|'profile'|'resync', from, to, u }.
export const watch = (topics, fn) => add(watchers, topics, fn);
// Same, but survives view changes (used for "my profile changed").
export const watchGlobal = (topics, fn) => add(globals, topics, fn);
export function onStatus(fn) { viewStatusSubs.add(fn); fn(overall()); return () => viewStatusSubs.delete(fn); }

// A new view is about to render: drop its watchers (channels stay open briefly so the next view can reuse them).
export function reset() { watchers.clear(); viewStatusSubs = new Set(); sweep(); }
// Identity changed (sign-in/out/switch): close everything.
export function dispose() {
  watchers.clear(); globals.clear(); viewStatusSubs = new Set();
  for (const e of channels.values()) if (e.ch) supabase.removeChannel(e.ch);
  channels.clear();
}

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
