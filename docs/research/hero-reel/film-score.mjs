// Usage: node film-score.mjs <film-id>
// Renders the film's score (Film.define({... score(kit) {} })) offline, writes renders/<id>.wav, a loudness
// picture renders/<id>-score.png (one column per 50 ms, a mark every second, the film's cut times if the film
// lists them in `cuts`), and muxes renders/<id>.mp4 + the score into renders/<id>-music.mp4.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const bundle = readdirSync(resolve(here, 'pieces'))
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'))
    .sort()
    .map((name) => `(() => {\n${readFileSync(resolve(here, 'pieces', name), 'utf8')}\n})();`)
    .join('\n');
writeFileSync(resolve(here, 'pieces.bundle.js'), bundle);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') { logs.push(m.text()); } });
await page.goto('file://' + resolve(here, 'film.html') + '?film=' + id + '&score=1');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const result = await page.evaluate(async () => {
    const def = Film.get(new URLSearchParams(location.search).get('film'));
    if (!def.score) {
        return { error: 'This film has no score(kit) yet.' };
    }
    const rate = 48000;
    const ac = new OfflineAudioContext(2, Math.ceil(rate * def.duration), rate);
    const kit = Score.create(ac);
    def.score(kit);
    const buffer = await ac.startRendering();
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const pcm = new Int16Array(left.length * 2);
    let peak = 0;
    for (let i = 0; i < left.length; i++) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        pcm[i * 2] = Math.max(-1, Math.min(1, left[i])) * 32767;
        pcm[i * 2 + 1] = Math.max(-1, Math.min(1, right[i])) * 32767;
    }
    // Loudness per 50 ms window, drawn as a picture with seconds and cuts marked.
    const step = rate / 20;
    const windows = Math.ceil(left.length / step);
    const canvas = document.createElement('canvas');
    canvas.width = windows * 2;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let w = 0; w < windows; w++) {
        let sum = 0;
        for (let i = w * step; i < Math.min(left.length, (w + 1) * step); i++) {
            sum += left[i] * left[i];
        }
        const rms = Math.sqrt(sum / step);
        const db = Math.max(-60, 20 * Math.log10(rms + 1e-9));
        const h = ((db + 60) / 60) * 190;
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(w * 2, 200 - h, 2, h);
    }
    ctx.fillStyle = '#9a9aa6';
    ctx.font = '11px monospace';
    for (let s = 0; s <= def.duration; s++) {
        ctx.fillRect(s * 40, 200, 1, s % 5 === 0 ? 14 : 6);
        if (s % 5 === 0) {
            ctx.fillText(String(s), s * 40 + 3, 214);
        }
    }
    ctx.fillStyle = '#fbbf24';
    for (const cut of def.cuts || []) {
        ctx.fillRect(Math.round(cut * 40), 0, 1, 200);
    }
    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return { pcm: btoa(binary), rate, peak, picture: canvas.toDataURL('image/png') };
});
if (result.error) {
    console.log(result.error);
    process.exit(1);
}
const pcm = Buffer.from(result.pcm, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(result.rate, 24);
header.writeUInt32LE(result.rate * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
const wav = resolve(here, 'renders', id + '.wav');
writeFileSync(wav, Buffer.concat([header, pcm]));
writeFileSync(resolve(here, 'renders', id + '-score.png'), Buffer.from(result.picture.split(',')[1], 'base64'));
console.log('score:', wav, 'peak', result.peak.toFixed(3), result.peak > 0.99 ? '(clipping)' : '');
const video = resolve(here, 'renders', id + '.mp4');
if (existsSync(video)) {
    const ffmpeg = execSync('python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"').toString().trim();
    const out = resolve(here, 'renders', id + '-music.mp4');
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    console.log('film with music:', out);
} else {
    console.log('no renders/' + id + '.mp4 yet; only the score was written');
}
for (const line of logs) {
    console.log(line);
}
await browser.close();
