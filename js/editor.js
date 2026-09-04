// ===========================================================
// editor.js — in-browser world editor: select/move/rotate/scale,
// multi-select (shift-click), folders & groups, explorer hierarchy,
// properties panel (incl. proximity prompts), Roblox-style scripting,
// undo/redo.
// ===========================================================
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { el, toast, deepClone, uid } from './utils.js';
import { createObjectData, applyTimeOfDay } from './world.js';
import { EVENT_TYPES, ACTION_TYPES } from './scripting.js';
import { parseScript, decompileScript } from './scriptLang.js';
import { renderScriptBuilder } from './scriptBuilder.js';

const SIZE_EDITABLE_TYPES = new Set(['part', 'model', 'spawn', 'checkpoint', 'killzone', 'finish']);
const PROMPT_KEYS = ['KeyE', 'KeyF', 'KeyG', 'KeyC', 'KeyX'];

export class Editor {
  constructor({ scene, camera, renderer, world, orbitCamera, env }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.world = world;
    this.orbitCamera = orbitCamera; // ThirdPersonCamera, disabled while dragging gizmo
    this.env = env; // { hemi, sun } from setupEnvironment — for the World panel's time-of-day
    this.projectSettings = null; // bound per-project via bindProject()

    this.active = false;
    this.tool = 'select';
    this._scriptMode = 'text'; // 'text' | 'easy' — toggle in the Properties panel's script section

    // selection state — selectedIds is the source of truth; primaryId is
    // "the one the properties panel / F-focus cares about" (last clicked).
    this.selectedIds = new Set();
    this.primaryId = null;
    this._multiPivot = null;      // temporary THREE.Group used to move/rotate/scale a multi-selection together
    this._multiPivotIds = null;
    this._selectionHelpers = new Map(); // id -> THREE.BoxHelper, shown while multi-selected

    // folders: purely organizational (parentId chains). Clicking a folder
    // in the Explorer selects its contents so the existing multi-select
    // gizmo can move them together; _selectedFolderId tracks which folder
    // that selection came from, for the Group/Ungroup toolbar buttons.
    this._selectedFolderId = null;
    this._collapsedFolders = new Set();

    this.undoStack = [];
    this.redoStack = [];

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.transformControls = new TransformControls(camera, renderer.domElement);
    this.transformControls.setSize(0.9);
    this.scene.add(this.transformControls.getHelper ? this.transformControls.getHelper() : this.transformControls);
    this.transformControls.addEventListener('dragging-changed', (e) => {
      this._dragging = e.value;
      if (!e.value && this.selectedIds.size > 0) {
        this._pushUndo();
        if (this._multiPivot) {
          const ids = this._multiPivotIds;
          this._teardownMultiPivot(); // reparents each mesh back + syncs its data from the drag
          if (ids && ids.length > 1) {
            this._buildMultiPivot(ids);
            this.transformControls.attach(this._multiPivot);
          }
        } else if (this.primaryId) {
          this.world.syncFromMesh(this.primaryId);
        }
        this._refreshPropertiesValues();
        this._suppressNextClick = true;
      }
    });
    this.transformControls.addEventListener('objectChange', () => {
      if (this.selectedIds.size === 1 && this.primaryId) this._liveSyncTransform();
    });

    this._bindDom();
    this._bindPointer();
    this._bindWorldPanel();
  }

  // for external read access (e.g. "press F to focus on the selected object")
  get selectedId() { return this.primaryId; }

  // ---------------------------------------------------------
  // Called once per frame while the editor is active, to keep the
  // multi-select highlight boxes tracking any moved objects.
  update() {
    for (const helper of this._selectionHelpers.values()) helper.update();
  }

  // ---------------------------------------------------------
  // Call BEFORE swapping the world's data (world.loadFromData) — releases
  // the multi-select pivot and resets selection/undo state while the old
  // meshes are still valid. Follow with world.loadFromData(...) then refresh().
  loadNewWorld() {
    this._teardownMultiPivot();
    this.transformControls.detach();
    this.selectedIds = new Set();
    this.primaryId = null;
    this._selectedFolderId = null;
    this._collapsedFolders = new Set();
    this._clearSelectionHelpers();
    this.undoStack = [];
    this.redoStack = [];
  }

  // Call AFTER world.loadFromData(...) to re-render against the new world.
  refresh() {
    this._renderExplorer();
    this._renderProperties();
  }

