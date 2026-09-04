// ===========================================================
// scriptLang.js — a tiny, Roblox-flavored scripting language for
// Blockverse objects, e.g.:
//
//   onTouch:
//       addScore(10)
//       showMessage("Nice!")
//
//   onPrompt:
//       giveItem("Key")
//       destroyObject()
//
// This is a REAL parser (line-based tokenizer + recursive structure),
// not a JSON editor and not eval(). It compiles down to exactly the same
// { event, actions: [{ type, ...params }] } rule format the existing
// GameRuntime already executes through its fixed action whitelist — so
// the safety model is unchanged, only the authoring surface is friendlier.
// ===========================================================
import { EVENT_TYPES, ACTION_TYPES } from './scripting.js';

// Friendly names for the guided "Easy Mode" builder (see scriptBuilder.js).
export const EVENT_LABELS = {
  onPlayerJoin: 'Player Joins',
  onPlayerLeave: 'Player Leaves',
  onTouch: 'Touched',
  onButtonPress: 'Button Pressed',
  onTimer: 'Timer',
  onCheckpoint: 'Checkpoint Reached',
  onPrompt: 'Proximity Prompt Activated',
};

// Single source of truth for each action's parameters — name, a friendly
// label, an input type ('string' | 'number'), and a placeholder. Used to
// build the guided form fields, to validate argument counts when parsing
// typed script text, and to build each action object from those values.
export const ACTION_SCHEMA = {
  showMessage: { label: 'Show Message', params: [{ name: 'text', type: 'string', placeholder: 'Message to show' }] },
  addScore: { label: 'Add Score', params: [{ name: 'amount', type: 'number', placeholder: '10' }] },
  changeHealth: { label: 'Change Health', params: [{ name: 'amount', type: 'number', placeholder: '-10 or 10' }] },
  teleportPlayer: {
    label: 'Teleport Player',
    params: [
      { name: 'x', type: 'number', placeholder: 'X' },
      { name: 'y', type: 'number', placeholder: 'Y' },
      { name: 'z', type: 'number', placeholder: 'Z' },
    ],
  },
  respawnPlayer: { label: 'Respawn Player', params: [] },
  setCheckpoint: { label: 'Set Checkpoint Here', params: [] },
  giveItem: { label: 'Give Item', params: [{ name: 'item', type: 'string', placeholder: 'Item name' }] },
  destroyObject: { label: 'Destroy Object', params: [{ name: 'targetId', type: 'string', placeholder: '(optional) object id — blank for this object' }] },
  wait: { label: 'Wait', params: [{ name: 'seconds', type: 'number', placeholder: 'Seconds' }] },
  spawnObject: {
    label: 'Spawn Object',
    params: [
      { name: 'type', type: 'string', placeholder: 'part' },
      { name: 'x', type: 'number', placeholder: 'X' },
      { name: 'y', type: 'number', placeholder: 'Y' },
      { name: 'z', type: 'number', placeholder: 'Z' },
    ],
  },
  setColor: {
    label: 'Set Color',
    params: [
      { name: 'color', type: 'color', placeholder: '#ff0000' },
      { name: 'targetId', type: 'string', placeholder: '(optional) object id — blank for this object' },
    ],
  },
  setTransparency: {
    label: 'Set Transparency',
    params: [
      { name: 'value', type: 'number', placeholder: '0 (solid) to 1 (invisible)' },
      { name: 'targetId', type: 'string', placeholder: '(optional)' },
    ],
  },
  setCollidable: {
    label: 'Set Collidable',
    params: [
      { name: 'value', type: 'boolean', placeholder: 'true' },
      { name: 'targetId', type: 'string', placeholder: '(optional)' },
    ],
  },
  setVisible: {
    label: 'Set Visible',
    params: [
      { name: 'value', type: 'boolean', placeholder: 'true' },
      { name: 'targetId', type: 'string', placeholder: '(optional)' },
    ],
  },
  setSize: {
    label: 'Set Size',
    params: [
      { name: 'x', type: 'number', placeholder: 'X' },
      { name: 'y', type: 'number', placeholder: 'Y' },
      { name: 'z', type: 'number', placeholder: 'Z' },
      { name: 'targetId', type: 'string', placeholder: '(optional)' },
    ],
  },
  movePart: {
    label: 'Move Part',
    params: [
      { name: 'x', type: 'number', placeholder: 'X' },
      { name: 'y', type: 'number', placeholder: 'Y' },
      { name: 'z', type: 'number', placeholder: 'Z' },
      { name: 'targetId', type: 'string', placeholder: '(optional)' },
    ],
  },
};

