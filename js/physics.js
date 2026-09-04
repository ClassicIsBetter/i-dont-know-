// ===========================================================
// physics.js — real rigid-body physics for destructible debris, via
// cannon-es. Scoped and deliberately separate from the player's own
// movement collision (player.js / world.js), which stays exactly as it
// was — this only drives parts that have been blown loose.
//
// Usage pattern:
//   1. addStatic(id, mesh, size) for every collidable part when a
//      physics-enabled game loads — this lets rockets/explosions detect
//      them, while they still render/collide normally as ordinary static
//      geometry (the player's existing AABB collision reads live mesh
//      transforms each frame, so it automatically respects wherever a
//      piece of debris currently is, without any special-casing).
//   2. explode(center, radius, strength) converts any static body within
//      range to a dynamic one and flings it outward with distance
//      falloff. From then on step() drives that body with gravity and
//      writes its position/rotation back onto the Three.js mesh.
// ===========================================================
import * as CANNON from 'cannon-es';

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    this.material = new CANNON.Material('debris');
    const contact = new CANNON.ContactMaterial(this.material, this.material, { friction: 0.45, restitution: 0.2 });
    this.world.addContactMaterial(contact);
    this.world.defaultContactMaterial = contact;

    this.bodies = new Map(); // id -> { body, mesh, size, dynamic }
  }

  addStatic(id, mesh, size, { indestructible = false } = {}) {
    const shape = new CANNON.Box(new CANNON.Vec3(Math.max(0.05, size.x / 2), Math.max(0.05, size.y / 2), Math.max(0.05, size.z / 2)));
    const body = new CANNON.Body({ mass: 0, shape, material: this.material });
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
    body.quaternion.setFromEuler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, 'XYZ');
    this.world.addBody(body);
    this.bodies.set(id, { body, mesh, size, dynamic: false, indestructible });
  }

  makeDynamic(id, mass) {
    const entry = this.bodies.get(id);
    if (!entry || entry.dynamic) return entry;
    this.world.removeBody(entry.body);
    const size = entry.size;
    const shape = new CANNON.Box(new CANNON.Vec3(Math.max(0.05, size.x / 2), Math.max(0.05, size.y / 2), Math.max(0.05, size.z / 2)));
    const body = new CANNON.Body({
      mass: mass || Math.max(1, size.x * size.y * size.z * 5),
      shape,
      material: this.material,
      allowSleep: true,
      linearDamping: 0.06,
      angularDamping: 0.35,
    });
    body.position.copy(entry.body.position);
    body.quaternion.copy(entry.body.quaternion);
    this.world.addBody(body);
    entry.body = body;
    entry.dynamic = true;
    return entry;
  }

  // Converts every static body within `radius` of `center` to dynamic and
  // flings it outward with distance falloff. Returns the ids affected.
  // Bodies flagged indestructible (e.g. the baseplate) are never affected.
  explode(center, radius, strength) {
    const affected = [];
    for (const [id, entry] of this.bodies) {
      if (entry.indestructible) continue;
      const dx = entry.body.position.x - center.x;
      const dy = entry.body.position.y - center.y;
      const dz = entry.body.position.z - center.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > radius) continue;

      const wasDynamic = entry.dynamic;
      const live = this.makeDynamic(id) || entry;
      const len = Math.max(0.5, dist);
      const falloff = 1 - dist / radius;
      const mag = strength * falloff;
      const impulse = new CANNON.Vec3(
        (dx / len) * mag,
        (dy / len) * mag + mag * 0.5, // extra upward kick, feels better than a flat radial blast
        (dz / len) * mag
      );
      live.body.applyImpulse(impulse, live.body.position);
      live.body.wakeUp();
      if (!wasDynamic) affected.push(id);
    }
    return affected;
  }

  step(dt) {
    this.world.step(1 / 60, Math.min(dt, 0.1), 5);
    for (const { body, mesh, dynamic } of this.bodies.values()) {
      if (!dynamic) continue;
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    }
  }

  dispose() {
    for (const { body } of this.bodies.values()) this.world.removeBody(body);
    this.bodies.clear();
  }
}
