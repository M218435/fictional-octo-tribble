// Layout is independent of the chosen combat controls and rendering budget.
// A small desktop window needs the same reflow as an embedded mobile viewport.
export function menuLayout({
  width = 1280, height = 720, coarse = false, mobile = false,
  userAgent = "", platform = "", maxTouchPoints = 0,
} = {}) {
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)
    || (platform === "MacIntel" && maxTouchPoints > 1);
  const phone = !tablet && (mobile || /iPhone|iPod|Android.*Mobile/i.test(userAgent));
  const handheld = tablet || phone || coarse;
  const compact = handheld || width < 1100 || height < 700;
  return {
    device: tablet ? "tablet" : phone ? "phone" : handheld ? "touch" : "desktop",
    layout: !compact ? "desktop" : width >= 700 || (width >= 560 && width > height) ? "wide" : "portrait",
    density: height <= 520 ? "short" : height <= 620 ? "tight" : "standard",
    compact,
  };
}

export function installMenuLayout(win = window, doc = document) {
  const pointer = win.matchMedia("(pointer: coarse)");
  const viewport = win.visualViewport;
  let pending = 0;
  const update = () => {
    pending = 0;
    // Browser bars and the Toy iframe change the usable viewport. Pinch zoom
    // must keep its normal behavior rather than trigger a fresh layout.
    if (viewport?.scale > 1.01) return;
    const width = Math.round(Math.min(win.innerWidth, viewport?.width || win.innerWidth));
    const height = Math.round(Math.min(win.innerHeight, viewport?.height || win.innerHeight));
    const safeStyle = win.getComputedStyle?.(doc.documentElement);
    const safe = side => parseFloat(safeStyle?.getPropertyValue("--menu-safe-" + side)) || 0;
    const result = menuLayout({ width: width - safe("left") - safe("right"), height: height - safe("top") - safe("bottom"), coarse: pointer.matches,
      mobile: win.navigator.userAgentData?.mobile, userAgent: win.navigator.userAgent,
      platform: win.navigator.platform, maxTouchPoints: win.navigator.maxTouchPoints });
    const body = doc.body;
    body.classList.toggle("compact-menu", result.compact);
    body.dataset.menuLayout = result.layout;
    body.dataset.menuDensity = result.density;
    body.dataset.menuDevice = result.device;
    body.style.setProperty("--menu-width", width + "px");
    body.style.setProperty("--menu-height", height + "px");
  };
  const schedule = () => { if (!pending) pending = win.requestAnimationFrame(update); };
  const events = new AbortController();
  for (const type of ["resize", "orientationchange", "pageshow"])
    win.addEventListener(type, schedule, { signal: events.signal });
  viewport?.addEventListener("resize", schedule, { signal: events.signal });
  pointer.addEventListener("change", schedule, { signal: events.signal });
  update();
  return () => { events.abort(); if (pending) win.cancelAnimationFrame(pending); };
}

// Keep the native pages, data and actions. Only their presentation changes.
export function installMenuPages(menus, doc = document) {
  const gunsmith = menus.pages.gunsmith;
  const actions = gunsmith?.querySelector('.gs-actions');
  if (actions) gunsmith.insertBefore(actions, gunsmith.querySelector('.legend'));
  const editor = menus.pages['touch-layout'];
  const editorActions = editor?.querySelector('.touch-layout-actions');
  if (editorActions) editor.append(editorActions);

  const buildEnd = menus.buildEnd;
  menus.buildEnd = function(...args) {
    const result = buildEnd.apply(this, args);
    const page = this.pages.end, columns = [...page.querySelectorAll('.e-cols > .e-col')];
    const tabs = doc.createElement('nav');
    tabs.className = 'report-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '对局结算详情');
    const labels = ['成长进度', '本局表现', '全场战绩'];
    const available = columns.map((panel, index) => ({ panel, index }))
      .filter(({ index }) => index !== 0 || !doc.body.classList.contains('coop-session'));
    for (const { panel } of available) {
      panel.setAttribute('role', 'tabpanel');
      panel.tabIndex = 0;
    }
    const select = index => {
      for (const { panel, index: other } of available) {
        panel.toggleAttribute('data-report-active', other === index);
        const button = tabs.querySelector(`[data-report="${other}"]`);
        button.setAttribute('aria-selected', String(other === index));
        button.tabIndex = other === index ? 0 : -1;
      }
    };
    for (const { panel, index } of available) {
      panel.id = `report-panel-${index}`;
      panel.setAttribute('aria-labelledby', `report-tab-${index}`);
      const button = doc.createElement('button');
      button.type = 'button'; button.id = `report-tab-${index}`;
      button.dataset.report = String(index); button.dataset.nav = '';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      button.textContent = labels[index];
      button.addEventListener('click', () => select(index));
      tabs.append(button);
    }
    select(1);
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...tabs.children], current = buttons.indexOf(doc.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click(); buttons[next].focus({ preventScroll: true });
    });
    page.insertBefore(tabs, page.querySelector('.e-cols'));
    return result;
  };
  const go = menus.go;
  menus.go = function(name, ...args) {
    const previous = this.page, result = go.call(this, name, ...args);
    if (previous !== name) this.pages[name]?.scrollTo(0, 0);
    return result;
  };
}
