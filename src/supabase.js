import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

// Login is by username; Supabase Auth needs an email, so we derive an internal one.
export const usernameToEmail = (username) => `${username.trim().toLowerCase()}@timesheet.local`;
