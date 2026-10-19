import { supabase, usernameToEmail } from '../supabase.js';

export const state = { profile: null };
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => fn(state.profile));

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
  if (r.error) { await supabase.auth.signOut(); state.profile = null; return r.error; }
  state.profile = r.profile;
  return null;
}

// Returns an i18n error key, or null on success.
export async function signIn(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username), password,
  });
  if (error || !data.user) return 'invalid_login';
  const r = await loadProfile(data.user.id);
  if (r.error) { await supabase.auth.signOut(); return r.error; }
  state.profile = r.profile;
  notify();
  return null;
}

export async function signOut() {
  await supabase.auth.signOut();
  state.profile = null;
  notify();
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

// Session ended elsewhere (token revoked, user banned): drop to the login screen.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && state.profile) { state.profile = null; notify(); }
});
