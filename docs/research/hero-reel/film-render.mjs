// Usage: node film-render.mjs <film-id> [--stills 0,5,12.5,...] [--from s --to s] [--scale 0.5]
//   --stills: renders those times (seconds) into renders/<id>-stills.png as a contact sheet, no video.
//   otherwise: renders the whole film (or --from/--to) to renders/<id>.mp4 (H.264, 30 fps).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args[0];
const opt = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : fallback;
};
// Every take in one file, so the film page can place any of them.
const bundle = readdirSync(resolve(here, 'pieces'))
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'))
    .sort()
    .map((name) => `(() => {\n${readFileSync(resolve(here, 'pieces', name), 'utf8')}\n})();`)
    .join('\n');
writeFileSync(resolve(here, 'pieces.bundle.js'), bundle);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 600 }, ignoreHTTPSErrors: true })).newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') { logs.push(m.text()); } });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('file://' + resolve(here, 'film.html') + '?film=' + id);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const total = await page.evaluate(() => window.__film.frames);
const fps = 30;
const scale = Number(opt('scale', '1'));

const grab = (quality) => page.evaluate(([q, s]) => {
    const source = document.getElementById('frame');
    if (s === 1) {
        return source.toDataURL('image/jpeg', q);
    }
    const small = document.createElement('canvas');
    small.width = Math.round(source.width * s);
    small.height = Math.round(source.height * s);
    small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
    return small.toDataURL('image/jpeg', q);
}, [quality, scale]);

const runTo = async (frame) => {
    await page.evaluate(([from, to]) => {
        for (let n = from; n <= to; n++) {
            window.__film.frame(n);
        }
    }, [runTo.next, frame]);
    runTo.next = frame + 1;
};
runTo.next = 0;

if (opt('stills')) {
    const times = opt('stills').split(',').map(Number).sort((a, b) => a - b);
    const shots = [];
    for (const time of times) {
        const frame = Math.min(total - 1, Math.round(time * fps));
        if (frame >= runTo.next) {
            await runTo(frame);
        }
        shots.push({ time, data: await grab(0.85) });
    }
    const sheet = await page.evaluate(async (list) => {
        const cols = 3;
        const w = 640;
        const h = 360;
        const canvas = document.createElement('canvas');
        canvas.width = cols * w + (cols - 1) * 8;
        canvas.height = Math.ceil(list.length / cols) * (h + 28);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < list.length; i++) {
            const img = new Image();
            img.src = list[i].data;
            await img.decode();
            const x = (i % cols) * (w + 8);
            const y = Math.floor(i / cols) * (h + 28);
            ctx.drawImage(img, x, y, w, h);
            ctx.fillStyle = '#9a9aa6';
            ctx.font = '14px monospace';
            ctx.fillText(list[i].time.toFixed(2) + 's', x + 4, y + h + 18);
        }
        return canvas.toDataURL('image/png');
    }, shots);
    const out = resolve(here, 'renders', id + '-stills.png');
    writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log('stills:', out);
} else {
    const ffmpeg = execSync('python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"').toString().trim();
    const from = Math.round(Number(opt('from', '0')) * fps);
    const to = Math.min(total, Math.round(Number(opt('to', String(total / fps))) * fps));
    const out = resolve(here, 'renders', id + (opt('from') || opt('to') ? `-${from}-${to}` : '') + '.mp4');
    const encoder = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    encoder.stderr.on('data', (d) => process.stderr.write(d));
    const started = Date.now();
    for (let n = 0; n < to; n++) {
        await runTo(n);
        if (n < from) {
            continue;
        }
        const data = await grab(0.93);
        if (!encoder.stdin.write(Buffer.from(data.split(',')[1], 'base64'))) {
            await new Promise((r) => encoder.stdin.once('drain', r));
        }
        if (n % 150 === 0) {
            console.log(`frame ${n}/${to}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
        }
    }
    encoder.stdin.end();
    await new Promise((r) => encoder.on('close', r));
    console.log('video:', out);
}
for (const line of [...new Set([...logs, ...(await page.evaluate(() => window.__errors))])]) {
    console.log(line);
}
await browser.close();
