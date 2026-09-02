// ===========================================================
// avatar.js — original blocky character: hierarchy, cosmetics, animation
// Proportions are tuned to the classic block-avatar silhouette: a
// cube-ish head noticeably narrower than the torso, and a square torso
// and limbs — this is an original interpretation of that general style,
// not a copy of any specific game's assets.
// ===========================================================
import * as THREE from 'three';

// Overall size dial — shrinks every part equally, proportions untouched.
const SCALE = 0.78;

// ---- proportions (world units) — cube-ish head narrower than the torso,
// chunky square body, matching the classic block-avatar silhouette ----
export const PROPORTIONS = {
  headW: 0.72 * SCALE, headH: 0.68 * SCALE, headD: 0.7 * SCALE,
  torsoW: 1.0 * SCALE, torsoH: 1.05 * SCALE, torsoD: 0.55 * SCALE,
  armW: 0.42 * SCALE, armH: 1.05 * SCALE, armD: 0.42 * SCALE,
  legW: 0.46 * SCALE, legH: 1.0 * SCALE, legD: 0.46 * SCALE,
};

// uniform size knob — shrinks/grows the whole rig equally, so relative
// limb proportions never change, only the overall scale of the character.
export const BASE_SCALE = 0.8;

export const TOTAL_HEIGHT =
  (PROPORTIONS.legH + PROPORTIONS.torsoH + PROPORTIONS.headH) * BASE_SCALE;

// ---- cosmetics catalog (all procedural / original, no external assets) ----
export const CATALOG = {
  skin: [
    { id: 'skin-classic', label: 'Classic', color: '#f5cc3b' },
    { id: 'skin-a', label: 'Sand', color: '#f0c39a' },
    { id: 'skin-b', label: 'Almond', color: '#d9a06b' },
    { id: 'skin-c', label: 'Umber', color: '#9c6b45' },
    { id: 'skin-d', label: 'Cocoa', color: '#5b3a29' },
    { id: 'skin-e', label: 'Porcelain', color: '#f4e0d0' },
    { id: 'skin-f', label: 'Slate', color: '#7d8494' },
    { id: 'skin-g', label: 'Amber Bot', color: '#f2a541' },
    { id: 'skin-h', label: 'Mint Bot', color: '#5fd0b0' },
  ],
  shirt: [
    { id: 'shirt-none', label: 'None', color: null },
    { id: 'shirt-b', label: 'Cobalt', color: '#2e6fd9' },
    { id: 'shirt-a', label: 'Crimson', color: '#c0392b' },
    { id: 'shirt-c', label: 'Forest', color: '#2e8b57' },
    { id: 'shirt-d', label: 'Charcoal', color: '#2b2f38' },
    { id: 'shirt-e', label: 'Amber', color: '#f2a541' },
    { id: 'shirt-f', label: 'Violet', color: '#8e5bd9' },
  ],
  pants: [
    { id: 'pants-classic', label: 'Classic', color: '#3a9d4f' },
    { id: 'pants-a', label: 'Denim', color: '#33475b' },
    { id: 'pants-b', label: 'Charcoal', color: '#2a2e36' },
    { id: 'pants-c', label: 'Khaki', color: '#a68a5b' },
    { id: 'pants-d', label: 'Crimson', color: '#7a2e2e' },
    { id: 'pants-e', label: 'Teal', color: '#2f7d75' },
  ],
  hair: [
    { id: 'hair-none', label: 'None', color: null, shape: 'none' },
    { id: 'hair-a', label: 'Buzz', color: '#3b2a20', shape: 'buzz' },
    { id: 'hair-b', label: 'Swoop', color: '#1c1c1c', shape: 'swoop' },
    { id: 'hair-c', label: 'Curly', color: '#6b3f22', shape: 'curly' },
    { id: 'hair-d', label: 'Spike', color: '#d9d2c4', shape: 'spike' },
    { id: 'hair-e', label: 'Fire', color: '#e5484d', shape: 'spike' },
  ],
  hat: [
    { id: 'hat-none', label: 'None', shape: 'none' },
    { id: 'hat-cap', label: 'Cap', color: '#2e6fd9', shape: 'cap' },
    { id: 'hat-top', label: 'Top Hat', color: '#1b1b1b', shape: 'top' },
    { id: 'hat-cone', label: 'Cone', color: '#f2a541', shape: 'cone' },
    { id: 'hat-band', label: 'Headband', color: '#e5484d', shape: 'band' },
  ],
  face: [
    //{ id: 'face-a', label: 'Classic' },
    { id: 'face-b', label: 'Happy' },
    { id: 'face-c', label: 'Cool' },
    { id: 'face-d', label: 'Surprised' },
    { id: 'face-e', label: 'Determined' },
  ],
  accessory: [
    { id: 'acc-none', label: 'None', shape: 'none' },
    { id: 'acc-backpack', label: 'Backpack', color: '#2e8b57', shape: 'backpack' },
    { id: 'acc-cape', label: 'Cape', color: '#7a2e2e', shape: 'cape' },
    { id: 'acc-shades', label: 'Shades', color: '#111318', shape: 'shades' },
  ],
  body: [
    { id: 'body-classic', label: 'Classic', scale: 1.0 },
    { id: 'body-slim', label: 'Slim', scale: 0.88 },
    { id: 'body-bulky', label: 'Bulky', scale: 1.14 },
  ],
};

