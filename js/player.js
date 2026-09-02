// ===========================================================
// player.js — third-person character controller with physics-lite collision
// ===========================================================
import * as THREE from 'three';
import { clamp } from './utils.js';
import { AvatarAnimator } from './avatar.js';

const GRAVITY = -28;
const WALK_SPEED = 4.4;
const RUN_SPEED = 7.6;
const JUMP_VELOCITY = 9.2;
const ACCEL = 26;
const AIR_ACCEL = 10;
const STEP_HEIGHT = 0.43;
const CAPSULE_RADIUS = 0.33;

export class PlayerController {
  /**
   * @param {THREE.Object3D} avatarRoot  the avatar group (see avatar.js)
   * @param {World} world  world instance providing getCollidableMeshes()
   * @param {THREE.Scene} scene
   */
  constructor(avatarRoot, world, scene) {
    this.avatar = avatarRoot;
    this.world = world;
    this.scene = scene;
    this.animator = new AvatarAnimator(avatarRoot);

    this.position = new THREE.Vector3(0, 3, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0; // faces where camera looks (set externally by camera each frame)
    this.grounded = false;
    this.wasGrounded = false;
    this.state = 'idle';
    this.enabled = true;
    this.inputSuspended = false; // true while chat (or similar) has focus — gravity/physics keep running, movement input doesn't
    this.health = 100;
    this.maxHealth = 100;
    this.respawnPoint = new THREE.Vector3(0, 2, 0);

    this.keys = new Set();
    this._bindInput();

    this._raycaster = new THREE.Raycaster();
    this._down = new THREE.Vector3(0, -1, 0);
  }

  _bindInput() {
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' && this.enabled) this._jumpRequested = true;
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  setSpawn(pos) {
    this.respawnPoint.copy(pos);
  }

  respawn() {
    this.position.copy(this.respawnPoint);
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
  }

  takeDamage(amount) {
    this.health = clamp(this.health - amount, 0, this.maxHealth);
    return this.health;
  }

  attack() {
    this.animator.triggerAttack();
  }

  // called by touch controls (no physical Space key on mobile)
  requestJump() {
    if (this.enabled) this._jumpRequested = true;
  }

  /**
   * @param {number} dt
   * @param {number} cameraYaw  camera's horizontal facing, movement is camera-relative
   */
  update(dt, cameraYaw) {
    if (!this.enabled) { this._syncMesh(); return; }
    dt = Math.min(dt, 0.05);

    const suspended = this.inputSuspended;
    const forward = suspended ? 0 : (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = suspended ? 0 : (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const sprinting = !suspended && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    const moving = forward !== 0 || strafe !== 0;

    // camera-relative movement direction
    const dir = new THREE.Vector3(strafe, 0, -forward);
    if (dir.lengthSq() > 0) {
      dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
    }
    const targetSpeed = sprinting ? RUN_SPEED : WALK_SPEED;
    const targetVel = dir.multiplyScalar(moving ? targetSpeed : 0);

    const accel = this.grounded ? ACCEL : AIR_ACCEL;
    this.velocity.x += (targetVel.x - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (targetVel.z - this.velocity.z) * Math.min(1, accel * dt);

    // jump
    if (this._jumpRequested && this.grounded && !suspended) {
      this.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
    }
    this._jumpRequested = false;

    // gravity
    this.velocity.y += GRAVITY * dt;
    this.velocity.y = Math.max(this.velocity.y, -40);

    // ---- resolve horizontal collision (axis separated) ----
    const collidables = this.world.getCollidableMeshes();
    const nextPos = this.position.clone();

    nextPos.x += this.velocity.x * dt;
    if (this._collidesAt(nextPos, collidables)) { nextPos.x = this.position.x; this.velocity.x = 0; }

    nextPos.z += this.velocity.z * dt;
    if (this._collidesAt(nextPos, collidables)) { nextPos.z = this.position.z; this.velocity.z = 0; }

    // ---- vertical: integrate then snap to ground via raycast ----
    nextPos.y += this.velocity.y * dt;

    const groundY = this._sampleGround(nextPos, collidables);
    this.wasGrounded = this.grounded;
    if (groundY !== null && nextPos.y <= groundY + 0.02 && this.velocity.y <= 0) {
      // step assist: if the height diff is small treat as walkable ground
      nextPos.y = groundY;
      this.velocity.y = 0;
      this.grounded = true;
    } else if (groundY !== null && nextPos.y - groundY < STEP_HEIGHT && this.velocity.y <= 0 && this.grounded) {
      nextPos.y = groundY;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (nextPos.y < -25) { // fell off the world
      this.position.copy(this.respawnPoint);
      this.velocity.set(0, 0, 0);
      this.takeDamage(10);
    } else {
      this.position.copy(nextPos);
    }

    if (this.grounded && !this.wasGrounded) this.animator.triggerLand();

    // ---- animation state ----
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.grounded) this.state = this.velocity.y > 0.5 ? 'jump' : 'fall';
    else if (horizSpeed > 0.15) this.state = sprinting ? 'run' : 'walk';
    else this.state = 'idle';

    // face movement direction smoothly
    if (horizSpeed > 0.15) {
      const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
      this.yaw = smoothAngle(this.yaw, targetYaw, dt, 14);
    }

    this.animator.update(dt, this.state, clamp(horizSpeed / RUN_SPEED, 0, 1));
    this._syncMesh();
  }

  _syncMesh() {
    this.avatar.position.copy(this.position);
    this.avatar.rotation.y = this.yaw;
  }

  // capsule-vs-box overlap test at a candidate position (feet-space position = base of capsule)
  _collidesAt(pos, meshes) {
    const feetY = pos.y;
    const headY = pos.y + (this.avatar.userData.height || 2.2);
    for (const mesh of meshes) {
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.max.y <= feetY + 0.05 || box.min.y >= headY - 0.05) continue; // vertical separation -> no side collision
      const closestX = clamp(pos.x, box.min.x, box.max.x);
      const closestZ = clamp(pos.z, box.min.z, box.max.z);
      const dx = pos.x - closestX, dz = pos.z - closestZ;
      if (dx * dx + dz * dz < CAPSULE_RADIUS * CAPSULE_RADIUS) return true;
    }
    return false;
  }

  // find the highest surface directly beneath (x,z) among collidable meshes
  _sampleGround(pos, meshes) {
    let best = null;
    for (const mesh of meshes) {
      const box = new THREE.Box3().setFromObject(mesh);
      if (pos.x < box.min.x - CAPSULE_RADIUS || pos.x > box.max.x + CAPSULE_RADIUS) continue;
      if (pos.z < box.min.z - CAPSULE_RADIUS || pos.z > box.max.z + CAPSULE_RADIUS) continue;
      if (box.max.y <= pos.y + 1.6) { // only consider surfaces not far above current position
        if (best === null || box.max.y > best) best = box.max.y;
      }
    }
    return best;
  }
}

function smoothAngle(current, target, dt, lambda) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, lambda * dt);
}
