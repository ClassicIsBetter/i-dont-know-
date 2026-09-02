// ===========================================================
// games.js — built-in demo games (Obby, Sword Arena, Sandbox)
// Each is a self-contained project-shaped object so it can be loaded
// through the same World/save pipeline as user-made games.
// ===========================================================
import { createObjectData } from './world.js';

function obbyWorld() {
  const objs = [];
  const push = (type, o) => objs.push(createObjectData(type, o));

  push('part', { name: 'Start Platform', material: 'concrete', color: '#a9adb4', size: { x: 6, y: 1, z: 6 }, position: { x: 0, y: -0.5, z: 0 } });
  push('spawn', { name: 'SpawnLocation', position: { x: 0, y: 0.2, z: 0 } });
  push('checkpoint', { name: 'Checkpoint 0', position: { x: 0, y: 0.15, z: 2 } });

  // a winding platform course with gaps (kill zones between)
  let x = 0, z = 4, step = 0;
  const positions = [];
  for (let i = 0; i < 16; i++) {
    z += 3.2;
    x += (i % 3 === 0) ? 2.4 : (i % 3 === 1 ? -2.4 : 0);
    positions.push({ x, z, y: Math.sin(i * 0.6) * 0.6 });
  }
  positions.forEach((p, i) => {
    push('part', { name: `Platform ${i + 1}`, material: i % 4 === 0 ? 'wood' : 'stone', color: i % 4 === 0 ? '#9a6633' : '#8a8f98', size: { x: 2.2, y: 0.6, z: 2.2 }, position: { x: p.x, y: p.y, z: p.z } });
    if (i > 0 && i % 4 === 0) {
      push('checkpoint', { name: `Checkpoint ${i}`, position: { x: p.x, y: p.y + 0.5, z: p.z } });
    }
  });
  // a wide kill-lava strip under the whole course
  push('killzone', { name: 'Void', material: 'neon', color: '#e5484d', size: { x: 60, y: 0.2, z: 60 }, position: { x: 6, y: -6, z: 30 } });

  const last = positions[positions.length - 1];
  push('finish', { name: 'Finish', position: { x: last.x, y: last.y + 0.5, z: last.z + 2 } });
  push('part', { name: 'Finish Pad', material: 'neon', color: '#4fd1c5', size: { x: 3, y: 0.4, z: 3 }, position: { x: last.x, y: last.y, z: last.z + 2 } });

  return objs;
}

function swordArenaWorld() {
  const objs = [];
  const push = (type, o) => objs.push(createObjectData(type, o));

  push('part', { name: 'Arena Floor', material: 'concrete', color: '#787d86', size: { x: 26, y: 1, z: 26 }, position: { x: 0, y: -0.5, z: 0 } });
  push('spawn', { name: 'SpawnLocation', position: { x: 0, y: 0.2, z: -9 } });

  // ring wall
  const wallH = 3, ringR = 13;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    push('part', {
      name: 'Arena Wall', material: 'brick', color: '#a1543a',
      size: { x: 2.4, y: wallH, z: 0.6 },
      position: { x: Math.cos(a) * ringR, y: wallH / 2, z: Math.sin(a) * ringR },
      rotation: { x: 0, y: -a, z: 0 },
    });
  }
  // pillars for cover
  [[5, 5], [-5, 5], [5, -3], [-5, -3]].forEach(([x, z], i) => {
    push('part', { name: `Pillar ${i + 1}`, material: 'stone', color: '#8a8f98', size: { x: 1.4, y: 3.4, z: 1.4 }, position: { x, y: 1.7, z } });
  });
  // training dummies (NPCs act as attackable targets)
  [[0, 4], [4, -2], [-4, -2]].forEach(([x, z], i) => {
    push('npc', { name: `Training Dummy ${i + 1}`, color: '#e5484d', position: { x, y: 0, z }, dialogue: 'Hit me!', scripts: [] });
  });

  return objs;
}

function sandboxWorld() {
  const objs = [];
  const push = (type, o) => objs.push(createObjectData(type, o));
  const tile = 8;
  for (let x = -5; x <= 5; x++) {
    for (let z = -5; z <= 5; z++) {
      push('part', { name: 'Baseplate', material: 'grass', color: '#4caf50', size: { x: tile, y: 1, z: tile }, position: { x: x * tile, y: -0.5, z: z * tile } });
    }
  }
  push('spawn', { name: 'SpawnLocation', position: { x: 0, y: 0.2, z: 0 } });
  // a handful of starter parts to play with
  const mats = ['stone', 'wood', 'brick', 'glass', 'concrete', 'metal'];
  mats.forEach((m, i) => {
    push('part', { name: `Sample ${m}`, material: m, size: { x: 2, y: 2, z: 2 }, position: { x: -10 + i * 4, y: 1, z: -10 } });
  });
  return objs;
}

