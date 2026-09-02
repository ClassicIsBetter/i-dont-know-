// ===========================================================
// multiplayer.js — real-time player sync + chat over Supabase Realtime.
//
// Uses the SAME Supabase project already configured for accounts (see
// config.js / README section 6) — Realtime is on by default for any
// Supabase project, so no extra setup is needed beyond what accounts
// already require. Works for guests too: multiplayer/chat don't need a
// signed-in account, just a configured project.
//
// Architecture: one Realtime "channel" per room (keyed by project_id, so
// everyone playing the same game lands in the same room). Presence tracks
// who's connected (+ their chosen username/avatar); Broadcast carries
// frequent, ephemeral position updates and chat messages — neither is
// stored anywhere, which is exactly what both want.
//
// Honest limitation: this syncs PLAYERS, not the WORLD. Built-in games
// are identical for everyone (baked into games.js), so multiplayer works
// as expected there. A custom project only lives in its creator's
// LocalStorage — other players joining that room will see each other
// moving around, but only see the same building/objects if they happen
// to have loaded an identical copy of that project (e.g. via export/
// import). True shared worlds need a cloud save system, which isn't
// built yet (see the roadmap).
// ===========================================================
import * as THREE from 'three';
import { buildAvatar, disposeAvatar, defaultAvatarConfig, AvatarAnimator, TOTAL_HEIGHT } from './avatar.js';
import { damp, uid } from './utils.js';
import { supabase, supabaseConfigured } from './supabaseClient.js';

const CHAT_MAX_LEN = 200;

// ---------------------------------------------------------
// Guest identity — stable across reloads, used when not signed in.
const GUEST_ID_KEY = 'blockverse_guest_id_v1';
const GUEST_NAME_KEY = 'blockverse_guest_name_v1';

export function getGuestIdentity() {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) { id = uid('guest'); localStorage.setItem(GUEST_ID_KEY, id); }
  let name = localStorage.getItem(GUEST_NAME_KEY);
  if (!name) { name = `Guest${Math.floor(1000 + Math.random() * 9000)}`; localStorage.setItem(GUEST_NAME_KEY, name); }
  return { id, name };
}

// ===========================================================
// MultiplayerSession — one Realtime channel for a room.
// ===========================================================
export class MultiplayerSession {
  /**
   * @param {string} roomId  usually the project_id, so everyone playing
   *   the same game shares a room
   * @param {{id:string, username:string, avatarConfig:object}} localUser
   */
  constructor(roomId, localUser) {
    this.roomId = roomId;
    this.localUser = localUser;
    this.channel = null;
    this.connected = false;

    this.onPlayerUpdate = null; // (key, {username, avatarConfig}) => void — spawn-or-update
    this.onRosterKeys = null;   // (Set<key>) => void — caller removes anyone not in this set
    this.onMove = null;         // (key, {x,y,z,yaw,state}) => void
    this.onChat = null;         // ({key, username, text, ts}) => void
  }

  get available() { return supabaseConfigured; }

