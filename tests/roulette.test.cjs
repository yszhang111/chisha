const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const model = require('../miniprogram/utils/model');
const componentPath = path.resolve(__dirname, '../miniprogram/components/roulette/index.js');
const flush = () => new Promise(resolve => setImmediate(resolve));

function makeWheel(options = {}) {
  let definition;
  let available = true;
  let exportFailure = false;
  let now = 100000;
  let nextTimer = 1;
  const timers = new Map();
  const calls = { scale: [], exports: [], clears: 0 };
  const context = new Proxy({}, { get(target, key) {
    if (key === 'scale') return (...args) => calls.scale.push(args);
    if (key === 'clearRect') return () => { calls.clears++; };
    if (!(key in target)) target[key] = () => {};
    return target[key];
  } });
  const canvas = { getContext() { return context; } };
  const query = {
    in() { return this; }, select() { return this; }, fields() { return this; },
    exec(callback) { queueMicrotask(() => callback(available ? [{ node: canvas, width: 280, height: 280 }] : [])); },
  };
  const wx = {
    createSelectorQuery: () => query,
    getWindowInfo: () => ({ pixelRatio: 2 }),
    showToast() {},
    canvasToTempFilePath(value, component) {
      calls.exports.push({ value, component });
      if (!options.deferExports) queueMicrotask(() => exportFailure ? value.fail() : value.success({ tempFilePath: '/tmp/wheel.png' }));
    },
  };
  const componentRequire = createRequire(componentPath);
  vm.runInNewContext(fs.readFileSync(componentPath, 'utf8'), {
    Component(value) { definition = value; }, wx,
    require(id) {
      if (id === '../../utils/model') return { ...model, createSpin(current) { return model.createSpin(current, options.random); } };
      return componentRequire(id);
    },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date: class extends Date { static now() { return now; } }, console, Promise,
  }, { filename: componentPath });
  const wheel = Object.assign({}, definition.methods, {
    data: { ...definition.data, items: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }], type: 'restaurant', size: 520 },
    setData(data, done) { Object.assign(this.data, data); if (done) queueMicrotask(done); },
  });
  definition.lifetimes.attached.call(wheel);
  definition.observers['items, type'].call(wheel);
  return {
    wheel, definition, calls, canvas, timers,
    setAvailable(value) { available = value; }, setExportFailure(value) { exportFailure = value; },
    advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
  };
}

const pointerIndex = (angle, count) => Math.floor((((-angle % 360) + 360) % 360) / (360 / count));

test('exports a high resolution image once and reports its stopped angle after backgrounding', async () => {
  const { wheel, definition, canvas, calls, timers } = makeWheel();
  await wheel.prepare();
  assert.equal(canvas.width, 560);
  assert.deepEqual(calls.scale[0], [2, 2]);
  assert.equal(calls.exports[0].value.canvas, canvas);
  assert.equal(calls.exports[0].component, wheel);
  assert.equal(wheel.data.wheelImage, '/tmp/wheel.png');
  const clears = calls.clears;
  const pending = wheel.spin();
  await flush();
  assert.ok(wheel._pending);
  assert.equal(calls.exports.length, 1);
  assert.equal(calls.clears, clears);
  assert.ok(wheel.data.rotationDuration > 0);
  definition.pageLifetimes.hide.call(wheel);
  const index = await pending;
  assert.equal(wheel._pending, null);
  assert.equal(wheel.data.rotationDuration, 0);
  assert.equal(wheel.data.rotationAngle, wheel._angle);
  assert.equal(index, pointerIndex(wheel.data.rotationAngle, 3));
  assert.equal(timers.size, 0);
});

test('updating result captions preserves the stopped angle and cached image', async () => {
  const { wheel, definition, calls } = makeWheel();
  const pending = wheel.spin();
  await flush();
  wheel.finish();
  await pending;
  const landedAngle = wheel._angle;
  wheel.data.items = JSON.parse(JSON.stringify(wheel.data.items));
  definition.observers['items, type'].call(wheel);
  await wheel.prepare();
  assert.equal(wheel._angle, landedAngle);
  assert.equal(wheel.data.rotationAngle, landedAngle);
  assert.equal(calls.exports.length, 1);
  wheel.data.items.push({ value: 'D', label: 'D' });
  definition.observers['items, type'].call(wheel);
  await wheel.prepare();
  assert.equal(wheel._angle, 0);
  assert.equal(calls.exports.length, 2);
});

