'use strict';

const model = require('../../utils/model');
const SUGGESTIONS = ['海底捞', '麦当劳', '萨莉亚'];

Page({
  data: {
    restaurants: [], dates: [], dateChips: [], extraDates: 0, mealEnabled: false,
    restaurantInput: '', inputFocus: false, error: '', wheels: [], spinning: false,
    result: null, hasResult: false, showCalendar: false, showHelp: false, scrollTarget: '',
    calendar: { cells: [], weeks: [], title: '', canPrev: false, canNext: true },
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    suggestions: [], saveMessage: '选项自动保存在微信本地',
  },

  onLoad() {
    this._disposed = false;
    this._spinToken = 0;
    const today = new Date();
    this._month = { year: today.getFullYear(), month: today.getMonth() };
    let saved;
    try { saved = wx.getStorageSync(model.STORAGE_KEY); } catch (_) { /* Storage failure never blocks play. */ }
    this._applyOptions(model.normalizeOptions(saved));
  },

  onShow() {
    if (!this._options || this.data.spinning) return;
    const fresh = model.normalizeOptions(this._options);
    if (JSON.stringify(fresh) !== JSON.stringify(this._options)) this._applyOptions(fresh);
  },

  onHide() { this._finishWheels(); },

  onUnload() {
    this._disposed = true;
    this._spinToken++;
    this._finishWheels();
  },

  _calendar(dates) { return model.calendarMonth(this._month.year, this._month.month, dates); },

  _applyOptions(options, extra) {
    this._options = options;
    const dateChips = options.dates.slice(0, 4).map(key => ({ key, label: model.formatDate(key) }));
    const wheels = model.wheelDescriptors(options).map(wheel => Object.assign({}, wheel, {
      size: wheel.type === 'restaurant' || !options.restaurants.length && !options.mealEnabled ? 520 : 288,
      picked: '',
    }));
    let saveMessage = '选项自动保存在微信本地';
    try { wx.setStorageSync(model.STORAGE_KEY, options); } catch (_) { saveMessage = '本次选项尚未保存，请检查微信存储空间'; }
    const data = Object.assign({
      restaurants: options.restaurants, dates: options.dates, mealEnabled: options.mealEnabled,
      dateChips, extraDates: Math.max(0, options.dates.length - 4),
      wheels, calendar: this._calendar(options.dates), result: null, hasResult: false,
      suggestions: SUGGESTIONS.map(name => ({ name, added: options.restaurants.indexOf(name) >= 0 })),
      saveMessage,
    }, extra || {});
    return new Promise(resolve => this.setData(data, resolve));
  },

  onInput(event) { this.setData({ restaurantInput: event.detail.value, error: '' }); },

  async addRestaurant(event) {
    if (this.data.spinning) return false;
    const suggestion = event && event.currentTarget && event.currentTarget.dataset.name;
    const merged = model.mergeRestaurants(this._options.restaurants, suggestion || this.data.restaurantInput);
    if (merged.error) { this.setData({ error: merged.error, inputFocus: true }); return false; }
    await this._applyOptions(Object.assign({}, this._options, { restaurants: merged.restaurants }), { restaurantInput: suggestion ? this.data.restaurantInput : '', error: '', inputFocus: false });
    return true;
  },

  removeRestaurant(event) {
    if (this.data.spinning) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this._options.restaurants.length) return;
    this._applyOptions(Object.assign({}, this._options, { restaurants: this._options.restaurants.filter((_, i) => i !== index) }), { error: '' });
  },

  openCalendar() {
    if (this.data.spinning) return;
    if (this.data.showCalendar) { this.closeCalendar(); return; }
    const firstDate = this._options.dates.find(key => model.validDate(key));
    const initial = firstDate ? model.fromKey(firstDate) : new Date();
    this._month = { year: initial.getFullYear(), month: initial.getMonth() };
    this.setData({ showCalendar: true, calendar: this._calendar(this._options.dates), inputFocus: false });
  },
  closeCalendar() { this.setData({ showCalendar: false }); },
  stopEvent() {},
  changeMonth(event) {
    const direction = Number(event.currentTarget.dataset.direction);
    if (direction !== -1 && direction !== 1) return;
    if (direction === -1 && !this.data.calendar.canPrev || direction === 1 && !this.data.calendar.canNext) return;
    const value = new Date(this._month.year, this._month.month + direction, 1);
    this._month = { year: value.getFullYear(), month: value.getMonth() };
    this.setData({ calendar: this._calendar(this._options.dates) });
  },
  selectDate(event) {
    if (this.data.spinning) return;
    const disabled = event.currentTarget.dataset.disabled;
    if (disabled === true || disabled === 'true') return;
    const changed = model.toggleDate(this._options.dates, event.currentTarget.dataset.key);
    if (changed.error) { wx.showToast({ title: changed.error, icon: 'none' }); return; }
    this._applyOptions(Object.assign({}, this._options, { dates: changed.dates }));
  },
  removeDate(event) {
    if (this.data.spinning) return;
    const key = event.currentTarget.dataset.key;
    this._applyOptions(Object.assign({}, this._options, { dates: this._options.dates.filter(value => value !== key) }));
  },
  clearDates() {
    if (!this.data.spinning) this._applyOptions(Object.assign({}, this._options, { dates: [] }));
  },
  onMealChange(event) {
    if (!this.data.spinning) this._applyOptions(Object.assign({}, this._options, { mealEnabled: event.detail.value.indexOf('random') >= 0 }));
  },

  resetOptions() {
    if (this.data.spinning) return;
    wx.showModal({
      title: '重新安排下一顿？', content: '会清空餐厅、日期和午晚餐选项。', confirmText: '清空选项', confirmColor: '#284b38',
      success: response => {
        if (response.confirm && !this._disposed && !this.data.spinning) this._applyOptions(model.emptyOptions(), { restaurantInput: '', error: '', showCalendar: false });
      },
    });
  },

  _scrollTo(id) {
    this.setData({ scrollTarget: '' }, () => {
      if (!this._disposed) this.setData({ scrollTarget: id });
    });
  },

  focusRestaurant() {
    this._scrollTo('settings');
    this.setData({ inputFocus: false }, () => this.setData({ inputFocus: true }));
  },

  _finishWheels() {
    (this.data.wheels || []).forEach(wheel => {
      const component = this.selectComponent(`#wheel-${wheel.type}`);
      if (component) component.finish();
    });
  },

  async spin() {
    if (this.data.spinning || this._startingSpin) return;
    this._startingSpin = true;
    try { await this._spinOnce(); }
    finally { this._startingSpin = false; }
  },

  async _spinOnce() {
    if (this.data.restaurantInput.trim() && !await this.addRestaurant()) return;
    if (this._disposed) return;
    const fresh = model.normalizeOptions(this._options);
    if (JSON.stringify(fresh) !== JSON.stringify(this._options)) await this._applyOptions(fresh);
    if (!this._options.restaurants.length) {
      this.setData({ error: '先添加至少一家餐厅，就能开始转啦。', inputFocus: true });
      this._scrollTo('settings');
      return;
    }
    const token = ++this._spinToken;
    await new Promise(resolve => this.setData({ spinning: true, result: null, hasResult: false, showCalendar: false, inputFocus: false, error: '' }, resolve));
    this._scrollTo('wheel-stage');
    try {
      const components = this.data.wheels.map(wheel => {
        const component = this.selectComponent(`#wheel-${wheel.type}`);
        if (!component) throw new Error('轮盘尚未就绪，请再试一次。');
        return component;
      });
      await Promise.all(components.map(component => component.prepare()));
      if (this._disposed || token !== this._spinToken) return;
      const stopped = await Promise.all(components.map(component => component.spin()));
      if (this._disposed || token !== this._spinToken) return;
      const selected = {};
      this.data.wheels.forEach((wheel, i) => {
        const index = stopped[i];
        if (!Number.isInteger(index) || !wheel.items[index]) throw new Error('无法读取轮盘结果，请重试。');
        selected[wheel.type] = wheel.items[index].value;
      });
      const result = model.describePlan(selected);
      const wheels = this.data.wheels.map(wheel => Object.assign({}, wheel, { picked: wheel.type === 'date' ? model.formatDate(selected.date) : selected[wheel.type] }));
      this.setData({ spinning: false, result, hasResult: true, wheels }, () => {
        this._scrollTo('result-card');
      });
    } catch (error) {
      this._finishWheels();
      if (this._disposed || token !== this._spinToken) return;
      this.setData({ spinning: false });
      wx.showToast({ title: error.message || '轮盘没转起来，请重试', icon: 'none' });
    }
  },

  copyResult() {
    if (!this.data.result) return;
    wx.setClipboardData({ data: this.data.result.text, fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) });
  },
  openHelp() { this.setData({ showHelp: true, inputFocus: false }); },
  closeHelp() { this.setData({ showHelp: false }); },
  onShareAppMessage() {
    return { title: this.data.result ? `${this.data.result.restaurant}，就这么愉快地决定了！你也来转转？` : '今天吃啥？转一下就知道。', path: '/pages/index/index', imageUrl: '/assets/avatar.png' };
  },
});