// Each action's positional parameter names, in order — derived from
// ACTION_SCHEMA above (used by the text-language parser for arity checks).
const ACTION_PARAMS = Object.fromEntries(
  Object.entries(ACTION_SCHEMA).map(([name, schema]) => [name, schema.params.map(p => p.name)])
);

const ACTION_BUILDERS = {
  showMessage: (a) => ({ type: 'showMessage', text: str(a[0], '') }),
  addScore: (a) => ({ type: 'addScore', amount: num(a[0], 0) }),
  changeHealth: (a) => ({ type: 'changeHealth', amount: num(a[0], 0) }),
  teleportPlayer: (a) => ({ type: 'teleportPlayer', x: num(a[0], 0), y: num(a[1], 0), z: num(a[2], 0) }),
  respawnPlayer: () => ({ type: 'respawnPlayer' }),
  setCheckpoint: () => ({ type: 'setCheckpoint' }),
  giveItem: (a) => ({ type: 'giveItem', item: str(a[0], 'item') }),
  destroyObject: (a) => ({ type: 'destroyObject', targetId: a[0] !== undefined ? str(a[0]) : undefined }),
  wait: (a) => ({ type: 'wait', seconds: num(a[0], 0) }),
  spawnObject: (a) => ({ type: 'spawnObject', data: { type: str(a[0], 'part'), position: { x: num(a[1], 0), y: num(a[2], 0), z: num(a[3], 0) } } }),
  setColor: (a) => ({ type: 'setColor', color: str(a[0], '#8a8f98'), targetId: a[1] !== undefined && a[1] !== '' ? str(a[1]) : undefined }),
  setTransparency: (a) => ({ type: 'setTransparency', value: clamp01(num(a[0], 0)), targetId: a[1] !== undefined && a[1] !== '' ? str(a[1]) : undefined }),
  setCollidable: (a) => ({ type: 'setCollidable', value: bool(a[0], true), targetId: a[1] !== undefined && a[1] !== '' ? str(a[1]) : undefined }),
  setVisible: (a) => ({ type: 'setVisible', value: bool(a[0], true), targetId: a[1] !== undefined && a[1] !== '' ? str(a[1]) : undefined }),
  setSize: (a) => ({ type: 'setSize', x: num(a[0], 1), y: num(a[1], 1), z: num(a[2], 1), targetId: a[3] !== undefined && a[3] !== '' ? str(a[3]) : undefined }),
  movePart: (a) => ({ type: 'movePart', x: num(a[0], 0), y: num(a[1], 0), z: num(a[2], 0), targetId: a[3] !== undefined && a[3] !== '' ? str(a[3]) : undefined }),
};

function str(v, fallback = '') { return v === undefined ? fallback : String(v); }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function bool(v, fallback) { if (v === undefined || v === '') return fallback; if (typeof v === 'boolean') return v; return String(v).toLowerCase() === 'true'; }
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

// Builds a proper action object (e.g. {type:'addScore', amount:10}) from
// raw parameter values in ACTION_SCHEMA[actionType].params order — used by
// the guided Easy Mode builder so it shares the exact same coercion rules
// as the text-language parser.
export function buildAction(actionType, paramValues) {
  const builder = ACTION_BUILDERS[actionType];
  if (!builder) return { type: actionType };
  return builder(paramValues || []);
}

/**
 * Parses Blockverse script source into the compiled rule array GameRuntime
 * executes. Returns { ok: true, rules } or { ok: false, error, line }.
 */
export function parseScript(source) {
  const lines = (source || '').split('\n');
  const rules = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (line === '' || line.startsWith('//') || line.startsWith('#')) continue;

    const eventMatch = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*$/);
    if (eventMatch) {
      const eventName = eventMatch[1];
      if (!EVENT_TYPES.includes(eventName)) {
        return { ok: false, line: lineNo, error: `Line ${lineNo}: unknown event "${eventName}". Valid events: ${EVENT_TYPES.join(', ')}` };
      }
      current = { event: eventName, actions: [] };
      rules.push(current);
      continue;
    }

    if (!current) {
      return { ok: false, line: lineNo, error: `Line ${lineNo}: expected an "EventName:" header before any actions.` };
    }

    const callMatch = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*\((.*)\)\s*$/s);
    if (!callMatch) {
      return { ok: false, line: lineNo, error: `Line ${lineNo}: couldn't parse "${line}" — expected something like actionName(args) or an "EventName:" header.` };
    }
    const [, actionName, argsRaw] = callMatch;
    if (!ACTION_TYPES.includes(actionName) || !ACTION_BUILDERS[actionName]) {
      return { ok: false, line: lineNo, error: `Line ${lineNo}: unknown action "${actionName}". Valid actions: ${ACTION_TYPES.join(', ')}` };
    }

    let args;
    try {
      args = splitArgs(argsRaw);
    } catch (e) {
      return { ok: false, line: lineNo, error: `Line ${lineNo}: ${e.message}` };
    }
    const maxArgs = ACTION_PARAMS[actionName].length;
    if (args.length > maxArgs) {
      return { ok: false, line: lineNo, error: `Line ${lineNo}: ${actionName}() takes at most ${maxArgs} argument(s) (${ACTION_PARAMS[actionName].join(', ') || 'none'}), got ${args.length}.` };
    }

    current.actions.push(ACTION_BUILDERS[actionName](args));
  }

  return { ok: true, rules };
}

