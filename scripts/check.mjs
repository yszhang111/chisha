import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const miniRoot = path.join(root, 'miniprogram');
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}
const files = await walk(miniRoot);
for (const file of [path.join(root, 'dist/app.js'), ...files.filter(file => file.endsWith('.js'))]) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
}
for (const file of files.filter(file => file.endsWith('.json'))) JSON.parse(await readFile(file, 'utf8'));
const app = JSON.parse(await readFile(path.join(miniRoot, 'app.json'), 'utf8'));
for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) await stat(path.join(miniRoot, `${page}.${extension}`));
}
const pageConfig = JSON.parse(await readFile(path.join(miniRoot, 'pages/index/index.json'), 'utf8'));
for (const component of Object.values(pageConfig.usingComponents)) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) await stat(path.join(miniRoot, `${component}.${extension}`));
}
for (const file of files.filter(file => file.endsWith('.wxml'))) {
  const source = await readFile(file, 'utf8');
  // Check nesting after masking binding expressions (which may contain >).
  const markup = source.replace(/\{\{[\s\S]*?\}\}/g, 'BINDING');
  const stack = [];
  for (const token of markup.matchAll(/<\/?([\w-]+)\b[^>]*>/g)) {
    if (token[0].startsWith('</')) assert.equal(stack.pop(), token[1], `Unbalanced WXML: ${file}`);
    else if (!token[0].endsWith('/>')) stack.push(token[1]);
  }
  assert.equal(stack.length, 0, `Unclosed WXML tags: ${file}`);
  for (const image of source.matchAll(/src="(\/[^"]+)"/g)) await stat(path.join(miniRoot, image[1]));
  const controller = await readFile(file.replace(/\.wxml$/, '.js'), 'utf8');
  for (const event of source.matchAll(/(?:bind|catch)(?:tap|change|input|confirm|touchmove)="([\w]+)"/g)) {
    assert.match(controller, new RegExp(`\\b${event[1]}\\s*\\(`), `Missing WXML handler ${event[1]}`);
  }
}
const bytes = (await Promise.all(files.map(file => stat(file)))).reduce((sum, info) => sum + info.size, 0);
assert.ok(bytes < 2 * 1024 * 1024, 'Keep this small app package under 2 MiB.');
console.log(`Syntax, JSON, page/component paths, WXML nesting and events passed. Package: ${(bytes / 1024 / 1024).toFixed(2)} MiB.`);
console.log('These static checks do not replace compilation and device testing in WeChat DevTools.');
