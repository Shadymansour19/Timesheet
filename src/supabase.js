import { createClient } from '@supabase/supabase-js';
import { acting } from './acting.js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Super admin acting as a department admin: add the department header to data / function requests (never to auth calls).
const withActing = (input, init) => {
  if (!acting.active || !acting.dept) return fetch(input, init);
  const url = typeof input === 'string' ? input : input.url;
  if (!/\/(rest|functions)\/v1\//.test(url)) return fetch(input, init);
  if (typeof input !== 'string') { const r = new Request(input, init); r.headers.set('x-acting-dept', acting.dept); return fetch(r); }
  const headers = new Headers(init?.headers); headers.set('x-acting-dept', acting.dept);
  return fetch(input, { ...init, headers });
};
export const supabase = createClient(URL, KEY, { global: { fetch: withActing } });

// Login is by username; Supabase Auth needs an email, so we derive an internal one.
export const usernameToEmail = (username) => `${username.trim().toLowerCase()}@timesheet.local`;

// Revoke ONE session on the server without touching the client's active session (used when removing a
// saved account that is not the active one). Best effort: an expired access token just means it lapses on its own.
export const revokeSession = (accessToken) =>
  fetch(`${URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${accessToken}` } }).catch(() => {});
