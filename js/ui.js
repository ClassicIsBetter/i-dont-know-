// ===========================================================
// ui.js — screen navigation + non-3D UI wiring
// ===========================================================
import { el, toast, bus, uid } from './utils.js';
import { CATALOG, defaultAvatarConfig, PROPORTIONS } from './avatar.js';
import {
  listProjects, deleteProject, newProjectData, saveProject, importProjectFromFile,
  loadAvatarConfig, saveAvatarConfig, loadSettings, saveSettings,
  listCustomHats, saveCustomHat, deleteCustomHat, importHatFromFile,
  listCustomFaces, saveCustomFace, deleteCustomFace,
} from './saveSystem.js';
import { loadPublishedGames, getPublishedGames } from './publishedGames.js';

export class UI {
  constructor() {
    this.avatarConfig = loadAvatarConfig() || defaultAvatarConfig();
    this.settings = Object.assign({
      graphics: 'medium', sensitivity: 1, sfx: 0.7, firstPerson: false, showFps: false,
    }, loadSettings() || {});
    this.currentAvatarTab = 'skin';
    this._gamesLoaded = false;
    this._loadCustomHatsIntoCatalog();
    this._loadCustomFacesIntoCatalog();
    this._bindNav();
    this._bindCreate();
    this._bindAvatarTabs();
    this._bindCustomHats();
    this._bindCustomFaces();
    this._bindSettings();
    this._bindHero();
    this.renderDiscovery();
    this.renderMyGames();
    this.renderCreateProjects();
    this.renderAvatarTab('skin');
    this.renderCustomHatList();
    this.renderCustomFaceList();
    this.applySettingsToInputs();

    loadPublishedGames().then(() => {
      this._gamesLoaded = true;
      this.renderDiscovery();
      this.renderMyGames();
    });
  }

