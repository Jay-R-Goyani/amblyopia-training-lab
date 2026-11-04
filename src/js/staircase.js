// Transformed up-down staircase in log10 units.
// "down" correct answers in a row make the task harder; one error makes it easier.
// 3-down-1-up converges near 79% correct; 1-up-1-down converges at 50%.
export class Staircase {
  constructor({ start, min, max, down = 3, up = 1, step = 0.12, stepAfter = 0.05, harderIsLower = true }) {
    this.level = Math.log10(start);
    this.min = Math.log10(min);
    this.max = Math.log10(max);
    this.down = down; this.up = up;
    this.step = step; this.stepAfter = stepAfter;
    this.harderIsLower = harderIsLower;
    this.runC = 0; this.runW = 0;
    this.lastDir = 0;
    this.reversals = [];
    this.history = [];
    this.trials = 0; this.correct = 0;
  }
  get value() { return Math.pow(10, this.level); }
  _move(dir) { // dir: -1 harder, +1 easier
    if (this.lastDir !== 0 && dir !== this.lastDir) this.reversals.push(this.level);
    this.lastDir = dir;
    const s = this.reversals.length >= 2 ? this.stepAfter : this.step;
    const sign = this.harderIsLower ? 1 : -1;
    this.level += dir * s * sign;
    this.level = Math.max(this.min, Math.min(this.max, this.level));
  }
  update(correct) {
    this.trials++; if (correct) this.correct++;
    this.history.push({ level: this.level, correct });
    if (correct) { this.runC++; this.runW = 0; if (this.runC >= this.down) { this.runC = 0; this._move(-1); } }
    else { this.runW++; this.runC = 0; if (this.runW >= this.up) { this.runW = 0; this._move(+1); } }
  }
  threshold() {
    const r = this.reversals.slice(-6);
    if (r.length >= 2) return Math.pow(10, r.reduce((a, b) => a + b, 0) / r.length);
    const h = this.history.slice(-10);
    if (h.length) return Math.pow(10, h.reduce((a, b) => a + b.level, 0) / h.length);
    return this.value;
  }
}
