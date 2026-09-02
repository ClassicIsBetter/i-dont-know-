// ===========================================================
// robloxImport.js — imports a Roblox place, XML export only (.rbxlx).
//
// Roblox's *binary* place format (.rbxl) is a proprietary compressed
// chunked format that can't be reliably parsed in-browser without a large
// dedicated decoder — this deliberately only supports the plain XML
// export (File > Save to File As > "Roblox Place (*.rbxlx)" in Studio).
//
// Only a conservative allowlist of instance classes is imported:
//   - Part / WedgePart / CornerWedgePart / TrussPart / MeshPart -> a block
//     (Blockverse only has box geometry, so every shape becomes a box
//     using its original size/position/rotation/color)
//   - SpawnLocation -> a spawn point
//   - Model / Folder -> a Blockverse folder (preserves grouping)
//   - ProximityPrompt (as a child of a supported part) -> that part's
//     built-in proximity-prompt property
//
// Everything else (Script/LocalScript, Seat/VehicleSeat, Tool, meshes'
// custom geometry, GUIs, sounds, particle effects, welds, etc.) is
// intentionally skipped — this only brings across static geometry, never
// behavior. Skipped classes are counted and reported back to the caller.
// ===========================================================
import * as THREE from 'three';
import { createObjectData } from './world.js';

const SUPPORTED_PART_CLASSES = new Set(['Part', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'MeshPart']);
const CONTAINER_CLASSES = new Set(['Model', 'Folder']);
const SPAWN_CLASS = 'SpawnLocation';
const PROMPT_CLASS = 'ProximityPrompt';

// Known-irrelevant classes we explicitly recognize and skip (counted in
// the summary) rather than silently ignoring — this is the "seats,
// ladders, etc." exclusion list.
const SKIP_TRACKED = new Set([
  'Script', 'LocalScript', 'ModuleScript', 'Seat', 'VehicleSeat', 'Tool',
  'Sound', 'Decal', 'Texture', 'SurfaceGui', 'BillboardGui', 'ScreenGui',
  'ClickDetector', 'TouchTransmitter', 'Animation', 'Humanoid', 'Accessory',
  'Hat', 'Shirt', 'Pants', 'SpecialMesh', 'UnionOperation', 'NegateOperation',
  'Terrain', 'Sky', 'Atmosphere', 'Motor6D', 'Weld', 'WeldConstraint',
  'Attachment', 'ParticleEmitter', 'Fire', 'Smoke', 'Explosion', 'Camera',
  'Light', 'PointLight', 'SpotLight', 'SurfaceLight',
]);

export function isBinaryRbxl(text) {
  return text.startsWith('<roblox!');
}

export function looksLikeRobloxXML(text) {
  return text.trim().startsWith('<roblox');
}

/**
 * @param {string} xmlText  contents of a .rbxlx file
 * @param {{scale?: number}} opts  uniform scale applied to every position/size
 * @returns {{ok:true, objects:object[], skipped:Record<string,number>} | {ok:false, error:string}}
 */
export function parseRobloxPlaceXML(xmlText, { scale = 1 } = {}) {
  if (isBinaryRbxl(xmlText)) {
    return { ok: false, error: 'This is a binary .rbxl file, which Blockverse can\'t read.\n\nIn Roblox Studio: File > Save to File As, then choose "Roblox Place (*.rbxlx)" from the format dropdown, and import that file instead.' };
  }
  if (!looksLikeRobloxXML(xmlText)) {
    return { ok: false, error: "That doesn't look like a Roblox place file." };
  }

  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    return { ok: false, error: 'Could not parse this file as XML — is it a valid .rbxlx export?' };
  }
  const rootEl = doc.documentElement;
  if (!rootEl || rootEl.tagName.toLowerCase() !== 'roblox') {
    return { ok: false, error: "That doesn't look like a Roblox place file." };
  }
  const workspaceEl = [...rootEl.children].find(c => c.tagName === 'Item' && c.getAttribute('class') === 'Workspace');
  if (!workspaceEl) {
    return { ok: false, error: 'Could not find a Workspace in this file.' };
  }

  const objects = [];
  const skipped = {};
  const trackSkip = (cls) => { skipped[cls] = (skipped[cls] || 0) + 1; };

  function walk(containerEl, parentId) {
    for (const child of containerEl.children) {
      if (child.tagName !== 'Item') continue;
      const cls = child.getAttribute('class') || 'Unknown';
      const props = getProperties(child);
      const name = getString(props, 'Name', cls);

      if (CONTAINER_CLASSES.has(cls)) {
        const folder = createObjectData('folder', { name, parentId });
        objects.push(folder);
        walk(child, folder.id);
        continue;
      }

      if (cls === SPAWN_CLASS) {
        const { position } = getCFrame(props);
        objects.push(createObjectData('spawn', { name, parentId, position: scaleVec(position, scale) }));
        continue;
      }

      if (SUPPORTED_PART_CLASSES.has(cls)) {
        const { position, rotation } = getCFrame(props);
        const size = getVector3(props, 'size', { x: 4, y: 1, z: 4 });
        const partData = createObjectData('part', {
          name, parentId,
          position: scaleVec(position, scale),
          rotation,
          size: { x: Math.max(0.05, size.x * scale), y: Math.max(0.05, size.y * scale), z: Math.max(0.05, size.z * scale) },
          color: getColor(props),
          collidable: getBool(props, 'CanCollide', true),
          transparency: getFloat(props, 'Transparency', 0),
          material: 'stone',
        });

        for (const grand of child.children) {
          if (grand.tagName === 'Item' && grand.getAttribute('class') === PROMPT_CLASS) {
            const pProps = getProperties(grand);
            partData.prompt = {
              enabled: true,
              text: getString(pProps, 'ActionText', 'Interact'),
              key: 'KeyE',
              maxDistance: getFloat(pProps, 'MaxActivationDistance', 3.5),
              holdSeconds: getFloat(pProps, 'HoldDuration', 0),
            };
          }
        }

        objects.push(partData);
        continue;
      }

      if (SKIP_TRACKED.has(cls)) { trackSkip(cls); continue; }
      // unrecognized class: descend in case it's just an unfamiliar
      // organizational wrapper containing supported geometry
      walk(child, parentId);
    }
  }

  walk(workspaceEl, null);
  return { ok: true, objects, skipped };
}