export function defaultAvatarConfig() {
  return {
    skin: 'skin-classic',
    shirt: 'shirt-b',
    pants: 'pants-classic',
    hair: 'hair-none',
    hat: 'hat-none',
    face: 'face-b',
    accessory: 'acc-none',
    body: 'body-classic',
  };
}

function findItem(cat, id) {
  return CATALOG[cat].find(i => i.id === id) || CATALOG[cat][0];
}

// Draws a bold, high-contrast face directly onto an opaque skin-colored
// background (avoids any transparent/alpha compositing surprises) sized
// to match the head's width:height ratio so features aren't squished.
// If customImageUrl is given, that uploaded image is used as the face
// texture instead of drawing one of the built-in procedural faces —
// images are pre-cropped to the head's aspect ratio at upload time (see
// ui.js), so no extra fitting happens here.
function makeFaceTexture(faceId, skinColor, aspect, customImageUrl) {
  if (customImageUrl) {
    const tex = new THREE.TextureLoader().load(customImageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const h = 220;
  const w = Math.round(h * aspect);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // opaque skin-colored backdrop so the decal blends seamlessly into the head
  ctx.fillStyle = skinColor;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h * 0.46;
  const eyeDX = w * 0.145, eyeR = h * 0.09;
  ctx.fillStyle = '#12141a';

  switch (faceId) {
    case 'face-b': // happy
  // vertical eyes
  line(ctx, cx - eyeDX, cy - h * 0.045, cx - eyeDX, cy + h * 0.045, h * 0.035);
  line(ctx, cx + eyeDX, cy - h * 0.045, cx + eyeDX, cy + h * 0.045, h * 0.035);

  // happy smile
  line(ctx, cx - w * 0.13, cy + h * 0.22, cx, cy + h * 0.27, h * 0.04);
  line(ctx, cx, cy + h * 0.27, cx + w * 0.13, cy + h * 0.22, h * 0.04);
  break;

case 'face-c': // cool
  // vertical eyes
  line(ctx, cx - eyeDX, cy - h * 0.045, cx - eyeDX, cy + h * 0.045, h * 0.035);
  line(ctx, cx + eyeDX, cy - h * 0.045, cx + eyeDX, cy + h * 0.045, h * 0.035);

  // smirk
  line(ctx, cx - w * 0.11, cy + h * 0.24, cx + w * 0.13, cy + h * 0.2, h * 0.04);
  break;

case 'face-d': // surprised
  // taller vertical eyes
  line(ctx, cx - eyeDX, cy - h * 0.07, cx - eyeDX, cy + h * 0.07, h * 0.04);
  line(ctx, cx + eyeDX, cy - h * 0.07, cx + eyeDX, cy + h * 0.07, h * 0.04);

  // surprised mouth
  line(ctx, cx - w * 0.05, cy + h * 0.24, cx + w * 0.05, cy + h * 0.24, h * 0.045);
  break;

case 'face-e': // determined
  // vertical eyes
  line(ctx, cx - eyeDX, cy - h * 0.06, cx - eyeDX, cy + h * 0.06, h * 0.045);
  line(ctx, cx + eyeDX, cy - h * 0.06, cx + eyeDX, cy + h * 0.06, h * 0.045);

  // straight mouth
  line(ctx, cx - w * 0.14, cy + h * 0.24, cx + w * 0.14, cy + h * 0.24, h * 0.045);
  break;

default: // classic
  // vertical eyes
  line(ctx, cx - eyeDX, cy - h * 0.045, cx - eyeDX, cy + h * 0.045, h * 0.035);
  line(ctx, cx + eyeDX, cy - h * 0.045, cx + eyeDX, cy + h * 0.045, h * 0.035);

  // straight smile
  line(ctx, cx - w * 0.13, cy + h * 0.22, cx + w * 0.13, cy + h * 0.22, h * 0.04);
  //break;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function arc(ctx, x, y, r, a0, a1, w) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.lineWidth = w; ctx.strokeStyle = '#12141a'; ctx.lineCap = 'round'; ctx.stroke(); }
function line(ctx, x0, y0, x1, y1, w) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineWidth = w; ctx.strokeStyle = '#12141a'; ctx.lineCap = 'round'; ctx.stroke(); }

/**
 * Builds a full blocky avatar as a THREE.Group with a real hierarchy:
 * root -> Body (scaled) -> torso, head-pivot(+head/face/hair/hat), arm
 * pivots, leg pivots. Front of the character is the local +Z axis.
 */
export function buildAvatar(config = defaultAvatarConfig()) {
  const P = PROPORTIONS;
  const bodyScale = findItem('body', config.body).scale ?? 1;

  const root = new THREE.Group();
  root.name = 'AvatarRoot';
  root.userData.config = config;

  const skinColor = findItem('skin', config.skin).color;
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.65 });
  const shirtItem = findItem('shirt', config.shirt);
  const torsoMat = new THREE.MeshStandardMaterial({ color: shirtItem.color || skinColor, roughness: 0.75 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: findItem('pants', config.pants).color, roughness: 0.8 });

  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'Body';
  bodyGroup.scale.setScalar(bodyScale * BASE_SCALE);
  root.add(bodyGroup);

  // ---- legs ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.name = `${side}LegPivot`;
    pivot.position.set(side === 'left' ? -P.legW / 2 - 0.01 : P.legW / 2 + 0.01, P.legH, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(P.legW, P.legH, P.legD), pantsMat);
    mesh.position.set(0, -P.legH / 2, 0);
    mesh.castShadow = true; mesh.receiveShadow = true;
    pivot.add(mesh);
    return pivot;
  }
  const leftLeg = makeLeg('left');
  const rightLeg = makeLeg('right');
  bodyGroup.add(leftLeg, rightLeg);

  // ---- torso ----
  const torso = new THREE.Mesh(new THREE.BoxGeometry(P.torsoW, P.torsoH, P.torsoD), torsoMat);
  torso.position.set(0, P.legH + P.torsoH / 2, 0);
  torso.castShadow = true; torso.receiveShadow = true;
  torso.name = 'Torso';
  bodyGroup.add(torso);

  // ---- arms ----
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.name = `${side}ArmPivot`;
    const x = side === 'left' ? -(P.torsoW / 2 + P.armW / 2 + 0.01) : (P.torsoW / 2 + P.armW / 2 + 0.01);
    pivot.position.set(x, P.legH + P.torsoH - 0.06, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(P.armW, P.armH, P.armD), skinMat.clone());
    mesh.position.set(0, -P.armH / 2, 0);
    mesh.castShadow = true; mesh.receiveShadow = true;
    pivot.add(mesh);
    return pivot;
  }
  const leftArm = makeArm('left');
  const rightArm = makeArm('right');
  bodyGroup.add(leftArm, rightArm);

  // ---- head (short & wide, classic block-avatar silhouette) ----
  const headPivot = new THREE.Group();
  headPivot.name = 'HeadPivot';
  headPivot.position.set(0, P.legH + P.torsoH, 0);
  bodyGroup.add(headPivot);

  const faceItem = findItem('face', config.face);
  const faceTex = makeFaceTexture(config.face, skinColor, P.headW / P.headH, faceItem.custom ? faceItem.imageUrl : null);
  const headMats = [
    skinMat, skinMat, skinMat, skinMat,
    new THREE.MeshStandardMaterial({ color: '#ffffff', map: faceTex, roughness: 0.55 }), // +Z = face
    skinMat,
  ];
  const head = new THREE.Mesh(new THREE.BoxGeometry(P.headW, P.headH, P.headD), headMats);
  head.position.set(0, P.headH / 2, 0);
  head.castShadow = true; head.receiveShadow = true;
  head.name = 'Head';
  headPivot.add(head);

  // ---- hair ----
  const hairItem = findItem('hair', config.hair);
  if (hairItem.shape && hairItem.shape !== 'none') {
    const hairMat = new THREE.MeshStandardMaterial({ color: hairItem.color, roughness: 0.9 });
    let hairMesh;
    const hw = P.headW, hd = P.headD, headTop = P.headH;
    if (hairItem.shape === 'buzz') {
      const th = hw * 0.28;
      hairMesh = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.05, th, hd * 1.05), hairMat);
      hairMesh.position.set(0, headTop + th / 2 - 0.05, -hd * 0.02);
    } else if (hairItem.shape === 'swoop') {
      const th = hw * 0.32;
      hairMesh = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.1, th, hd * 1.1), hairMat);
      hairMesh.position.set(hw * 0.05, headTop + th / 2 - 0.03, -hd * 0.08);
      hairMesh.rotation.z = 0.12;
    } else if (hairItem.shape === 'curly') {
      hairMesh = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.3, hw * 0.3, hw * 0.3), hairMat);
        s.position.set((Math.random() - 0.5) * hw * 0.85, headTop + hw * 0.1 + Math.random() * hw * 0.12, (Math.random() - 0.5) * hd * 0.75);
        hairMesh.add(s);
      }
    } else if (hairItem.shape === 'spike') {
      hairMesh = new THREE.Group();
      const coneH = hw * 0.85;
      for (let i = -1; i <= 1; i++) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(hw * 0.15, coneH, 4), hairMat);
        s.position.set(i * hw * 0.3, headTop + coneH / 2 - 0.03, 0);
        s.rotation.y = Math.PI / 4;
        hairMesh.add(s);
      }
    }
    if (hairMesh) { hairMesh.name = 'Hair'; headPivot.add(hairMesh); }
  }

  // ---- hat ----
  const hatItem = findItem('hat', config.hat);
  if (hatItem.shape && hatItem.shape !== 'none') {
    const hatMat = new THREE.MeshStandardMaterial({ color: hatItem.color, roughness: 0.5 });
    let hatMesh;
    const hw = P.headW, hd = P.headD, headTop = P.headH;
    if (hatItem.shape === 'cap') {
      hatMesh = new THREE.Group();
      const crownH = hw * 0.5;
      const crown = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.12, crownH, hd * 1.12), hatMat);
      crown.position.set(0, headTop + crownH / 2 - 0.04, -hd * 0.02);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.6, hw * 0.08, hd * 0.55), hatMat);
      brim.position.set(0, headTop + crownH * 0.35, hd * 0.68);
      hatMesh.add(crown, brim);
    } else if (hatItem.shape === 'top') {
      hatMesh = new THREE.Group();
      const brimH = hw * 0.1;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(hw * 0.78, hw * 0.78, brimH, 16), hatMat);
      brim.position.set(0, headTop + brimH / 2, 0);
      const cylH = hw * 1.1;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(hw * 0.44, hw * 0.44, cylH, 16), hatMat);
      cyl.position.set(0, headTop + brimH + cylH / 2 - 0.02, 0);
      hatMesh.add(brim, cyl);
    } else if (hatItem.shape === 'cone') {
      const coneH = hw * 1.3;
      hatMesh = new THREE.Mesh(new THREE.ConeGeometry(hw * 0.62, coneH, 14), hatMat);
      hatMesh.position.set(0, headTop + coneH / 2 - 0.04, 0);
    } else if (hatItem.shape === 'band') {
      hatMesh = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.08, hw * 0.2, hd * 1.08), hatMat);
      hatMesh.position.set(0, headTop * 0.6, 0);
    } else if (hatItem.shape === 'custom' && Array.isArray(hatItem.parts)) {
      // built by the player in the World Editor and uploaded on the Avatar page —
      // each part's position is authored relative to (0,0,0) = the top of the head.
      hatMesh = new THREE.Group();
      for (const part of hatItem.parts) {
        const size = part.size || { x: 0.3, y: 0.3, z: 0.3 };
        const geo = new THREE.BoxGeometry(Math.max(0.02, size.x), Math.max(0.02, size.y), Math.max(0.02, size.z));
        const partMat = new THREE.MeshStandardMaterial({ color: part.color || '#8a8f98', roughness: 0.55 });
        const m = new THREE.Mesh(geo, partMat);
        const pos = part.position || { x: 0, y: 0, z: 0 };
        m.position.set(pos.x || 0, headTop + (pos.y || 0), pos.z || 0);
        const rot = part.rotation;
        if (rot) m.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        const scl = part.scale;
        if (scl) m.scale.set(scl.x || 1, scl.y || 1, scl.z || 1);
        m.castShadow = true; m.receiveShadow = true;
        hatMesh.add(m);
      }
    }
    if (hatMesh) { hatMesh.name = 'Hat'; headPivot.add(hatMesh); }
  }

  // ---- accessory ----
  const accItem = findItem('accessory', config.accessory);
  if (accItem.shape && accItem.shape !== 'none') {
    const accMat = new THREE.MeshStandardMaterial({ color: accItem.color, roughness: 0.6 });
    if (accItem.shape === 'backpack') {
      const bp = new THREE.Mesh(new THREE.BoxGeometry(P.torsoW * 0.7, P.torsoH * 0.6, 0.25), accMat);
      bp.position.set(0, P.legH + P.torsoH / 2, -(P.torsoD / 2 + 0.15));
      bp.name = 'Backpack';
      bodyGroup.add(bp);
    } else if (accItem.shape === 'cape') {
      const cape = new THREE.Mesh(new THREE.BoxGeometry(P.torsoW * 0.9, P.torsoH * 1.1, 0.08), accMat);
      cape.position.set(0, P.legH + P.torsoH * 0.55, -(P.torsoD / 2 + 0.06));
      cape.rotation.x = 0.15;
      cape.name = 'Cape';
      bodyGroup.add(cape);
    } else if (accItem.shape === 'shades') {
      const shades = new THREE.Mesh(new THREE.BoxGeometry(P.headW * 0.82, P.headH * 0.32, 0.06), new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.2, metalness: 0.4 }));
      shades.position.set(0, P.headH * 0.5, P.headD / 2 + 0.02);
      shades.name = 'Shades';
      headPivot.add(shades);
    }
  }

  root.userData.parts = { bodyGroup, torso, headPivot, head, leftArm, rightArm, leftLeg, rightLeg };
  root.userData.height = TOTAL_HEIGHT * bodyScale;
  root.userData.legH = P.legH * bodyScale * BASE_SCALE;
  return root;
}

