'use strict';

const MAX_RESTAURANTS = 24;
const MAX_DATES = 31;
const STORAGE_KEY = 'chisha-miniprogram-v1';
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function startOfDay(value) {
  const date = value ? new Date(value.getTime()) : new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function toKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromKey(key) {
  const parts = key.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function validDate(key, now) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = fromKey(key);
  const today = startOfDay(now);
  return Number.isFinite(date.getTime()) && toKey(date) === key && date >= today && date.getFullYear() <= today.getFullYear() + 5;
}

function formatDate(key, full, now) {
  const date = fromKey(key);
  const today = startOfDay(now);
  const year = date.getFullYear() === today.getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日${full ? ` ${WEEKDAYS[date.getDay()]}` : ''}`;
}

function emptyOptions() { return { restaurants: [], dates: [], mealEnabled: false }; }

function normalizeOptions(value, now) {
  const source = value && typeof value === 'object' ? value : {};
  const names = Array.isArray(source.restaurants) ? source.restaurants : [];
  const dates = Array.isArray(source.dates) ? source.dates : [];
  return {
    restaurants: Array.from(new Set(names.filter(v => typeof v === 'string').map(v => v.trim()).filter(v => v && Array.from(v).length <= 30))).slice(0, MAX_RESTAURANTS),
    dates: Array.from(new Set(dates.filter(v => validDate(v, now)))).sort().slice(0, MAX_DATES),
    mealEnabled: source.mealEnabled === true,
  };
}

function mergeRestaurants(existing, raw) {
  const names = String(raw || '').split(/[,，、;；\r\n]+/).map(v => v.trim()).filter(Boolean);
  if (!names.length) return { error: '先写一家你想去的餐厅吧。' };
  if (names.some(v => Array.from(v).length > 30)) return { error: '餐厅名称最多 30 个字。' };
  const additions = Array.from(new Set(names)).filter(v => existing.indexOf(v) < 0);
  if (!additions.length) return { error: '这家餐厅已经在轮盘里啦。' };
  if (existing.length + additions.length > MAX_RESTAURANTS) return { error: `最多添加 ${MAX_RESTAURANTS} 家餐厅。` };
  return { restaurants: existing.concat(additions), added: additions.length };
}

function calendarMonth(year, month, selected, now) {
  const today = startOfDay(now);
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  const cells = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(year, month, i - offset + 1);
    const key = toKey(date);
    const inMonth = date.getFullYear() === year && date.getMonth() === month;
    const isSelected = selected.indexOf(key) >= 0;
    const isToday = key === toKey(today);
    const disabled = !inMonth || !validDate(key, today);
    cells.push({ key, day: date.getDate(), disabled, selected: isSelected, today: isToday, label: `${formatDate(key, true, today)}${isSelected ? '，已选' : ''}`, className: `${!inMonth ? 'other ' : ''}${disabled ? 'disabled ' : ''}${isSelected ? 'selected ' : ''}${isToday ? 'today' : ''}`.trim() });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push({ key: cells[i].key, days: cells.slice(i, i + 7) });
  return {
    title: `${year} 年 ${month + 1} 月`, cells, weeks,
    canPrev: first > new Date(today.getFullYear(), today.getMonth(), 1),
    canNext: first < new Date(today.getFullYear() + 5, 11, 1),
  };
}

function toggleDate(selected, key, now) {
  if (!validDate(key, now)) return { error: '请选择今天或之后的有效日期。' };
  if (selected.indexOf(key) >= 0) return { dates: selected.filter(v => v !== key) };
  if (selected.length >= MAX_DATES) return { error: `最多选择 ${MAX_DATES} 个日期。` };
  return { dates: selected.concat(key).sort() };
}

function wheelDescriptors(options) {
  const result = [];
  if (options.restaurants.length) result.push({ type: 'restaurant', title: '吃什么', caption: '好味道，转出来', items: options.restaurants.map(name => ({ value: name, label: name })) });
  if (options.dates.length) result.push({ type: 'date', title: '哪天吃', caption: '选个好日子', items: options.dates.map(key => ({ value: key, label: `${fromKey(key).getMonth() + 1}/${fromKey(key).getDate()}` })) });
  if (options.mealEnabled) result.push({ type: 'meal', title: '哪顿吃', caption: '午餐和晚餐，选一个', items: [{ value: '午餐', label: '午餐' }, { value: '晚餐', label: '晚餐' }] });
  return result;
}

function randomUnit(random) {
  const value = (random || Math.random)();
  if (!(value >= 0 && value < 1)) throw new Error('随机数必须在 [0, 1) 内。');
  return value;
}

function createSpin(current, random) {
  if (!Number.isFinite(current)) throw new Error('无效的轮盘角度。');
  // Randomize run-out distance and initial speed without looking at any options.
  // Three complete turns of possible distances give every final angle equal odds.
  const distance = 360 * (4 + 3 * randomUnit(random));
  const speed = 1080 + 360 * randomUnit(random);
  return { angle: current + distance, duration: Math.round(2000 * distance / speed) };
}

function selectionAtAngle(angle, count) {
  if (!Number.isFinite(angle) || !Number.isInteger(count) || count < 1) throw new Error('无效的轮盘角度或选项数量。');
  const pointerAngle = ((-angle % 360) + 360) % 360;
  return Math.min(count - 1, Math.floor(pointerAngle / (360 / count)));
}

function describePlan(selected, now) {
  const meta = [];
  if (selected.date) meta.push(formatDate(selected.date, true, now));
  if (selected.meal) meta.push(selected.meal);
  return { restaurant: selected.restaurant, meta: meta.join(' · '), text: `吃啥？就去${selected.restaurant}！${meta.length ? `\n${meta.join(' · ')}` : ''}` };
}

module.exports = { MAX_RESTAURANTS, MAX_DATES, STORAGE_KEY, startOfDay, toKey, fromKey, validDate, formatDate, emptyOptions, normalizeOptions, mergeRestaurants, calendarMonth, toggleDate, wheelDescriptors, createSpin, selectionAtAngle, describePlan };
