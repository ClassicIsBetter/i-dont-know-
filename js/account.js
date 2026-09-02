// ===========================================================
// account.js — username/password accounts, backed by Supabase.
//
// Supabase Auth's password login is built around email addresses, not
// usernames. Since Blockverse only wants a username, each account signs
// up with a synthetic email (username@blockverse.local) that the person
// never sees or types — the real, chosen username lives in a separate
// "profiles" table (see README.md for the SQL that creates it) and is
// what's used for display and search.
//
// This is a well-known pattern for username-only auth on Supabase, but
// it does mean password-reset-by-email won't work out of the box, since
// there's no real inbox behind the synthetic address. Fine for "nothing
// advanced yet" — worth knowing before this grows.
// ===========================================================
import { supabase, supabaseConfigured } from './supabaseClient.js';

const EMAIL_DOMAIN = 'blockverse.local';
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function usernameToEmail(username) {
  return `${username.toLowerCase()}@${EMAIL_DOMAIN}`;
}

export function validateUsername(username) {
  if (!USERNAME_RE.test(username || '')) {
    return 'Usernames must be 3-20 characters: letters, numbers, and underscores only.';
  }
  return null;
}

export async function signUp(username, password, avatarConfig) {
  if (!supabaseConfigured) return { ok: false, error: "Accounts aren't set up yet on this deployment." };
  const usernameError = validateUsername(username);
  if (usernameError) return { ok: false, error: usernameError };
  if (!password || password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };

  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    if (/registered|exists/i.test(error.message || '')) return { ok: false, error: 'That username is already taken.' };
    return { ok: false, error: error.message };
  }
  const user = data.user;
  if (!user) {
    return { ok: false, error: 'Sign-up did not return a user — check that "Confirm email" is turned off for this Supabase project (see README.md).' };
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .insert({ id: user.id, username, avatar_config: avatarConfig });
  if (profileError) {
    if (/duplicate/i.test(profileError.message || '')) return { ok: false, error: 'That username is already taken.' };
    return { ok: false, error: profileError.message };
  }

  return { ok: true, user, username };
}

export async function signIn(username, password) {
  if (!supabaseConfigured) return { ok: false, error: "Accounts aren't set up yet on this deployment." };
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: 'Incorrect username or password.' };
  return { ok: true, user: data.user };
}

export async function signOut() {
  if (!supabaseConfigured) return;
  await supabase.auth.signOut();
}

export async function getCurrentSession() {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// Fires immediately with the current session (covers page-load restore),
// then again on every future sign-in/sign-out/token-refresh. This is the
// robust way to track auth state — a single one-shot getSession() call
// right at boot can race with the client's own session-from-storage
// rehydration and miss an already-logged-in session.
export function onAuthStateChange(callback) {
  if (!supabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => data.subscription.unsubscribe();
}

export async function getMyProfile() {
  if (!supabaseConfigured) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) {
    console.error('[Blockverse] Could not load profile for signed-in user:', error);
    return null;
  }
  return data;
}

export async function updateMyAvatarConfig(avatarConfig) {
  if (!supabaseConfigured) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;
  await supabase.from('profiles').update({ avatar_config: avatarConfig }).eq('id', user.id);
}

export async function searchProfiles(query) {
  if (!supabaseConfigured || !query.trim()) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_config, created_at')
    .ilike('username', `%${query.trim()}%`)
    .limit(20);
  if (error) return [];
  return data || [];
}