  connect() {
    if (!supabaseConfigured) return false;
    if (this.channel) return true;

    this.channel = supabase.channel(`game:${this.roomId}`, {
      config: { presence: { key: this.localUser.id }, broadcast: { self: false } },
    });

    this.channel.on('presence', { event: 'sync' }, () => this._handleSync());
    this.channel.on('broadcast', { event: 'move' }, ({ payload }) => {
      if (payload && payload.key !== this.localUser.id) this.onMove?.(payload.key, payload);
    });
    this.channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
      if (payload) this.onChat?.(payload);
    });

    this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        this.connected = true;
        await this.channel.track({
          username: this.localUser.username,
          avatarConfig: this.localUser.avatarConfig,
        });
      }
    });
    return true;
  }

  _handleSync() {
    if (!this.channel) return;
    const state = this.channel.presenceState();
    const keys = new Set();
    for (const key in state) {
      if (key === this.localUser.id) continue;
      keys.add(key);
      const presence = state[key] && state[key][0];
      if (presence) this.onPlayerUpdate?.(key, presence);
    }
    this.onRosterKeys?.(keys);
  }

  // Re-broadcasts our presence payload (e.g. after the local avatar changes)
  updatePresence(avatarConfig) {
    this.localUser.avatarConfig = avatarConfig;
    if (this.channel && this.connected) {
      this.channel.track({ username: this.localUser.username, avatarConfig });
    }
  }

  sendMove(transform) {
    if (!this.channel || !this.connected) return;
    this.channel.send({ type: 'broadcast', event: 'move', payload: { key: this.localUser.id, ...transform } });
  }

  sendChat(text) {
    const clean = String(text || '').trim().slice(0, CHAT_MAX_LEN);
    if (!clean) return;
    const payload = { key: this.localUser.id, username: this.localUser.username, text: clean, ts: Date.now() };
    // show it locally immediately (broadcast is configured with self:false)
    this.onChat?.(payload);
    if (this.channel && this.connected) {
      this.channel.send({ type: 'broadcast', event: 'chat', payload });
    }
  }

  leave() {
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.connected = false;
  }
}

// ===========================================================
// RemotePlayer — another connected player's avatar in the 3D scene.
// Smoothly interpolates toward the last received network transform
// rather than snapping, to hide the gaps between position updates.
// ===========================================================
export class RemotePlayer {
  constructor(scene, username, avatarConfig) {
    this.scene = scene;
    this.username = username;
    this.avatarRoot = buildAvatar(avatarConfig || defaultAvatarConfig());
    this.animator = new AvatarAnimator(this.avatarRoot);
    this.nameSprite = makeNameSprite(username);
    this.avatarRoot.add(this.nameSprite);
    scene.add(this.avatarRoot);

    this.targetPos = this.avatarRoot.position.clone();
    this.targetYaw = 0;
    this.state = 'idle';
    this.lastUpdate = performance.now();
  }

  updateFromNetwork(data) {
    this.targetPos.set(data.x, data.y, data.z);
    this.targetYaw = data.yaw || 0;
    this.state = data.state || 'idle';
    this.lastUpdate = performance.now();
  }

  setAvatarConfig(config) {
    disposeAvatar(this.avatarRoot);
    this.avatarRoot.remove(this.nameSprite);
    const newRoot = buildAvatar(config || defaultAvatarConfig());
    newRoot.position.copy(this.avatarRoot.position);
    newRoot.rotation.copy(this.avatarRoot.rotation);
    newRoot.add(this.nameSprite);
    this.scene.remove(this.avatarRoot);
    this.scene.add(newRoot);
    this.avatarRoot = newRoot;
    this.animator = new AvatarAnimator(newRoot);
  }

  tick(dt) {
    this.avatarRoot.position.x = damp(this.avatarRoot.position.x, this.targetPos.x, 12, dt);
    this.avatarRoot.position.y = damp(this.avatarRoot.position.y, this.targetPos.y, 12, dt);
    this.avatarRoot.position.z = damp(this.avatarRoot.position.z, this.targetPos.z, 12, dt);

    let diff = this.targetYaw - this.avatarRoot.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.avatarRoot.rotation.y += diff * Math.min(1, 12 * dt);

    // if we haven't heard from them in a while, treat as idle rather than
    // freezing mid-stride
    const state = (performance.now() - this.lastUpdate > 500) ? 'idle' : this.state;
    this.animator.update(dt, state, state === 'run' ? 1 : state === 'walk' ? 0.6 : 0);
  }

  dispose() {
    disposeAvatar(this.avatarRoot);
    this.scene.remove(this.avatarRoot);
  }
}

function makeNameSprite(username) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(15,17,21,0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eef0f4';
  ctx.fillText(String(username || 'Player').slice(0, 18), canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.set(0, TOTAL_HEIGHT + 0.5, 0);
  sprite.renderOrder = 999;
  return sprite;
}
