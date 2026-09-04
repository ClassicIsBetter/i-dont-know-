// ===========================================================
// camera.js — third-person orbit camera (Roblox-style), collision aware
// ===========================================================
import * as THREE from 'three';
import { clamp, damp } from './utils.js';
import { isTouchDevice } from './touchControls.js';

const MIN_DIST = 0.05;
const MAX_DIST = 12;
const FP_DIST = 0.15;

export class ThirdPersonCamera {
  constructor(camera, domElement, world) {
    this.camera = camera;
    this.dom = domElement;
    this.world = world;

    this.theta = Math.PI; // horizontal angle
    this.phi = 1.15;      // vertical angle (from +Y)
    this.distance = 6.5;
    this.currentDistance = 6.5;
    this.target = new THREE.Vector3();
    this.sensitivity = 1.0;
    this.firstPerson = false;

    this._dragging = false;
    this._pointerLocked = false;
    this._raycaster = new THREE.Raycaster();

    this._bind();
  }

  _bind() {
    this._onMouseDown = (e) => {
      if (isTouchDevice) return;
      if (e.button === 2) { // right-click drag always orbits (used in editor, and as fallback in play)
        this._dragging = true;
      }
    };
    this._onMouseUp = () => { this._dragging = false; };
    this._onMouseMove = (e) => {
      if (isTouchDevice) return;
      if (!this._pointerLocked && !this._dragging) return;
      this.applyLookDelta(e.movementX || 0, e.movementY || 0);
    };
    this._onWheel = (e) => {
      if (this.firstPerson) return;
      this.distance = clamp(this.distance + e.deltaY * 0.01, MIN_DIST, MAX_DIST);
    };
    this._onLockChange = () => {
      this._pointerLocked = document.pointerLockElement === this.dom;
      this._locked = this._pointerLocked;
    };
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    this.dom.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // shared by mouse movementX/Y (pointer-locked) and touch drag deltas
  applyLookDelta(dx, dy) {
    this.theta -= dx * 0.0028 * this.sensitivity;
    this.phi = clamp(this.phi - dy * 0.0022 * this.sensitivity, 0.35, Math.PI - 0.25);
  }

  lockPointer() { if (!isTouchDevice) this.dom.requestPointerLock?.()?.catch?.(() => {}); }
  unlockPointer() { if (document.pointerLockElement === this.dom) document.exitPointerLock?.(); }
  get locked() { return this._pointerLocked; }

  dispose() {
    this.dom.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.dom.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }

  setFirstPerson(v) {
    this.firstPerson = v;
    this.distance = v ? FP_DIST : 6.5;
  }

  get yaw() { return this.theta; }

  update(dt, focusPoint, avatarRootToHide) {
    // focusPoint: player's chest position
    this.target.lerp(focusPoint, Math.min(1, 20 * dt));

    const desiredDistance = this.firstPerson ? FP_DIST : this.distance;

    // spherical -> cartesian offset
    const sinPhi = Math.sin(this.phi);
    const dirX = sinPhi * Math.sin(this.theta);
    const dirY = Math.cos(this.phi);
    const dirZ = sinPhi * Math.cos(this.theta);

    // collision: raycast from target outward, shrink distance if blocked
    let finalDistance = desiredDistance;
    if (!this.firstPerson) {
      const origin = this.target.clone();
      const dir = new THREE.Vector3(dirX, dirY, dirZ);
      this._raycaster.set(origin, dir);
      this._raycaster.far = desiredDistance + 0.3;
      const hits = this._raycaster.intersectObjects(this.world.getCollidableMeshes(), true);
      if (hits.length > 0) {
        finalDistance = Math.max(MIN_DIST * 0.4, hits[0].distance - 0.25);
      }
    }

    this.currentDistance = damp(this.currentDistance, finalDistance, 16, dt);

    const camPos = new THREE.Vector3(
      this.target.x + dirX * this.currentDistance,
      this.target.y + dirY * this.currentDistance,
      this.target.z + dirZ * this.currentDistance
    );
    this.camera.position.copy(camPos);
    this.camera.lookAt(this.target);

    if (avatarRootToHide) {
      avatarRootToHide.visible = !(this.firstPerson);
    }
  }
}
