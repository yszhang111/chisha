const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const model = require('../miniprogram/utils/model');
const pagePath = path.resolve(__dirname, '../miniprogram/pages/index/index.js');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = dataset => ({ currentTarget: { dataset } });

function makePage(saved, failStorage) {
  let definition;
  const calls = { prepares: [], spins: [], toasts: [], scrolls: [], storage: saved, clipboard: '' };
  const components = new Map();
  const wx = {
    getStorageSync() { if (failStorage) throw new Error('storage'); return saved; },
    setStorageSync(_, value) { if (failStorage) throw new Error('storage'); calls.storage = clone(value); },
    showToast(value) { calls.toasts.push(value); },
    showModal(value) { calls.modal = value; },
    setClipboardData(value) { calls.clipboard = value.data; },
  };
  vm.runInNewContext(fs.readFileSync(pagePath, 'utf8'), { Page(value) { definition = value; }, wx, require: createRequire(pagePath), console, Promise }, { filename: pagePath });
  const page = Object.assign({}, definition, { data: clone(definition.data) });
  page.setData = (data, done) => {
    Object.assign(page.data, data);
    if (data.scrollTarget) calls.scrolls.push(data.scrollTarget);
    if (done) queueMicrotask(done);
  };
  page.selectComponent = id => {
    if (!components.has(id)) components.set(id, {
      prepare() { calls.prepares.push(id); return Promise.resolve(); },
      spin(...args) { calls.spins.push({ id, args }); return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); },
      finish(index = 0) { if (this.resolve) { this.resolve(index); this.resolve = null; } },
    });
    return components.get(id);
  };
  page.onLoad();
  return { page, calls, components };
}

test('required restaurant guard, input submission and all optional display states', async () => {
  const { page, calls } = makePage();
  assert.equal(page.data.wheels.length, 0);
  await page.spin();
  assert.match(page.data.error, /餐厅/);
  assert.equal(calls.spins.length, 0);
  assert.equal(page.data.scrollTarget, 'settings');
  page.onInput({ detail: { value: 'A，B' } });
  await page.addRestaurant();
  assert.deepEqual(clone(page.data.restaurants), ['A', 'B']);
  assert.deepEqual(clone(page.data.wheels.map(v => v.type)), ['restaurant']);
  page.onMealChange({ detail: { value: ['random'] } });
  const tomorrow = model.toKey(new Date(Date.now() + 86400000));
  page.selectDate(event({ key: tomorrow }));
  assert.deepEqual(clone(page.data.wheels.map(v => v.type)), ['restaurant', 'date', 'meal']);
  page.onMealChange({ detail: { value: [] } });
  page.clearDates();
  assert.deepEqual(clone(page.data.wheels.map(v => v.type)), ['restaurant']);
  page.removeRestaurant(event({ index: 1 }));
  page.removeRestaurant(event({ index: 0 }));
  assert.equal(page.data.wheels.length, 0);
  assert.equal(calls.storage.restaurants.length, 0);
});

test('all configured wheels start together; rapid taps and edits cannot create another draw', async () => {
  const saved = { restaurants: ['唯一的店'], dates: [model.toKey(new Date(Date.now() + 86400000))], mealEnabled: true };
  const { page, calls, components } = makePage(saved);
  const pending = page.spin();
  const repeated = page.spin();
  await tick();
  assert.equal(page.data.spinning, true);
  assert.deepEqual(calls.spins.map(value => value.id), ['#wheel-restaurant', '#wheel-date', '#wheel-meal']);
  assert.deepEqual(calls.prepares, ['#wheel-restaurant', '#wheel-date', '#wheel-meal']);
  assert.ok(calls.spins.every(call => call.args.length === 0));
  assert.equal(page.data.scrollTarget, 'wheel-stage');
  page.removeRestaurant(event({ index: 0 }));
  page.clearDates();
  page.onMealChange({ detail: { value: [] } });
  assert.equal(page.data.wheels.length, 3);
  components.forEach(component => component.finish());
  await Promise.all([pending, repeated]);
  await tick();
  assert.equal(page.data.scrollTarget, 'result-card');
  assert.equal(page.data.spinning, false);
  assert.equal(page.data.result.restaurant, '唯一的店');
  assert.match(page.data.result.meta, /午餐|晚餐/);
  assert.equal(page.data.wheels.length, 3);
  page.copyResult();
  assert.equal(calls.clipboard, page.data.result.text);
});

test('the spin button adds pending input exactly once before drawing', async () => {
  const { page, calls, components } = makePage();
  page.onInput({ detail: { value: '新餐厅' } });
  const pending = page.spin();
  const repeated = page.spin();
  await tick();
  assert.equal(calls.spins.length, 1);
  assert.equal(page.data.restaurantInput, '');
  components.forEach(component => component.finish());
  await Promise.all([pending, repeated]);
  assert.equal(page.data.result.restaurant, '新餐厅');
});

