// ===========================================================
// world.js — voxel/part world: materials, object lifecycle, lighting, (de)serialization
// ===========================================================
import * as THREE from 'three';
import { uid } from './utils.js';
import { buildAvatar, defaultAvatarConfig, AvatarAnimator } from './avatar.js';

export const MATERIALS = {
  grass:    { color: '#4caf50', roughness: 1.0 },
  dirt:     { color: '#7a5230', roughness: 1.0 },
  stone:    { color: '#8a8f98', roughness: 0.95 },
  wood:     { color: '#9a6633', roughness: 0.85 },
  concrete: { color: '#a9adb4', roughness: 0.9 },
  brick:    { color: '#a1543a', roughness: 0.95 },
  glass:    { color: '#bfe3ff', roughness: 0.1, transparent: true, opacity: 0.35 },
  metal:    { color: '#c7cdd6', roughness: 0.35, metalness: 0.7 },
  plastic:  { color: '#f2a541', roughness: 0.5 },
  neon:     { color: '#4fd1c5', roughness: 0.4, emissive: '#1c6b64', emissiveIntensity: 0.6 },
};

const materialCache = new Map();
function getMaterial(materialKey, colorHex, transparency = 0) {
  const key = `${materialKey}|${colorHex}|${transparency}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const base = MATERIALS[materialKey] || MATERIALS.stone;
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex || base.color,
    roughness: base.roughness ?? 0.8,
    metalness: base.metalness ?? 0,
  });
  if (base.emissive) { mat.emissive = new THREE.Color(base.emissive); mat.emissiveIntensity = base.emissiveIntensity || 0.5; }
  const t = transparency ?? (base.transparent ? 1 - (base.opacity ?? 0.35) : 0);
  if (t > 0) { mat.transparent = true; mat.opacity = 1 - t; }
  materialCache.set(key, mat);
  return mat;
}

// ---- default data factory for each addable object type ----
export function createObjectData(type, overrides = {}) {
  const base = {
    id: uid(type),
    type,
    name: defaultName(type),
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    size: { x: 2, y: 2, z: 2 },
    color: '#8a8f98',
    material: 'stone',
    transparency: 0,
    collidable: true,
    anchored: true,
    parentId: null,
    scripts: [],
    scriptSource: '',
    prompt: null, // { enabled, text, key, maxDistance, holdSeconds } — set via the Properties panel
    indestructible: false, // physics-enabled games (see physics.js) never convert/move this part, e.g. a baseplate
    visible: true, // scripts can toggle this at runtime via the setVisible action
  };
  switch (type) {
    case 'part': base.material = 'stone'; base.color = '#8a8f98'; break;
    case 'spawn': base.material = 'plastic'; base.color = '#4fd1c5'; base.size = { x: 3, y: 0.3, z: 3 }; base.collidable = false; break;
    case 'model': base.material = 'wood'; base.color = '#9a6633'; base.size = { x: 2, y: 2, z: 2 }; break;
    case 'light': base.color = '#ffd28a'; base.size = { x: 0.4, y: 0.4, z: 0.4 }; base.collidable = false; base.intensity = 1.2; base.range = 12; break;
    case 'camera': base.color = '#4fd1c5'; base.size = { x: 0.5, y: 0.5, z: 0.5 }; base.collidable = false; base.fov = 60; break;
    case 'npc': base.color = '#2e6fd9'; base.size = { x: 1, y: 2.6, z: 1 }; base.collidable = true; base.dialogue = 'Hello there!'; break;
    case 'checkpoint': base.color = '#f2a541'; base.material = 'neon'; base.size = { x: 2, y: 0.2, z: 2 }; base.collidable = false; break;
    case 'killzone': base.color = '#e5484d'; base.material = 'neon'; base.size = { x: 3, y: 0.2, z: 3 }; base.collidable = false; break;
    case 'finish': base.color = '#4fd1c5'; base.material = 'neon'; base.size = { x: 3, y: 0.3, z: 3 }; base.collidable = false; break;
    case 'folder': base.collidable = false; base.size = { x: 0, y: 0, z: 0 }; break;
  }
  return { ...base, ...overrides };
}

function defaultName(type) {
  const n = { part: 'Part', spawn: 'SpawnLocation', model: 'Model', light: 'PointLight', camera: 'Camera', npc: 'NPC', checkpoint: 'Checkpoint', killzone: 'KillZone', finish: 'Finish', folder: 'Folder' };
  return n[type] || 'Object';
}

/**
 * World manages the live THREE representation of a project's object list,
 * keeping THREE.Mesh instances in sync with plain-JSON object data so the
 * whole world can be saved/loaded/exported as JSON.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.objects = new Map(); // id -> { data, mesh }
    this.group = new THREE.Group();
    this.group.name = 'World';
    this.scene.add(this.group);
  }

  clear() {
    for (const { mesh } of this.objects.values()) {
      this.group.remove(mesh);
      disposeMesh(mesh);
    }
    this.objects.clear();
  }

  addObject(data) {
    const mesh = this._buildMesh(data);
    this.objects.set(data.id, { data, mesh });
    this.group.add(mesh);
    return mesh;
  }

  removeObject(id) {
    const entry = this.objects.get(id);
    if (!entry) return;
    this.group.remove(entry.mesh);
    disposeMesh(entry.mesh);
    this.objects.delete(id);
  }

  getData(id) { return this.objects.get(id)?.data; }
  getMesh(id) { return this.objects.get(id)?.mesh; }

  updateObject(id, patch) {
    const entry = this.objects.get(id);
    if (!entry) return;
    Object.assign(entry.data, patch);
    this._applyTransform(entry);
  }

  syncFromMesh(id) {
    // pull transform back from a mesh (e.g. after gizmo drag) into data
    const entry = this.objects.get(id);
    if (!entry) return;
    const { mesh, data } = entry;
    data.position = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    data.rotation = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
    data.scale = { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z };
  }

  allData() {
    return [...this.objects.values()].map(e => e.data);
  }

  getCollidableMeshes() {
    const arr = [];
    for (const { data, mesh } of this.objects.values()) {
      if (data.collidable) arr.push(mesh);
    }
    return arr;
  }

  loadFromData(dataArray) {
    this.clear();
    for (const d of dataArray) this.addObject(d);
  }

  _buildMesh(data) {
    let mesh;
    const size = data.size || { x: 1, y: 1, z: 1 };
    switch (data.type) {
      case 'light': {
        const light = new THREE.PointLight(data.color || '#ffd28a', data.intensity ?? 1.2, data.range ?? 12, 2);
        const holder = new THREE.Group();
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), new THREE.MeshBasicMaterial({ color: data.color || '#ffd28a' }));
        holder.add(light, bulb);
        mesh = holder;
        break;
      }
      case 'camera': {
        const helper = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), new THREE.MeshStandardMaterial({ color: data.color || '#4fd1c5' }));
        helper.rotation.x = Math.PI / 2;
        mesh = helper;
        break;
      }
      case 'npc': {
        const avatarGroup = buildAvatar(defaultAvatarConfig());
        const torso = avatarGroup.userData.parts?.torso;
        if (torso && data.color) {
          torso.material = torso.material.clone();
          torso.material.color.set(data.color);
        }
        avatarGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        avatarGroup.userData.animator = new AvatarAnimator(avatarGroup);
        mesh = avatarGroup;
        break;
      }
      case 'folder': {
        // purely organizational — no 3D presence, exists only for the Explorer
        mesh = new THREE.Object3D();
        break;
      }
      default: {
        const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const mat = getMaterial(data.material, data.color, data.transparency);
        mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = data.type === 'part' || data.type === 'model';
        mesh.receiveShadow = true;
      }
    }
    mesh.name = data.name;
    mesh.userData.id = data.id;
    mesh.userData.type = data.type;
    mesh.visible = data.visible !== false;
    this._positionMesh(mesh, data);
    return mesh;
  }

  _positionMesh(mesh, data) {
    mesh.position.set(data.position.x, data.position.y, data.position.z);
    mesh.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    mesh.scale.set(data.scale.x, data.scale.y, data.scale.z);
  }

  _applyTransform(entry) {
    // rebuild mesh only if shape-affecting fields changed color/material/size are cheap via full rebuild
    const { data, mesh } = entry;
    this.group.remove(mesh);
    disposeMesh(mesh);
    const newMesh = this._buildMesh(data);
    entry.mesh = newMesh;
    this.group.add(newMesh);
  }
}

function disposeMesh(mesh) {
  mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { if (m.map) m.map.dispose(); if (m.dispose) m.dispose(); });
    }
  });
}

// ===========================================================
// Scene environment: sky, fog, ambient + sun lighting
// ===========================================================
export function setupEnvironment(scene, renderer) {
  scene.background = new THREE.Color('#7fb8e0');
  scene.fog = new THREE.Fog('#9fd0ea', 40, 160);

  const hemi = new THREE.HemisphereLight('#bfe3ff', '#5b7a4f', 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff3d6', 1.15);
  sun.position.set(30, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return { hemi, sun };
}

// ===========================================================
// Day/night cycle — a handful of keyframes (by hour, 0-24) interpolated
// between. The h:12 keyframe intentionally matches setupEnvironment()'s
// original static look, so a project left at the default noon looks
// exactly as it always did.
// ===========================================================
const DAY_KEYFRAMES = [
  { h: 0, bg: '#0b1026', fog: '#0b1026', hemiSky: '#222a4a', hemiGround: '#0e1220', hemiI: 0.28, sunColor: '#3a4570', sunI: 0.05 },
  { h: 5, bg: '#0b1026', fog: '#0b1026', hemiSky: '#222a4a', hemiGround: '#0e1220', hemiI: 0.28, sunColor: '#3a4570', sunI: 0.05 },
  { h: 6.5, bg: '#e8935f', fog: '#e8935f', hemiSky: '#ffcf9e', hemiGround: '#4a3a2a', hemiI: 0.7, sunColor: '#ffb26b', sunI: 0.9 },
  { h: 9, bg: '#a9d3ec', fog: '#bcdcf0', hemiSky: '#cfe9ff', hemiGround: '#54704a', hemiI: 0.85, sunColor: '#fff0d0', sunI: 1.1 },
  { h: 12, bg: '#7fb8e0', fog: '#9fd0ea', hemiSky: '#bfe3ff', hemiGround: '#5b7a4f', hemiI: 0.9, sunColor: '#fff3d6', sunI: 1.15 },
  { h: 15, bg: '#8fc3e6', fog: '#a9d7ee', hemiSky: '#cbe8ff', hemiGround: '#587a4c', hemiI: 0.88, sunColor: '#ffedcf', sunI: 1.1 },
  { h: 17.5, bg: '#e8935f', fog: '#e8935f', hemiSky: '#ffcf9e', hemiGround: '#4a3a2a', hemiI: 0.7, sunColor: '#ff9d5c', sunI: 0.85 },
  { h: 19, bg: '#1c2444', fog: '#1c2444', hemiSky: '#28305a', hemiGround: '#10141f', hemiI: 0.4, sunColor: '#3a4570', sunI: 0.15 },
  { h: 24, bg: '#0b1026', fog: '#0b1026', hemiSky: '#222a4a', hemiGround: '#0e1220', hemiI: 0.28, sunColor: '#3a4570', sunI: 0.05 },
];

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function lerpHexColor(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }

function dayNightBlend(hour) {
  const h = ((hour % 24) + 24) % 24;
  let lo = DAY_KEYFRAMES[0], hi = DAY_KEYFRAMES[DAY_KEYFRAMES.length - 1];
  for (let i = 0; i < DAY_KEYFRAMES.length - 1; i++) {
    if (h >= DAY_KEYFRAMES[i].h && h <= DAY_KEYFRAMES[i + 1].h) { lo = DAY_KEYFRAMES[i]; hi = DAY_KEYFRAMES[i + 1]; break; }
  }
  const t = clamp01((h - lo.h) / ((hi.h - lo.h) || 1));
  return {
    bg: lerpHexColor(lo.bg, hi.bg, t),
    fog: lerpHexColor(lo.fog, hi.fog, t),
    hemiSky: lerpHexColor(lo.hemiSky, hi.hemiSky, t),
    hemiGround: lerpHexColor(lo.hemiGround, hi.hemiGround, t),
    hemiI: lo.hemiI + (hi.hemiI - lo.hemiI) * t,
    sunColor: lerpHexColor(lo.sunColor, hi.sunColor, t),
    sunI: lo.sunI + (hi.sunI - lo.sunI) * t,
  };
}

// Applies an hour-of-day (0-24, wraps) to the scene/lights setupEnvironment
// created. Cheap enough to call every frame while auto-time is advancing.
export function applyTimeOfDay(scene, env, hour) {
  const s = dayNightBlend(hour);
  scene.background = s.bg;
  if (scene.fog) scene.fog.color = s.fog;
  env.hemi.color.copy(s.hemiSky);
  env.hemi.groundColor.copy(s.hemiGround);
  env.hemi.intensity = s.hemiI;
  env.sun.color.copy(s.sunColor);
  env.sun.intensity = s.sunI;

  // sun arc: rises ~6, peaks ~12, sets ~18, opposite side at midnight
  const t = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  const elevation = Math.sin(t);
  const azimuth = Math.cos(t);
  const R = 50;
  env.sun.position.set(azimuth * R * 0.55 + 12, Math.max(elevation, -0.08) * R + 8, 20);
  env.sun.target.position.set(0, 0, 0);
}

// ===========================================================
// Procedural starter world data — a small, visually interesting map
// ===========================================================
export function buildStarterWorldData() {
  const objs = [];
  const push = (type, overrides) => objs.push(createObjectData(type, overrides));

  // baseplate (large ground of grass parts, tiled for visual break-up)
  const tile = 8;
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      push('part', {
        name: 'Baseplate',
        material: 'grass', color: MATERIALS.grass.color,
        size: { x: tile, y: 1, z: tile },
        position: { x: x * tile, y: -0.5, z: z * tile },
        collidable: true,
      });
    }
  }

  // spawn pad
  push('spawn', { name: 'SpawnLocation', position: { x: 0, y: 0.15, z: 0 } });

  // stone path
  for (let i = 0; i < 10; i++) {
    push('part', { name: 'Path', material: 'concrete', color: MATERIALS.concrete.color, size: { x: 2, y: 0.2, z: 2 }, position: { x: 0, y: 0.1, z: 3 + i * 2.2 } });
  }

  // a simple house
  const houseX = -8, houseZ = 6;
  push('part', { name: 'House Floor', material: 'wood', color: MATERIALS.wood.color, size: { x: 6, y: 0.3, z: 6 }, position: { x: houseX, y: 0.15, z: houseZ } });
  push('part', { name: 'House Wall N', material: 'brick', color: MATERIALS.brick.color, size: { x: 6, y: 3, z: 0.3 }, position: { x: houseX, y: 1.65, z: houseZ - 3 } });
  push('part', { name: 'House Wall S', material: 'brick', color: MATERIALS.brick.color, size: { x: 6, y: 3, z: 0.3 }, position: { x: houseX, y: 1.65, z: houseZ + 3 } });
  push('part', { name: 'House Wall W', material: 'brick', color: MATERIALS.brick.color, size: { x: 0.3, y: 3, z: 6 }, position: { x: houseX - 3, y: 1.65, z: houseZ } });
  push('part', { name: 'House Wall E (window)', material: 'glass', color: MATERIALS.glass.color, transparency: 0.6, size: { x: 0.3, y: 3, z: 6 }, position: { x: houseX + 3, y: 1.65, z: houseZ } });
  push('part', { name: 'House Roof', material: 'wood', color: '#7a4a24', size: { x: 6.6, y: 0.4, z: 6.6 }, position: { x: houseX, y: 3.4, z: houseZ }, rotation: { x: 0, y: Math.PI / 4, z: 0 } });

  // trees (trunk + canopy)
  const treeSpots = [[6, 4], [9, 8], [-4, 10], [12, -2], [-10, -4], [4, -8]];
  for (const [tx, tz] of treeSpots) {
    push('part', { name: 'Tree Trunk', material: 'wood', color: '#6b4226', size: { x: 0.6, y: 2.4, z: 0.6 }, position: { x: tx, y: 1.2, z: tz } });
    push('part', { name: 'Tree Canopy', material: 'grass', color: '#2e8b57', size: { x: 2.2, y: 2.2, z: 2.2 }, position: { x: tx, y: 3.4, z: tz } });
  }

  // low wall / plaza decoration
  for (let i = -4; i <= 4; i++) {
    push('part', { name: 'Plaza Light Post', material: 'metal', color: '#8a8f98', size: { x: 0.25, y: 2, z: 0.25 }, position: { x: i * 3, y: 1, z: -6 } });
  }
  push('light', { name: 'Sun Fill', position: { x: 0, y: 8, z: 0 }, intensity: 0.6, range: 30 });

  // road block
  push('part', { name: 'Road', material: 'concrete', color: '#3a3d44', size: { x: 4, y: 0.15, z: 30 }, position: { x: 8, y: 0.08, z: 6 } });

  // ---- lookout tower (stacked, climbable via the stairs on its side) ----
  const towerX = -14, towerZ = -8;
  for (let lvl = 0; lvl < 4; lvl++) {
    push('part', { name: `Tower Level ${lvl + 1}`, material: 'stone', color: '#8a8f98', size: { x: 3, y: 0.4, z: 3 }, position: { x: towerX, y: 0.2 + lvl * 2.4, z: towerZ } });
    if (lvl < 3) {
      push('part', { name: `Tower Pillar ${lvl + 1}`, material: 'stone', color: '#787d86', size: { x: 2.6, y: 2.4, z: 0.3 }, position: { x: towerX, y: 1.4 + lvl * 2.4, z: towerZ - 1.4 } });
    }
  }
  for (let s = 0; s < 8; s++) {
    push('part', { name: `Tower Stair ${s + 1}`, material: 'wood', color: '#9a6633', size: { x: 1.1, y: 0.25, z: 1.1 }, position: { x: towerX + 2.2, y: 0.2 + s * 1.15, z: towerZ + 1.5 - s * 1.1 } });
  }
  push('light', { name: 'Tower Beacon', color: '#ffd28a', position: { x: towerX, y: 10.2, z: towerZ }, intensity: 1, range: 16 });

  // ---- pond crossed by a stone bridge, with a little island ----
  const pondZ = 20;
  push('part', { name: 'Pond', material: 'glass', color: '#3fa9dd', transparency: 0.35, size: { x: 12, y: 0.15, z: 10 }, position: { x: 0, y: -0.35, z: pondZ }, collidable: false });
  push('part', { name: 'Bridge', material: 'wood', color: '#8a5a30', size: { x: 2.2, y: 0.25, z: 12 }, position: { x: 0, y: -0.1, z: pondZ } });
  for (let i = -1; i <= 1; i += 2) {
    push('part', { name: 'Bridge Rail', material: 'wood', color: '#6b4226', size: { x: 0.15, y: 0.6, z: 12 }, position: { x: i * 1.1, y: 0.25, z: pondZ } });
  }
  push('part', { name: 'Island', material: 'grass', color: '#4caf50', size: { x: 4, y: 0.8, z: 4 }, position: { x: 0, y: -0.15, z: pondZ + 7 } });
  push('part', { name: 'Island Palm Trunk', material: 'wood', color: '#8a6a3a', size: { x: 0.35, y: 2.6, z: 0.35 }, position: { x: 0, y: 1.4, z: pondZ + 7 }, rotation: { x: 0, y: 0, z: 0.15 } });
  push('part', { name: 'Island Palm Leaves', material: 'grass', color: '#3fae5a', size: { x: 2.4, y: 0.4, z: 2.4 }, position: { x: 0.3, y: 2.7, z: pondZ + 7 } });

  // ---- tiny hedge maze with a prize at the center ----
  const mazeX = 16, mazeZ = -4;
  const mazeWalls = [
    [0, 0, 5, 0.6], [0, 4, 5, 0.6], [-2.3, 2, 0.6, 4], [2.3, 2, 0.6, 4],
    [-1.1, 1.2, 0.6, 1.6], [1.1, 2.8, 0.6, 1.6],
  ];
  mazeWalls.forEach(([dx, dz, w, d], i) => {
    push('part', { name: `Hedge ${i + 1}`, material: 'grass', color: '#2e8b57', size: { x: w, y: 1.4, z: d }, position: { x: mazeX + dx, y: 0.7, z: mazeZ + dz } });
  });
  push('part', { name: 'Maze Prize Pedestal', material: 'neon', color: '#f2a541', size: { x: 1, y: 0.6, z: 1 }, position: { x: mazeX, y: 0.3, z: mazeZ + 2 } });

  // ---- small fountain plaza ----
  const plazaX = -6, plazaZ = -14;
  push('part', { name: 'Fountain Base', material: 'stone', color: '#8a8f98', size: { x: 5, y: 0.4, z: 5 }, position: { x: plazaX, y: 0.2, z: plazaZ } });
  push('part', { name: 'Fountain Rim', material: 'stone', color: '#787d86', size: { x: 4, y: 0.6, z: 4 }, position: { x: plazaX, y: 0.5, z: plazaZ } });
  push('part', { name: 'Fountain Water', material: 'glass', color: '#4fd1c5', transparency: 0.25, size: { x: 3.2, y: 0.3, z: 3.2 }, position: { x: plazaX, y: 0.65, z: plazaZ }, collidable: false });
  push('part', { name: 'Fountain Spout', material: 'neon', color: '#4fd1c5', size: { x: 0.4, y: 1.4, z: 0.4 }, position: { x: plazaX, y: 1.1, z: plazaZ } });
  [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(([dx, dz], i) => {
    push('part', { name: `Plaza Bench ${i + 1}`, material: 'wood', color: '#9a6633', size: { x: 1.4, y: 0.4, z: 0.5 }, position: { x: plazaX + dx, y: 0.2, z: plazaZ + dz } });
  });

  // ---- skate ramp for a bit of movement fun ----
  const rampX = 18, rampZ = 14;
  push('part', { name: 'Ramp Up', material: 'concrete', color: '#a9adb4', size: { x: 3, y: 0.3, z: 4 }, position: { x: rampX, y: 0.9, z: rampZ }, rotation: { x: 0.5, y: 0, z: 0 } });
  push('part', { name: 'Ramp Down', material: 'concrete', color: '#a9adb4', size: { x: 3, y: 0.3, z: 4 }, position: { x: rampX, y: 0.9, z: rampZ + 6.2 }, rotation: { x: -0.5, y: 0, z: 0 } });
  push('part', { name: 'Ramp Landing', material: 'concrete', color: '#a9adb4', size: { x: 3, y: 0.3, z: 2 }, position: { x: rampX, y: 1.85, z: rampZ + 3.1 } });

  return objs;
}