  // ---------------------------------------------------------
  // World panel: time of day / auto-advance / day length. These live on
  // the project's own settings object (mutated in place, so Save picks
  // them up like any other field) rather than the Editor's own state.
  bindProject(projectData) {
    this.projectSettings = projectData.settings;
    this._refreshWorldPanel();
  }

  _bindWorldPanel() {
    const timeInput = document.getElementById('world-time-input');
    const autoInput = document.getElementById('world-autotime-input');
    const dayLenInput = document.getElementById('world-daylength-input');

    timeInput.addEventListener('change', () => {
      if (!this.projectSettings) return;
      let v = parseInt(timeInput.value, 10);
      if (Number.isNaN(v)) v = 12;
      v = ((v % 24) + 24) % 24;
      this.projectSettings.timeOfDay = v;
      timeInput.value = v;
      if (this.env) applyTimeOfDay(this.scene, this.env, v);
    });
    autoInput.addEventListener('change', () => {
      if (!this.projectSettings) return;
      this.projectSettings.autoTime = autoInput.checked;
      this._refreshWorldPanel();
    });
    dayLenInput.addEventListener('change', () => {
      if (!this.projectSettings) return;
      let v = parseFloat(dayLenInput.value);
      if (Number.isNaN(v) || v <= 0) v = 20;
      this.projectSettings.dayLengthMinutes = v;
      dayLenInput.value = v;
    });
  }

  _refreshWorldPanel() {
    const s = this.projectSettings || {};
    const timeInput = document.getElementById('world-time-input');
    const autoInput = document.getElementById('world-autotime-input');
    const dayLenInput = document.getElementById('world-daylength-input');
    const dayLenRow = document.getElementById('world-daylength-row');
    if (document.activeElement !== timeInput) timeInput.value = Math.floor(s.timeOfDay ?? 12);
    autoInput.checked = !!s.autoTime;
    timeInput.readOnly = !!s.autoTime; // driven automatically while auto-advance is on
    if (document.activeElement !== dayLenInput) dayLenInput.value = s.dayLengthMinutes ?? 20;
    dayLenInput.disabled = !s.autoTime;
    dayLenRow.classList.toggle('prop-row-disabled', !s.autoTime);
  }

  // called every frame from GameSession.update() while auto-time is on,
  // so the (read-only) time field visibly ticks forward.
  _liveTickWorldTime(hour) {
    const input = document.getElementById('world-time-input');
    if (input && document.activeElement !== input) input.value = Math.floor(hour);
  }

  // ---------------------------------------------------------
  setActive(active) {
    this.active = active;
    document.getElementById('editor-chrome').classList.toggle('hidden', !active);
    if (!active) this.deselect();
  }

