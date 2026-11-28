// Separate from the menu controller: loading must not unlock the pointer or
// navigate to pause while a deployment is waiting for its first snapshot.
export class MatchLoading {
  constructor({ parent = document.body, cancel, frame = callback => requestAnimationFrame(callback) } = {}) {
    this.frame = frame;
    this.sequence = 0;
    this.root = document.createElement('section');
    this.root.id = 'match-loading';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', '战场加载');
    this.root.innerHTML = `<div class="match-loading-panel">
      <span class="match-loading-eyebrow">随时随地 COD / 战场部署</span>
      <h1>正在进入战场</h1><p class="match-loading-map"></p>
      <div class="match-loading-status" role="status" aria-live="polite"></div>
      <div class="match-loading-track" role="progressbar" aria-label="战场准备进度" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      <div class="match-loading-detail"><span></span><b>0%</b></div>
      <p class="match-loading-tip">首次进入地图需要下载资源，后续可使用浏览器缓存。</p>
      <button class="btn" type="button">取消并退出房间</button>
    </div>`;
    this.map = this.root.querySelector('.match-loading-map');
    this.status = this.root.querySelector('[role="status"]');
    this.track = this.root.querySelector('[role="progressbar"]');
    this.fill = this.track.querySelector('i');
    this.detail = this.root.querySelector('.match-loading-detail span');
    this.percent = this.root.querySelector('.match-loading-detail b');
    this.cancelButton = this.root.querySelector('button');
    this.defaultCancel = this.cancel = cancel;
    this.cancelButton.addEventListener('click', () => this.cancel?.());
    document.addEventListener('keydown', event => {
      if (!this.active || this.finishing || event.code !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancel?.();
    }, true);
    parent.append(this.root);
  }
  get active() { return !this.root.hidden; }
  begin(mapName = '', modeName = '团队死斗', { message = '正在连接战场', cancelLabel = '取消并退出房间', onCancel = this.defaultCancel } = {}) {
    if (!this.active) {
      this.sequence++;
      this.value = 0;
      this.finishing = false;
      this.started = performance.now();
      this.cancel = onCancel;
      this.cancelButton.textContent = cancelLabel;
      this.cancelButton.disabled = false;
      this.root.hidden = false;
    }
    this.map.textContent = [mapName, modeName].filter(Boolean).join(' · ');
    this.update(2, message);
  }
  update(value, message, detail = '') {
    if (!this.active || this.finishing) return;
    // Reliable room updates may repeat while a download is in flight.
    if (value < this.value) return;
    this.value = Math.min(99, value);
    this.status.textContent = message;
    this.detail.textContent = detail;
    this.track.setAttribute('aria-valuenow', String(Math.floor(this.value)));
    this.fill.style.width = `${this.value}%`;
    this.percent.textContent = `${Math.floor(this.value)}%`;
  }
  download(loaded, total) {
    const mb = bytes => (bytes / 1024 / 1024).toFixed(1);
    this.update(15 + Math.min(1, loaded / total) * 55, '正在下载地图', `${mb(loaded)} / ${mb(total)} MB`);
  }
  finish() {
    if (!this.active || this.finishing) return;
    this.update(99, '准备完成，即将进入');
    this.finishing = true;
    this.cancelButton.disabled = true;
    const sequence = this.sequence;
    // Let the deployed first-person scene render underneath before revealing it.
    this.frame(() => this.frame(() => {
      if (sequence !== this.sequence) return;
      this.track.setAttribute('aria-valuenow', '100');
      this.fill.style.width = '100%';
      this.percent.textContent = '100%';
      setTimeout(() => {
        if (sequence === this.sequence) this.hide();
      }, Math.max(100, 350 - (performance.now() - this.started)));
    }));
  }
  hide() {
    this.sequence++;
    this.finishing = false;
    this.cancel = this.defaultCancel;
    this.root.hidden = true;
  }
}
