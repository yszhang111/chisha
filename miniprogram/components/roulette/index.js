'use strict';

const { createSpin, selectionAtAngle } = require('../../utils/model');
const { drawWheel, THEMES } = require('../../utils/draw-wheel');

Component({
  properties: {
    items: { type: Array, value: [] },
    type: { type: String, value: 'restaurant' },
    title: { type: String, value: '' },
    size: { type: Number, value: 520 },
  },
  data: { canvasError: false, wheelImage: '', rotationAngle: 0, rotationDuration: 0, ink: '#395437', rim: '#dce5ce', mark: '吃' },
  observers: {
    'items, type': function () {
      const signature = JSON.stringify([this.data.type, this.data.items]);
      if (signature === this._signature) return;
      this._signature = signature;
      if (this._pending) return;
      this._angle = 0;
      const theme = THEMES[this.data.type] || THEMES.restaurant;
      this.setData({ ink: theme.ink, rim: theme.rim, mark: theme.mark });
      if (this._ready) this.prepare().catch(() => {});
    },
  },
  lifetimes: {
    attached() { this._alive = true; this._angle = 0; },
    ready() { this._ready = true; this.prepare().catch(() => {}); },
    detached() {
      this._alive = false;
      clearTimeout(this._timer);
      if (this._pending) { this._pending.reject(new Error('轮盘已关闭。')); this._pending = null; }
      this._canvas = null;
      this._ctx = null;
    },
  },
  pageLifetimes: {
    show() { this._pageHidden = false; },
    hide() { this._pageHidden = true; this.finish(); },
  },
  methods: {
    ensureCanvas() {
      if (!this._alive) return Promise.reject(new Error('轮盘已关闭。'));
      if (this._canvas && this._ctx) return Promise.resolve();
      if (this._initializing) return this._initializing;
      const job = new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select('#wheel-canvas').fields({ node: true, size: true }).exec(result => {
          try {
            const found = result && result[0];
            if (!this._alive) throw new Error('轮盘已关闭。');
            if (!found || !found.node || !found.width) throw new Error('无法初始化轮盘，请更新微信后重试。');
            const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
            this._canvas = found.node;
            this._width = found.width;
            const ratio = info.pixelRatio || 1;
            this._canvas.width = Math.round(found.width * ratio);
            this._canvas.height = Math.round(found.height * ratio);
            this._ctx = this._canvas.getContext('2d');
            this._ctx.scale(ratio, ratio);
            resolve();
          } catch (error) {
            this._canvas = null;
            this._ctx = null;
            if (this._alive) this.setData({ canvasError: true });
            reject(error);
          }
        });
      });
      this._initializing = job.finally(() => { this._initializing = null; });
      return this._initializing;
    },

    async prepare() {
      await this.ensureCanvas();
      const signature = JSON.stringify([this.data.type, this.data.items]);
      if (signature === this._preparedSignature) return;
      // Serialize exports so quick option changes cannot publish a stale bitmap.
      if (this._rendering) { await this._rendering; return this.prepare(); }
      const job = new Promise((resolve, reject) => {
        try {
          drawWheel(this._ctx, this._width, this.data.items, this.data.type, 0, false);
          wx.canvasToTempFilePath({
            canvas: this._canvas,
            destWidth: this._canvas.width, destHeight: this._canvas.height, fileType: 'png',
            success: result => {
              try {
                if (!this._alive) throw new Error('轮盘已关闭。');
                if (signature !== JSON.stringify([this.data.type, this.data.items])) { resolve(); return; }
                if (!result.tempFilePath) throw new Error('轮盘图案生成失败，请重试。');
                this.setData({ wheelImage: result.tempFilePath, canvasError: false, rotationAngle: this._angle || 0, rotationDuration: 0 }, () => {
                  this._preparedSignature = signature;
                  resolve();
                });
              } catch (error) { reject(error); }
            },
            fail: () => reject(new Error('轮盘图案生成失败，请重试。')),
          }, this);
        } catch (error) { reject(error); }
      });
      this._rendering = job;
      try { await job; }
      catch (error) {
        if (this._alive) this.setData({ canvasError: true });
        throw error;
      } finally { this._rendering = null; }
      if (signature !== JSON.stringify([this.data.type, this.data.items])) return this.prepare();
    },

    retryCanvas() { this.prepare().catch(() => wx.showToast({ title: '轮盘加载失败，请再试一次', icon: 'none' })); },
    async spin() {
      await this.prepare();
      if (!this._alive) throw new Error('轮盘已关闭。');
      if (this._pending) throw new Error('轮盘正在转动。');
      const count = this.data.items.length;
      if (!count) throw new Error('轮盘不能为空。');
      const motion = createSpin(this._angle || 0);
      if (this._pageHidden) {
        this._angle = motion.angle;
        this.setData({ rotationAngle: motion.angle, rotationDuration: 0 });
        return selectionAtAngle(this._angle, count);
      }
      return new Promise((resolve, reject) => {
        const pending = { angle: motion.angle, count, duration: motion.duration, resolve, reject, startedAt: Date.now() };
        this._pending = pending;
        this.setData({ rotationAngle: motion.angle, rotationDuration: motion.duration }, () => {
          if (this._pending !== pending) return;
          pending.startedAt = Date.now();
          this._timer = setTimeout(() => this.finish(), motion.duration + 120);
        });
      });
    },
    onTransitionEnd(event) {
      if (event.detail && event.detail.propertyName && event.detail.propertyName !== 'transform') return;
      const pending = this._pending;
      if (pending && Date.now() >= pending.startedAt + pending.duration - 50) this.finish();
    },
    finish() {
      if (!this._pending) return;
      clearTimeout(this._timer);
      const pending = this._pending;
      this._pending = null;
      this._angle = pending.angle;
      if (this._alive) this.setData({ rotationAngle: this._angle, rotationDuration: 0 });
      // Read the sector only after the wheel stops; no option is chosen up front.
      pending.resolve(selectionAtAngle(this._angle, pending.count));
    },
  },
});
