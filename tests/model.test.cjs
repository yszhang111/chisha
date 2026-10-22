const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../miniprogram/utils/model');
const now = new Date(2026, 9, 21, 18);

test('restaurant input splits Chinese separators, deduplicates, and never mutates the original list', () => {
  const existing = ['海底捞'];
  const result = model.mergeRestaurants(existing, ' 海底捞，麦当劳、萨莉亚;寿司郎\n麦当劳 ');
  assert.deepEqual(result.restaurants, ['海底捞', '麦当劳', '萨莉亚', '寿司郎']);
  assert.deepEqual(existing, ['海底捞']);
  assert.ok(model.mergeRestaurants(existing, '海底捞').error);
  assert.ok(model.mergeRestaurants(existing, ' ,， ').error);
  assert.ok(model.mergeRestaurants(existing, '店'.repeat(31)).error);
  assert.equal(model.mergeRestaurants([], '🍜'.repeat(30)).restaurants.length, 1);
  assert.ok(model.mergeRestaurants(Array.from({ length: 24 }, (_, i) => `店${i}`), '新店').error);
});

test('restored storage drops corrupt, expired and invalid entries', () => {
  const result = model.normalizeOptions({ restaurants: [' 店A ', '店A', 123, '', '长'.repeat(31)], dates: ['2026-10-20', '2026-10-22', '2026-10-22', '2027-02-29', '2028-02-29', '2032-01-01', null], mealEnabled: 'true' }, now);
  assert.deepEqual(result, { restaurants: ['店A'], dates: ['2026-10-22', '2028-02-29'], mealEnabled: false });
  assert.deepEqual(model.normalizeOptions(null, now), model.emptyOptions());
  assert.equal(model.validDate('2026-10-21', now), true);
  assert.equal(model.validDate('2026-13-01', now), false);
});

test('calendar is Monday-first with full weeks, valid leap days and month boundaries', () => {
  const oct = model.calendarMonth(2026, 9, ['2026-10-23'], now);
  assert.equal(oct.cells[0].key, '2026-09-28');
  assert.equal(oct.cells.length % 7, 0);
  assert.equal(oct.cells.find(v => v.key === '2026-10-23').selected, true);
  assert.equal(oct.cells.find(v => v.key === '2026-10-20').disabled, true);
  assert.equal(oct.canPrev, false);
  const leap = model.calendarMonth(2028, 1, [], now);
  assert.equal(leap.cells.find(v => v.key === '2028-02-29').disabled, false);
  assert.equal(model.calendarMonth(2031, 11, [], now).canNext, false);
  assert.equal(model.toKey(new Date(2026, 12, 1)), '2027-01-01');
});

test('multi-select dates sort across months, deselect and enforce the 31-date limit', () => {
  assert.deepEqual(model.toggleDate(['2026-11-01'], '2026-10-30', now).dates, ['2026-10-30', '2026-11-01']);
  assert.deepEqual(model.toggleDate(['2026-11-01'], '2026-11-01', now).dates, []);
  assert.ok(model.toggleDate([], '2026-10-20', now).error);
  const all = Array.from({ length: 31 }, (_, i) => model.toKey(new Date(2026, 10, i + 1)));
  assert.ok(model.toggleDate(all, '2026-12-15', now).error);
  assert.equal(model.toggleDate(all, all[0], now).dates.length, 30);
});

test('every calendar month is grouped into complete seven-day rows without missing or duplicate dates', () => {
  for (let month = 0; month < 12; month++) {
    const calendar = model.calendarMonth(2027, month, [], now);
    assert.ok(calendar.weeks.length >= 4 && calendar.weeks.length <= 6);
    assert.ok(calendar.weeks.every(week => week.days.length === 7));
    const days = calendar.weeks.flatMap(week => week.days);
    assert.equal(new Set(days.map(day => day.key)).size, days.length);
    assert.equal(model.fromKey(days[0].key).getDay(), 1);
    assert.equal(model.fromKey(days[days.length - 1].key).getDay(), 0);
    const actual = days.filter(day => model.fromKey(day.key).getMonth() === month);
    assert.equal(actual.length, new Date(2027, month + 1, 0).getDate());
  }
});

test('each optional wheel is present exactly when configured in all eight combinations', () => {
  for (const restaurant of [false, true]) for (const date of [false, true]) for (const meal of [false, true]) {
    const options = { restaurants: restaurant ? ['餐厅'] : [], dates: date ? ['2026-10-22'] : [], mealEnabled: meal };
    const wheels = model.wheelDescriptors(options);
    assert.deepEqual(wheels.map(wheel => wheel.type), [restaurant && 'restaurant', date && 'date', meal && 'meal'].filter(Boolean));
    assert.ok(wheels.every(wheel => wheel.items.length));
    if (meal) assert.deepEqual(wheels.find(wheel => wheel.type === 'meal').items.map(v => v.value), ['午餐', '晚餐']);
  }
});

test('spin motion is independent of options and includes unchanged center and boundary landings', () => {
  const boundary = model.createSpin(0, () => 0);
  assert.equal(boundary.angle, 1440);
  assert.equal(model.selectionAtAngle(boundary.angle, 4), 0);
  const center = model.createSpin(0, () => 1 / 24);
  assert.equal(center.angle, 1485);
  assert.equal(model.selectionAtAngle(center.angle, 4), 3);
  assert.deepEqual(Object.keys(center).sort(), ['angle', 'duration']);
  const longer = model.createSpin(100, () => .999999);
  assert.ok(longer.angle - 100 >= 1440 && longer.angle - 100 < 2520);
  assert.ok(longer.duration >= 2000 && longer.duration <= 4667);
  assert.throws(() => model.createSpin(NaN), /角度/);
  assert.throws(() => model.createSpin(0, () => 1), /随机数/);
});

test('final angle determines the pointer sector for all supported counts and repeated turns', () => {
  for (let count = 1; count <= 31; count++) for (let index = 0; index < count; index++) {
    for (const position of [.001, .1, .5, .9, .999]) for (const turns of [-12, 0, 23]) {
      const angle = turns * 360 - (index + position) * 360 / count;
      assert.equal(model.selectionAtAngle(angle, count), index);
    }
  }
  assert.equal(model.selectionAtAngle(0, 4), 0);
  assert.equal(model.selectionAtAngle(90, 4), 3);
  assert.equal(model.selectionAtAngle(-90, 4), 1);
  assert.throws(() => model.selectionAtAngle(20, 0), /角度或选项/);
  assert.equal(model.describePlan({ restaurant: 'A', date: '2026-10-22', meal: '午餐' }, now).text, '吃啥？就去A！\n10月22日 周四 · 午餐');
});

test('uniform run-out distances cover every sector equally without first selecting an option', () => {
  for (let count = 1; count <= 31; count++) {
    const totals = Array(count).fill(0);
    for (let sample = 0; sample < count * 3; sample++) {
      let call = 0;
      const motion = model.createSpin(0, () => call++ === 0 ? (sample + .5) / (count * 3) : .5);
      totals[model.selectionAtAngle(motion.angle, count)]++;
    }
    assert.deepEqual(totals, Array(count).fill(3));
  }
});
