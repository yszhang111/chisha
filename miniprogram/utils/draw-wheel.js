'use strict';

const THEMES = {
  restaurant: { colors: ['#d9e4bc', '#bdd097', '#eff0c9', '#8fab73', '#e5eacb', '#b3c990'], ink: '#395437', rim: '#dce5ce', mark: '吃' },
  date: { colors: ['#f4d77c', '#fae9b4', '#dfb95f', '#f8e3a1', '#ead18a', '#fcf1cc'], ink: '#896b27', rim: '#f4e4b4', mark: '日' },
  meal: { colors: ['#efc3a3', '#e6a984'], ink: '#855b40', rim: '#f2d7bd', mark: '餐' },
};

function circle(ctx, x, y, radius, fill, stroke, lineWidth) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 1; ctx.stroke(); }
}

function shorten(text, max) {
  const chars = Array.from(String(text));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : String(text);
}

// This renderer only uses Canvas 2D APIs shared with the WeChat canvas node.
function drawWheel(ctx, width, items, type, degrees, decorations) {
  const theme = THEMES[type] || THEMES.restaurant;
  const count = items.length;
  ctx.clearRect(0, 0, width, width);
  if (!count) return;
  ctx.save();
  ctx.scale(width / 280, width / 280);
  const center = 140;
  const radius = 124;
  circle(ctx, center, center + 3, 132, '#dce2d1');
  circle(ctx, center, center, 132, '#fffdf4', '#d5ddc7', 1);
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(degrees * Math.PI / 180);
  for (let i = 0; i < count; i++) {
    const start = -Math.PI / 2 + i * Math.PI * 2 / count;
    const end = start + Math.PI * 2 / count;
    const mid = (start + end) / 2;
    if (count === 1) circle(ctx, 0, 0, radius, theme.colors[0], '#fffdf4', 1.8);
    else {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      const colorIndex = i === count - 1 && i % theme.colors.length === 0 ? 1 : i % theme.colors.length;
      ctx.fillStyle = theme.colors[colorIndex];
      ctx.fill();
      ctx.strokeStyle = '#fffdf4';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.save();
    const textRadius = count === 1 ? 0 : count <= 2 ? 75 : 82;
    if (count === 1) ctx.translate(0, -72);
    else ctx.translate(Math.cos(mid) * textRadius, Math.sin(mid) * textRadius);
    if (count > 2) {
      let turn = mid;
      if (Math.cos(mid) < 0) turn += Math.PI;
      ctx.rotate(turn);
    } else ctx.rotate(-degrees * Math.PI / 180);
    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const font = count <= 2 ? 17 : count > 18 ? 8 : count > 10 ? 10 : 13;
    ctx.font = `600 ${font}px sans-serif`;
    ctx.fillText(shorten(items[i].label, count > 16 ? 5 : count > 9 ? 6 : 8), 0, 0, count > 12 ? 58 : 95);
    ctx.restore();
  }
  ctx.restore();
  // The visible image rotates; its hub and pointer stay fixed in WXML.
  if (decorations === false) { ctx.restore(); return; }
  circle(ctx, center, center, 25, theme.rim);
  circle(ctx, center, center, 20, '#fffdf4');
  ctx.font = '600 18px sans-serif';
  ctx.fillStyle = theme.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(theme.mark, center, center);
  ctx.beginPath();
  ctx.moveTo(center - 11, 5);
  ctx.lineTo(center + 11, 5);
  ctx.lineTo(center + 12, 11);
  ctx.lineTo(center, 33);
  ctx.lineTo(center - 12, 11);
  ctx.closePath();
  ctx.fillStyle = theme.ink;
  ctx.fill();
  ctx.restore();
}

module.exports = { drawWheel, THEMES };
