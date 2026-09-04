// ===========================================================
// avatarViewer.js — shared avatar preview rendering, used by the Home
// hero panel, Avatar customization page, Account profile, and profile
// search results (as a "profile picture").
// ===========================================================
import * as THREE from 'three';
import { buildAvatar, disposeAvatar } from './avatar.js';

// ===========================================================
// MiniAvatarViewer — small self-contained rotating preview with its own
// renderer/scene/camera, optionally drag-to-rotate.
// ===========================================================
export class MiniAvatarViewer {
  constructor(mountEl, config, { interactive = false } = {}) {
    this.mount = mountEl;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountEl.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    const hemi = new THREE.HemisphereLight('#bfe3ff', '#222', 1.1);
    const dir = new THREE.DirectionalLight('#fff3d6', 1.1);
    dir.position.set(3, 5, 4);
    this.scene.add(hemi, dir);

    this.avatar = buildAvatar(config);
    this.avatar.position.y = 0;
    this.pivot = new THREE.Group();
    this.pivot.add(this.avatar);
    this.scene.add(this.pivot);

    this.angle = 0.4;
    this.autoRotate = true;
    this.camDist = 4.4;
    this.camHeight = 1.2;
    this.lookY = 0.9;

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(mountEl);
    this._resize();

    if (interactive) {
      let dragging = false, lastX = 0;
      mountEl.style.cursor = 'grab';
      mountEl.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; this.autoRotate = false; mountEl.style.cursor = 'grabbing'; });
      window.addEventListener('mouseup', () => { dragging = false; mountEl.style.cursor = 'grab'; });
      window.addEventListener('mousemove', (e) => { if (dragging) { this.angle += (e.clientX - lastX) * 0.01; lastX = e.clientX; } });
    }

    this._running = true;
    this._lastT = performance.now();
    const loop = () => {
      if (!this._running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this._lastT) / 1000);
      this._lastT = now;
      if (this.autoRotate) this.angle += dt * 0.5;
      this.camera.position.set(Math.sin(this.angle) * this.camDist, this.camHeight, Math.cos(this.angle) * this.camDist);
      this.camera.lookAt(0, this.lookY, 0);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  setConfig(config) {
    disposeAvatar(this.avatar);
    this.pivot.remove(this.avatar);
    this.avatar = buildAvatar(config);
    this.pivot.add(this.avatar);
  }

  _resize() {
    const w = this.mount.clientWidth || 300;
    const h = this.mount.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this._running = false;
    this._ro.disconnect();
    disposeAvatar(this.avatar);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ===========================================================
// renderAvatarThumbnail — a one-shot still render used as a "profile
// picture" (e.g. in search results), rather than keeping a live WebGL
// context per row. Creates a temporary renderer, renders exactly one
// frame, extracts a PNG data URL, then tears everything down.
// ===========================================================
export function renderAvatarThumbnail(config, size = 96) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  const hemi = new THREE.HemisphereLight('#bfe3ff', '#222', 1.1);
  const dir = new THREE.DirectionalLight('#fff3d6', 1.1);
  dir.position.set(3, 5, 4);
  scene.add(hemi, dir);

  const avatar = buildAvatar(config);
  scene.add(avatar);

  camera.position.set(1.5, 1.5, 3.6);
  camera.lookAt(0, 1.1, 0);
  renderer.render(scene, camera);

  const dataUrl = renderer.domElement.toDataURL('image/png');

  disposeAvatar(avatar);
  renderer.dispose();
  renderer.forceContextLoss?.();

  return dataUrl;
}
