// Usage: node shot.mjs <piece-id> [--t 1,3,6,9] [--w 360] [--q 1] [--dpr 1] [--p x,y] [--bench] [--out name]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args[0];
const opt = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : fallback;
};
const times = opt('t', '1,3,6,9');
const width = opt('w', '360');
const params = new URLSearchParams({ piece: id, t: times, w: width, q: opt('q', '1'), dpr: opt('dpr', '1') });
if (opt('p')) params.set('p', opt('p'));
if (args.includes('--bench')) params.set('bench', '1');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('file://' + resolve(here, 'test.html') + '?' + params.toString());
await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
const out = resolve(here, 'shots', (opt('out') || id) + '.png');
await page.locator('#strip').screenshot({ path: out });
const bench = await page.evaluate(() => window.__bench);
const errors = await page.evaluate(() => window.__errors);
console.log('shot:', out);
if (bench !== undefined) console.log('ms per frame (software rendering, ' + width + 'px):', bench.toFixed(2));
for (const line of [...new Set([...logs, ...errors])]) console.log(line);
await browser.close();