export function summarizeImport(objects) {
  let parts = 0, spawns = 0, folders = 0, prompts = 0;
  for (const o of objects) {
    if (o.type === 'part') parts++;
    else if (o.type === 'spawn') spawns++;
    else if (o.type === 'folder') folders++;
    if (o.prompt && o.prompt.enabled) prompts++;
  }
  return { parts, spawns, folders, prompts };
}

// ---------------------------------------------------------
// Property extraction — Roblox's XML stores each property as
// <TypeTag name="PropertyName">value</TypeTag> inside a <Properties>
// element; we key everything by the lowercased name for robustness.
function getProperties(itemEl) {
  const map = {};
  let propsEl = null;
  for (const child of itemEl.children) {
    if (child.tagName === 'Properties') { propsEl = child; break; }
  }
  if (!propsEl) return map;
  for (const child of propsEl.children) {
    const name = child.getAttribute('name');
    if (!name) continue;
    map[name.toLowerCase()] = child;
  }
  return map;
}

function getString(props, key, fallback) {
  const el = props[key.toLowerCase()];
  if (!el) return fallback;
  const text = (el.textContent || '').trim();
  return text || fallback;
}

function getBool(props, key, fallback) {
  const el = props[key.toLowerCase()];
  if (!el) return fallback;
  return (el.textContent || '').trim().toLowerCase() === 'true';
}

function getFloat(props, key, fallback) {
  const el = props[key.toLowerCase()];
  if (!el) return fallback;
  const n = parseFloat(el.textContent);
  return Number.isFinite(n) ? n : fallback;
}

function childNum(el, tag, fallback) {
  const n = el.querySelector(tag);
  if (!n) return fallback;
  const v = parseFloat(n.textContent);
  return Number.isFinite(v) ? v : fallback;
}

function getVector3(props, key, fallback) {
  const el = props[key.toLowerCase()];
  if (!el) return fallback;
  return { x: childNum(el, 'X', fallback.x), y: childNum(el, 'Y', fallback.y), z: childNum(el, 'Z', fallback.z) };
}

function getCFrame(props) {
  const el = props['cframe'];
  if (!el) return { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  const position = { x: childNum(el, 'X', 0), y: childNum(el, 'Y', 0), z: childNum(el, 'Z', 0) };
  let rotation = { x: 0, y: 0, z: 0 };
  if (el.querySelector('R00')) {
    const m = new THREE.Matrix4();
    m.set(
      childNum(el, 'R00', 1), childNum(el, 'R01', 0), childNum(el, 'R02', 0), 0,
      childNum(el, 'R10', 0), childNum(el, 'R11', 1), childNum(el, 'R12', 0), 0,
      childNum(el, 'R20', 0), childNum(el, 'R21', 0), childNum(el, 'R22', 1), 0,
      0, 0, 0, 1
    );
    const euler = new THREE.Euler().setFromRotationMatrix(m);
    rotation = { x: euler.x, y: euler.y, z: euler.z };
  }
  return { position, rotation };
}

function getColor(props) {
  const c8 = props['color3uint8'];
  if (c8) {
    const v = parseInt((c8.textContent || '').trim(), 10);
    if (Number.isFinite(v)) {
      const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
      return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    }
  }
  const c3 = props['color'] || props['color3'];
  if (c3) {
    const r = Math.round(childNum(c3, 'R', 0.6) * 255);
    const g = Math.round(childNum(c3, 'G', 0.6) * 255);
    const b = Math.round(childNum(c3, 'B', 0.6) * 255);
    const clamp255 = (n) => Math.max(0, Math.min(255, n));
    return '#' + [r, g, b].map(n => clamp255(n).toString(16).padStart(2, '0')).join('');
  }
  return '#8a8f98';
}

function scaleVec(v, scale) {
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}