function desertRuinsWorld() {
  const objs = [];
  const push = (type, o) => objs.push(createObjectData(type, o));
  const tile = 8;
  for (let x = -5; x <= 5; x++) {
    for (let z = -5; z <= 5; z++) {
      push('part', { name: 'Sand', material: 'concrete', color: '#d9c48a', size: { x: tile, y: 1, z: tile }, position: { x: x * tile, y: -0.5, z: z * tile } });
    }
  }
  push('spawn', { name: 'SpawnLocation', position: { x: 0, y: 0.2, z: 0 } });

  // a stepped pyramid to climb
  const layers = 5;
  for (let l = 0; l < layers; l++) {
    const s = 11 - l * 2;
    push('part', { name: `Pyramid Layer ${l + 1}`, material: 'stone', color: '#c9a86a', size: { x: s, y: 1.4, z: s }, position: { x: 12, y: 0.7 + l * 1.4, z: 0 } });
  }
  push('light', { name: 'Pyramid Torch', color: '#ffb347', position: { x: 12, y: layers * 1.4 + 1, z: 0 }, intensity: 1, range: 14 });

  // broken columns / ruins scattered around
  const ruinSpots = [[-8, -6], [-14, 4], [-4, 10], [6, -12], [-10, -14]];
  ruinSpots.forEach(([x, z], i) => {
    const h = 1.5 + (i % 3) * 0.8;
    push('part', { name: `Ruined Column ${i + 1}`, material: 'stone', color: '#c9a86a', size: { x: 1, y: h, z: 1 }, position: { x, y: h / 2, z } });
    push('part', { name: `Column Cap ${i + 1}`, material: 'stone', color: '#b89860', size: { x: 1.4, y: 0.3, z: 1.4 }, position: { x, y: h + 0.15, z } });
  });

  // a small oasis
  push('part', { name: 'Oasis Water', material: 'glass', color: '#3fa9dd', transparency: 0.3, size: { x: 6, y: 0.2, z: 6 }, position: { x: -18, y: -0.35, z: -18 }, collidable: false });
  [[-21, -20], [-15, -21], [-20, -15]].forEach(([x, z], i) => {
    push('part', { name: `Palm Trunk ${i + 1}`, material: 'wood', color: '#8a6a3a', size: { x: 0.35, y: 2.4, z: 0.35 }, position: { x, y: 1.2, z }, rotation: { x: 0, y: 0, z: 0.12 } });
    push('part', { name: `Palm Leaves ${i + 1}`, material: 'grass', color: '#4a9d4f', size: { x: 2.2, y: 0.4, z: 2.2 }, position: { x: x + 0.25, y: 2.5, z } });
  });

  // sample materials palette for building
  const mats = ['stone', 'wood', 'brick', 'glass', 'concrete', 'metal'];
  mats.forEach((m, i) => {
    push('part', { name: `Sample ${m}`, material: m, size: { x: 2, y: 2, z: 2 }, position: { x: 14 + i * 4, y: 1, z: -16 } });
  });

  return objs;
}