  // ---------------------------------------------------------
  _bindNav() {
    document.querySelectorAll('.nav-btn[data-screen]').forEach(btn => {
      btn.addEventListener('click', () => this.showScreen(btn.dataset.screen));
    });
  }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${name}`)?.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
    document.getElementById('topnav').classList.toggle('hidden', name === 'game');
    if (name === 'create') { this.renderCreateProjects(); this.renderMyGames(); }
    bus.emit('screen-change', name);
  }

  _bindHero() {
    document.getElementById('hero-play-btn').addEventListener('click', () => this.showScreen('home'));
    document.getElementById('hero-create-btn').addEventListener('click', () => this.showScreen('create'));
  }

  // ---------------------------------------------------------
  renderDiscovery() {
    const grid = document.getElementById('discovery-grid');
    grid.innerHTML = '';
    const games = getPublishedGames();
    games.forEach(g => grid.appendChild(this._gameCard(g, { launch: true })));
    if (games.length === 0) {
      grid.appendChild(el('p', 'muted small', this._gamesLoaded ? 'No games published yet.' : 'Loading games\u2026'));
    }
  }

  renderMyGames() {
    const grid = document.getElementById('mygames-grid');
    grid.innerHTML = '';
    const published = getPublishedGames();
    const own = listProjects();
    [...published, ...own].forEach(g => grid.appendChild(this._gameCard(g, { launch: true, editable: !g.builtin })));
    if (own.length === 0) {
      const hint = el('p', 'muted small', 'Your saved and published projects will show up here alongside the platform\u2019s games.');
      grid.appendChild(hint);
    }
  }

  renderCreateProjects() {
    const wrap = document.getElementById('create-projects-list');
    wrap.innerHTML = '';
    listProjects().forEach(p => {
      const card = el('div', 'project-card');
      card.appendChild(el('div', 'card-title', `${p.icon || '🧊'} ${p.name}`));
      card.appendChild(el('div', 'card-sub', new Date(p.updated).toLocaleDateString()));
      const row = el('div', 'row');
      const editBtn = el('button', 'btn btn-ghost', 'Edit');
      editBtn.addEventListener('click', () => bus.emit('open-editor', p.project_id));
      const delBtn = el('button', 'btn btn-danger', 'Delete');
      delBtn.addEventListener('click', () => { deleteProject(p.project_id); toast('Project deleted'); this.renderCreateProjects(); this.renderMyGames(); });
      row.appendChild(editBtn); row.appendChild(delBtn);
      card.appendChild(row);
      wrap.appendChild(card);
    });
  }

  _gameCard(g, { launch, editable } = {}) {
    const card = el('div', 'card');
    const thumb = el('div', 'card-thumb', g.icon || '🎮');
    thumb.style.background = 'linear-gradient(135deg, var(--bg-2), var(--bg-3))';
    card.appendChild(thumb);
    const body = el('div', 'card-body');
    body.appendChild(el('div', 'card-title', g.name));
    body.appendChild(el('div', 'card-sub', g.description || `by ${g.creator || 'Unknown'}`));
    card.appendChild(body);
    const actions = el('div', 'card-actions');
    const playBtn = el('button', 'btn btn-primary', '▶ Play');
    playBtn.addEventListener('click', () => bus.emit('play-game', g.project_id));
    actions.appendChild(playBtn);
    if (editable) {
      const editBtn = el('button', 'btn btn-ghost', 'Edit');
      editBtn.addEventListener('click', () => bus.emit('open-editor', g.project_id));
      actions.appendChild(editBtn);
      const delBtn = el('button', 'btn btn-danger', '✕');
      delBtn.addEventListener('click', () => { deleteProject(g.project_id); toast('Deleted'); this.renderMyGames(); this.renderCreateProjects(); });
      actions.appendChild(delBtn);
    }
    card.appendChild(actions);
    return card;
  }

  // ---------------------------------------------------------
  _bindCreate() {
    document.getElementById('create-new-project').addEventListener('click', () => {
      const data = newProjectData('Untitled Game');
      saveProject(data);
      toast('New project created');
      bus.emit('open-editor', data.project_id);
      this.renderCreateProjects();
    });
  }

  // ---------------------------------------------------------
  _bindAvatarTabs() {
    document.querySelectorAll('.avatar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.avatar-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentAvatarTab = tab.dataset.tab;
        this.renderAvatarTab(tab.dataset.tab);
      });
    });
  }

  renderAvatarTab(tab) {
    const wrap = document.getElementById('avatar-options');
    wrap.innerHTML = '';
    document.getElementById('custom-hats-panel').classList.toggle('hidden', tab !== 'hat');
    document.getElementById('custom-faces-panel').classList.toggle('hidden', tab !== 'face');
    const items = CATALOG[tab] || [];
    items.forEach(item => {
      const swatch = el('div', 'opt-swatch', item.custom && item.imageUrl ? '' : item.label);
      if (item.color) {
        swatch.style.background = `linear-gradient(160deg, ${item.color}, ${shade(item.color)})`;
      } else if (item.custom && item.imageUrl) {
        swatch.style.backgroundImage = `url(${item.imageUrl})`;
        swatch.style.backgroundSize = 'cover';
        swatch.style.backgroundPosition = 'center';
      } else if (item.custom && item.parts && item.parts[0]) {
        swatch.style.background = `linear-gradient(160deg, ${item.parts[0].color || '#8a8f98'}, ${shade(item.parts[0].color || '#8a8f98')})`;
      }
      if (this.avatarConfig[tab] === item.id) swatch.classList.add('selected');
      swatch.addEventListener('click', () => {
        this.avatarConfig[tab] = item.id;
        saveAvatarConfig(this.avatarConfig);
        this.renderAvatarTab(tab);
        bus.emit('avatar-changed', this.avatarConfig);
      });
      wrap.appendChild(swatch);
    });
  }

  // ---------------------------------------------------------
  _loadCustomHatsIntoCatalog() {
    const existingIds = new Set(CATALOG.hat.map(h => h.id));
    for (const hat of listCustomHats()) {
      if (existingIds.has(hat.id)) continue;
      CATALOG.hat.push({ id: hat.id, label: hat.name, shape: 'custom', parts: hat.parts, custom: true });
    }
  }

  _bindCustomHats() {
    const input = document.getElementById('custom-hat-input');
    document.getElementById('custom-hat-upload-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const hat = await importHatFromFile(file);
        saveCustomHat(hat);
        CATALOG.hat = CATALOG.hat.filter(h => h.id !== hat.id);
        CATALOG.hat.push({ id: hat.id, label: hat.name, shape: 'custom', parts: hat.parts, custom: true });
        this.renderCustomHatList();
        if (this.currentAvatarTab === 'hat') this.renderAvatarTab('hat');
        toast(`Uploaded "${hat.name}"`);
      } catch (e) {
        toast("Couldn't read that file — export a hat from the World Editor first.");
      }
    });
  }

  renderCustomHatList() {
    const list = document.getElementById('custom-hat-list');
    list.innerHTML = '';
    const hats = listCustomHats();
    if (hats.length === 0) {
      list.appendChild(el('p', 'muted small', 'No custom hats uploaded yet.'));
      return;
    }
    hats.forEach(hat => {
      const chip = el('div', 'custom-hat-chip');
      const dot = el('span', 'swatch-dot');
      dot.style.background = (hat.parts && hat.parts[0] && hat.parts[0].color) || '#8a8f98';
      chip.appendChild(dot);
      chip.appendChild(el('span', null, hat.name));
      const del = el('button', null, '✕');
      del.title = 'Delete this custom hat';
      del.addEventListener('click', () => {
        deleteCustomHat(hat.id);
        CATALOG.hat = CATALOG.hat.filter(h => h.id !== hat.id);
        if (this.avatarConfig.hat === hat.id) {
          this.avatarConfig.hat = 'hat-none';
          saveAvatarConfig(this.avatarConfig);
          bus.emit('avatar-changed', this.avatarConfig);
        }
        this.renderCustomHatList();
        if (this.currentAvatarTab === 'hat') this.renderAvatarTab('hat');
        toast('Custom hat deleted');
      });
      chip.appendChild(del);
      list.appendChild(chip);
    });
  }

  // ---------------------------------------------------------
  _loadCustomFacesIntoCatalog() {
    const existingIds = new Set(CATALOG.face.map(f => f.id));
    for (const face of listCustomFaces()) {
      if (existingIds.has(face.id)) continue;
      CATALOG.face.push({ id: face.id, label: face.name, imageUrl: face.imageUrl, custom: true });
    }
  }

  _bindCustomFaces() {
    const input = document.getElementById('custom-face-input');
    document.getElementById('custom-face-upload-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast('Please upload an image file'); return; }
      try {
        const imageUrl = await cropImageToHeadAspect(file);
        const face = { id: uid('face'), name: file.name.replace(/\.[^.]+$/, '') || 'Custom Face', imageUrl };
        saveCustomFace(face);
        CATALOG.face = CATALOG.face.filter(f => f.id !== face.id);
        CATALOG.face.push({ id: face.id, label: face.name, imageUrl: face.imageUrl, custom: true });
        this.renderCustomFaceList();
        if (this.currentAvatarTab === 'face') this.renderAvatarTab('face');
        toast(`Uploaded "${face.name}"`);
      } catch (e) {
        toast("Couldn't read that image file");
      }
    });
  }

  renderCustomFaceList() {
    const list = document.getElementById('custom-face-list');
    list.innerHTML = '';
    const faces = listCustomFaces();
    if (faces.length === 0) {
      list.appendChild(el('p', 'muted small', 'No custom faces uploaded yet.'));
      return;
    }
    faces.forEach(face => {
      const chip = el('div', 'custom-hat-chip');
      const thumb = document.createElement('img');
      thumb.className = 'custom-face-thumb';
      thumb.src = face.imageUrl;
      thumb.alt = face.name;
      chip.appendChild(thumb);
      chip.appendChild(el('span', null, face.name));
      const del = el('button', null, '✕');
      del.title = 'Delete this custom face';
      del.addEventListener('click', () => {
        deleteCustomFace(face.id);
        CATALOG.face = CATALOG.face.filter(f => f.id !== face.id);
        if (this.avatarConfig.face === face.id) {
          this.avatarConfig.face = 'face-a';
          saveAvatarConfig(this.avatarConfig);
          bus.emit('avatar-changed', this.avatarConfig);
        }
        this.renderCustomFaceList();
        if (this.currentAvatarTab === 'face') this.renderAvatarTab('face');
        toast('Custom face deleted');
      });
      chip.appendChild(del);
      list.appendChild(chip);
    });
  }

  // ---------------------------------------------------------
  _bindSettings() {
    const g = document.getElementById('setting-graphics');
    const sens = document.getElementById('setting-sensitivity');
    const sfx = document.getElementById('setting-sfx');
    const fp = document.getElementById('setting-firstperson');
    const fps = document.getElementById('setting-showfps');
    const persist = () => { saveSettings(this.settings); bus.emit('settings-changed', this.settings); };
    g.addEventListener('change', () => { this.settings.graphics = g.value; persist(); });
    sens.addEventListener('input', () => { this.settings.sensitivity = parseFloat(sens.value); persist(); });
    sfx.addEventListener('input', () => { this.settings.sfx = parseFloat(sfx.value); persist(); });
    fp.addEventListener('change', () => { this.settings.firstPerson = fp.checked; persist(); });
    fps.addEventListener('change', () => { this.settings.showFps = fps.checked; document.getElementById('fps-badge').classList.toggle('hidden', !fps.checked); persist(); });
  }

  applySettingsToInputs() {
    document.getElementById('setting-graphics').value = this.settings.graphics;
    document.getElementById('setting-sensitivity').value = this.settings.sensitivity;
    document.getElementById('setting-sfx').value = this.settings.sfx;
    document.getElementById('setting-firstperson').checked = this.settings.firstPerson;
    document.getElementById('setting-showfps').checked = this.settings.showFps;
    document.getElementById('fps-badge').classList.toggle('hidden', !this.settings.showFps);
  }
}

function shade(hex) {
  try {
    const c = parseInt(hex.slice(1), 16);
    let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    r = Math.max(0, r - 40); g = Math.max(0, g - 40); b = Math.max(0, b - 40);
    return `rgb(${r},${g},${b})`;
  } catch { return hex; }
}

// Crops an uploaded image to the head's width:height aspect ratio (center
// crop) and re-encodes it small, so it maps onto the face decal the same
// way the built-in procedural faces do. Returns a data URL.
function cropImageToHeadAspect(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const targetAspect = PROPORTIONS.headW / PROPORTIONS.headH;
        const srcAspect = img.width / img.height;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (srcAspect > targetAspect) {
          sw = img.height * targetAspect;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / targetAspect;
          sy = (img.height - sh) / 2;
        }
        const outH = 220;
        const outW = Math.round(outH * targetAspect);
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not load that image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}