test('detaching rejects an in-flight spin and prevents further preparation', async () => {
  const { wheel, definition, timers } = makeWheel();
  const pending = wheel.spin();
  const rejected = assert.rejects(pending, /关闭/);
  await flush();
  definition.lifetimes.detached.call(wheel);
  await rejected;
  assert.equal(wheel._pending, null);
  assert.equal(timers.size, 0);
  await assert.rejects(wheel.prepare(), /关闭/);
});

test('failed initialization can retry successfully', async () => {
  const { wheel, setAvailable } = makeWheel();
  setAvailable(false);
  await assert.rejects(wheel.prepare(), /初始化/);
  assert.equal(wheel.data.canvasError, true);
  setAvailable(true);
  await wheel.prepare();
  assert.equal(wheel.data.canvasError, false);
  assert.ok(wheel.data.wheelImage);
});

test('failed image export unlocks preparation so the next attempt can succeed', async () => {
  const { wheel, setExportFailure } = makeWheel();
  setExportFailure(true);
  await assert.rejects(wheel.prepare(), /生成失败/);
  assert.equal(wheel.data.canvasError, true);
  setExportFailure(false);
  await wheel.prepare();
  assert.equal(wheel.data.canvasError, false);
  assert.ok(wheel.data.wheelImage);
});

test('rapid option changes cannot display an outdated exported image', async () => {
  const { wheel, definition, calls } = makeWheel({ deferExports: true });
  const first = wheel.prepare();
  await flush();
  wheel.data.type = 'meal';
  wheel.data.items = [{ value: 'lunch', label: '午餐' }, { value: 'dinner', label: '晚餐' }];
  definition.observers['items, type'].call(wheel);
  const second = wheel.prepare();
  calls.exports[0].value.success({ tempFilePath: '/tmp/stale.png' });
  await flush();
  assert.notEqual(wheel.data.wheelImage, '/tmp/stale.png');
  assert.equal(calls.exports.length, 2);
  calls.exports[1].value.success({ tempFilePath: '/tmp/meal.png' });
  await Promise.all([first, second]);
  assert.equal(wheel.data.wheelImage, '/tmp/meal.png');
  assert.equal(wheel.data.mark, '餐');
});

test('normal completion reads the sector after stopping, and repeat spins keep moving forward', async () => {
  const { wheel, advance } = makeWheel();
  const firstSpin = wheel.spin();
  await flush();
  advance(wheel._pending.duration + 120);
  const firstIndex = await firstSpin;
  const firstAngle = wheel._angle;
  assert.equal(firstIndex, pointerIndex(firstAngle, 3));
  const secondSpin = wheel.spin();
  await flush();
  advance(wheel._pending.duration + 120);
  const secondIndex = await secondSpin;
  assert.ok(wheel._angle >= firstAngle + 1440);
  assert.equal(secondIndex, pointerIndex(wheel._angle, 3));
});

test('the same random motion ignores item count and only its final position determines the result', async () => {
  const a = makeWheel({ random: () => .25 });
  const b = makeWheel({ random: () => .25 });
  b.wheel.data.items = Array.from({ length: 5 }, (_, i) => ({ value: String(i), label: String(i) }));
  const first = a.wheel.spin();
  const second = b.wheel.spin();
  await flush();
  assert.equal(a.wheel.data.rotationAngle, b.wheel.data.rotationAngle);
  assert.equal(a.wheel.data.rotationDuration, b.wheel.data.rotationDuration);
  assert.equal(a.wheel._pending.index, undefined);
  a.wheel.finish(); b.wheel.finish();
  assert.equal(await first, 0);
  assert.equal(await second, 1);
});

test('a stale transition event cannot finish a new spin early', async () => {
  const { wheel, advance } = makeWheel();
  const pending = wheel.spin();
  await flush();
  wheel.onTransitionEnd({ detail: { propertyName: 'transform' } });
  assert.ok(wheel._pending);
  advance(wheel._pending.duration);
  wheel.onTransitionEnd({ detail: { propertyName: 'transform' } });
  const index = await pending;
  assert.equal(index, pointerIndex(wheel.data.rotationAngle, 3));
  assert.equal(wheel._pending, null);
});
