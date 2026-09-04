// ===========================================================
// touchControls.js — on-screen joystick + look-drag + buttons for touch
// devices. Only instantiated when isTouchDevice is true (see main.js);
// desktop play is completely unaffected.
//
// Design: the virtual joystick just adds/removes the same WASD key
// codes the keyboard path already uses (player.keys is a plain Set),
// so movement, collision, and animation all go through the exact same
// code PlayerController already runs — nothing about desktop movement
// changes. Camera look reuses ThirdPersonCamera.applyLookDelta(), the
// same math the mouse-drag path uses.
// ===========================================================

// "coarse" pointer = touch is the PRIMARY input (phones/tablets), which
// is a better signal than 'ontouchstart' in window (true on some touch
// laptops that are still mouse-first).
export const isTouchDevice =
  (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
  ('ontouchstart' in window && navigator.maxTouchPoints > 0);

const MOVE_DEADZONE = 0.28;
const LOOK_SCALE = 2.4; // touch drags are coarser/slower than raw mouse movementX

export class TouchControls {
  constructor(session) {
    this.session = session;
    this._joystickPointerId = null;
    this._lookPointerId = null;
    this._sprintOn = false;
    this._buildDom();
    this._bind();
  }

  _buildDom() {
    const wrap = document.getElementById('game-canvas-wrap');
    const root = document.createElement('div');
    root.className = 'touch-controls hidden';
    root.id = 'touch-controls';
    root.innerHTML = `
      <div class="touch-look-zone" id="touch-look-zone"></div>
      <div class="touch-joystick" id="touch-joystick">
        <div class="touch-joystick-knob" id="touch-joystick-knob"></div>
      </div>
      <button class="touch-btn touch-btn-chat" id="touch-btn-chat" title="Chat">💬</button>
      <button class="touch-btn touch-btn-pause" id="touch-btn-pause" title="Pause">☰</button>
      <div class="touch-buttons" id="touch-buttons">
        <button class="touch-btn touch-btn-fp" id="touch-btn-fp" title="First person">👁</button>
        <button class="touch-btn touch-btn-sprint" id="touch-btn-sprint" title="Sprint">⚡</button>
        <button class="touch-btn touch-btn-action hidden" id="touch-btn-action" title="Attack">⚔</button>
        <button class="touch-btn touch-btn-jump" id="touch-btn-jump" title="Jump">⤒</button>
      </div>
    `;
    wrap.appendChild(root);
    this.root = root;
    this.canvasWrap = wrap;
    this.joystick = root.querySelector('#touch-joystick');
    this.knob = root.querySelector('#touch-joystick-knob');
    this.lookZone = root.querySelector('#touch-look-zone');
    this.btnJump = root.querySelector('#touch-btn-jump');
    this.btnAction = root.querySelector('#touch-btn-action');
    this.btnSprint = root.querySelector('#touch-btn-sprint');
    this.btnFp = root.querySelector('#touch-btn-fp');
    this.btnChat = root.querySelector('#touch-btn-chat');
    this.btnPause = root.querySelector('#touch-btn-pause');
  }

  show(project) {
    this.root.classList.remove('hidden');
    this.canvasWrap.classList.add('touch-active');
    const mode = project?.mode;
    const hasAction = mode === 'sword' || mode === 'demolition';
    this.btnAction.classList.toggle('hidden', !hasAction);
    this.btnAction.textContent = mode === 'demolition' ? '🚀' : '⚔';
    this.btnChat.classList.toggle('hidden', !this.session.multiplayer);
  }

  hide() {
    this.root.classList.add('hidden');
    this.canvasWrap.classList.remove('touch-active');
    this._resetJoystick();
    this._lookPointerId = null;
  }

  _bind() {
    // ---- joystick (movement) ----
    this.joystick.addEventListener('pointerdown', (e) => {
      if (this._joystickPointerId !== null) return;
      e.preventDefault();
      this._joystickPointerId = e.pointerId;
      this.joystick.setPointerCapture(e.pointerId);
      this._joystickRect = this.joystick.getBoundingClientRect();
      this._updateJoystick(e);
    });
    this.joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joystickPointerId) return;
      e.preventDefault();
      this._updateJoystick(e);
    });
    const endJoystick = (e) => {
      if (e.pointerId !== this._joystickPointerId) return;
      this._joystickPointerId = null;
      this._resetJoystick();
    };
    this.joystick.addEventListener('pointerup', endJoystick);
    this.joystick.addEventListener('pointercancel', endJoystick);

    // ---- look zone (camera drag, anywhere over the rest of the canvas) ----
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this._lookPointerId !== null) return;
      e.preventDefault();
      this._lookPointerId = e.pointerId;
      this.lookZone.setPointerCapture(e.pointerId);
      this._lastLookX = e.clientX;
      this._lastLookY = e.clientY;
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookPointerId) return;
      e.preventDefault();
      const dx = e.clientX - this._lastLookX;
      const dy = e.clientY - this._lastLookY;
      this._lastLookX = e.clientX;
      this._lastLookY = e.clientY;
      this.session.orbitCam.applyLookDelta(dx * LOOK_SCALE, dy * LOOK_SCALE);
    });
    const endLook = (e) => {
      if (e.pointerId !== this._lookPointerId) return;
      this._lookPointerId = null;
    };
    this.lookZone.addEventListener('pointerup', endLook);
    this.lookZone.addEventListener('pointercancel', endLook);

    // ---- buttons ----
    this.btnJump.addEventListener('pointerdown', (e) => { e.preventDefault(); this.session.player.requestJump(); });
    this.btnAction.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const mode = this.session.project?.mode;
      if (mode === 'demolition') this.session._fireRocket();
      else if (mode === 'sword') this.session._handleAttack();
    });
    this.btnSprint.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._sprintOn = !this._sprintOn;
      this.btnSprint.classList.toggle('active', this._sprintOn);
      if (this._sprintOn) this.session.player.keys.add('ShiftLeft');
      else this.session.player.keys.delete('ShiftLeft');
    });
    this.btnFp.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.session._toggleFirstPersonQuick();
      this.btnFp.classList.toggle('active', this.session.orbitCam.firstPerson);
    });
    this.btnChat.addEventListener('pointerdown', (e) => { e.preventDefault(); this.session._openChat(); });
    this.btnPause.addEventListener('pointerdown', (e) => { e.preventDefault(); this.session.togglePause(); });
  }

  _updateJoystick(e) {
    const r = this._joystickRect;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width / 2;
    const dist = Math.hypot(dx, dy);
    if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

    const nx = dx / max, ny = dy / max;
    const keys = this.session.player.keys;
    if (Math.abs(nx) > MOVE_DEADZONE) {
      if (nx > 0) { keys.add('KeyD'); keys.delete('KeyA'); } else { keys.add('KeyA'); keys.delete('KeyD'); }
    } else { keys.delete('KeyA'); keys.delete('KeyD'); }
    if (Math.abs(ny) > MOVE_DEADZONE) {
      if (ny < 0) { keys.add('KeyW'); keys.delete('KeyS'); } else { keys.add('KeyS'); keys.delete('KeyW'); }
    } else { keys.delete('KeyW'); keys.delete('KeyS'); }
  }

  _resetJoystick() {
    this.knob.style.transform = 'translate(0px, 0px)';
    const keys = this.session.player.keys;
    keys.delete('KeyW'); keys.delete('KeyA'); keys.delete('KeyS'); keys.delete('KeyD');
  }
}
