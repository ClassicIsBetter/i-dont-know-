// ===========================================================
// main.js — application entry point
// ===========================================================
import * as THREE from 'three';
import { bus, toast, formatTime, clamp } from './utils.js';
import { buildAvatar, disposeAvatar } from './avatar.js';
import { World, setupEnvironment, createObjectData } from './world.js';
import { PlayerController } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { Editor } from './editor.js';
import { GameRuntime } from './scripting.js';
import { UI } from './ui.js';
import { AccountUI } from './accountUI.js';
import { MiniAvatarViewer } from './avatarViewer.js';
import { getBuiltinGame } from './games.js';
import { getProject, saveProject, exportProjectJSON, importProjectFromFile, exportHatJSON } from './saveSystem.js';
import { parseRobloxPlaceXML, summarizeImport } from './robloxImport.js';
import { PhysicsWorld } from './physics.js';
import { MultiplayerSession, RemotePlayer, getGuestIdentity } from './multiplayer.js';
import { TouchControls, isTouchDevice } from './touchControls.js';

// ===========================================================
// Audio — tiny procedural sound engine (no external/copyrighted assets)
// ===========================================================
class AudioManager {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.7;
  }
  _ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  _blip(freq, dur, type = 'sine', gainMul = 1) {
    const ctx = this._ensure();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(this.sfxVol * 0.5 * gainMul, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }
  jump() { this._blip(520, 0.14, 'triangle'); }
  land() { this._blip(160, 0.1, 'sine', 0.6); }
  footstep() { this._blip(90 + Math.random() * 20, 0.06, 'square', 0.3); }
  click() { this._blip(700, 0.05, 'square', 0.5); }
  attack() { this._blip(300, 0.12, 'sawtooth', 0.7); }
  hit() { this._blip(140, 0.15, 'square', 0.8); }
  score() { this._blip(900, 0.12, 'sine', 0.6); }
  win() { [660, 880, 1100].forEach((f, i) => setTimeout(() => this._blip(f, 0.2, 'sine', 0.6), i * 110)); }
  rocketLaunch() { this._blip(220, 0.18, 'sawtooth', 0.6); }
  explosion() { this._blip(65, 0.4, 'sawtooth', 1.0); setTimeout(() => this._blip(45, 0.3, 'square', 0.7), 40); }

  setSfxVolume(v) { this.sfxVol = v; }
}
const audio = new AudioManager();
document.addEventListener('click', () => audio._ensure(), { once: true });

// ===========================================================
// Mini avatar viewer — small self-contained rotating preview
// used on the Home hero panel, Avatar page, and Account screen.
// See avatarViewer.js.
// ===========================================================

const EDITOR_FLY_SPEED = 9; // units/sec, doubled while holding Shift
const ROCKET_SPEED = 30; // units/sec
const MOVE_SEND_INTERVAL = 0.1; // seconds — matches multiplayer.js's own send throttle

// ===========================================================
// GameSession — the 3D game/editor viewport (play + edit modes)
// ===========================================================
class GameSession {
  constructor(canvas, avatarConfigProvider) {
    this.canvas = canvas;
    this.avatarConfigProvider = avatarConfigProvider;
    this.mode = null; // 'play' | 'edit'
    this.project = null;
    this.score = 0;
    this.elapsed = 0;
    this.timerRunning = false;
    this.finished = false;
    this.paused = false;
    this.suspended = true;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);

    this.scene = new THREE.Scene();
    setupEnvironment(this.scene, this.renderer);
    this.world = new World(this.scene);

    this.avatarRoot = buildAvatar(avatarConfigProvider());
    this.scene.add(this.avatarRoot);
    this.player = new PlayerController(this.avatarRoot, this.world, this.scene);
    this.orbitCam = new ThirdPersonCamera(this.camera, canvas, this.world);

    this.editor = new Editor({ scene: this.scene, camera: this.camera, renderer: this.renderer, world: this.world, orbitCamera: this.orbitCam });

    this.npcHealth = new Map();
    this.npcCooldown = new Map();
    this._attackCooldown = 0;
    this._footstepTimer = 0;
    this._editorFocus = new THREE.Vector3(0, 1.2, 0);
    this._promptState = { activeId: null, holdElapsed: 0, firedForId: null };

    this.physicsWorld = null;
    this.rockets = []; // { mesh, velocity, age }
    this.explosionFx = []; // { mesh, ring, age }
    this._rocketCooldown = 0;

    this._accountProfile = null; // set via the 'account-changed' bus event
    this.multiplayer = null;
    this.remotePlayers = new Map(); // presence key -> RemotePlayer
    this._moveSendTimer = 0;
    this._chatOpen = false;
    this._chatBound = false;

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(document.getElementById('game-canvas-wrap'));

    this.touchControls = isTouchDevice ? new TouchControls(this) : null;

