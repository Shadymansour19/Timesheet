import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(URL, KEY);

// Login is by username; Supabase Auth needs an email, so we derive an internal one.
export const usernameToEmail = (username) => `${username.trim().toLowerCase()}@timesheet.local`;

// Revoke ONE session on the server without touching the client's active session (used when removing a
// saved account that is not the active one). Best effort: an expired access token just means it lapses on its own.
export const revokeSession = (accessToken) =>
  fetch(`${URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${accessToken}` } }).catch(() => {});
