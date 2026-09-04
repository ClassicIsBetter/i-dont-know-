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

// ---------------------------------------------------------
// Friends — backed by a `friendships` table (requester_id, addressee_id,
// status). See README.md section 6 for the SQL that creates it and its
// RLS policies. A friendship starts 'pending' (sent by the requester) and
// becomes 'accepted' once the addressee accepts it.

export async function getFriendsData() {
  const empty = { friends: [], incoming: [], outgoing: [] };
  if (!supabaseConfigured) return empty;
  const { data: sessionData } = await supabase.auth.getSession();
  const me = sessionData?.session?.user;
  if (!me) return empty;

  const { data: rows, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${me.id},addressee_id.eq.${me.id}`);
  if (error) { console.error('[Blockverse] Could not load friendships:', error); return empty; }
  if (!rows || rows.length === 0) return empty;

  const otherIds = [...new Set(rows.map(r => (r.requester_id === me.id ? r.addressee_id : r.requester_id)))];
  const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_config').in('id', otherIds);
  const profilesById = {};
  for (const p of (profiles || [])) profilesById[p.id] = p;

  const result = { friends: [], incoming: [], outgoing: [] };
  for (const row of rows) {
    const isRequester = row.requester_id === me.id;
    const profile = profilesById[isRequester ? row.addressee_id : row.requester_id];
    if (!profile) continue; // the other profile row is gone (deleted account)
    const entry = { friendshipId: row.id, profile };
    if (row.status === 'accepted') result.friends.push(entry);
    else if (isRequester) result.outgoing.push(entry);
    else result.incoming.push(entry);
  }
  return result;
}

export async function sendFriendRequest(targetUserId) {
  if (!supabaseConfigured) return { ok: false, error: 'Accounts are not set up on this deployment.' };
  const { data: sessionData } = await supabase.auth.getSession();
  const me = sessionData?.session?.user;
  if (!me) return { ok: false, error: 'Sign in first.' };
  if (me.id === targetUserId) return { ok: false, error: "That's you!" };

  // if they already sent us a request, accept it instead of creating a
  // second, reversed row
  const { data: reverse } = await supabase
    .from('friendships').select('id, status')
    .eq('requester_id', targetUserId).eq('addressee_id', me.id).maybeSingle();
  if (reverse) {
    if (reverse.status === 'accepted') return { ok: false, error: 'Already friends.' };
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', reverse.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, accepted: true };
  }

  const { error } = await supabase.from('friendships').insert({ requester_id: me.id, addressee_id: targetUserId });
  if (error) {
    if (/duplicate/i.test(error.message || '')) return { ok: false, error: 'Already friends, or a request is already pending.' };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function acceptFriendRequest(friendshipId) {
  if (!supabaseConfigured) return;
  await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
}

// declining an incoming request, cancelling an outgoing one, and removing
// an existing friend are all the same operation: delete the row.
export async function removeFriendship(friendshipId) {
  if (!supabaseConfigured) return;
  await supabase.from('friendships').delete().eq('id', friendshipId);
}