export function disposeAvatar(root) {
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}

// ===========================================================
// Procedural animation — drives the limb pivots each frame.
// state: 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'attack'
// ===========================================================
export class AvatarAnimator {
  constructor(avatarRoot) {
    this.root = avatarRoot;
    this.parts = avatarRoot.userData.parts;
    this.t = 0;
    this.landTimer = 0;
    this.attackTimer = 0;
    this.justLanded = false;
    this.prevState = 'idle';
  }

  triggerAttack() { this.attackTimer = 0.001; }
  triggerLand() { this.landTimer = 0.001; this.justLanded = true; }

  update(dt, state, speed01) {
    this.t += dt;
    const { leftArm, rightArm, leftLeg, rightLeg, bodyGroup, headPivot } = this.parts;
    const walkFreq = 6 + speed01 * 4;
    const swing = (state === 'run' ? 0.9 : 0.55) * (state === 'walk' || state === 'run' ? Math.min(1, speed01 + 0.35) : 0);

    let lArmX = 0, rArmX = 0, lLegX = 0, rLegX = 0, bob = 0, tilt = 0;

    if (state === 'idle') {
      bob = Math.sin(this.t * 1.6) * 0.03;
      lArmX = Math.sin(this.t * 1.2) * 0.04;
      rArmX = -Math.sin(this.t * 1.2) * 0.04;
    } else if (state === 'walk' || state === 'run') {
      const s = Math.sin(this.t * walkFreq);
      lArmX = -s * swing;
      rArmX = s * swing;
      lLegX = s * swing * 0.9;
      rLegX = -s * swing * 0.9;
      bob = Math.abs(Math.cos(this.t * walkFreq)) * 0.06 * (state === 'run' ? 1.6 : 1);
    } else if (state === 'jump') {
      lArmX = -Math.PI; rArmX = -Math.PI; lLegX = 0.35; rLegX = -0.2;
    } else if (state === 'fall') {
      lArmX = -0.4; rArmX = -0.4; lLegX = -0.15; rLegX = 0.15;
    }

    let squash = 0;
    if (this.landTimer > 0) {
      this.landTimer += dt;
      const d = this.landTimer;
      squash = Math.max(0, 0.22 - d * 1.4);
      if (d > 0.16) this.landTimer = 0;
    }

    if (this.attackTimer > 0) {
      this.attackTimer += dt;
      const d = this.attackTimer;
      const dur = 0.28;
      if (d > dur) { this.attackTimer = 0; }
      else {
        const p = d / dur;
        rArmX = -2.2 + Math.sin(p * Math.PI) * 2.6;
        tilt = Math.sin(p * Math.PI) * 0.15;
      }
    }

    leftArm.rotation.x = damp(leftArm.rotation.x, lArmX, 14, dt);
    rightArm.rotation.x = damp(rightArm.rotation.x, rArmX, 14, dt);
    leftLeg.rotation.x = damp(leftLeg.rotation.x, lLegX, 14, dt);
    rightLeg.rotation.x = damp(rightLeg.rotation.x, rLegX, 14, dt);
    bodyGroup.position.y = damp(bodyGroup.position.y, bob - squash, 10, dt);
    bodyGroup.rotation.z = damp(bodyGroup.rotation.z, tilt, 10, dt);

    this.prevState = state;
  }
}

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
