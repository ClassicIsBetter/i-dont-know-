import * as THREE from 'three';

// ===========================================================
// scripting.js — a SAFE scripting layer for user-created games.
//
// User "scripts" are plain JSON, never executed as JavaScript.
// Each object can carry a list of { event, actions[] } rules; the
// GameRuntime below listens for engine events and runs the matching
// actions through a fixed, whitelisted interpreter (executeAction).
//
// Example rule attached to an object:
//   { event: "onTouch", actions: [
//       { type: "addScore", amount: 10 },
//       { type: "showMessage", text: "+10 points!" },
//       { type: "destroyObject" }
//   ]}
//
// showMessage text supports {property} placeholders that read the CURRENT
// value straight off the object the script is attached to — e.g.
// showMessage("This part is {color}") — see templateText() below. That's
// how a script "detects" a property: by referencing its live value.
// ===========================================================

export const EVENT_TYPES = ['onPlayerJoin', 'onPlayerLeave', 'onTouch', 'onButtonPress', 'onTimer', 'onCheckpoint', 'onPrompt'];

export const ACTION_TYPES = [
  'showMessage', 'addScore', 'teleportPlayer', 'giveItem',
  'spawnObject', 'destroyObject', 'changeHealth', 'wait', 'respawnPlayer', 'setCheckpoint',
  'setColor', 'setTransparency', 'setCollidable', 'setVisible', 'setSize', 'movePart',
];

// Replaces {name}, {color}, {size.x}, etc. in a string with the current
// value read off `sourceData` — the object the script is attached to.
// Unknown placeholders are left as-is rather than silently blanked.
export function templateText(text, sourceData) {
  if (!text || !sourceData) return text;
  return String(text).replace(/\{([\w.]+)\}/g, (match, path) => {
    let val = sourceData;
    for (const key of path.split('.')) {
      if (val == null) { val = undefined; break; }
      val = val[key];
    }
    return val === undefined ? match : String(val);
  });
}

export function validateScriptText(text) {
  // Deprecated: object scripts are now authored in the Roblox-style
  // event/action language (see scriptLang.js). Kept only so any
  // hand-crafted JSON rule arrays elsewhere in the codebase still validate.
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return { ok: false, error: 'Script must be a JSON array of rules.' };
    for (const rule of parsed) {
      if (!EVENT_TYPES.includes(rule.event)) return { ok: false, error: `Unknown event "${rule.event}"` };
      if (!Array.isArray(rule.actions)) return { ok: false, error: 'Each rule needs an "actions" array.' };
      for (const a of rule.actions) {
        if (!ACTION_TYPES.includes(a.type)) return { ok: false, error: `Unknown action "${a.type}"` };
      }
    }
    return { ok: true, rules: parsed };
  } catch (e) {
    return { ok: false, error: 'Invalid JSON: ' + e.message };
  }
}

/**
 * GameRuntime wires world object scripts to live gameplay events and
 * executes actions through a closed set of handlers (context below) —
 * arbitrary code from a saved project is never eval()'d.
 */
export class GameRuntime {
  constructor(context) {
    // context supplies: world, player, hud, addScore, showMessage, teleport,
    // spawnObjectData, destroyObjectId, damagePlayer, respawnPlayer
    this.ctx = context;
    this._touchingIds = new Set();
  }

  fireEvent(eventName, sourceObjectId = null) {
    const world = this.ctx.world;
    if (sourceObjectId) {
      const data = world.getData(sourceObjectId);
      if (data && Array.isArray(data.scripts)) {
        for (const rule of data.scripts) if (rule.event === eventName) this._runActions(rule.actions, data);
      }
      return;
    }
    // global broadcast: run matching rules on every object AND the project-level script list
    for (const data of world.allData()) {
      if (!Array.isArray(data.scripts)) continue;
      for (const rule of data.scripts) if (rule.event === eventName) this._runActions(rule.actions, data);
    }
    const globalScripts = this.ctx.globalScripts || [];
    for (const rule of globalScripts) {
      if (rule.event === eventName) this._runActions(rule.actions, null);
    }
  }

  // called every frame by the game loop to detect touch/checkpoint triggers.
  // Fires onTouch once when the player ENTERS a trigger volume, not
  // repeatedly while standing inside it — re-arms once the player leaves.
  checkTouches(playerBox) {
    const world = this.ctx.world;
    for (const data of world.allData()) {
      if (!Array.isArray(data.scripts) || data.scripts.length === 0) continue;
      const mesh = world.getMesh(data.id);
      if (!mesh) continue;
      const box = new THREE__Box3For(mesh);
      const overlapping = box.intersectsBox(playerBox);
      const wasTouching = this._touchingIds.has(data.id);
      if (overlapping && !wasTouching) {
        this._touchingIds.add(data.id);
        for (const rule of data.scripts) {
          if (rule.event === 'onTouch') this._runActions(rule.actions, data);
        }
      } else if (!overlapping && wasTouching) {
        this._touchingIds.delete(data.id);
      }
    }
  }

  _runActions(actions, sourceData) {
    let delay = 0;
    for (const action of actions) {
      if (action.type === 'wait') { delay += (action.seconds || 0) * 1000; continue; }
      const run = () => this._exec(action, sourceData);
      if (delay > 0) setTimeout(run, delay); else run();
    }
  }

  _exec(action, sourceData) {
    const c = this.ctx;
    switch (action.type) {
      case 'showMessage': c.showMessage(templateText(action.text || '', sourceData)); break;
      case 'addScore': c.addScore(action.amount || 0); break;
      case 'changeHealth': c.damagePlayer(-(action.amount || 0)); break;
      case 'teleportPlayer': c.teleport(action.x || 0, action.y || 0, action.z || 0); break;
      case 'respawnPlayer': c.respawnPlayer(); break;
      case 'setCheckpoint': c.setCheckpoint(sourceData); break;
      case 'giveItem': c.showMessage(templateText(`Received: ${action.item || 'item'}`, sourceData)); break;
      case 'spawnObject': if (action.data) c.spawnObjectData(action.data); break;
      case 'destroyObject': c.destroyObjectId(action.targetId || sourceData?.id); break;
      case 'setColor': c.setProperty(action.targetId || sourceData?.id, 'color', action.color); break;
      case 'setTransparency': c.setProperty(action.targetId || sourceData?.id, 'transparency', action.value); break;
      case 'setCollidable': c.setProperty(action.targetId || sourceData?.id, 'collidable', action.value); break;
      case 'setVisible': c.setProperty(action.targetId || sourceData?.id, 'visible', action.value); break;
      case 'setSize': c.setSize(action.targetId || sourceData?.id, action.x, action.y, action.z); break;
      case 'movePart': c.moveObject(action.targetId || sourceData?.id, action.x, action.y, action.z); break;
    }
  }
}

function THREE__Box3For(mesh) { return new THREE.Box3().setFromObject(mesh); }