test('results come from stopped wheels, with no restaurant picked before completion', async () => {
  const { page, components } = makePage({ restaurants: ['A', 'B', 'C'], dates: [], mealEnabled: true });
  const pending = page.spin();
  await tick();
  assert.equal(page.data.result, null);
  assert.ok(page.data.wheels.every(wheel => wheel.picked === ''));
  components.get('#wheel-restaurant').finish(2);
  await tick();
  assert.equal(page.data.result, null);
  components.get('#wheel-meal').finish(1);
  await pending;
  assert.equal(page.data.result.restaurant, 'C');
  assert.equal(page.data.result.meta, '晚餐');
});

test('an invalid stopped sector unlocks the page without fabricating a result', async () => {
  const { page, calls, components } = makePage({ restaurants: ['A'], dates: [], mealEnabled: false });
  const pending = page.spin();
  await tick();
  components.get('#wheel-restaurant').finish(99);
  await pending;
  assert.equal(page.data.spinning, false);
  assert.equal(page.data.result, null);
  assert.match(calls.toasts[0].title, /读取轮盘结果/);
});

test('no wheel starts until every bitmap is ready, and repeated scroll targets still update', async () => {
  const { page, calls, components } = makePage({ restaurants: ['A'], dates: [], mealEnabled: true });
  let ready;
  const slow = page.selectComponent('#wheel-meal');
  slow.prepare = () => new Promise(resolve => { ready = resolve; });
  const pending = page.spin();
  await tick();
  assert.equal(calls.spins.length, 0);
  ready();
  await tick();
  assert.equal(calls.spins.length, 2);
  components.forEach(component => component.finish());
  await pending;
  page._scrollTo('wheel-stage');
  await tick();
  page._scrollTo('wheel-stage');
  assert.equal(page.data.scrollTarget, '');
  await tick();
  assert.equal(page.data.scrollTarget, 'wheel-stage');
});

test('backgrounding completes in-flight animation; unloading suppresses late UI updates', async () => {
  const { page } = makePage({ restaurants: ['A'], dates: [], mealEnabled: true });
  const pending = page.spin();
  await tick();
  page.onHide();
  await pending;
  assert.equal(page.data.hasResult, true);
  const later = page.spin();
  await tick();
  page.onUnload();
  await later;
  assert.equal(page.data.hasResult, false);
});

test('canvas failure unlocks the page and allows a retry', async () => {
  const { page, calls, components } = makePage({ restaurants: ['A'], dates: [], mealEnabled: false });
  const pending = page.spin();
  await tick();
  components.get('#wheel-restaurant').reject(new Error('画布初始化失败'));
  await pending;
  assert.equal(page.data.spinning, false);
  assert.equal(page._startingSpin, false);
  assert.match(calls.toasts[0].title, /画布/);
  const retry = page.spin();
  await tick();
  components.forEach(component => component.finish());
  await retry;
  assert.equal(page.data.hasResult, true);
});

test('saved options restore, storage failure remains usable, and reset only runs after native confirmation', async () => {
  const { page, calls } = makePage({ restaurants: ['A'], dates: [], mealEnabled: true });
  assert.equal(page.data.wheels.length, 2);
  page.resetOptions();
  calls.modal.success({ confirm: false });
  assert.equal(page.data.restaurants.length, 1);
  calls.modal.success({ confirm: true });
  assert.equal(page.data.wheels.length, 0);
  const failed = makePage(null, true).page;
  assert.match(failed.data.saveMessage, /尚未保存/);
  failed.onInput({ detail: { value: '还能吃' } });
  await failed.addRestaurant();
  assert.equal(failed.data.restaurants[0], '还能吃');
});

test('inline calendar toggles, opens to selected month, supports multi-select and ignores disabled cells', () => {
  const future = new Date();
  future.setMonth(future.getMonth() + 2, 15);
  const key = model.toKey(future);
  const { page } = makePage({ restaurants: ['A'], dates: [key], mealEnabled: false });
  page.openCalendar();
  assert.equal(page.data.showCalendar, true);
  assert.equal(page._month.month, future.getMonth());
  assert.ok(page.data.calendar.weeks.every(week => week.days.length === 7));
  const other = model.toKey(new Date(future.getFullYear(), future.getMonth(), 16));
  page.selectDate(event({ key: other, disabled: true }));
  assert.equal(page.data.dates.length, 1);
  page.selectDate(event({ key: other, disabled: false }));
  assert.equal(page.data.dates.length, 2);
  assert.equal(page.data.showCalendar, true);
  page.openCalendar();
  assert.equal(page.data.showCalendar, false);
  assert.equal(page.data.dates.length, 2);
  page.openCalendar();
  page.clearDates();
  assert.equal(page.data.showCalendar, true);
  assert.equal(page.data.dates.length, 0);
  assert.deepEqual(clone(page.data.wheels.map(wheel => wheel.type)), ['restaurant']);
});