    this._bindInputs();
  }

  refreshAvatar() {
    const cfg = this.avatarConfigProvider();
    disposeAvatar(this.avatarRoot);
    this.scene.remove(this.avatarRoot);
    this.avatarRoot = buildAvatar(cfg);
    this.scene.add(this.avatarRoot);
    this.player.avatar = this.avatarRoot;
    this.player.animator = new (this.player.animator.constructor)(this.avatarRoot);
  }

  _bindInputs() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.mode !== 'play' || this.paused) return;
      if (!this.orbitCam.locked) { this.orbitCam.lockPointer(); return; }
      if (e.button !== 0) return;
      if (this.project?.mode === 'demolition') this._fireRocket();
      else if (this.project?.mode === 'sword') this._handleAttack();
    });
    window.addEventListener('keydown', (e) => {
      const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (typing) return;
      if (e.code === 'Escape') {
        if (this.mode === 'play' && !this.suspended) this.togglePause();
        else if (this.mode === 'edit') this.editor.deselect();
      }
      if (e.code === 'KeyF') {
        if (this.mode === 'play') this._toggleFirstPersonQuick();
        else if (this.mode === 'edit') this._focusSelectedObject();
      }
      if ((e.code === 'Enter' || e.code === 'KeyT' || e.code === 'Slash') && this.mode === 'play' && !this.paused && this.multiplayer && !this._chatOpen) {
        e.preventDefault();
        this._openChat();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.mode === 'play' && !this.orbitCam.locked && !this.paused && !this.suspended) {
        this.togglePause(true);
      }
    });

    document.getElementById('pause-resume').addEventListener('click', () => this.togglePause(false));
    document.getElementById('pause-respawn').addEventListener('click', () => { this.player.respawn(); this.togglePause(false); });
    document.getElementById('pause-settings').addEventListener('click', () => { this.exitToMenu(); bus.emit('nav-settings'); });
    document.getElementById('pause-exit').addEventListener('click', () => {
      if (this._playtestOrigin) { this._playtestOrigin = false; this.togglePause(false); this.enterEditor(); toast('Back to editor'); }
      else this.exitToMenu();
    });

    document.getElementById('editor-exit').addEventListener('click', () => this.exitToMenu());
    document.getElementById('editor-save').addEventListener('click', () => this._saveCurrentProject());
    document.getElementById('editor-export').addEventListener('click', () => exportProjectJSON(this._exportableProject()));
    document.getElementById('editor-import').addEventListener('click', () => this._importFlow());
    document.getElementById('editor-import-roblox').addEventListener('click', () => this._importRobloxPlace());
    document.getElementById('editor-export-hat').addEventListener('click', () => this._exportAsHat());
    document.getElementById('editor-playtest').addEventListener('click', () => { this._playtestOrigin = true; this.enterPlay({ keepLiveWorld: true }); });
    document.getElementById('editor-project-name').addEventListener('change', (e) => {
      if (this.project) this.project.name = e.target.value;
    });
  }

  _toggleFirstPersonQuick() {
    this.orbitCam.setFirstPerson(!this.orbitCam.firstPerson);
  }

  _focusSelectedObject() {
    const ids = [...this.editor.selectedIds];
    if (ids.length === 0) { toast('Select something first, then press F to focus on it'); return; }
    const box = new THREE.Box3();
    let any = false;
    for (const id of ids) {
      const mesh = this.world.getMesh(id);
      if (!mesh) continue;
      box.expandByObject(mesh);
      any = true;
    }
    if (!any) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this._editorFocus.copy(center);
    const radius = Math.max(size.x, size.y, size.z, 0.6);
    this.orbitCam.distance = clamp(radius * 2.6, 2.5, 30);
    if (ids.length > 1) toast(`Focused on ${ids.length} objects`);
    else toast(`Focused on ${this.world.getData(ids[0])?.name || 'object'}`);
  }

  // ---------------------------------------------------------
  loadProject(projectData, { startInEditor = false } = {}) {
    this.project = projectData;
    this._playtestOrigin = false;
    this.score = 0;
    this.elapsed = 0;
    this.finished = false;
    this.timerRunning = !!(projectData.settings && projectData.settings.timer);
    this.npcHealth.clear();
    this.npcCooldown.clear();
    this._promptState = { activeId: null, holdElapsed: 0, firedForId: null };
    document.getElementById('hud-prompt').classList.add('hidden');

    this._teardownPhysics();

    this.editor.loadNewWorld();
    this.world.loadFromData(projectData.world.map(d => JSON.parse(JSON.stringify(d))));
    this.editor.refresh();

    const spawnData = this.world.allData().find(d => d.type === 'spawn');
    const spawnPos = spawnData ? new THREE.Vector3(spawnData.position.x, spawnData.position.y + 1, spawnData.position.z) : new THREE.Vector3(0, 2, 0);
    this.player.setSpawn(spawnPos);
    this.player.respawn();
    this._editorFocus.set(spawnPos.x, Math.max(1.2, spawnPos.y), spawnPos.z);

    this.orbitCam.theta = Math.PI;
    this.orbitCam.setFirstPerson(false);

    this.runtime = new GameRuntime(this._buildScriptContext());

    document.getElementById('editor-project-name').value = projectData.name || 'Untitled Game';
    document.getElementById('hud-game-name').textContent = projectData.name || 'Untitled Game';
    document.getElementById('hud-health-wrap').classList.toggle('hidden', projectData.mode !== 'sword');

    if (startInEditor || (projectData.settings && projectData.settings.openInEditor)) {
      this.enterEditor();
    } else {
      this.enterPlay();
    }
  }

  // Registers every collidable part as a static physics body. Called
  // fresh on every load/replay of a demolition-mode project so blown-apart
  // debris always resets to the original layout.
  _setupPhysics() {
    this.physicsWorld = new PhysicsWorld();
    for (const data of this.world.allData()) {
      if (!data.collidable) continue;
      const mesh = this.world.getMesh(data.id);
      if (!mesh) continue;
      const size = {
        x: (data.size?.x || 1) * (data.scale?.x || 1),
        y: (data.size?.y || 1) * (data.scale?.y || 1),
        z: (data.size?.z || 1) * (data.scale?.z || 1),
      };
      this.physicsWorld.addStatic(data.id, mesh, size, { indestructible: !!data.indestructible });
    }
  }

  _teardownPhysics() {
    if (this.physicsWorld) { this.physicsWorld.dispose(); this.physicsWorld = null; }
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets = [];
    for (const fx of this.explosionFx) { this.scene.remove(fx.mesh); this.scene.remove(fx.ring); }
    this.explosionFx = [];
    this._rocketCooldown = 0;
  }

  // ---------------------------------------------------------
  _localIdentity() {
    if (this._accountProfile) {
      return { id: this._accountProfile.id, username: this._accountProfile.username };
    }
    const guest = getGuestIdentity();
    return { id: guest.id, username: guest.name };
  }

  _connectMultiplayer() {
    this._disconnectMultiplayer();
    if (!this.project?.project_id) return;

    const identity = this._localIdentity();
    this.multiplayer = new MultiplayerSession(this.project.project_id, {
      id: identity.id,
      username: identity.username,
      avatarConfig: this.avatarConfigProvider(),
    });
    if (!this.multiplayer.available) { this.multiplayer = null; return; }

    this.multiplayer.onPlayerUpdate = (key, presence) => {
      let rp = this.remotePlayers.get(key);
      if (!rp) {
        rp = new RemotePlayer(this.scene, presence.username || 'Player', presence.avatarConfig);
        this.remotePlayers.set(key, rp);
        this._renderRoster();
      } else if (rp.username !== presence.username) {
        rp.username = presence.username;
        this._renderRoster();
      }
    };
    this.multiplayer.onRosterKeys = (keys) => {
      let changed = false;
      for (const [key, rp] of [...this.remotePlayers]) {
        if (!keys.has(key)) { rp.dispose(); this.remotePlayers.delete(key); changed = true; }
      }
      if (changed) this._renderRoster();
    };
    this.multiplayer.onMove = (key, data) => { this.remotePlayers.get(key)?.updateFromNetwork(data); };
    this.multiplayer.onChat = (payload) => this._appendChatLine(payload.username, payload.text);

    this.multiplayer.connect();
    this._bindChatInput();
    this._renderRoster();
  }

  _disconnectMultiplayer() {
    if (this.multiplayer) { this.multiplayer.leave(); this.multiplayer = null; }
    for (const rp of this.remotePlayers.values()) rp.dispose();
    this.remotePlayers.clear();
    this._closeChat();
    document.getElementById('hud-roster').classList.add('hidden');
    document.getElementById('hud-chat-log').innerHTML = '';
  }

  _renderRoster() {
    const rosterEl = document.getElementById('hud-roster');
    if (this.remotePlayers.size === 0) { rosterEl.classList.add('hidden'); rosterEl.innerHTML = ''; return; }
    rosterEl.classList.remove('hidden');
    rosterEl.innerHTML = '';
    const header = document.createElement('div');
    header.textContent = `${this.remotePlayers.size + 1} online`;
    rosterEl.appendChild(header);
    for (const rp of this.remotePlayers.values()) {
      const row = document.createElement('div');
      row.className = 'hud-roster-row';
      const dot = document.createElement('span');
      dot.className = 'hud-roster-dot';
      row.appendChild(dot);
      const name = document.createElement('span');
      name.textContent = rp.username; // textContent only — never trust remote names as HTML
      row.appendChild(name);
      rosterEl.appendChild(row);
    }
  }

  // ---------------------------------------------------------
  _bindChatInput() {
    if (this._chatBound) return;
    this._chatBound = true;
    const input = document.getElementById('hud-chat-input');
    const sendChat = () => {
      const text = input.value.trim();
      if (text && this.multiplayer) this.multiplayer.sendChat(text);
      input.value = '';
      this._closeChat();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') sendChat();
      else if (e.code === 'Escape') { input.value = ''; this._closeChat(); }
    });
    document.getElementById('hud-chat-send').addEventListener('click', sendChat);
  }

  _openChat() {
    if (!this.multiplayer || this._chatOpen) return;
    this._chatOpen = true;
    this.player.inputSuspended = true;
    if (this.touchControls) this.touchControls.hide(); // so taps reach the input instead of the look-drag layer
    document.getElementById('hud-chat-input-row').classList.remove('hidden');
    const input = document.getElementById('hud-chat-input');
    input.value = '';
    input.focus();
  }

  _closeChat() {
    this._chatOpen = false;
    this.player.inputSuspended = false;
    document.getElementById('hud-chat-input-row').classList.add('hidden');
    document.getElementById('hud-chat-input').blur();
    if (this.touchControls && this.mode === 'play' && !this.paused) this.touchControls.show(this.project);
  }

  _appendChatLine(username, text) {
    const log = document.getElementById('hud-chat-log');
    const line = document.createElement('div');
    line.className = 'hud-chat-line';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-name';
    nameSpan.textContent = username; // never innerHTML — this text comes from another client
    line.appendChild(nameSpan);
    line.appendChild(document.createTextNode(text));
    log.appendChild(line);
    while (log.children.length > 8) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  _buildScriptContext() {
    const session = this;
    return {
      world: this.world,
      globalScripts: this.project?.scripts || [],
      showMessage: (text) => session._hudMessage(text),
      addScore: (amount) => session._addScore(amount),
      damagePlayer: (amount) => { session.player.takeDamage(amount); session._updateHealthBar(); },
      teleport: (x, y, z) => session.player.position.set(x, y, z),
      respawnPlayer: () => session.player.respawn(),
      setCheckpoint: (data) => session.player.setSpawn(new THREE.Vector3(data.position.x, data.position.y + 1, data.position.z)),
      spawnObjectData: (data) => session.world.addObject(createObjectData(data.type || 'part', data)),
      destroyObjectId: (id) => { if (id) session.world.removeObject(id); },
      setProperty: (id, key, value) => {
        if (!id || value === undefined) return;
        const data = session.world.getData(id);
        if (!data) return;
        data[key] = value;
        session.world.updateObject(id, {});
      },
      setSize: (id, x, y, z) => {
        if (!id) return;
        const data = session.world.getData(id);
        if (!data || !data.size) return;
        data.size = {
          x: x !== undefined ? Math.max(0.05, x) : data.size.x,
          y: y !== undefined ? Math.max(0.05, y) : data.size.y,
          z: z !== undefined ? Math.max(0.05, z) : data.size.z,
        };
        session.world.updateObject(id, {});
      },
      moveObject: (id, x, y, z) => {
        if (!id) return;
        const data = session.world.getData(id);
        if (!data) return;
        data.position = {
          x: x !== undefined ? x : data.position.x,
          y: y !== undefined ? y : data.position.y,
          z: z !== undefined ? z : data.position.z,
        };
        session.world.updateObject(id, {});
      },
    };
  }

  // ---------------------------------------------------------
  enterPlay({ keepLiveWorld = false } = {}) {
    this.mode = 'play';
    this.suspended = false;
    this.paused = false;
    this.editor.setActive(false);
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    document.getElementById('hud-crosshair').classList.toggle('hidden', !this.orbitCam.firstPerson);
    this.player.enabled = true;
    this.player.respawn();

    this._teardownPhysics(); // always rebuild fresh — matches current world, including live editor edits
    if (this.project?.mode === 'demolition') this._setupPhysics();

    this._connectMultiplayer();
    if (this.touchControls) this.touchControls.show(this.project);

    this.runtime?.fireEvent('onPlayerJoin');
    if (!keepLiveWorld) toast(`Loaded ${this.project.name}`);
  }

  enterEditor() {
    this.mode = 'edit';
    this.suspended = false;
    this.paused = false;
    this.player.enabled = false;
    this.orbitCam.unlockPointer();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    this.editor.setActive(true);
    this._teardownPhysics(); // no simulation while editing
    this._disconnectMultiplayer();
    if (this.touchControls) this.touchControls.hide();
  }

  togglePause(forceState) {
    this.paused = forceState !== undefined ? forceState : !this.paused;
    document.getElementById('pause-menu').classList.toggle('hidden', !this.paused);
    document.getElementById('pause-exit').textContent = this._playtestOrigin ? 'Back to editor' : 'Exit game';
    if (this.paused) this.orbitCam.unlockPointer();
    if (this.touchControls) {
      if (this.paused) this.touchControls.hide();
      else this.touchControls.show(this.project);
    }
  }

  exitToMenu() {
    this.suspended = true;
    this.mode = null;
    this.orbitCam.unlockPointer();
    this.editor.setActive(false);
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    this._teardownPhysics();
    this._disconnectMultiplayer();
    if (this.touchControls) this.touchControls.hide();
    bus.emit('exit-game');
  }

  // ---------------------------------------------------------
  _saveCurrentProject() {
    if (!this.project || this.project.builtin) { toast("Built-in demos can't be overwritten — use Export instead."); return; }
    const data = this._exportableProject();
    saveProject(data);
    toast('Project saved');
    bus.emit('project-saved');
  }

  _exportableProject() {
    return { ...this.project, world: this.world.allData().map(d => JSON.parse(JSON.stringify(d))) };
  }

  async _importFlow() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = await importProjectFromFile(file);
        this.loadProject(data, { startInEditor: true });
        toast('Project imported');
      } catch (e) {
        toast('Import failed: invalid JSON file');
      }
    });
    input.click();
  }

  _importRobloxPlace() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.rbxlx,application/xml,text/xml';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      let text;
      try {
        text = await file.text();
      } catch (e) {
        toast('Could not read that file');
        return;
      }

      const scaleInput = window.prompt(
        'Import scale (1 = no change). Roblox and Blockverse use different unit scales, so try a smaller number like 0.5 if things come in too large:',
        '1'
      );
      if (scaleInput === null) return; // cancelled
      const scaleVal = parseFloat(scaleInput);
      const scale = Number.isFinite(scaleVal) && scaleVal > 0 ? scaleVal : 1;

      const result = parseRobloxPlaceXML(text, { scale });
      if (!result.ok) { window.alert(result.error); return; }
      if (result.objects.length === 0) {
        window.alert('Nothing supported was found in this place — only basic parts, spawn points, models/folders, and proximity prompts are imported.');
        return;
      }

      const counts = summarizeImport(result.objects);
      const skippedText = Object.entries(result.skipped).map(([cls, n]) => `${n} ${cls}`).join(', ') || 'nothing';
      window.alert(
        `Imported: ${counts.parts} parts, ${counts.spawns} spawn point(s), ${counts.folders} folder(s), ${counts.prompts} with proximity prompts.\n\n` +
        `Skipped (not supported): ${skippedText}.\n\n` +
        `Note: every shape imports as a block and original Roblox materials aren't preserved — only position, size, color, and transparency carry over.`
      );

      this.editor.addImportedObjects(result.objects);
      toast('Roblox place imported');
    });
    input.click();
  }

  _exportAsHat() {
    const data = this.world.allData();
    if (data.length === 0) { toast('Add some parts first, then Export as Hat'); return; }

    const marker = data.find(d => d.type === 'part' && (d.name || '').trim().toLowerCase() === 'topofhead');
    const origin = marker ? marker.position : { x: 0, y: 0, z: 0 };
    const partsData = data.filter(d => d !== marker);
    if (partsData.length === 0) { toast('Add some hat parts around the TopOfHead marker first'); return; }

    const defaultName = (this.project && !this.project.builtin) ? this.project.name : 'My Hat';
    const name = (window.prompt('Name this hat:', defaultName) || '').trim();
    if (!name) return;
    const hat = {
      type: 'blockverse_hat',
      id: 'hat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      name,
      parts: partsData.map(d => ({
        position: { x: d.position.x - origin.x, y: d.position.y - origin.y, z: d.position.z - origin.z },
        rotation: { x: d.rotation.x, y: d.rotation.y, z: d.rotation.z },
        scale: { x: d.scale.x, y: d.scale.y, z: d.scale.z },
        size: { x: d.size.x, y: d.size.y, z: d.size.z },
        color: d.color,
      })),
    };
    exportHatJSON(hat);
    toast(marker
      ? `Exported "${name}" using the TopOfHead marker as the reference point.`
      : `Exported "${name}" — upload it from the Avatar page. (No TopOfHead marker found, so world origin (0,0,0) was used.)`);
  }

  // ---------------------------------------------------------
  _hudMessage(text) {
    const m = document.getElementById('hud-message');
    m.textContent = text;
    m.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => m.classList.remove('show'), 2200);
  }
  _addScore(amount) {
    this.score += amount;
    document.getElementById('hud-score').textContent = `Score: ${this.score}`;
    if (amount > 0) audio.score();
  }
  _updateHealthBar() {
    const pct = clamp((this.player.health / this.player.maxHealth) * 100, 0, 100);
    document.getElementById('hud-health-fill').style.width = pct + '%';
    if (this.player.health <= 0) {
      this._hudMessage('You were defeated — respawning');
      this.player.respawn();
      this._updateHealthBar();
    }
  }

  _updatePrompt(dt) {
    const p = this.player.position;
    let nearestData = null, nearestDist = Infinity;
    for (const data of this.world.allData()) {
      if (!data.prompt?.enabled) continue;
      const mesh = this.world.getMesh(data.id);
      if (!mesh) continue;
      const dist = mesh.position.distanceTo(p);
      const maxDist = data.prompt.maxDistance || 3.5;
      if (dist <= maxDist && dist < nearestDist) { nearestDist = dist; nearestData = data; }
    }

    const promptEl = document.getElementById('hud-prompt');
    if (!nearestData) {
      if (this._promptState.activeId !== null) {
        this._promptState = { activeId: null, holdElapsed: 0, firedForId: null };
        promptEl.classList.add('hidden');
      }
      return;
    }

    if (this._promptState.activeId !== nearestData.id) {
      this._promptState = { activeId: nearestData.id, holdElapsed: 0, firedForId: null };
    }

    const keyCode = nearestData.prompt.key || 'KeyE';
    const held = this.player.keys.has(keyCode);
    const holdNeeded = nearestData.prompt.holdSeconds || 0;
    const keyLabel = keyCode.replace('Key', '').replace('Digit', '');

    promptEl.classList.remove('hidden');
    const pct = holdNeeded > 0 ? Math.min(100, (this._promptState.holdElapsed / holdNeeded) * 100) : 0;
    promptEl.innerHTML =
      `<div class="hud-prompt-key">${keyLabel}</div>` +
      `<div class="hud-prompt-text">${nearestData.prompt.text || 'Interact'}</div>` +
      (holdNeeded > 0 ? `<div class="hud-prompt-bar"><div class="hud-prompt-fill" style="width:${pct}%"></div></div>` : '');

    if (held) {
      this._promptState.holdElapsed += dt;
      if (this._promptState.holdElapsed >= holdNeeded && this._promptState.firedForId !== nearestData.id) {
        this._promptState.firedForId = nearestData.id;
        this.runtime?.fireEvent('onPrompt', nearestData.id);
      }
    } else {
      this._promptState.holdElapsed = 0;
      if (this._promptState.firedForId === nearestData.id) this._promptState.firedForId = null;
    }
  }

  _handleAttack() {
    if (this._attackCooldown > 0) return;
    this._attackCooldown = 0.35;
    this.player.attack();
    audio.attack();
    // find nearby npc/model to hit
    const playerPos = this.player.position;
    for (const data of this.world.allData()) {
      if (data.type !== 'npc') continue;
      const mesh = this.world.getMesh(data.id);
      if (!mesh) continue;
      const dist = mesh.position.distanceTo(new THREE.Vector3(playerPos.x, mesh.position.y, playerPos.z));
      if (dist < 2.3) {
        const hp = (this.npcHealth.get(data.id) ?? 100) - 34;
        this.npcHealth.set(data.id, hp);
        audio.hit();
        this._hudMessage(`Hit ${data.name}!`);
        this._addScore(10);
        this._flash(mesh);
        if (hp <= 0) {
          this.npcHealth.set(data.id, 100);
          this._hudMessage(`${data.name} down! Respawning...`);
          setTimeout(() => { /* dummy "respawns" — position unchanged, health reset */ }, 10);
        }
      }
    }
  }

  _flash(mesh) {
    mesh.traverse(o => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          const orig = m.emissive ? m.emissive.getHex() : 0x000000;
          if (m.emissive) {
            m.emissive.setHex(0xff4444);
            setTimeout(() => m.emissive.setHex(orig), 120);
          }
        });
      }
    });
  }

  // ---------------------------------------------------------
  _fireRocket() {
    if (this._rocketCooldown > 0) { this._hudMessage('Reloading…'); return; }
    this._rocketCooldown = 1.1;
    audio.rocketLaunch();

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.normalize();

    const spawnPos = this.camera.position.clone().addScaledVector(dir, 1.0);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 10),
      new THREE.MeshStandardMaterial({ color: '#ff6a3d', emissive: '#ff3d1a', emissiveIntensity: 1.4, roughness: 0.4 })
    );
    mesh.position.copy(spawnPos);
    this.scene.add(mesh);

    this.rockets.push({ mesh, velocity: dir.clone().multiplyScalar(ROCKET_SPEED), age: 0, prevPos: spawnPos.clone() });
  }

  _updateRockets(dt) {
    if (this.rockets.length === 0) return;
    this._rocketRaycaster = this._rocketRaycaster || new THREE.Raycaster();

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      r.prevPos.copy(r.mesh.position);
      r.mesh.position.addScaledVector(r.velocity, dt);

      let hitPoint = null;
      const segment = r.mesh.position.clone().sub(r.prevPos);
      const dist = segment.length();
      if (dist > 0.0001) {
        segment.normalize();
        this._rocketRaycaster.set(r.prevPos, segment);
        this._rocketRaycaster.far = dist;
        const hits = this._rocketRaycaster.intersectObjects(this.world.getCollidableMeshes(), true);
        if (hits.length > 0) hitPoint = hits[0].point;
      }

      const timedOut = r.age > 4 || r.mesh.position.y < -20;
      if (hitPoint || timedOut) {
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
        if (hitPoint) this._triggerExplosion(hitPoint);
      }
    }
  }

  _triggerExplosion(position) {
    audio.explosion();
    const radius = this.project?.settings?.blastRadius || 6;
    const strength = this.project?.settings?.blastStrength || 15;

    if (this.physicsWorld) {
      const affected = this.physicsWorld.explode({ x: position.x, y: position.y, z: position.z }, radius, strength);
      if (affected.length > 0) this._addScore(affected.length * 5);
    }

    const fireball = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 12, 12),
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9 })
    );
    fireball.position.copy(position);
    this.scene.add(fireball);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: '#ffdca8', transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    ring.position.copy(position);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);

    this.explosionFx.push({ mesh: fireball, ring, age: 0 });
  }

  _updateExplosionFx(dt) {
    for (let i = this.explosionFx.length - 1; i >= 0; i--) {
      const fx = this.explosionFx[i];
      fx.age += dt;
      const t = fx.age / 0.45;
      if (t >= 1) {
        this.scene.remove(fx.mesh);
        this.scene.remove(fx.ring);
        this.explosionFx.splice(i, 1);
        continue;
      }
      fx.mesh.scale.setScalar(1 + t * 9);
      fx.mesh.material.opacity = 0.9 * (1 - t);
      fx.ring.scale.setScalar(1 + t * 14);
      fx.ring.material.opacity = 0.7 * (1 - t);
    }
  }

  // ---------------------------------------------------------
  update(dt) {
    if (this.suspended) return;
    if (this.mode === 'play' && !this.paused) {
      this.player.update(dt, this.orbitCam.yaw);

      // footsteps
      if (this.player.grounded && (this.player.state === 'walk' || this.player.state === 'run')) {
        this._footstepTimer -= dt;
        if (this._footstepTimer <= 0) { audio.footstep(); this._footstepTimer = this.player.state === 'run' ? 0.26 : 0.4; }
      }
      if (this.player.animator.justLanded) { audio.land(); this.player.animator.justLanded = false; }

      this._attackCooldown = Math.max(0, this._attackCooldown - dt);
      this._rocketCooldown = Math.max(0, this._rocketCooldown - dt);
      this._updateRockets(dt);
      this._updateExplosionFx(dt);
      if (this.physicsWorld) this.physicsWorld.step(dt);

      for (const rp of this.remotePlayers.values()) rp.tick(dt);
      if (this.multiplayer) {
        this._moveSendTimer -= dt;
        if (this._moveSendTimer <= 0) {
          this._moveSendTimer = MOVE_SEND_INTERVAL;
          const mp = this.player.position;
          this.multiplayer.sendMove({ x: mp.x, y: mp.y, z: mp.z, yaw: this.player.yaw, state: this.player.state });
        }
      }

      // gameplay: checkpoints / killzones / finish via direct type checks + generic scripts via touches
      const p = this.player.position;
      const playerBox = new THREE.Box3(
        new THREE.Vector3(p.x - 0.4, p.y, p.z - 0.4),
        new THREE.Vector3(p.x + 0.4, p.y + 1.8, p.z + 0.4)
      );
      for (const data of this.world.allData()) {
        const mesh = this.world.getMesh(data.id);
        if (!mesh) continue;
        if (data.type === 'checkpoint' || data.type === 'killzone' || data.type === 'finish') {
          const box = new THREE.Box3().setFromObject(mesh);
          if (box.intersectsBox(playerBox)) {
            if (data.type === 'checkpoint' && this._lastCheckpoint !== data.id) {
              this._lastCheckpoint = data.id;
              this.player.setSpawn(new THREE.Vector3(mesh.position.x, mesh.position.y + 1, mesh.position.z));
              this._hudMessage('Checkpoint!');
              this._addScore(5);
            } else if (data.type === 'killzone') {
              this.player.respawn();
              this._hudMessage('Ouch! Respawned.');
            } else if (data.type === 'finish' && !this.finished) {
              this.finished = true;
              this.timerRunning = false;
              this._hudMessage('🏁 Finished!');
              this._addScore(50);
              audio.win();
            }
          }
        }
      }
      this.runtime?.checkTouches(playerBox);

      // NPCs idle-animate like players while playing
      for (const data of this.world.allData()) {
        if (data.type !== 'npc') continue;
        const mesh = this.world.getMesh(data.id);
        if (mesh?.userData.animator) mesh.userData.animator.update(dt, 'idle', 0);
      }

      this._updatePrompt(dt);

      // sword-mode: dummies periodically strike back if player lingers close
      if (this.project?.mode === 'sword') {
        document.getElementById('hud-health-wrap').classList.remove('hidden');
        for (const data of this.world.allData()) {
          if (data.type !== 'npc') continue;
          const mesh = this.world.getMesh(data.id);
          if (!mesh) continue;
          const dist = mesh.position.distanceTo(p);
          const cd = this.npcCooldown.get(data.id) || 0;
          if (dist < 1.8) {
            if (cd <= 0) {
              this.player.takeDamage(6);
              this._updateHealthBar();
              this.npcCooldown.set(data.id, 1.1);
              this._flash(mesh);
            }
          }
          this.npcCooldown.set(data.id, Math.max(0, (this.npcCooldown.get(data.id) || 0) - dt));
        }
      }

      if (this.timerRunning) {
        this.elapsed += dt;
        document.getElementById('hud-timer').textContent = formatTime(this.elapsed);
      }

      this.orbitCam.update(dt, new THREE.Vector3(p.x, p.y + (this.avatarRoot.userData.height || 2.2) * 0.72, p.z), this.avatarRoot);
    } else if (this.mode === 'edit') {
      // WASD flies the camera's focus point around; disabled while typing in a panel field
      const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (typing) {
        this.player.keys.clear();
      } else {
        const keys = this.player.keys;
        let mx = 0, mz = 0;
        if (keys.has('KeyW')) mz += 1;
        if (keys.has('KeyS')) mz -= 1;
        if (keys.has('KeyD')) mx += 1;
        if (keys.has('KeyA')) mx -= 1;
        if (mx !== 0 || mz !== 0) {
          const theta = this.orbitCam.theta;
          const forward = new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta));
          const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
          const move = new THREE.Vector3().addScaledVector(forward, mz).addScaledVector(right, mx);
          if (move.lengthSq() > 0) move.normalize();
          const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
          const speed = sprinting ? EDITOR_FLY_SPEED * 2.2 : EDITOR_FLY_SPEED;
          this._editorFocus.addScaledVector(move, speed * dt);
        }
      }
      this.orbitCam.update(dt, this._editorFocus, null);
      this.avatarRoot.visible = false;
      this.editor.update();
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const wrap = document.getElementById('game-canvas-wrap');
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

