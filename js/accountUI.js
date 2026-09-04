// ===========================================================
// accountUI.js — wires the Account screen: sign in/up/out, the signed-in
// profile view (avatar preview as the "profile picture"), and username
// search.
// ===========================================================
import { el, toast, bus } from './utils.js';
import { defaultAvatarConfig } from './avatar.js';
import { MiniAvatarViewer, renderAvatarThumbnail } from './avatarViewer.js';
import { supabaseConfigured } from './supabaseClient.js';
import {
  signUp, signIn, signOut, getMyProfile, onAuthStateChange,
  updateMyAvatarConfig, searchProfiles, validateUsername,
} from './account.js';

export class AccountUI {
  constructor(getLocalAvatarConfig) {
    this.getLocalAvatarConfig = getLocalAvatarConfig; // () => current locally-customized avatar config
    this.profile = null; // signed-in profile row, or null
    this.avatarPreview = null;

    if (!supabaseConfigured) {
      console.warn('[Blockverse] Accounts are not configured — js/config.js still has placeholder SUPABASE_URL/SUPABASE_ANON_KEY values (or one of the two is missing). Sign-in/search are disabled until both are filled in.');
    }

    this._bindTabs();
    this._bindForms();
    this._bindSearch();
    this._bindNavSearch();
    this._showGuest(); // default state until the auth listener below reports otherwise

    // Fires immediately with the current (possibly already-logged-in)
    // session, then again on every future sign-in/out — this is the
    // reliable way to pick up a persisted session on page load; a single
    // one-shot check right at boot can race with the client's own
    // session-from-storage restore and miss it.
    onAuthStateChange(async (event, session) => {
      if (session?.user) {
        try {
          const profile = await getMyProfile();
          if (profile) {
            this._showSignedIn(profile);
            if (event === 'SIGNED_IN') toast(`Welcome, ${profile.username}!`);
          } else if (event === 'SIGNED_IN') {
            toast("Signed in, but couldn't load your profile — check the browser console.");
          }
        } catch (e) {
          console.error('[Blockverse] Failed to load profile after sign-in:', e);
        }
      } else {
        this._showGuest();
      }
    });
  }

