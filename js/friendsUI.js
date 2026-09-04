// ===========================================================
// friendsUI.js — wires the Home screen "Friends" panel: search-to-add,
// incoming/outgoing requests, and the accepted friends list. Backed by
// account.js's friendship functions (see README.md section 6 for the
// `friendships` table + RLS this needs).
// ===========================================================
import { el, toast, bus } from './utils.js';
import { defaultAvatarConfig } from './avatar.js';
import { renderAvatarThumbnail } from './avatarViewer.js';
import { supabaseConfigured } from './supabaseClient.js';
import {
  searchProfiles, getFriendsData, sendFriendRequest, acceptFriendRequest, removeFriendship,
} from './account.js';

export class FriendsUI {
  constructor() {
    this.myProfile = null;
    this.data = { friends: [], incoming: [], outgoing: [] };
    this._knownIds = new Set(); // ids already friends/pending, so search doesn't offer to re-add them

    document.getElementById('friends-not-configured').classList.toggle('hidden', supabaseConfigured);

    this._bindAddSearch();

    bus.on('account-changed', (profile) => { this.myProfile = profile; this._refresh(); });
    bus.on('screen-change', (name) => { if (name === 'home' && this.myProfile) this._refresh(); });
  }

  async _refresh() {
    const guestMsg = document.getElementById('friends-guest-msg');
    const content = document.getElementById('friends-content');
    if (!supabaseConfigured) { guestMsg.classList.add('hidden'); content.classList.add('hidden'); return; }
    if (!this.myProfile) {
      guestMsg.classList.remove('hidden');
      content.classList.add('hidden');
      return;
    }
    guestMsg.classList.add('hidden');
    content.classList.remove('hidden');
    this.data = await getFriendsData();
    this._knownIds = new Set([
      ...this.data.friends.map(f => f.profile.id),
      ...this.data.incoming.map(f => f.profile.id),
      ...this.data.outgoing.map(f => f.profile.id),
    ]);
    this._renderLists();
  }

  _thumb(profile, size = 38) {
    const img = document.createElement('img');
    img.className = 'search-result-thumb';
    img.alt = profile.username;
    try { img.src = renderAvatarThumbnail(profile.avatar_config || defaultAvatarConfig(), size); } catch { /* leave blank */ }
    return img;
  }

  // one friend/request row: avatar thumbnail, name, and a row of action buttons
  _row(profile, buttons) {
    const row = el('div', 'search-result-row friend-row');
    row.appendChild(this._thumb(profile));
    row.appendChild(el('span', 'search-result-name', profile.username));
    const btnWrap = el('div', 'friend-row-actions');
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${b.primary ? 'btn-primary' : 'btn-ghost'}`;
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      btnWrap.appendChild(btn);
    }
    row.appendChild(btnWrap);
    return row;
  }

  _renderLists() {
    const incomingSection = document.getElementById('friends-incoming-section');
    const incomingList = document.getElementById('friends-incoming-list');
    incomingList.innerHTML = '';
    incomingSection.classList.toggle('hidden', this.data.incoming.length === 0);
    for (const { friendshipId, profile } of this.data.incoming) {
      incomingList.appendChild(this._row(profile, [
        {
          label: 'Accept', primary: true, onClick: async () => {
            await acceptFriendRequest(friendshipId);
            toast(`You and ${profile.username} are now friends`);
            this._refresh();
          },
        },
        { label: 'Decline', onClick: async () => { await removeFriendship(friendshipId); this._refresh(); } },
      ]));
    }

    const outgoingSection = document.getElementById('friends-outgoing-section');
    const outgoingList = document.getElementById('friends-outgoing-list');
    outgoingList.innerHTML = '';
    outgoingSection.classList.toggle('hidden', this.data.outgoing.length === 0);
    for (const { friendshipId, profile } of this.data.outgoing) {
      outgoingList.appendChild(this._row(profile, [
        { label: 'Cancel', onClick: async () => { await removeFriendship(friendshipId); this._refresh(); } },
      ]));
    }

    const list = document.getElementById('friends-list');
    const emptyMsg = document.getElementById('friends-empty-msg');
    list.innerHTML = '';
    emptyMsg.classList.toggle('hidden', this.data.friends.length > 0);
    for (const { friendshipId, profile } of this.data.friends) {
      list.appendChild(this._row(profile, [
        {
          label: 'Remove', onClick: () => {
            if (!window.confirm(`Remove ${profile.username} from your friends?`)) return;
            removeFriendship(friendshipId).then(() => this._refresh());
          },
        },
      ]));
    }
  }

  // ---------------------------------------------------------
  _bindAddSearch() {
    const input = document.getElementById('friends-add-input');
    let debounceTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = input.value;
      debounceTimer = setTimeout(() => this._runAddSearch(query), 300);
    });
  }

  async _runAddSearch(query) {
    const resultsEl = document.getElementById('friends-add-results');
    if (!query.trim() || !this.myProfile) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<p class="muted small">Searching…</p>';
    const results = (await searchProfiles(query)).filter(p => p.id !== this.myProfile.id);
    resultsEl.innerHTML = '';
    if (results.length === 0) { resultsEl.innerHTML = '<p class="muted small">No players found.</p>'; return; }
    for (const profile of results) {
      const known = this._knownIds.has(profile.id);
      resultsEl.appendChild(this._row(profile, [
        known
          ? { label: 'Pending / Friends', onClick: () => {} }
          : {
              label: 'Add', primary: true, onClick: async (e) => {
                e.target.disabled = true;
                e.target.textContent = 'Sending…';
                const result = await sendFriendRequest(profile.id);
                if (!result.ok) { toast(result.error); e.target.disabled = false; e.target.textContent = 'Add'; return; }
                toast(result.accepted ? `You and ${profile.username} are now friends` : `Friend request sent to ${profile.username}`);
                this._refresh();
              },
            },
      ]));
    }
  }
}