// Splits "a, b, c" into coerced values, respecting quoted strings so
// commas inside "like this" don't split incorrectly.
function splitArgs(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  const pieces = [];
  let cur = '';
  let inString = false;
  let quoteChar = '';
  let wasQuoted = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (ch === '\\' && trimmed[i + 1] === quoteChar) { cur += quoteChar; i++; continue; }
      if (ch === quoteChar) { inString = false; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quoteChar = ch; wasQuoted = true; continue; }
    if (ch === ',') { pieces.push({ text: cur.trim(), quoted: wasQuoted }); cur = ''; wasQuoted = false; continue; }
    cur += ch;
  }
  if (inString) throw new Error('unterminated string literal (missing closing quote)');
  pieces.push({ text: cur.trim(), quoted: wasQuoted });
  return pieces.map(p => coerce(p.text, p.quoted));
}

function coerce(text, quoted) {
  if (quoted) return text;
  if (text === '') return undefined;
  if (text === 'true') return true;
  if (text === 'false') return false;
  const n = Number(text);
  if (text !== '' && !Number.isNaN(n)) return n;
  return text; // bare word (e.g. an id) — keep as a string
}

/**
 * Turns a compiled rule array back into editable script source — used to
 * populate the editor for scripts that don't have their original source
 * text stored (e.g. older saved projects).
 */
export function decompileScript(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return '';
  return rules.map(rule => {
    const lines = [`${rule.event}:`];
    for (const action of rule.actions || []) lines.push(`    ${decompileAction(action)}`);
    return lines.join('\n');
  }).join('\n\n');
}

function fmt(v) {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : String(v);
}

function decompileAction(action) {
  switch (action.type) {
    case 'showMessage': return `showMessage(${fmt(action.text)})`;
    case 'addScore': return `addScore(${fmt(action.amount)})`;
    case 'changeHealth': return `changeHealth(${fmt(action.amount)})`;
    case 'teleportPlayer': return `teleportPlayer(${fmt(action.x)}, ${fmt(action.y)}, ${fmt(action.z)})`;
    case 'respawnPlayer': return `respawnPlayer()`;
    case 'setCheckpoint': return `setCheckpoint()`;
    case 'giveItem': return `giveItem(${fmt(action.item)})`;
    case 'destroyObject': return action.targetId ? `destroyObject(${fmt(action.targetId)})` : `destroyObject()`;
    case 'wait': return `wait(${fmt(action.seconds)})`;
    case 'spawnObject': return `spawnObject(${fmt(action.data?.type)}, ${fmt(action.data?.position?.x)}, ${fmt(action.data?.position?.y)}, ${fmt(action.data?.position?.z)})`;
    case 'setColor': return action.targetId ? `setColor(${fmt(action.color)}, ${fmt(action.targetId)})` : `setColor(${fmt(action.color)})`;
    case 'setTransparency': return action.targetId ? `setTransparency(${fmt(action.value)}, ${fmt(action.targetId)})` : `setTransparency(${fmt(action.value)})`;
    case 'setCollidable': return action.targetId ? `setCollidable(${fmt(action.value)}, ${fmt(action.targetId)})` : `setCollidable(${fmt(action.value)})`;
    case 'setVisible': return action.targetId ? `setVisible(${fmt(action.value)}, ${fmt(action.targetId)})` : `setVisible(${fmt(action.value)})`;
    case 'setSize': return action.targetId ? `setSize(${fmt(action.x)}, ${fmt(action.y)}, ${fmt(action.z)}, ${fmt(action.targetId)})` : `setSize(${fmt(action.x)}, ${fmt(action.y)}, ${fmt(action.z)})`;
    case 'movePart': return action.targetId ? `movePart(${fmt(action.x)}, ${fmt(action.y)}, ${fmt(action.z)}, ${fmt(action.targetId)})` : `movePart(${fmt(action.x)}, ${fmt(action.y)}, ${fmt(action.z)})`;
    default: return `${action.type}()`;
  }
}
