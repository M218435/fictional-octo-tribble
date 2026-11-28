const STORAGE_KEY = 'gh-gyro-aim-v1';
const DEG_TO_RAD = Math.PI / 180;
const SENSOR_TIMEOUT = 2500;
const MAX_INTERVAL = 0.12;

function gyroPreferences(value) {
  return {
    enabled: value?.enabled === true,
    mode: value?.mode === 'always' ? 'always' : 'ads',
    sensitivity: Number.isFinite(value?.sensitivity)
      ? Math.min(3, Math.max(0.25, value.sensitivity)) : 1,
  };
}

function filteredRate(rate) {
  // Reject small stationary drift and limit spikes from the motion sensor.
  return Math.sign(rate) * Math.max(0, Math.min(720, Math.abs(rate)) - 1);
}

export class GyroAim extends EventTarget {
  constructor({ win = window, storage, canAim, look }) {
    super();
    this.win = win;
    this.storage = storage;
    this.canAim = canAim;
    this.look = look;
    let saved;
    try { saved = JSON.parse(storage?.getItem(STORAGE_KEY)); } catch {}
    this.preferences = gyroPreferences(saved);
    this.motion = win.DeviceMotionEvent;
    const policy = win.document.permissionsPolicy || win.document.featurePolicy;
    const blocked = ['accelerometer', 'gyroscope'].some(feature =>
      policy?.features?.().includes(feature) && !policy.allowsFeature(feature));
    this.unavailable = !win.isSecureContext ? 'https' : blocked ? 'blocked' : !this.motion ? 'unsupported' : '';
    this.status = this.unavailable || 'idle';
    this.angle = null;
    this.lastSample = null;
    this.onMotion = event => this.sample(event);
  }

  save(changes) {
    this.preferences = gyroPreferences({ ...this.preferences, ...changes });
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch {}
    this.dispatchEvent(new Event('change'));
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new Event('change'));
  }

  async enable() {
    if (this.unavailable || this.status === 'requesting') return;
    if (typeof this.motion.requestPermission === 'function') {
      this.setStatus('requesting');
      let permission;
      try {
        // Safari requires calling this directly from the user's tap.
        permission = await this.motion.requestPermission();
      } catch {}
      if (permission !== 'granted') {
        this.disable('denied');
        return;
      }
    }
    this.save({ enabled: true });
    this.setStatus('checking');
    this.sync();
  }

  disable(status = 'idle') {
    this.save({ enabled: false });
    this.setStatus(status);
    this.stop();
  }

  setTouchSelected(selected) {
    this.touchSelected = selected;
    if (selected && this.preferences.enabled && this.status === 'idle' && !this.unavailable)
      this.setStatus('checking');
    this.sync();
  }

  sync() {
    if (!this.touchSelected || !this.preferences.enabled || this.unavailable || this.win.document.hidden ||
        (this.status !== 'checking' && !this.canAim('always'))) {
      this.stop();
      return;
    }
    if (this.listening) return;
    this.listening = true;
    this.win.addEventListener('devicemotion', this.onMotion);
    this.timer = this.win.setTimeout(() => {
      this.setStatus('no-data');
      this.sync();
    }, SENSOR_TIMEOUT);
  }

  reset() {
    this.lastSample = null;
    this.angle = null;
  }

  stop() {
    if (!this.listening) return;
    this.listening = false;
    this.win.removeEventListener('devicemotion', this.onMotion);
    this.clearProbeTimer();
    this.reset();
  }

  clearProbeTimer() {
    if (this.timer === undefined) return;
    this.win.clearTimeout(this.timer);
    this.timer = undefined;
  }

  sample(event) {
    if (!this.listening || this.win.document.hidden) return;
    // rotationRate uses alpha = X and beta = Y. The similarly named
    // DeviceOrientationEvent angles have a different axis convention.
    const { alpha, beta } = event.rotationRate || {};
    if (!Number.isFinite(alpha) || !Number.isFinite(beta)) {
      this.reset();
      return;
    }
    const aim = this.canAim(this.preferences.mode);
    const angle = this.win.screen.orientation?.angle ?? this.win.orientation ?? 0;
    this.clearProbeTimer();
    if (this.status !== 'ready') {
      this.setStatus('ready');
      this.sync();
    }
    if (!aim) {
      this.reset();
      return;
    }
    const dt = this.lastSample === null || angle !== this.angle ? 0 : (event.timeStamp - this.lastSample) / 1000;
    this.lastSample = event.timeStamp;
    if (angle !== this.angle) {
      this.angle = angle;
      this.sin = Math.sin(angle * DEG_TO_RAD);
      this.cos = Math.cos(angle * DEG_TO_RAD);
    }
    // Drop stale input after a pause or a long gap. Delivery timestamps avoid
    // relying on the sample interval advertised by the browser.
    if (!(dt > 0 && dt <= MAX_INTERVAL)) return;
    const horizontal = filteredRate(alpha * this.sin + beta * this.cos);
    const vertical = filteredRate(alpha * this.cos - beta * this.sin);
    const scale = dt * DEG_TO_RAD * this.preferences.sensitivity;
    if (horizontal || vertical) this.look(horizontal * scale, vertical * scale);
  }
}