function demolitionWorld() {
  const objs = [];
  const push = (type, o) => objs.push(createObjectData(type, o));

  // wide static ground so blown-apart debris always has somewhere to land
  push('part', { name: 'Ground', material: 'grass', color: '#4caf50', size: { x: 60, y: 1, z: 60 }, position: { x: 0, y: -0.5, z: 0 }, indestructible: true });
  push('spawn', { name: 'SpawnLocation', position: { x: 0, y: 0.2, z: -14 } });

  const wallH = 3, wallT = 0.4, houseW = 10, houseD = 8, hx = 0, hz = 4;
  const wallY = wallH / 2 + 0.3;

  push('part', { name: 'House Floor', material: 'concrete', color: '#9aa0ab', size: { x: houseW, y: 0.3, z: houseD }, position: { x: hx, y: 0.15, z: hz } });

  // exterior walls — south wall has a doorway gap
  push('part', { name: 'Wall North', material: 'brick', color: '#a1543a', size: { x: houseW, y: wallH, z: wallT }, position: { x: hx, y: wallY, z: hz - houseD / 2 } });
  push('part', { name: 'Wall South Left', material: 'brick', color: '#a1543a', size: { x: houseW / 2 - 1, y: wallH, z: wallT }, position: { x: hx - houseW / 4 - 0.5, y: wallY, z: hz + houseD / 2 } });
  push('part', { name: 'Wall South Right', material: 'brick', color: '#a1543a', size: { x: houseW / 2 - 1, y: wallH, z: wallT }, position: { x: hx + houseW / 4 + 0.5, y: wallY, z: hz + houseD / 2 } });
  push('part', { name: 'Wall East', material: 'brick', color: '#a1543a', size: { x: wallT, y: wallH, z: houseD }, position: { x: hx + houseW / 2, y: wallY, z: hz } });
  push('part', { name: 'Wall West', material: 'brick', color: '#a1543a', size: { x: wallT, y: wallH, z: houseD }, position: { x: hx - houseW / 2, y: wallY, z: hz } });

  // interior dividing wall with a hallway gap
  push('part', { name: 'Interior Wall Front', material: 'concrete', color: '#c9cdd4', size: { x: wallT, y: wallH, z: houseD / 2 - 1 }, position: { x: hx, y: wallY, z: hz - houseD / 4 - 0.5 } });
  push('part', { name: 'Interior Wall Back', material: 'concrete', color: '#c9cdd4', size: { x: wallT, y: wallH, z: houseD / 2 - 1 }, position: { x: hx, y: wallY, z: hz + houseD / 4 + 0.5 } });

  push('part', { name: 'Roof', material: 'wood', color: '#7a4a24', size: { x: houseW + 0.6, y: 0.4, z: houseD + 0.6 }, position: { x: hx, y: wallH + 0.5, z: hz } });

  // destructible clutter inside
  push('part', { name: 'Table', material: 'wood', color: '#9a6633', size: { x: 1.4, y: 0.8, z: 1.4 }, position: { x: hx - 3, y: 0.7, z: hz - 2 } });
  push('part', { name: 'Crate 1', material: 'wood', color: '#8a6633', size: { x: 1, y: 1, z: 1 }, position: { x: hx + 3, y: 0.8, z: hz + 2 } });
  push('part', { name: 'Crate 2', material: 'wood', color: '#8a6633', size: { x: 1, y: 1, z: 1 }, position: { x: hx + 3, y: 1.8, z: hz + 2 } });

  // standalone target pillars outside for extra blasting
  [[-10, -2], [10, -2], [-8, 12], [8, 12]].forEach(([x, z], i) => {
    push('part', { name: `Target Pillar ${i + 1}`, material: 'stone', color: '#8a8f98', size: { x: 1.2, y: 3, z: 1.2 }, position: { x, y: 1.5, z } });
  });

  return objs;
}

export function getBuiltinGames() {
  return [
    {
      project_id: 'builtin_obby',
      builtin: true,
      mode: 'obby',
      name: 'Sky Climb Obby',
      description: 'Jump across floating platforms, hit every checkpoint, and dodge the void below.',
      creator: 'Blockverse',
      icon: '🧗',
      world: obbyWorld(),
      scripts: [],
      settings: { timer: true },
    },
    {
      project_id: 'builtin_sword',
      builtin: true,
      mode: 'sword',
      name: 'Arena Duel',
      description: 'A simple sword arena — swing at training dummies, manage your health, respawn and go again.',
      creator: 'Blockverse',
      icon: '⚔️',
      world: swordArenaWorld(),
      scripts: [],
      settings: { timer: false },
    },
    {
      project_id: 'builtin_sandbox',
      builtin: true,
      mode: 'sandbox',
      name: 'Open Sandbox',
      description: 'A big open plot with sample materials — opens straight into the editor so you can build freely.',
      creator: 'Blockverse',
      icon: '🏗️',
      world: sandboxWorld(),
      scripts: [],
      settings: { timer: false, openInEditor: true },
    },
    {
      project_id: 'builtin_desert',
      builtin: true,
      mode: 'sandbox',
      name: 'Desert Ruins',
      description: 'A sandy plot with a climbable step-pyramid, scattered ruined columns, and a little oasis — another place to build in.',
      creator: 'Blockverse',
      icon: '🏜️',
      world: desertRuinsWorld(),
      scripts: [],
      settings: { timer: false, openInEditor: true },
    },
    {
      project_id: 'builtin_demolition',
      builtin: true,
      mode: 'demolition',
      name: 'Demolition Range',
      description: 'A little house full of destructible clutter — grab the rocket launcher and blow it apart with real physics.',
      creator: 'Blockverse',
      icon: '🚀',
      world: demolitionWorld(),
      scripts: [],
      settings: { timer: false, physics: true, blastRadius: 6, blastStrength: 15 },
    },
  ];
}

export function getBuiltinGame(id) {
  return getBuiltinGames().find(g => g.project_id === id) || null;
}
