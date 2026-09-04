// ===========================================================
// supabaseClient.js — a single shared Supabase client instance.
// ===========================================================
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabaseConfigured =
  !!SUPABASE_URL && !SUPABASE_URL.startsWith('YOUR_') &&
  !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('YOUR_');

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
