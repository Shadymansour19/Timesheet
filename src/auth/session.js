import { supabase, usernameToEmail, revokeSession } from '../supabase.js';

export const state = { profile: null };
let pendingNotice = null;
// A message for the login screen after the account was ended elsewhere (deactivated by an admin, etc.).
export const takeNotice = () => { const n = pendingNotice; pendingNotice = null; return n; };
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => fn(state.profile));

// ---- accounts remembered on this device -------------------------------------------------------
// The Supabase client holds ONE session at a time, so "switching" swaps the active session for a saved one.
// Only session tokens are stored (never passwords), in the same localStorage the client itself uses.
const KEY = 'ts.accounts';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; } };
const write = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage unavailable */ } };
export const listAccounts = () => read().map(({ id, username, full_name, role }) => ({ id, username, full_name, role }));

const entry = (session, p) => ({
  id: p.id, username: p.username, full_name: p.full_name, role: p.role,
  access_token: session.access_token, refresh_token: session.refresh_token,
});
function upsert(e) {
  const all = read(); const i = all.findIndex((x) => x.id === e.id);
  if (i >= 0) all[i] = e; else all.push(e);
  write(all);
}
const removeLocal = (id) => write(read().filter((x) => x.id !== id));

// While we change sessions on purpose, the auth listener must not treat it as "someone else did this".
let busy = 0;
const guard = async (fn) => { busy++; try { return await fn(); } finally { busy--; } };

async function rememberCurrent() {
  if (!state.profile) return;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id === state.profile.id) upsert(entry(data.session, state.profile));
}

async function loadProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) return { error: 'load_error' };
  // RLS hides inactive profiles from their owner, so "no row" means deleted/deactivated.
  if (!data || !data.active) return { error: 'account_disabled' };
  return { profile: data };
}

// Restore an existing session (page reload). Returns an error key or null.
export async function restore() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) { state.profile = null; return null; }
  const r = await loadProfile(data.session.user.id);
  if (r.error) { await supabase.auth.signOut({ scope: 'local' }); removeLocal(data.session.user.id); state.profile = null; return r.error; }
  state.profile = r.profile;
  upsert(entry(data.session, r.profile));
  return null;
}

// Returns an i18n error key, or null on success.
export const signIn = (username, password) => guard(async () => {
  const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error || !data.user) return 'invalid_login';
  const r = await loadProfile(data.user.id);
  if (r.error) { await supabase.auth.signOut({ scope: 'local' }); return r.error; }
  state.profile = r.profile;
  upsert(entry(data.session, r.profile));
  notify();
  return null;
});

// Sign in to another account WITHOUT signing out of the current one. A wrong password leaves the current session as is.
export const addAccount = (username, password) => guard(async () => {
  await rememberCurrent();
  const prev = read().find((a) => a.id === state.profile?.id);
  const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error || !data.user) return 'invalid_login';
  const r = await loadProfile(data.user.id);
  if (r.error) { await supabase.auth.signOut({ scope: 'local' }); await goBackTo(prev); return r.error; }
  state.profile = r.profile;
  upsert(entry(data.session, r.profile));
  location.hash = '';
  notify();
  return null;
});

// Put the client back on a previous account after a failed attempt (a failed setSession can drop the current one).
async function goBackTo(prev) {
  if (!prev) return;
  await supabase.auth.setSession({ access_token: prev.access_token, refresh_token: prev.refresh_token });
  const { data } = await supabase.auth.getSession();
  if (!data.session) { state.profile = null; notify(); }
}

// Returns an i18n error key, or null on success.
export const switchTo = (id) => guard(async () => {
  if (id === state.profile?.id) return null;
  const target = read().find((a) => a.id === id);
  if (!target) return 'switch_expired';
  await rememberCurrent();
  const prev = read().find((a) => a.id === state.profile?.id);
  const { data, error } = await supabase.auth.setSession({ access_token: target.access_token, refresh_token: target.refresh_token });
  let key = null, profile = null;
  if (error || data.session?.user.id !== id) key = 'switch_expired';
  else { const r = await loadProfile(id); if (r.error) key = r.error; else profile = r.profile; }
  if (key) {
    if (key !== 'load_error') removeLocal(id);          // revoked / banned / deleted: forget it
    await goBackTo(prev);
    return key === 'account_disabled' ? 'switch_expired' : key;
  }
  state.profile = profile;
  upsert(entry(data.session, profile));
  location.hash = '';
  notify();
  return null;
});

// Sign out of the account in use only (this session, not other devices); fall back to another saved account.
export const signOut = () => guard(async () => {
  const id = state.profile?.id;
  await supabase.auth.signOut({ scope: 'local' });
  if (id) removeLocal(id);
  state.profile = null;
  for (const a of read()) if ((await switchTo(a.id)) === null) return;
  notify();
});

export const signOutAll = () => guard(async () => {
  await Promise.all(read().filter((a) => a.id !== state.profile?.id).map((a) => revokeSession(a.access_token)));
  await supabase.auth.signOut({ scope: 'local' });
  write([]);
  state.profile = null;
  notify();
});

export async function removeAccount(id) {
  const a = read().find((x) => x.id === id);
  if (!a || id === state.profile?.id) return;
  removeLocal(id);
  await revokeSession(a.access_token);
}

// Re-read the signed-in person's profile (called when the database announces a change to it).
// Deactivated -> back to the login screen; role or department changed -> the app re-renders with the new menus.
let refreshing = null;
export function refreshProfile() {
  // several announcements can arrive together: run one refresh at a time
  refreshing ??= guard(doRefreshProfile).finally(() => { refreshing = null; });   // guard: our own sign-out must not trigger the "session ended elsewhere" reload
  return refreshing;
}
async function doRefreshProfile() {
  const me = state.profile;
  if (!me) return;
  const r = await loadProfile(me.id);
  if (r.error === 'account_disabled') {
    await supabase.auth.signOut({ scope: 'local' });
    removeLocal(me.id);
    pendingNotice = 'account_disabled';
    state.profile = null;
    notify();
    return;
  }
  if (!r.profile) return;
  const changed = r.profile.role !== me.role || r.profile.department_id !== me.department_id;
  state.profile = r.profile;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id === r.profile.id) upsert(entry(data.session, r.profile));
  if (changed) { location.hash = ''; notify(); }
}

// Verify the current password, then set the new one. Returns an i18n error key or null.
export async function changePassword(current, next) {
  const { error: reauth } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(state.profile.username), password: current,
  });
  if (reauth) return 'wrong_current_password';
  const { error } = await supabase.auth.updateUser({ password: next });
  return error ? 'load_error' : null;
}

supabase.auth.onAuthStateChange((event, session) => {
  if (busy) return;                                       // our own switch/sign-in/out
  if (!state.profile) return;
  // Session ended or changed outside this page (another tab switched account, token revoked, user banned):
  // reload so the UI always shows the account the client is really acting as.
  if (event === 'SIGNED_OUT') { setTimeout(() => location.reload(), 0); return; }
  if (!session) return;
  if (session.user.id !== state.profile.id) { setTimeout(() => location.reload(), 0); return; }
  if (read().some((a) => a.id === state.profile.id)) upsert(entry(session, state.profile));  // keep rotated tokens fresh
});
