(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'chisha-options-v1';
  const MAX_RESTAURANTS = 24;
  const MAX_DATES = 31;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let month = new Date(today.getFullYear(), today.getMonth(), 1);
  let restaurants = [];
  let dates = [];
  let mealEnabled = false;
  let spinning = false;
  let resultText = '';
  let toastTimer;
  const angles = { restaurant: 0, date: 0, meal: 0 };
  const palettes = {
    restaurant: ['#d9e4bc', '#bdd097', '#eff0c9', '#8fab73', '#e5eacb', '#b3c990'],
    date: ['#f4d77c', '#fae9b4', '#dfb95f', '#f8e3a1', '#ead18a', '#fcf1cc'],
    meal: ['#efc3a3', '#e6a984'],
  };

  function toKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function fromKey(key) {
    const [year, monthIndex, day] = key.split('-').map(Number);
    return new Date(year, monthIndex - 1, day);
  }

  function validDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const value = fromKey(key);
    return Number.isFinite(value.getTime()) && toKey(value) === key && value >= today && value.getFullYear() <= today.getFullYear() + 5;
  }

  function formatDate(key, full = false) {
    const d = fromKey(key);
    const year = d.getFullYear() !== today.getFullYear() ? `${d.getFullYear()}年` : '';
    return `${year}${d.getMonth() + 1}月${d.getDate()}日${full ? ` ${weekdays[d.getDay()]}` : ''}`;
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;
      if (Array.isArray(saved.restaurants)) restaurants = [...new Set(saved.restaurants.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 30)).filter(Boolean))].slice(0, MAX_RESTAURANTS);
      if (Array.isArray(saved.dates)) dates = [...new Set(saved.dates.filter(validDate))].sort().slice(0, MAX_DATES);
      mealEnabled = saved.mealEnabled === true;
    } catch { /* A fresh session works even when local storage is unavailable. */ }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ restaurants, dates, mealEnabled }));
      $('save-message').textContent = '选项自动保存在当前浏览器';
    } catch {
      $('save-message').textContent = '当前浏览器无法保存，选项仅在本次有效';
    }
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2800);
  }

  function error(message) {
    $('restaurant-error').textContent = message;
    $('restaurant-error').hidden = !message;
    $('restaurant-input').setAttribute('aria-invalid', String(!!message));
  }

  function invalidateResult() {
    $('result').hidden = true;
    resultText = '';
    $('spin-label').textContent = '转一转，开饭！';
    for (const type of ['restaurant', 'date', 'meal']) {
      angles[type] = 0;
      const rotor = $(`${type}-rotor`);
      rotor.style.transition = 'none';
      rotor.style.transform = 'rotate(0deg)';
      $(`${type}-caption`).classList.remove('has-result');
    }
    $('restaurant-caption').textContent = '好味道，转出来';
    $('date-caption').textContent = '选个好日子';
    $('meal-caption').textContent = '日光或月光，都配好饭';
  }

  function makeRemove(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
    button.addEventListener('click', handler);
    return button;
  }

  function renderRestaurants() {
    const tags = $('restaurant-tags');
    tags.replaceChildren();
    restaurants.forEach((name, i) => {
      const tag = document.createElement('span');
      tag.className = 'restaurant-chip';
      const label = document.createElement('span');
      label.textContent = name;
      label.title = name;
      tag.append(label, makeRemove(`删除餐厅 ${name}`, () => {
        restaurants.splice(i, 1);
        error('');
        change();
      }));
      tags.append(tag);
    });
    $('restaurant-count').textContent = `${restaurants.length} / ${MAX_RESTAURANTS}`;
    document.querySelectorAll('[data-suggestion]').forEach(button => {
      button.disabled = restaurants.includes(button.dataset.suggestion);
    });
  }

  function addRestaurants(raw = $('restaurant-input').value) {
    if (spinning) return false;
    const names = raw.split(/[,，、;；\r\n]+/).map(v => v.trim()).filter(Boolean);
    if (!names.length) { error('先写一家你想去的餐厅吧。'); $('restaurant-input').focus(); return false; }
    if (names.some(v => v.length > 30)) { error('餐厅名称请控制在 30 个字以内。'); return false; }
    const additions = [...new Set(names)].filter(v => !restaurants.includes(v));
    if (restaurants.length + additions.length > MAX_RESTAURANTS) { error(`最多添加 ${MAX_RESTAURANTS} 家餐厅，先删掉几家再添加吧。`); return false; }
    if (!additions.length) { error('这家餐厅已经在轮盘里啦。'); return false; }
    restaurants.push(...additions);
    $('restaurant-input').value = '';
    error('');
    change();
    return true;
  }

  function renderCalendar() {
    $('calendar-month').textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
    const firstMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    $('prev-month').disabled = month <= firstMonth;
    $('next-month').disabled = month >= new Date(today.getFullYear() + 5, 11, 1);
    const grid = $('calendar-grid');
    grid.replaceChildren();
    const mondayOffset = (month.getDay() + 6) % 7;
    const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((mondayOffset + dayCount) / 7) * 7;
    for (let i = 0; i < cells; i++) {
      const date = new Date(month.getFullYear(), month.getMonth(), i - mondayOffset + 1);
      const key = toKey(date);
      const selected = dates.includes(key);
      const inMonth = date.getMonth() === month.getMonth();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `calendar-day${selected ? ' is-selected' : ''}${key === toKey(today) ? ' is-today' : ''}${!inMonth ? ' is-other' : ''}`;
      button.textContent = date.getDate();
      button.disabled = !inMonth || date < today || !validDate(key);
      button.setAttribute('aria-label', `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`);
      button.setAttribute('aria-pressed', String(selected));
      if (key === toKey(today)) button.setAttribute('aria-current', 'date');
      button.addEventListener('click', () => {
        if (spinning) return;
        if (!selected && dates.length >= MAX_DATES) { showToast(`最多选 ${MAX_DATES} 个日期，给好运留一点空间。`); return; }
        if (selected) dates = dates.filter(v => v !== key);
        else dates = [...dates, key].sort();
        change();
        const focused = [...grid.children].find(el => el.getAttribute('aria-label') === button.getAttribute('aria-label'));
        focused?.focus({ preventScroll: true });
      });
      grid.append(button);
    }
  }

  function renderDateChips() {
    $('date-summary').textContent = dates.length ? `已选 ${dates.length} 个候选日期` : '选择日期，可多选';
    $('date-trigger').classList.toggle('has-dates', dates.length > 0);
    const chips = $('date-chips');
    chips.replaceChildren();
    dates.slice(0, 3).forEach(key => {
      const chip = makeRemove(`删除日期 ${formatDate(key, true)}`, () => {
        dates = dates.filter(v => v !== key);
        change();
      });
      chip.className = 'date-chip';
      const text = document.createElement('span');
      text.textContent = formatDate(key);
      chip.prepend(text);
      chips.append(chip);
    });
    if (dates.length > 3) {
      const more = document.createElement('span');
      more.className = 'date-overflow';
      more.textContent = `还有 ${dates.length - 3} 天`;
      chips.append(more);
    }
  }

  function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  }

  function drawWheel(type, items) {
    const count = items.length;
    const target = $(`${type}-rotor`);
    if (!count) { target.replaceChildren(); return; }
    const colors = palettes[type];
    const paths = [];
    const texts = [];
    const radius = 116;
    if (count === 1) {
      paths.push(`<circle cx="120" cy="120" r="${radius}" fill="${colors[0]}"/>`);
      // A subtle decorative ring keeps a one-option wheel visually balanced.
      paths.push('<circle cx="120" cy="120" r="99" fill="none" stroke="#fffdf4" stroke-width="1" stroke-dasharray="3 8" opacity=".6"/>');
      const name = items[0].label;
      const label = Array.from(name).length > 10 ? Array.from(name).slice(0, 9).join('') + '…' : name;
      texts.push(`<text x="120" y="62" text-anchor="middle" dominant-baseline="middle" fill="#395437" font-size="13" font-weight="600">${escapeXml(label)}</text>`);
      texts.push('<text x="120" y="183" text-anchor="middle" fill="#6d8559" font-size="8" letter-spacing="3">就是这家啦</text>');
    } else {
      const step = 360 / count;
      for (let i = 0; i < count; i++) {
        const start = (-90 + i * step) * Math.PI / 180;
        const end = (-90 + (i + 1) * step) * Math.PI / 180;
        const midDegrees = -90 + (i + .5) * step;
        const mid = midDegrees * Math.PI / 180;
        const x1 = 120 + radius * Math.cos(start);
        const y1 = 120 + radius * Math.sin(start);
        const x2 = 120 + radius * Math.cos(end);
        const y2 = 120 + radius * Math.sin(end);
        const colorIndex = i === count - 1 && i % colors.length === 0 ? 1 : i % colors.length;
        paths.push(`<path d="M120 120 L${x1} ${y1} A${radius} ${radius} 0 ${step > 180 ? 1 : 0} 1 ${x2} ${y2} Z" fill="${colors[colorIndex]}" stroke="#fffdf4" stroke-width="1.5"/>`);
        const textRadius = count <= 2 ? 69 : count > 12 ? 82 : 76;
        const x = 120 + Math.cos(mid) * textRadius;
        const y = 120 + Math.sin(mid) * textRadius;
        const limit = count > 12 ? 6 : count > 7 ? 7 : 9;
        const letters = Array.from(items[i].label);
        const label = letters.length > limit ? letters.slice(0, limit - 1).join('') + '…' : items[i].label;
        const fontSize = count <= 2 ? 15 : count > 16 ? 7 : count > 10 ? 8 : 10;
        let rotation = count <= 2 ? 0 : midDegrees + 90;
        if (rotation > 90 && rotation < 270) rotation += 180;
        texts.push(`<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})" text-anchor="middle" dominant-baseline="middle" fill="${type === 'restaurant' ? '#395437' : type === 'date' ? '#896b27' : '#855b40'}" font-size="${fontSize}" font-weight="600">${escapeXml(label)}</text>`);
      }
    }
    target.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="${escapeXml(type === 'restaurant' ? '餐厅' : type === 'date' ? '日期' : '午餐晚餐')}轮盘，${count}个选项"><title>${items.map(item => escapeXml(item.label)).join('、')}</title>${paths.join('')}${texts.join('')}<circle cx="120" cy="120" r="116" fill="none" stroke="#fffdf4" stroke-width="2"/></svg>`;
  }

  function choices() {
    return {
      restaurant: restaurants.map(name => ({ value: name, label: name })),
      date: dates.map(key => ({ value: key, label: `${fromKey(key).getMonth() + 1}/${fromKey(key).getDate()}` })),
      meal: mealEnabled ? [{ value: '午餐', label: '午餐' }, { value: '晚餐', label: '晚餐' }] : [],
    };
  }

  function renderWheels() {
    const all = choices();
    let active = 0;
    for (const type of Object.keys(all)) {
      $(`${type}-wheel`).hidden = !all[type].length;
      if (all[type].length) active++;
      drawWheel(type, all[type]);
    }
    $('wheels').hidden = active === 0;
    $('wheels').dataset.count = active;
    $('empty-state').hidden = active > 0;
    $('active-count').lastChild.textContent = active ? ` ${active} 个轮盘就绪` : ' 等你添加';
    $('stage-title').textContent = active ? '这一顿，让好运安排' : '把「随便」变成一顿好饭';
    $('restaurant-options-count').textContent = `${restaurants.length} 个选项`;
    $('date-options-count').textContent = `${dates.length} 个选项`;
    $('spin-button').classList.toggle('is-empty', !restaurants.length);
    $('spin-footnote').textContent = restaurants.length ? `已加入 ${restaurants.length} 家餐厅${dates.length ? ` · ${dates.length} 个日期` : ''}${mealEnabled ? ' · 午餐 / 晚餐' : ''}，好好吃饭就现在` : '先添加至少一家餐厅，就可以开始啦';
  }

  function change() {
    invalidateResult();
    renderRestaurants();
    renderCalendar();
    renderDateChips();
    renderWheels();
    save();
  }

  function randomUnit() {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] / 0x100000000;
  }

  function lock(value) {
    spinning = value;
    document.querySelectorAll('fieldset').forEach(field => { field.disabled = value; });
    $('reset-button').disabled = value;
    $('spin-button').disabled = value;
    $('playground').classList.toggle('is-spinning', value);
    $('options-form').classList.toggle('is-locked', value);
    $('spin-button').setAttribute('aria-busy', String(value));
  }

  function animateWheel(type, reducedMotion) {
    const rotor = $(`${type}-rotor`);
    // Run-out and speed are independent of the items drawn on the wheel.
    const distance = 360 * (4 + 3 * randomUnit());
    const speed = 1080 + 360 * randomUnit();
    const duration = reducedMotion ? 10 : Math.round(2000 * distance / speed);
    angles[type] += distance;
    // This curve follows constant deceleration: progress = 2t - t².
    rotor.style.transition = `transform ${duration}ms cubic-bezier(.333333,.666667,.666667,1)`;
    rotor.style.transform = `rotate(${angles[type]}deg)`;
    return new Promise(resolve => {
      let done = false;
      let timeout;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        rotor.removeEventListener('transitionend', onEnd);
        const matrix = new DOMMatrixReadOnly(getComputedStyle(rotor).transform);
        resolve(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
      };
      const onEnd = event => { if (event.propertyName === 'transform') finish(); };
      rotor.addEventListener('transitionend', onEnd);
      timeout = setTimeout(finish, duration + 150);
    });
  }

  function celebrate() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const container = $('confetti');
    container.replaceChildren();
    const colors = ['#f3c956', '#8fab73', '#e5a27c', '#d3dfb4'];
    for (let i = 0; i < 28; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * .45}s`;
      piece.style.animationDuration = `${1.4 + Math.random() * .7}s`;
      if (i % 3 === 0) piece.style.borderRadius = '50%';
      container.append(piece);
    }
    setTimeout(() => container.replaceChildren(), 2600);
  }

  async function spin() {
    if (spinning) return;
    if ($('restaurant-input').value.trim() && !addRestaurants()) return;
    if (!restaurants.length) {
      error('先添加至少一家餐厅，就能开始转啦。');
      $('restaurant-input').focus();
      $('restaurant-input').classList.remove('shake');
      requestAnimationFrame(() => $('restaurant-input').classList.add('shake'));
      return;
    }
    error('');
    $('calendar-panel').hidden = true;
    $('date-trigger').setAttribute('aria-expanded', 'false');
    $('result').hidden = true;
    $('spin-label').textContent = '好运正在安排…';
    const all = choices();
    const picked = {};
    const animations = [];
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    lock(true);
    for (const type of Object.keys(all)) {
      if (!all[type].length) continue;
      $(`${type}-caption`).textContent = '转呀转，好运来…';
      $(`${type}-caption`).classList.remove('has-result');
      animations.push(animateWheel(type, reducedMotion).then(angle => {
        const pointerAngle = ((-angle % 360) + 360) % 360;
        const index = Math.min(all[type].length - 1, Math.floor(pointerAngle / (360 / all[type].length)));
        picked[type] = all[type][index].value;
      }));
    }
    await Promise.all(animations);
    $('result-title').textContent = picked.restaurant;
    const meta = [picked.date ? formatDate(picked.date, true) : '', picked.meal || ''].filter(Boolean);
    $('result-meta').textContent = meta.length ? meta.join(' · ') : '下一顿，就去吃点喜欢的。';
    $('result').hidden = false;
    resultText = `吃啥？就去${picked.restaurant}！${meta.length ? `\n${meta.join(' · ')}` : ''}`;
    for (const type of Object.keys(picked)) {
      $(`${type}-caption`).textContent = type === 'date' ? formatDate(picked[type]) : picked[type];
      $(`${type}-caption`).classList.add('has-result');
    }
    $('spin-label').textContent = '再转一次，也行！';
    $('spin-footnote').textContent = '答案有了，快乐开饭。想换个选择？再转一次。';
    lock(false);
    celebrate();
    if (innerWidth <= 650) $('result').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest' });
  }

  restore();
  $('random-meal').checked = mealEnabled;
  $('options-form').addEventListener('submit', event => { event.preventDefault(); addRestaurants(); });
  $('restaurant-input').addEventListener('input', () => error(''));
  $('restaurant-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.isComposing) event.preventDefault();
  });
  document.querySelectorAll('[data-suggestion]').forEach(button => button.addEventListener('click', () => addRestaurants(button.dataset.suggestion)));
  $('date-trigger').addEventListener('click', () => {
    const opened = $('calendar-panel').hidden;
    $('calendar-panel').hidden = !opened;
    $('date-trigger').setAttribute('aria-expanded', String(opened));
    if (opened) renderCalendar();
  });
  $('calendar-done').addEventListener('click', () => {
    $('calendar-panel').hidden = true;
    $('date-trigger').setAttribute('aria-expanded', 'false');
    $('date-trigger').focus({ preventScroll: true });
  });
  $('clear-dates').addEventListener('click', () => { dates = []; change(); });
  $('prev-month').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderCalendar(); });
  $('next-month').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderCalendar(); });
  $('random-meal').addEventListener('change', () => { mealEnabled = $('random-meal').checked; change(); });
  $('spin-button').addEventListener('click', spin);
  $('empty-start').addEventListener('click', () => {
    $('restaurant-input').focus();
    $('restaurant-input').classList.remove('is-pulsing');
    requestAnimationFrame(() => $('restaurant-input').classList.add('is-pulsing'));
  });
  $('reset-button').addEventListener('click', () => {
    if (spinning) return;
    restaurants = [];
    dates = [];
    mealEnabled = false;
    $('random-meal').checked = false;
    $('restaurant-input').value = '';
    $('calendar-panel').hidden = true;
    $('date-trigger').setAttribute('aria-expanded', 'false');
    error('');
    change();
    showToast('选项已清空，下一顿重新安排。');
  });
  $('copy-result').addEventListener('click', async () => {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      showToast('已复制，叫上饭搭子一起吃！');
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($('result'));
      selection.removeAllRanges();
      selection.addRange(range);
      showToast('结果已选中，可以长按或 Ctrl+C 复制。');
    }
  });
  $('help-open').addEventListener('click', () => $('help-dialog').showModal());
  for (const id of ['help-close', 'help-done']) $(id).addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const r = $('help-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('help-dialog').close(); } });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('calendar-panel').hidden) {
      $('calendar-panel').hidden = true;
      $('date-trigger').setAttribute('aria-expanded', 'false');
      $('date-trigger').focus({ preventScroll: true });
    }
  });
  renderRestaurants();
  renderCalendar();
  renderDateChips();
  renderWheels();
  save();
})();