  // ---------------------------------------------------------
  _bindTabs() {
    document.querySelectorAll('.account-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('account-form-signin').classList.toggle('hidden', tab.dataset.tab !== 'signin');
        document.getElementById('account-form-signup').classList.toggle('hidden', tab.dataset.tab !== 'signup');
      });
    });
  }

  _bindForms() {
    document.getElementById('account-not-configured').classList.toggle('hidden', supabaseConfigured);
    // Only the actual auth inputs and submit buttons get disabled when not
    // configured — the Sign In / Sign Up TAB buttons must always stay
    // clickable so people can at least see both forms and the "not set up
    // yet" message no matter which tab they land on.
    document.querySelectorAll('.account-form input, #signin-btn, #signup-btn').forEach(elm => {
      elm.disabled = !supabaseConfigured;
    });

    document.getElementById('signin-btn').addEventListener('click', async () => {
      const username = document.getElementById('signin-username').value.trim();
      const password = document.getElementById('signin-password').value;
      const errEl = document.getElementById('signin-error');
      errEl.textContent = '';
      try {
        const result = await signIn(username, password);
        if (!result.ok) errEl.textContent = result.error;
        // success: the onAuthStateChange listener above updates the UI
      } catch (e) {
        console.error('[Blockverse] Sign in threw an error:', e);
        errEl.textContent = 'Something went wrong signing in — check the browser console for details.';
      }
    });

    document.getElementById('signup-btn').addEventListener('click', async () => {
      const username = document.getElementById('signup-username').value.trim();
      const password = document.getElementById('signup-password').value;
      const errEl = document.getElementById('signup-error');
      errEl.textContent = '';
      const usernameError = validateUsername(username);
      if (usernameError) { errEl.textContent = usernameError; return; }
      try {
        const result = await signUp(username, password, this.getLocalAvatarConfig());
        if (!result.ok) errEl.textContent = result.error;
        // success: the onAuthStateChange listener above updates the UI
      } catch (e) {
        console.error('[Blockverse] Sign up threw an error:', e);
        errEl.textContent = 'Something went wrong signing up — check the browser console for details.';
      }
    });

    document.getElementById('account-signout-btn').addEventListener('click', async () => {
      try {
        await signOut();
        toast('Signed out');
        // the onAuthStateChange listener above shows the guest view
      } catch (e) {
        console.error('[Blockverse] Sign out threw an error:', e);
      }
    });
  }

  // ---------------------------------------------------------
  _showGuest() {
    this.profile = null;
    document.getElementById('account-guest').classList.remove('hidden');
    document.getElementById('account-signed-in').classList.add('hidden');
    if (this.avatarPreview) { this.avatarPreview.dispose(); this.avatarPreview = null; }
    this._updateNavBadge();
    bus.emit('account-changed', null);
  }

  _showSignedIn(profile) {
    this.profile = profile;
    document.getElementById('account-guest').classList.add('hidden');
    document.getElementById('account-signed-in').classList.remove('hidden');
    document.getElementById('account-username-display').textContent = profile.username;
    const joined = profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '';
    document.getElementById('account-joined-display').textContent = joined ? `Joined ${joined}` : '';

    const mount = document.getElementById('account-avatar-mount');
    if (this.avatarPreview) this.avatarPreview.dispose();
    this.avatarPreview = new MiniAvatarViewer(mount, profile.avatar_config || defaultAvatarConfig(), { interactive: true });

    this._updateNavBadge();
    bus.emit('account-changed', profile);
  }

  _updateNavBadge() {
    const nameEl = document.getElementById('nav-account-name');
    const img = document.getElementById('nav-account-avatar-img');
    const placeholder = document.getElementById('nav-account-avatar-placeholder');
    if (this.profile) {
      nameEl.textContent = this.profile.username;
      try {
        img.src = renderAvatarThumbnail(this.profile.avatar_config || defaultAvatarConfig(), 48);
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } catch {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }
    } else {
      nameEl.textContent = 'Sign In';
      img.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
  }

  // Called whenever the local avatar customization changes, so a
  // signed-in user's stored profile picture stays current.
  async syncAvatarConfig(config) {
    if (!this.profile) return;
    this.profile.avatar_config = config;
    this._updateNavBadge();
    try {
      await updateMyAvatarConfig(config);
    } catch (e) {
      console.error('[Blockverse] Failed to sync avatar to profile:', e);
    }
  }

  // ---------------------------------------------------------
  _bindSearch() {
    const input = document.getElementById('profile-search-input');
    let debounceTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = input.value;
      debounceTimer = setTimeout(() => this._runSearch(query), 350);
    });
  }

  async _runSearch(query) {
    const resultsEl = document.getElementById('profile-search-results');
    if (!query.trim()) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<p class="muted small">Searching…</p>';
    const results = await searchProfiles(query);
    resultsEl.innerHTML = '';
    if (results.length === 0) { resultsEl.innerHTML = '<p class="muted small">No players found.</p>'; return; }
    for (const profile of results) {
      const row = el('div', 'search-result-row');
      const thumb = document.createElement('img');
      thumb.className = 'search-result-thumb';
      thumb.alt = profile.username;
      try {
        thumb.src = renderAvatarThumbnail(profile.avatar_config || defaultAvatarConfig(), 64);
      } catch {
        // thumbnail render failed (e.g. no WebGL context available) —
        // leave the <img> without a src; CSS gives it a neutral fallback box.
      }
      row.appendChild(thumb);
      row.appendChild(el('span', 'search-result-name', profile.username));
      resultsEl.appendChild(row);
    }
  }

  // ---------------------------------------------------------
  // Top-nav quick search — a small dropdown of matching usernames,
  // reachable from anywhere in the app.
  _bindNavSearch() {
    const input = document.getElementById('nav-user-search');
    const resultsEl = document.getElementById('nav-search-results');
    if (!supabaseConfigured) {
      input.disabled = true;
      input.placeholder = 'Search players (accounts not set up)';
      return;
    }

    let debounceTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = input.value;
      debounceTimer = setTimeout(() => this._runNavSearch(query), 300);
    });
    input.addEventListener('focus', () => {
      if (input.value.trim()) resultsEl.classList.remove('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav-search')) resultsEl.classList.add('hidden');
    });
  }

  async _runNavSearch(query) {
    const resultsEl = document.getElementById('nav-search-results');
    if (!query.trim()) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = '<p class="nav-search-empty">Searching…</p>';
    const results = await searchProfiles(query);
    resultsEl.innerHTML = '';
    if (results.length === 0) {
      resultsEl.innerHTML = '<p class="nav-search-empty">No players found.</p>';
      return;
    }
    for (const profile of results) {
      const row = el('div', 'nav-search-result');
      const thumb = document.createElement('img');
      thumb.alt = profile.username;
      try { thumb.src = renderAvatarThumbnail(profile.avatar_config || defaultAvatarConfig(), 56); } catch { /* leave blank */ }
      row.appendChild(thumb);
      row.appendChild(el('span', null, profile.username));
      row.addEventListener('click', () => {
        resultsEl.classList.add('hidden');
        toast(`${profile.username}'s profile page isn't built yet`);
      });
      resultsEl.appendChild(row);
    }
  }
}
