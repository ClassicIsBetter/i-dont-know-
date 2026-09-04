// ===========================================================
// saveSystem.js — local project persistence (LocalStorage) + JSON export/import
// ===========================================================
import { uid } from './utils.js';
import { buildStarterWorldData } from './world.js';

const STORE_KEY = 'blockverse_projects_v1';
const AVATAR_KEY = 'blockverse_avatar_v1';
const SETTINGS_KEY = 'blockverse_settings_v1';

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function newProjectData(name = 'Untitled Game') {
  return {
    project_id: uid('proj'),
    name,
    description: '',
    creator: 'You',
    icon: '🧊',
    created: Date.now(),
    updated: Date.now(),
    published: false,
    world: buildStarterWorldData(),
    scripts: [
      { event: 'onPlayerJoin', actions: [{ type: 'showMessage', text: 'Welcome!' }] },
    ],
    settings: { gravity: -28, killY: -25 },
  };
}

export function listProjects() {
  const store = readStore();
  return Object.values(store).sort((a, b) => b.updated - a.updated);
}

export function getProject(id) {
  return readStore()[id] || null;
}

export function saveProject(data) {
  const store = readStore();
  data.updated = Date.now();
  store[data.project_id] = data;
  writeStore(store);
  return data;
}

export function deleteProject(id) {
  const store = readStore();
  delete store[id];
  writeStore(store);
}

export function publishProject(id, published = true) {
  const store = readStore();
  if (store[id]) { store[id].published = published; writeStore(store); }
}

export function exportProjectJSON(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(data.name || 'project').replace(/\s+/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importProjectFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.project_id) data.project_id = uid('proj');
        if (!Array.isArray(data.world)) data.world = [];
        resolve(data);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ---- avatar persistence ----
export function saveAvatarConfig(config) {
  localStorage.setItem(AVATAR_KEY, JSON.stringify(config));
}
export function loadAvatarConfig() {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---- custom hats (modeled in the World Editor, exported/imported as JSON) ----
const CUSTOM_HATS_KEY = 'blockverse_custom_hats_v1';

export function listCustomHats() {
  try {
    const raw = localStorage.getItem(CUSTOM_HATS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomHat(hat) {
  const hats = listCustomHats().filter(h => h.id !== hat.id);
  hats.push(hat);
  localStorage.setItem(CUSTOM_HATS_KEY, JSON.stringify(hats));
  return hat;
}

export function deleteCustomHat(id) {
  const hats = listCustomHats().filter(h => h.id !== id);
  localStorage.setItem(CUSTOM_HATS_KEY, JSON.stringify(hats));
}

export function exportHatJSON(hat) {
  const blob = new Blob([JSON.stringify(hat, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(hat.name || 'hat').replace(/\s+/g, '_')}.hat.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importHatFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.parts) || data.parts.length === 0) {
          reject(new Error('Not a valid hat file (missing "parts").'));
          return;
        }
        if (!data.id) data.id = uid('hat');
        if (!data.name) data.name = 'Custom Hat';
        resolve(data);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ---- custom faces (uploaded images, cropped/compressed at upload time) ----
const CUSTOM_FACES_KEY = 'blockverse_custom_faces_v1';

export function listCustomFaces() {
  try {
    const raw = localStorage.getItem(CUSTOM_FACES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomFace(face) {
  const faces = listCustomFaces().filter(f => f.id !== face.id);
  faces.push(face);
  localStorage.setItem(CUSTOM_FACES_KEY, JSON.stringify(faces));
  return face;
}

export function deleteCustomFace(id) {
  const faces = listCustomFaces().filter(f => f.id !== id);
  localStorage.setItem(CUSTOM_FACES_KEY, JSON.stringify(faces));
}

// ---- settings persistence ----
export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
