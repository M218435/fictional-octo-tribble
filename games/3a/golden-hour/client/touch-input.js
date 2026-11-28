// Touch owns separate state, so lifting a finger never releases a physical key.
export function stickVector(dx, dy, radius, out = {}) {
  const distance = Math.hypot(dx, dy);
  if (radius <= 0 || distance <= radius * 0.12) {
    out.x = out.y = out.forward = out.right = 0;
    return out;
  }
  const travel = Math.min(distance, radius);
  const amount = (travel / radius - 0.12) / 0.88;
  out.x = (dx / distance) * travel;
  out.y = (dy / distance) * travel;
  out.right = (dx / distance) * amount;
  out.forward = (-dy / distance) * amount;
  return out;
}

export class TouchInput {
  constructor(input) {
    this.input = input;
    this.revision = 0;
  }
  press(code) {
    const input = this.input;
    if (!input.touchKeys.has(code)) {
      input.touchKeys.add(code);
      input.touchDown.add(code);
      input.aim?.press(code);
      this.revision++;
    }
  }
  release(code) {
    if (this.input.touchKeys.delete(code)) {
      this.input.touchUp.add(code);
      this.revision++;
    }
  }
  pulse(code) {
    this.input.touchDown.add(code);
    this.input.touchUp.add(code);
    this.input.aim?.press(code);
  }
  toggle(code) {
    const held = !this.input.touchKeys.has(code);
    if (held) this.press(code);
    else this.release(code);
    return held;
  }
  move(forward, right) {
    this.input.touchForward = forward;
    this.input.touchRight = right;
  }
  look(dx, dy) {
    this.input.touchMx += dx;
    this.input.touchMy += dy;
  }
  reset() {
    const input = this.input;
    input.aim?.reset();
    this.revision++;
    input.touchKeys.clear();
    input.touchDown.clear();
    input.touchUp.clear();
    input.touchForward = input.touchRight = input.touchMx = input.touchMy = 0;
  }
}