  _bindPointer() {
    this.renderer.domElement.addEventListener('click', (e) => {
      if (this._suppressNextClick) { this._suppressNextClick = false; return; }
      if (!this.active || this._dragging) return;
      if (this.tool !== 'select' && this._justAttached) {
        this._justAttached = false;
        if (!e.shiftKey) return;
      }
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const meshes = [...this.world.objects.values()].map(o => o.mesh);
      const hits = this.raycaster.intersectObjects(meshes, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && !obj.userData.id && obj.parent) obj = obj.parent;
        if (obj && obj.userData.id) {
          if (e.shiftKey) this.toggleSelect(obj.userData.id);
          else this.select(obj.userData.id);
        }
      } else if (!e.shiftKey) {
        this.deselect();
      }
    });
  }

  _bindDom() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    });
    document.getElementById('tool-duplicate').addEventListener('click', () => this.duplicateSelected());
    document.getElementById('tool-delete').addEventListener('click', () => this._deleteKeyPressed());
    document.getElementById('tool-undo').addEventListener('click', () => this.undo());
    document.getElementById('tool-redo').addEventListener('click', () => this.redo());
    document.getElementById('tool-group')?.addEventListener('click', () => this.groupSelected());
    document.getElementById('tool-ungroup')?.addEventListener('click', () => {
      if (this._selectedFolderId) this.ungroupFolder(this._selectedFolderId);
      else toast('Select a folder in the Explorer first');
    });

    document.querySelectorAll('.add-btn[data-add]').forEach(btn => {
      btn.addEventListener('click', () => this.addObject(btn.dataset.add));
    });

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if (e.code === 'KeyG' && !e.ctrlKey) this.setTool('move');
      if (e.code === 'KeyR') this.setTool('rotate');
      if (e.code === 'KeyB') this.setTool('scale');
      if (e.code === 'KeyQ') this.setTool('select');
      if (e.code === 'Delete' || e.code === 'Backspace') this._deleteKeyPressed();
      if (e.ctrlKey && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); }
      if (e.ctrlKey && e.code === 'KeyG') { e.preventDefault(); this.groupSelected(); }
      if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
    });
  }

  setTool(tool) {
    this.tool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    this._syncSelectionVisuals();
  }

  // ---------------------------------------------------------
  // Selection API
  select(id) {
    this._setSelection([id]);
  }

  toggleSelect(id) {
    const ids = new Set(this.selectedIds);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    this._setSelection([...ids]);
  }

  deselect() {
    this._setSelection([]);
  }

  _setSelection(idArray) {
    this._selectedFolderId = null;
    const valid = idArray.filter(id => this.world.getData(id));
    this.selectedIds = new Set(valid);
    this.primaryId = valid.length ? valid[valid.length - 1] : null;
    this._syncSelectionVisuals();
  }

  _syncSelectionVisuals() {
    this._teardownMultiPivot();
    this._clearSelectionHelpers();
    const ids = [...this.selectedIds];

    if (ids.length > 1) {
      ids.forEach(id => this._addSelectionHelper(id));
    }

    if (this.tool === 'select' || ids.length === 0) {
      this.transformControls.detach();
    } else if (ids.length === 1) {
      const mesh = this.world.getMesh(ids[0]);
      if (mesh) {
        this.transformControls.setMode(this.tool === 'move' ? 'translate' : this.tool);
        this.transformControls.attach(mesh);
        this._justAttached = true;
      } else {
        this.transformControls.detach();
      }
    } else {
      this._buildMultiPivot(ids);
      this.transformControls.setMode(this.tool === 'move' ? 'translate' : this.tool);
      this.transformControls.attach(this._multiPivot);
      this._justAttached = true;
    }

    this._renderExplorer();
    this._renderProperties();
  }

  // ---------------------------------------------------------
  // Multi-select pivot: temporarily reparents the selected meshes into a
  // Group centered on their combined position, using Object3D.attach()
  // (which preserves world transform) so Three.js's own scene graph does
  // all the math for combined translate/rotate/scale. Torn down (and each
  // mesh reparented back to the world group, with its data re-synced)
  // whenever the selection changes or the world reloads.
  _buildMultiPivot(ids) {
    const center = new THREE.Vector3();
    const worldPos = new THREE.Vector3();
    let n = 0;
    ids.forEach(id => {
      const m = this.world.getMesh(id);
      if (!m) return;
      m.getWorldPosition(worldPos);
      center.add(worldPos);
      n++;
    });
    if (n === 0) return;
    center.multiplyScalar(1 / n);

    const pivot = new THREE.Group();
    pivot.name = 'MultiSelectPivot';
    pivot.position.copy(center);
    this.scene.add(pivot);
    pivot.updateMatrixWorld(true);
    ids.forEach(id => {
      const m = this.world.getMesh(id);
      if (m) pivot.attach(m);
    });
    this._multiPivot = pivot;
    this._multiPivotIds = ids;
  }

  _teardownMultiPivot() {
    if (!this._multiPivot) return;
    const ids = this._multiPivotIds || [];
    ids.forEach(id => {
      const m = this.world.getMesh(id);
      if (m) {
        this.world.group.attach(m);
        this.world.syncFromMesh(id);
      }
    });
    this.scene.remove(this._multiPivot);
    this._multiPivot = null;
    this._multiPivotIds = null;
  }

  _addSelectionHelper(id) {
    const mesh = this.world.getMesh(id);
    if (!mesh) return;
    const helper = new THREE.BoxHelper(mesh, 0x8b5cf6);
    this.scene.add(helper);
    this._selectionHelpers.set(id, helper);
  }

  _clearSelectionHelpers() {
    for (const helper of this._selectionHelpers.values()) {
      this.scene.remove(helper);
      helper.geometry?.dispose();
      helper.material?.dispose();
    }
    this._selectionHelpers.clear();
  }

  // ---------------------------------------------------------
  addObject(type) {
    if (type === 'topofhead') {
      this._pushUndo();
      const data = createObjectData('part', {
        name: 'TopOfHead',
        position: { x: 0, y: 2.6, z: 0 },
        size: { x: 0.15, y: 0.15, z: 0.15 },
        color: '#ff2fd0',
        material: 'neon',
        collidable: false,
      });
      this.world.addObject(data);
      this.select(data.id);
      toast('Added TopOfHead marker — build your hat parts around it, then Export as Hat.');
      return;
    }
    const data = createObjectData(type, {
      position: { x: (Math.random() - 0.5) * 4, y: 3, z: (Math.random() - 0.5) * 4 },
    });
    this._pushUndo();
    this.world.addObject(data);
    if (type === 'folder') {
      this._setSelection([]);
      this._selectedFolderId = data.id; // _setSelection clears this — restore it
      this._renderExplorer();
    } else {
      this.select(data.id);
    }
    toast(`Added ${data.name}`);
  }

  // Bulk-add objects from an external source (e.g. the Roblox importer),
  // as a single undo step.
  addImportedObjects(objects) {
    if (!objects || objects.length === 0) return;
    this._pushUndo();
    objects.forEach(d => this.world.addObject(d));
    this._renderExplorer();
    this._renderProperties();
  }

  duplicateSelected() {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    this._pushUndo();
    const newIds = [];
    for (const id of ids) {
      const src = this.world.getData(id);
      if (!src) continue;
      const copy = deepClone(src);
      copy.id = uid(copy.type);
      copy.name = src.name + ' Copy';
      this.world.addObject(copy);
      newIds.push(copy.id);
    }
    this._setSelection(newIds);
    toast(newIds.length > 1 ? `Duplicated ${newIds.length} objects` : 'Duplicated');
  }

  // Delete key / toolbar Delete button: if the current selection came from
  // clicking a folder, offer to delete the folder itself too.
  _deleteKeyPressed() {
    if (this._selectedFolderId) this._confirmDeleteFolder(this._selectedFolderId);
    else this.deleteSelected();
  }

  deleteSelected() {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    this._pushUndo();
    this._teardownMultiPivot(); // make sure meshes are back under world.group before removing them
    this.transformControls.detach();
    ids.forEach(id => this.world.removeObject(id));
    this._setSelection([]);
  }

  // ---------------------------------------------------------
  // Folders & Groups
  groupSelected() {
    const ids = [...this.selectedIds];
    if (ids.length === 0) { toast('Select one or more objects first'); return; }
    const name = (window.prompt('Folder name:', 'Folder') || '').trim();
    if (!name) return;
    this._pushUndo();
    const folder = createObjectData('folder', { name });
    this.world.addObject(folder);
    ids.forEach(id => { const d = this.world.getData(id); if (d) d.parentId = folder.id; });
    this._setSelection(ids);
    this._selectedFolderId = folder.id; // _setSelection clears this — restore it
    this._renderExplorer();
    toast(`Grouped into "${name}"`);
  }

  ungroupFolder(folderId) {
    const folder = this.world.getData(folderId);
    if (!folder || folder.type !== 'folder') return;
    this._pushUndo();
    const childIds = this._ungroupFolderNoUndo(folderId);
    this._setSelection(childIds);
    toast('Ungrouped');
  }

  _ungroupFolderNoUndo(folderId) {
    const folder = this.world.getData(folderId);
    const children = this.world.allData().filter(d => d.parentId === folderId);
    children.forEach(d => { d.parentId = (folder && folder.parentId) || null; });
    this.world.removeObject(folderId);
    return children.map(c => c.id);
  }

  _confirmDeleteFolder(folderId) {
    const folder = this.world.getData(folderId);
    if (!folder) return;
    const deleteContents = window.confirm(
      `Delete folder "${folder.name}" AND everything inside it?\n\nOK = delete folder + contents.\nCancel = just ungroup (folder removed, contents kept).`
    );
    this._pushUndo();
    this._teardownMultiPivot();
    if (deleteContents) {
      this._deleteFolderRecursive(folderId);
      toast('Folder and contents deleted');
    } else {
      this._ungroupFolderNoUndo(folderId);
      toast('Ungrouped');
    }
    this._setSelection([]);
  }

  _deleteFolderRecursive(folderId) {
    const children = this.world.allData().filter(d => d.parentId === folderId);
    children.forEach(d => {
      if (d.type === 'folder') this._deleteFolderRecursive(d.id);
      else this.world.removeObject(d.id);
    });
    this.world.removeObject(folderId);
  }

  _getDescendantLeafIds(folderId) {
    const byParent = this._groupByParent();
    const result = [];
    const walk = (pid) => {
      (byParent.get(pid) || []).forEach(d => {
        if (d.type === 'folder') walk(d.id);
        else result.push(d.id);
      });
    };
    walk(folderId);
    return result;
  }

  _selectFolderChildren(folderId) {
    const ids = this._getDescendantLeafIds(folderId);
    if (ids.length === 0) {
      this._setSelection([]);
      this._selectedFolderId = folderId;
      this._renderExplorer();
      toast('This folder is empty');
      return;
    }
    this._setSelection(ids);
    this._selectedFolderId = folderId; // _setSelection clears this — restore it
    this._renderExplorer();
  }

  _toggleFolderCollapse(folderId) {
    if (this._collapsedFolders.has(folderId)) this._collapsedFolders.delete(folderId);
    else this._collapsedFolders.add(folderId);
    this._renderExplorer();
  }

  _groupByParent() {
    const byParent = new Map();
    this.world.allData().forEach(d => {
      const pid = d.parentId || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(d);
    });
    return byParent;
  }

  // ---------------------------------------------------------
  _pushUndo() {
    this.undoStack.push(this.world.allData().map(deepClone));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.world.allData().map(deepClone));
    const snapshot = this.undoStack.pop();
    this._teardownMultiPivot();
    this.transformControls.detach();
    this.world.loadFromData(snapshot);
    this._setSelection([]);
  }
  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.world.allData().map(deepClone));
    const snapshot = this.redoStack.pop();
    this._teardownMultiPivot();
    this.transformControls.detach();
    this.world.loadFromData(snapshot);
    this._setSelection([]);
  }

  _liveSyncTransform() {
    const mesh = this.world.getMesh(this.primaryId);
    if (!mesh) return;
    // live-update only the numeric fields in the properties panel (cheap DOM writes)
    const p = document.getElementById('properties-body');
    if (!p) return;
    const set = (name, v) => { const inp = p.querySelector(`[data-field="${name}"]`); if (inp && document.activeElement !== inp) inp.value = v.toFixed(2); };
    set('position-x', mesh.position.x); set('position-y', mesh.position.y); set('position-z', mesh.position.z);
    set('rotation-x', mesh.rotation.x); set('rotation-y', mesh.rotation.y); set('rotation-z', mesh.rotation.z);
    set('scale-x', mesh.scale.x); set('scale-y', mesh.scale.y); set('scale-z', mesh.scale.z);
  }

  _refreshPropertiesValues() { this._renderProperties(); }

  // ---------------------------------------------------------
  _renderExplorer() {
    const tree = document.getElementById('explorer-tree');
    tree.innerHTML = '';
    const rootLabel = el('div', 'exp-node', null);
    rootLabel.innerHTML = `<span class="exp-name">🌍 World</span>`;
    tree.appendChild(rootLabel);

    const byParent = this._groupByParent();
    const renderLevel = (parentId, depth) => {
      (byParent.get(parentId) || []).forEach(data => this._renderExplorerNode(tree, data, depth, byParent));
    };
    renderLevel(null, 1);
  }

  _renderExplorerNode(tree, data, depth, byParent) {
    const isFolder = data.type === 'folder';
    const children = isFolder ? (byParent.get(data.id) || []) : [];
    const collapsed = this._collapsedFolders.has(data.id);
    const isSelected = isFolder ? this._selectedFolderId === data.id : this.selectedIds.has(data.id);

    const node = el('div', 'exp-node' + (isSelected ? ' selected' : ''));
    node.style.paddingLeft = `${20 + depth * 14}px`;

    if (isFolder) {
      const caret = el('span', 'exp-caret', children.length ? (collapsed ? '▶' : '▼') : '·');
      caret.addEventListener('click', (e) => { e.stopPropagation(); this._toggleFolderCollapse(data.id); });
      node.appendChild(caret);
    }

    node.appendChild(el('span', 'exp-name', `${iconFor(data.type)} ${data.name}`));

    const del = el('span', 'exp-del', '✕');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isFolder) this._confirmDeleteFolder(data.id);
      else { this.select(data.id); this.deleteSelected(); }
    });
    node.appendChild(del);

    node.addEventListener('click', (e) => {
      if (isFolder) this._selectFolderChildren(data.id);
      else if (e.shiftKey) this.toggleSelect(data.id);
      else this.select(data.id);
    });
    node.addEventListener('dblclick', () => this._renameInline(node, data));
    tree.appendChild(node);

    if (isFolder && !collapsed) {
      children.forEach(child => this._renderExplorerNode(tree, child, depth + 1, byParent));
    }
  }

  _renameInline(node, data) {
    const input = document.createElement('input');
    input.className = 'exp-rename';
    input.value = data.name;
    node.innerHTML = '';
    node.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      data.name = input.value.trim() || data.name;
      const mesh = this.world.getMesh(data.id);
      if (mesh) mesh.name = data.name;
      this._renderExplorer();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.code === 'Enter') input.blur(); });
  }

  _renderProperties() {
    const body = document.getElementById('properties-body');
    const scriptBody = document.getElementById('script-body');
    body.innerHTML = '';
    scriptBody.innerHTML = '';
    const ids = [...this.selectedIds];

    if (ids.length === 0) {
      body.innerHTML = this._selectedFolderId
        ? '<p class="muted small">Empty folder selected. Delete removes it (or just the folder, if you choose to keep contents).</p>'
        : '<p class="muted small">Nothing selected.</p>';
      scriptBody.innerHTML = '<p class="muted small">Select an object to attach a script.</p>';
      return;
    }
    if (ids.length > 1) {
      const groupHint = this._selectedFolderId ? ' Ctrl+G to re-group, or use Ungroup in the toolbar.' : ' Ctrl+G to group into a folder.';
      body.innerHTML = `<p class="muted small">${ids.length} objects selected — drag the gizmo to move/rotate/scale them together. Delete removes all, Ctrl+D duplicates all.${groupHint}</p>`;
      scriptBody.innerHTML = '<p class="muted small">Select a single object to edit its script.</p>';
      return;
    }

    const data = this.world.getData(ids[0]);
    if (!data) return;

    const vecRow = (label, key, step = 0.1) => {
      const row = el('div', 'prop-row');
      row.appendChild(el('label', null, label));
      const group = el('div', 'prop-group');
      ['x', 'y', 'z'].forEach(axis => {
        const input = document.createElement('input');
        input.type = 'number'; input.step = step;
        input.dataset.field = `${key}-${axis}`;
        input.value = (data[key][axis]).toFixed(2);
        input.addEventListener('change', () => {
          this._pushUndo();
          data[key][axis] = parseFloat(input.value) || 0;
          this.world.updateObject(data.id, {});
          if (this.tool !== 'select') this.transformControls.attach(this.world.getMesh(data.id));
        });
        group.appendChild(input);
      });
      row.appendChild(group);
      return row;
    };

    body.appendChild(vecRow('Position', 'position'));
    body.appendChild(vecRow('Rotation', 'rotation', 0.05));
    body.appendChild(vecRow('Scale', 'scale', 0.05));

    if (data.size && SIZE_EDITABLE_TYPES.has(data.type)) {
      const row = el('div', 'prop-row');
      row.appendChild(el('label', null, 'Size'));
      const group = el('div', 'prop-group');
      ['x', 'y', 'z'].forEach(axis => {
        const input = document.createElement('input');
        input.type = 'number'; input.step = 0.1; input.min = 0.1;
        input.value = data.size[axis].toFixed(2);
        input.addEventListener('change', () => {
          this._pushUndo();
          data.size[axis] = Math.max(0.1, parseFloat(input.value) || 1);
          this.world.updateObject(data.id, {});
          if (this.tool !== 'select') this.transformControls.attach(this.world.getMesh(data.id));
        });
        group.appendChild(input);
      });
      row.appendChild(group);
      body.appendChild(row);
    }

    const colorRow = el('div', 'prop-row');
    colorRow.appendChild(el('label', null, 'Color'));
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = data.color || '#8a8f98';
    colorInput.addEventListener('input', () => {
      data.color = colorInput.value;
      this.world.updateObject(data.id, {});
      if (this.tool !== 'select') this.transformControls.attach(this.world.getMesh(data.id));
    });
    colorRow.appendChild(colorInput);
    body.appendChild(colorRow);

    if (data.type === 'light') {
      const intensityRow = el('div', 'prop-row');
      intensityRow.appendChild(el('label', null, 'Intensity'));
      const intensityInput = document.createElement('input');
      intensityInput.type = 'number'; intensityInput.min = 0; intensityInput.max = 10; intensityInput.step = 0.1;
      intensityInput.value = data.intensity ?? 1.2;
      intensityInput.addEventListener('change', () => {
        this._pushUndo();
        data.intensity = Math.max(0, parseFloat(intensityInput.value) || 0);
        this.world.updateObject(data.id, {});
      });
      intensityRow.appendChild(intensityInput);
      body.appendChild(intensityRow);

      const rangeRow = el('div', 'prop-row');
      rangeRow.appendChild(el('label', null, 'Range'));
      const rangeInput = document.createElement('input');
      rangeInput.type = 'number'; rangeInput.min = 0; rangeInput.max = 100; rangeInput.step = 0.5;
      rangeInput.value = data.range ?? 12;
      rangeInput.addEventListener('change', () => {
        this._pushUndo();
        data.range = Math.max(0, parseFloat(rangeInput.value) || 0);
        this.world.updateObject(data.id, {});
      });
      rangeRow.appendChild(rangeInput);
      body.appendChild(rangeRow);
    }

    if (data.type !== 'npc' && data.type !== 'light' && data.type !== 'camera') {
      const matRow = el('div', 'prop-row');
      matRow.appendChild(el('label', null, 'Material'));
      const matSelect = document.createElement('select');
      ['stone', 'grass', 'dirt', 'wood', 'concrete', 'brick', 'glass', 'metal', 'plastic', 'neon'].forEach(m => {
        const opt = document.createElement('option'); opt.value = m; opt.textContent = m;
        if (data.material === m) opt.selected = true;
        matSelect.appendChild(opt);
      });
      matSelect.addEventListener('change', () => {
        this._pushUndo(); data.material = matSelect.value; this.world.updateObject(data.id, {});
        if (this.tool !== 'select') this.transformControls.attach(this.world.getMesh(data.id));
      });
      matRow.appendChild(matSelect);
      body.appendChild(matRow);

      const transRow = el('div', 'prop-row');
      transRow.appendChild(el('label', null, 'Transparency'));
      const transInput = document.createElement('input');
      transInput.type = 'number'; transInput.min = 0; transInput.max = 1; transInput.step = 0.05;
      transInput.value = data.transparency || 0;
      transInput.addEventListener('change', () => {
        data.transparency = parseFloat(transInput.value) || 0; this.world.updateObject(data.id, {});
        if (this.tool !== 'select') this.transformControls.attach(this.world.getMesh(data.id));
      });
      transRow.appendChild(transInput);
      body.appendChild(transRow);
    }

    const collRow = el('div', 'prop-row');
    collRow.appendChild(el('label', null, 'Collision'));
    const collInput = document.createElement('input'); collInput.type = 'checkbox'; collInput.checked = !!data.collidable;
    collInput.addEventListener('change', () => { data.collidable = collInput.checked; });
    collRow.appendChild(collInput);
    body.appendChild(collRow);

    const anchRow = el('div', 'prop-row');
    anchRow.appendChild(el('label', null, 'Anchored'));
    const anchInput = document.createElement('input'); anchInput.type = 'checkbox'; anchInput.checked = !!data.anchored;
    anchInput.addEventListener('change', () => { data.anchored = anchInput.checked; });
    anchRow.appendChild(anchInput);
    body.appendChild(anchRow);

    // ---- proximity prompt ----
    body.appendChild(el('div', 'editor-panel-title', 'Proximity Prompt'));
    const promptEnableRow = el('div', 'prop-row');
    promptEnableRow.appendChild(el('label', null, 'Enabled'));
    const promptEnableInput = document.createElement('input');
    promptEnableInput.type = 'checkbox';
    promptEnableInput.checked = !!(data.prompt && data.prompt.enabled);
    promptEnableInput.addEventListener('change', () => {
      if (!data.prompt) data.prompt = { enabled: false, text: 'Interact', key: 'KeyE', maxDistance: 3.5, holdSeconds: 0 };
      data.prompt.enabled = promptEnableInput.checked;
      this._renderProperties();
    });
    promptEnableRow.appendChild(promptEnableInput);
    body.appendChild(promptEnableRow);

    if (data.prompt && data.prompt.enabled) {
      const textRow = el('div', 'prop-row');
      textRow.appendChild(el('label', null, 'Text'));
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.value = data.prompt.text || 'Interact';
      textInput.addEventListener('change', () => { data.prompt.text = textInput.value || 'Interact'; });
      textRow.appendChild(textInput);
      body.appendChild(textRow);

      const keyRow = el('div', 'prop-row');
      keyRow.appendChild(el('label', null, 'Key'));
      const keySelect = document.createElement('select');
      PROMPT_KEYS.forEach(k => {
        const opt = document.createElement('option'); opt.value = k; opt.textContent = k.replace('Key', '');
        if ((data.prompt.key || 'KeyE') === k) opt.selected = true;
        keySelect.appendChild(opt);
      });
      keySelect.addEventListener('change', () => { data.prompt.key = keySelect.value; });
      keyRow.appendChild(keySelect);
      body.appendChild(keyRow);

      const distRow = el('div', 'prop-row');
      distRow.appendChild(el('label', null, 'Distance'));
      const distInput = document.createElement('input');
      distInput.type = 'number'; distInput.min = 0.5; distInput.step = 0.5;
      distInput.value = data.prompt.maxDistance || 3.5;
      distInput.addEventListener('change', () => { data.prompt.maxDistance = Math.max(0.5, parseFloat(distInput.value) || 3.5); });
      distRow.appendChild(distInput);
      body.appendChild(distRow);

      const holdRow = el('div', 'prop-row');
      holdRow.appendChild(el('label', null, 'Hold (sec)'));
      const holdInput = document.createElement('input');
      holdInput.type = 'number'; holdInput.min = 0; holdInput.step = 0.25;
      holdInput.value = data.prompt.holdSeconds || 0;
      holdInput.addEventListener('change', () => { data.prompt.holdSeconds = Math.max(0, parseFloat(holdInput.value) || 0); });
      holdRow.appendChild(holdInput);
      body.appendChild(holdRow);
    }

    // ---- script editor: Text mode (type the language) or Easy mode (guided builder) ----
    const modeRow = el('div', 'script-mode-toggle');
    const textModeBtn = el('button', 'script-mode-btn' + (this._scriptMode !== 'easy' ? ' active' : ''), 'Text');
    const easyModeBtn = el('button', 'script-mode-btn' + (this._scriptMode === 'easy' ? ' active' : ''), 'Easy Mode');
    textModeBtn.addEventListener('click', () => { this._scriptMode = 'text'; this._renderProperties(); });
    easyModeBtn.addEventListener('click', () => { this._scriptMode = 'easy'; this._renderProperties(); });
    modeRow.appendChild(textModeBtn);
    modeRow.appendChild(easyModeBtn);
    scriptBody.appendChild(modeRow);

    if (this._scriptMode === 'easy') {
      const builderMount = el('div', 'script-builder-mount');
      scriptBody.appendChild(builderMount);
      if (!Array.isArray(data.scripts)) data.scripts = [];
      renderScriptBuilder(builderMount, data.scripts, (rules) => {
        data.scripts = rules;
        data.scriptSource = decompileScript(rules);
      });
      const hint = el('p', 'script-hint', 'Pick an event, then pick actions and fill in the blanks — no typing needed. Property actions (Set Color, Set Size, etc.) affect this object unless you fill in another object\'s id. Tip: Show Message text can include {color}, {transparency}, {name} to display this object\'s current values. Switch to Text mode any time to see (or hand-edit) the equivalent script.');
      scriptBody.appendChild(hint);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = data.scriptSource || decompileScript(data.scripts || []);
    const saveBtn = el('button', 'btn btn-ghost btn-sm', 'Save script');
    saveBtn.addEventListener('click', () => {
      const result = parseScript(textarea.value);
      if (!result.ok) { toast(result.error); return; }
      data.scripts = result.rules;
      data.scriptSource = textarea.value;
      toast('Script saved');
    });
    scriptBody.appendChild(textarea);
    scriptBody.appendChild(saveBtn);

    const hint = document.createElement('pre');
    hint.className = 'script-hint';
    hint.textContent =
`Example:

onTouch:
    setColor("#ff0000")
    showMessage("This part is now {color}!")

Events: ${EVENT_TYPES.join(', ')}
Actions: ${ACTION_TYPES.join(', ')}

Property actions (setColor, setTransparency, setCollidable, setVisible,
setSize, movePart) affect this object by default — add a second/extra
argument with another object's id to affect that one instead.

showMessage text can reference this object's current properties with
{color}, {transparency}, {name}, {size.x}, etc.

No raw JavaScript runs — every line compiles to one of the actions above.`;
    scriptBody.appendChild(hint);
  }
}

function iconFor(type) {
  return { part: '◼', spawn: '⭐', model: '🧩', light: '💡', camera: '🎥', npc: '🙂', checkpoint: '🚩', killzone: '☠', finish: '🏁', folder: '📁' }[type] || '◼';
}