// ===========================================================
// Boot / app wiring
// ===========================================================
const BOOT_TIPS = [
  'Stacking voxels…', 'Rigging blocky limbs…', 'Warming up the physics…',
  'Painting checkpoints…', 'Tuning the camera boom…', 'Waking up the training dummies…',
];

async function boot() {
  const fill = document.getElementById('boot-bar-fill');
  const tip = document.getElementById('boot-tip');
  let p = 0;
  const tipInterval = setInterval(() => { tip.textContent = BOOT_TIPS[Math.floor(Math.random() * BOOT_TIPS.length)]; }, 550);
  await new Promise((resolve) => {
    const step = () => {
      p += Math.random() * 18 + 6;
      fill.style.width = Math.min(100, p) + '%';
      if (p >= 100) { resolve(); return; }
      setTimeout(step, 140);
    };
    step();
  });
  clearInterval(tipInterval);
  await new Promise(r => setTimeout(r, 150));

  document.getElementById('boot-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  initApp();
}

function initApp() {
  const ui = new UI();
  audio.setSfxVolume(ui.settings.sfx);

  const getAvatarConfig = () => ui.avatarConfig;

  // ---- account (sign in/up/out, profile, search) ----
  const accountUI = new AccountUI(getAvatarConfig);

  // ---- hero + avatar preview mini viewers ----
  const heroViewer = new MiniAvatarViewer(document.getElementById('hero-avatar-mount'), getAvatarConfig(), { interactive: false });
  const avatarPreview = new MiniAvatarViewer(document.getElementById('avatar-preview-mount'), getAvatarConfig(), { interactive: true });

  bus.on('avatar-changed', (cfg) => {
    heroViewer.setConfig(cfg);
    avatarPreview.setConfig(cfg);
    if (session.mode) session.refreshAvatar();
    accountUI.syncAvatarConfig(cfg);
    session.multiplayer?.updatePresence(cfg);
  });

  bus.on('settings-changed', (settings) => {
    audio.setSfxVolume(settings.sfx);
    session.orbitCam.sensitivity = settings.sensitivity;
    session.orbitCam.setFirstPerson(settings.firstPerson);
    document.getElementById('hud-crosshair').classList.toggle('hidden', !settings.firstPerson);
  });

  bus.on('account-changed', (profile) => { session._accountProfile = profile; });

  bus.on('nav-settings', () => ui.showScreen('settings'));

  // ---- main game session ----
  const canvas = document.getElementById('game-canvas');
  const session = new GameSession(canvas, getAvatarConfig);
  session.orbitCam.sensitivity = ui.settings.sensitivity;
  session.orbitCam.setFirstPerson(ui.settings.firstPerson);

  function launchProject(id, { edit = false } = {}) {
    const builtin = getBuiltinGame(id);
    const data = builtin || getProject(id);
    if (!data) { toast('Project not found'); return; }
    ui.showScreen('game');
    // small timeout lets the canvas become visible before we size the renderer
    requestAnimationFrame(() => {
      session.resize();
      session.loadProject(JSON.parse(JSON.stringify(data)), { startInEditor: edit });
    });
  }

  bus.on('play-game', (id) => launchProject(id, { edit: false }));
  bus.on('open-editor', (id) => launchProject(id, { edit: true }));
  bus.on('exit-game', () => ui.showScreen('home'));

  // ---- shared render loop ----
  let last = performance.now();
  let fpsAcc = 0, fpsCount = 0, fpsTimer = 0;
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const onGameScreen = document.getElementById('screen-game').classList.contains('active');
    if (onGameScreen) session.update(dt);

    if (ui.settings.showFps) {
      fpsAcc += dt; fpsCount++;
      fpsTimer += dt;
      if (fpsTimer > 0.4) {
        document.getElementById('fps-badge').textContent = `${Math.round(fpsCount / fpsAcc)} FPS`;
        fpsAcc = 0; fpsCount = 0; fpsTimer = 0;
      }
    }
  }
  loop();

  window.addEventListener('resize', () => session.resize());

  toast('Welcome to Blockverse!');
}

boot();
