// The same cards work with the native menu's keyboard and gamepad navigation.
const previews = {
  hotel: { title: '大堂与露台' },
  'sublevel-07': { title: '地下通道', new: true },
  shipment: { title: '集装箱近战', new: true },
};

export class MapPicker {
  constructor(root, action) {
    this.root = root;
    this.action = action;
    this.maps = [];
    this.buttons = new Map();
  }

  setMaps(maps, defaultMap) {
    const hadFocus = this.root.contains(document.activeElement);
    this.maps = maps;
    this.value = maps.some(map => map.id === this.value) ? this.value : defaultMap;
    this.buttons.clear();
    this.root.replaceChildren(...maps.map(map => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-card';
      button.setAttribute('role', 'radio');
      button.dataset.nav = '';
      button.dataset.act = this.action + ':' + map.id;
      button.dataset.map = map.id;
      if (Object.hasOwn(previews, map.id)) {
        const picture = document.createElement('img');
        picture.src = new URL('./previews/' + map.id + '.webp', import.meta.url);
        picture.alt = '';
        picture.decoding = 'async';
        button.append(picture);
        if (previews[map.id].new) {
          const badge = document.createElement('span');
          badge.className = 'map-card-new';
          badge.textContent = '新图';
          button.append(badge);
        }
      }
      const copy = document.createElement('span');
      copy.className = 'map-card-copy';
      const name = document.createElement('b');
      name.textContent = map.name;
      copy.append(name);
      if (Object.hasOwn(previews, map.id)) {
        const title = document.createElement('small');
        title.textContent = previews[map.id].title;
        copy.append(title);
      }
      button.append(copy);
      this.buttons.set(map.id, button);
      return button;
    }));
    this.update();
    if (hadFocus) this.focus();
  }

  get selected() { return this.maps.find(map => map.id === this.value); }

  select(id) {
    if (this.disabled || !this.buttons.has(id)) return false;
    this.value = id;
    this.update();
    return true;
  }

  setDisabled(disabled) {
    this.disabled = disabled;
    this.update();
  }

  update() {
    for (const [id, button] of this.buttons) {
      button.disabled = !!this.disabled;
      button.setAttribute('aria-checked', String(id === this.value));
    }
  }

  focus() { this.buttons.get(this.value)?.focus({ preventScroll: true }); }

  // Left/right moves between the available cards while the menu keeps its
  // normal up/down navigation to the actions.
  move(focused, delta) {
    const index = this.maps.findIndex(map => this.buttons.get(map.id) === focused);
    if (index === -1 || this.disabled) return false;
    this.select(this.maps[(index + delta + this.maps.length) % this.maps.length].id);
    this.focus();
    return true;
  }
}
