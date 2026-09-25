Reel.add({
    id: 'stream',
    title: 'Word by Word',
    line: 'Follow the work as it is written, not after the fact.',
    principles: ['Timing', 'Straight ahead and pose to pose'],
    tech: 'Canvas 2D, token streaming typography',
    hint: 'Hover a tool call to highlight it',
    poster: 8.6,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;
        const TAU = R.TAU;
        const ease = R.ease;
        const SANS = R.fonts.sans;
        const MONO = R.fonts.mono;

        const CLAUDE = new Path2D(
            'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
        );

        const SPAN = 14;
        const NODE = { x: 72, y: 58, w: 416, h: 392 };
        const HEAD = 34;
        const PAD = 22;
        const TEXT_W = NODE.w - PAD * 2;
        const LEAD = 21;
        const COMPOSER_H = 78;
        const VIEW_TOP = NODE.y + HEAD;
        const VIEW_BOTTOM = NODE.y + NODE.h - COMPOSER_H - 22;
        const FONT_TEXT = '400 13.5px ' + SANS;
        const FONT_CODE = '400 11px ' + MONO;
        const CODE_LEAD = 17;
        const FRESH = '#a9c9ff';
        const KEYWORDS = new Set(['const', 'export', 'function', 'return', 'import', 'from', 'await', 'let', 'new']);

        /* Two conversations, one after the other. Every time is seconds into that conversation. */
        const SCRIPTS = [
            {
                
                ask: 'Saved carts expire after a week. Can we keep them for 30 days?',
                items: [
                    { kind: 'text', at: 2.3, text: 'The expiry lives in cart.ts. Reading it first.' },
                    {
                        kind: 'tool',
                        at: 3.4,
                        icon: 'eye',
                        label: 'Read',
                        detail: 'cart.ts',
                        open: [3.75, 4.95],
                        code: [
                            { n: 12, text: 'const TTL = days(7);' },
                            { n: 13, text: 'export function save(cart) {' },
                            { n: 14, text: '  store.put(cart.id, cart, TTL);' }
                        ]
                    },
                    { kind: 'text', at: 5.25, text: 'It is hard coded to seven days. Changing it and adding a test for the new window.' },
                    {
                        kind: 'tool',
                        at: 6.9,
                        icon: 'edit',
                        label: 'Edit',
                        detail: 'cart.ts',
                        plus: '+12',
                        minus: '-3',
                        open: [7.2, 8.85],
                        code: [
                            { sign: '-', text: 'const TTL = days(7);' },
                            { sign: '+', text: 'const TTL = days(30);' },
                            { sign: '+', text: 'export const keep = (cart) =>' },
                            { sign: '+', text: '  store.touch(cart.id, TTL);' }
                        ]
                    },
                    {
                        kind: 'tool',
                        at: 9.1,
                        icon: 'bash',
                        label: 'Run',
                        detail: 'bun test',
                        open: [9.4, 10.35],
                        result: [
                            { text: '12 pass', color: pal.green },
                            { text: '0 fail', color: pal.termDim }
                        ]
                    },
                    { kind: 'text', at: 10.6, text: 'Done. Saved carts now last 30 days, and all 12 tests pass.', final: true }
                ]
            },
            {
                
                ask: 'Checkout feels slow on mobile. Can you find out why?',
                items: [
                    { kind: 'text', at: 2.3, text: 'Looking at what the checkout page loads first.' },
                    {
                        kind: 'tool',
                        at: 3.4,
                        icon: 'eye',
                        label: 'Read',
                        detail: 'checkout.tsx',
                        open: [3.75, 4.95],
                        code: [
                            { n: 3, text: "import { Map } from 'maps';" },
                            { n: 4, text: "import { Summary } from './summary';" },
                            { n: 5, text: 'export function Checkout() {' }
                        ]
                    },
                    { kind: 'text', at: 5.25, text: 'The map library loads on every visit, even without a pickup point. Loading it on demand.' },
                    {
                        kind: 'tool',
                        at: 6.9,
                        icon: 'edit',
                        label: 'Edit',
                        detail: 'checkout.tsx',
                        plus: '+8',
                        minus: '-2',
                        open: [7.2, 8.85],
                        code: [
                            { sign: '-', text: "import { Map } from 'maps';" },
                            { sign: '+', text: 'const Map = lazy(() =>' },
                            { sign: '+', text: "  import('maps'));" },
                            { sign: '+', text: 'const pickup = usePickup();' }
                        ]
                    },
                    {
                        kind: 'tool',
                        at: 9.1,
                        icon: 'bash',
                        label: 'Run',
                        detail: 'bun run build',
                        open: [9.4, 10.35],
                        result: [
                            { text: 'checkout.js  84 kB', color: pal.termFg },
                            { text: 'was 312 kB', color: pal.termDim }
                        ]
                    },
                    { kind: 'text', at: 10.6, text: 'Checkout now loads 228 kB less, so it opens much sooner on a phone.', final: true }
                ]
            }
        ];
        const SEND = 1.55;

        const wrap = (text, width) => {
            ctx.font = FONT_TEXT;
            const space = ctx.measureText(' ').width;
            const lines = [];
            let row = [];
            let x = 0;
            for (const word of text.split(' ')) {
                const wordWidth = ctx.measureText(word).width;
                if (row.length && x + wordWidth > width) {
                    lines.push(row);
                    row = [];
                    x = 0;
                }
                row.push({ word, x, w: wordWidth });
                x += wordWidth + space;
            }
            lines.push(row);
            return lines;
        };

        // Real streaming comes in bursts: a few words at once, then a pause while the model thinks.
        const cadence = (item, seed) => {
            let at = item.at;
            let index = 0;
            for (const row of item.lines) {
                for (const word of row) {
                    word.at = at;
                    const jitter = R.hash(seed * 31 + index * 7.13);
                    at += jitter < 0.16 ? 0.26 + jitter : 0.035 + jitter * 0.05;
                    index++;
                }
            }
            item.end = at;
        };

        const tokenize = (text) => {
            const out = [];
            const re = /('[^']*'|\d+|[A-Za-z_]+|\s+|.)/g;
            let match;
            let col = 0;
            while ((match = re.exec(text))) {
                const part = match[0];
                let color = pal.termFg;
                if (part[0] === "'") {
                    color = pal.green;
                } else if (/^\d/.test(part)) {
                    color = pal.yellow;
                } else if (KEYWORDS.has(part)) {
                    color = pal.magenta;
                } else if (/^[A-Za-z_]/.test(part) && text[re.lastIndex] === '(') {
                    color = pal.blue;
                } else if (/^[{}()=>;,.]+$/.test(part)) {
                    color = '#8b8b96';
                }
                if (part.trim()) {
                    out.push({ part, col, color });
                }
                col += part.length;
            }
            return out;
        };

        let measured = -1;
        let charW = 6.6;
        const itemHeight = (item, t) => {
            if (item.kind === 'text') {
                // A new line takes its room as its first word lands, eased, so the thread never jumps.
                let height = 0;
                for (const row of item.lines) {
                    height += LEAD * ease.outCubic((t - row[0].at) / 0.2);
                }
                return height;
            }
            const shown = ease.outCubic((t - item.at) / 0.3);
            const open = openness(item, t);
            return (28 + open * (item.boxH + 8)) * shown;
        };
        const openness = (item, t) => {
            const [opens, closes] = item.open;
            return ease.inOutCubic((t - opens) / 0.38) * (1 - ease.inOutCubic((t - closes) / 0.34));
        };
        const bubbleIn = (t) => ease.outCubic((t - SEND) / 0.5);
        const contentHeight = (script, t) => {
            let height = script.bubbleH * bubbleIn(t) + 14 * bubbleIn(t);
            for (const item of script.items) {
                const ih = itemHeight(item, t);
                if (ih > 0) {
                    height += ih + 12 * R.clamp(ih / 20);
                }
            }
            height += 30 * working(script, t);
            return height;
        };
        const working = (script, t) => ease.inOutCubic((t - SEND - 0.4) / 0.35) * (1 - ease.inOutCubic((t - script.items[script.items.length - 1].end - 0.1) / 0.35));

        const layout = () => {
            ctx.font = FONT_TEXT;
            const probe = ctx.measureText('Saved carts expire').width;
            if (probe === measured) {
                return;
            }
            measured = probe;
            ctx.font = FONT_CODE;
            charW = ctx.measureText('0000000000').width / 10;
            SCRIPTS.forEach((script, order) => {
                script.bubble = wrap(script.ask, TEXT_W * 0.74);
                script.bubbleW = Math.max(...script.bubble.map((row) => row[row.length - 1].x + row[row.length - 1].w)) + 28;
                script.bubbleH = script.bubble.length * LEAD + 18;
                script.items.forEach((item, i) => {
                    if (item.kind === 'text') {
                        item.lines = wrap(item.text, TEXT_W);
                        cadence(item, order * 17 + i);
                    } else {
                        const rows = item.code ? item.code.length : 1;
                        item.boxH = rows * CODE_LEAD + 14;
                        if (item.code) {
                            for (const row of item.code) {
                                row.tokens = tokenize(row.text);
                            }
                        }
                        item.end = item.open[1] + 0.3;
                    }
                });
                // Scroll only ever follows the newest line down, never back up, like a pinned thread.
                const steps = Math.ceil(SPAN * 30) + 1;
                script.scroll = new Float32Array(steps);
                let high = 0;
                const avail = VIEW_BOTTOM - VIEW_TOP - 20;
                for (let k = 0; k < steps; k++) {
                    high = Math.max(high, contentHeight(script, k / 30) - avail);
                    script.scroll[k] = high;
                }
            });
        };
        const scrollAt = (script, t) => {
            const at = R.clamp(t * 30, 0, script.scroll.length - 1);
            const k = Math.floor(at);
            const next = Math.min(script.scroll.length - 1, k + 1);
            return Math.max(0, R.lerp(script.scroll[k], script.scroll[next], at - k));
        };

        const line = (x1, y1, x2, y2) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };
        const iconAt = (kind, x, y, color) => {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (kind === 'claude') {
                ctx.translate(x - 7, y - 7);
                ctx.scale(14 / 24, 14 / 24);
                ctx.fill(CLAUDE);
            } else if (kind === 'eye') {
                ctx.beginPath();
                ctx.moveTo(x - 6, y);
                ctx.quadraticCurveTo(x, y - 6.5, x + 6, y);
                ctx.quadraticCurveTo(x, y + 6.5, x - 6, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 1.8, 0, TAU);
                ctx.stroke();
            } else if (kind === 'edit') {
                R.roundRect(ctx, x - 5.5, y - 4.5, 10, 10, 2);
                ctx.stroke();
                line(x - 1, y + 1, x + 5.5, y - 5.5);
            } else if (kind === 'bash') {
                ctx.beginPath();
                ctx.moveTo(x - 5, y - 3.5);
                ctx.lineTo(x - 1.5, y);
                ctx.lineTo(x - 5, y + 3.5);
                ctx.stroke();
                line(x + 0.5, y + 4, x + 5.5, y + 4);
            } else if (kind === 'close') {
                line(x - 3.5, y - 3.5, x + 3.5, y + 3.5);
                line(x + 3.5, y - 3.5, x - 3.5, y + 3.5);
            } else if (kind === 'chevron') {
                ctx.beginPath();
                ctx.moveTo(x - 1.5, y - 3);
                ctx.lineTo(x + 1.5, y);
                ctx.lineTo(x - 1.5, y + 3);
                ctx.stroke();
            } else if (kind === 'plus') {
                line(x - 4.5, y, x + 4.5, y);
                line(x, y - 4.5, x, y + 4.5);
            } else if (kind === 'up') {
                line(x, y + 5, x, y - 5);
                ctx.beginPath();
                ctx.moveTo(x - 4, y - 1);
                ctx.lineTo(x, y - 5);
                ctx.lineTo(x + 4, y - 1);
                ctx.stroke();
            }
            ctx.restore();
        };
        const shineFill = (x, width, t) => {
            const phase = R.fract(t / 1.6);
            const center = x + width * (1.6 - 2.2 * phase);
            const paint = ctx.createLinearGradient(center - width * 0.3, 0, center + width * 0.3, 0);
            paint.addColorStop(0, pal.muted);
            paint.addColorStop(0.5, pal.text);
            paint.addColorStop(1, pal.muted);
            return paint;
        };

        const drawText = (item, x, y, t, alpha) => {
            ctx.font = FONT_TEXT;
            ctx.textBaseline = 'middle';
            item.lines.forEach((row, li) => {
                for (const word of row) {
                    const frac = (t - word.at) / 0.24;
                    if (frac <= 0) {
                        continue;
                    }
                    const rise = ease.outCubic(frac);
                    // The newest words carry a light tint that cools into the text color: the shine of writing.
                    const cool = R.clamp((t - word.at) / 0.7);
                    ctx.globalAlpha = alpha * rise;
                    ctx.fillStyle = cool >= 1 ? pal.text : R.mix(FRESH, pal.text, ease.inOutSine(cool), 1);
                    ctx.fillText(word.word, x + word.x, y + LEAD / 2 + li * LEAD + (1 - rise) * 5);
                }
            });
            ctx.globalAlpha = alpha;
        };

        const drawTool = (item, x, y, t, alpha, hovered) => {
            const shown = ease.outCubic((t - item.at) / 0.3);
            const live = t < item.end - 0.2;
            const open = openness(item, t);
            ctx.globalAlpha = alpha * shown;
            if (hovered > 0.01) {
                R.roundRect(ctx, x - 6, y, TEXT_W + 12, 28, 6);
                ctx.fillStyle = 'rgba(255,255,255,' + (0.05 * hovered).toFixed(3) + ')';
                ctx.fill();
            }
            const cy = y + 14;
            iconAt(item.icon, x + 6, cy, live ? '#3b82f6' : pal.muted);
            ctx.font = '400 13px ' + SANS;
            ctx.textBaseline = 'middle';
            const lw = ctx.measureText(item.label).width;
            ctx.fillStyle = live ? shineFill(x + 20, lw, t) : pal.muted;
            ctx.fillText(item.label, x + 20, cy + 0.5);
            ctx.font = '400 11.5px ' + MONO;
            ctx.fillStyle = pal.faint;
            let dx = x + 28 + lw;
            ctx.fillText(item.detail, dx, cy + 0.5);
            dx += ctx.measureText(item.detail).width + 8;
            if (item.plus) {
                const counted = R.clamp((t - item.open[0]) / 1.2);
                if (counted > 0) {
                    ctx.globalAlpha = alpha * shown * counted;
                    ctx.fillStyle = pal.green;
                    ctx.fillText(item.plus, dx, cy + 0.5);
                    dx += ctx.measureText(item.plus).width + 5;
                    ctx.fillStyle = pal.red;
                    ctx.fillText(item.minus, dx, cy + 0.5);
                    ctx.globalAlpha = alpha * shown;
                }
            }
            if (item.result && t > item.open[1]) {
                ctx.fillStyle = item.result[0].color;
                ctx.globalAlpha = alpha * shown * R.clamp((t - item.open[1]) / 0.3);
                ctx.fillText(item.result[0].text, dx, cy + 0.5);
                ctx.globalAlpha = alpha * shown;
            }
            ctx.save();
            ctx.translate(x + TEXT_W - 4, cy);
            ctx.rotate((open * Math.PI) / 2);
            iconAt('chevron', 0, 0, pal.faint);
            ctx.restore();
            if (open <= 0.001) {
                return;
            }
            // The expanded pose: a sunken box whose lines build one after another, then fold away again.
            const boxY = y + 32;
            const boxH = item.boxH * open;
            ctx.save();
            R.roundRect(ctx, x, boxY, TEXT_W, boxH, 8);
            ctx.fillStyle = pal.sunken;
            ctx.fill();
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.clip();
            ctx.font = FONT_CODE;
            const rows = item.code || [{ result: true }];
            rows.forEach((row, i) => {
                const rowAt = item.open[0] + 0.22 + i * 0.2;
                const frac = ease.outCubic((t - rowAt) / 0.25);
                if (frac <= 0) {
                    return;
                }
                const ry = boxY + 7 + i * CODE_LEAD + CODE_LEAD / 2;
                ctx.globalAlpha = alpha * frac;
                if (row.sign) {
                    ctx.fillStyle = row.sign === '+' ? 'rgba(74,222,128,0.10)' : 'rgba(248,113,113,0.11)';
                    ctx.fillRect(x, ry - CODE_LEAD / 2, TEXT_W, CODE_LEAD);
                    ctx.fillStyle = row.sign === '+' ? pal.green : pal.red;
                    ctx.fillRect(x, ry - CODE_LEAD / 2, 2, CODE_LEAD);
                    ctx.fillText(row.sign, x + 9, ry);
                } else if (row.n) {
                    ctx.fillStyle = pal.faint;
                    ctx.textAlign = 'right';
                    ctx.fillText(String(row.n), x + 22, ry);
                    ctx.textAlign = 'left';
                }
                if (row.result) {
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText('$ ' + item.detail, x + 10, ry);
                    let rx = x + 10 + charW * (item.detail.length + 3);
                    for (const part of item.result) {
                        ctx.fillStyle = part.color;
                        ctx.fillText(part.text, rx, ry);
                        rx += charW * (part.text.length + 2);
                    }
                    return;
                }
                // Typed across in a quick sweep, so a line builds rather than pops.
                const reveal = Math.floor(ease.outQuad((t - rowAt) / 0.35) * row.text.length);
                const ox = x + 32 + (row.sign ? -8 : 0);
                for (const token of row.tokens) {
                    if (token.col >= reveal) {
                        break;
                    }
                    ctx.fillStyle = token.color;
                    ctx.fillText(token.part.slice(0, reveal - token.col), ox + token.col * charW, ry);
                }
            });
            ctx.restore();
            ctx.globalAlpha = alpha;
        };

        const drawComposer = (script, t) => {
            const x = NODE.x + 14;
            const width = NODE.w - 28;
            const y = NODE.y + NODE.h - COMPOSER_H - 12;
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.shadowColor = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 3;
            R.roundRect(ctx, x, y, width, COMPOSER_H, 15);
            ctx.fillStyle = pal.raised;
            ctx.fill();
            ctx.restore();
            R.roundRect(ctx, x + 0.5, y + 0.5, width - 1, COMPOSER_H - 1, 14.5);
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.font = FONT_TEXT;
            ctx.textBaseline = 'middle';
            const typed = Math.floor(R.clamp((t - 0.25) / 1.15) * script.ask.length);
            const sent = t >= SEND;
            if (typed > 0 && !sent) {
                let text = script.ask.slice(0, typed);
                ctx.fillStyle = pal.text;
                // Only the tail fits the one visible line, the way a composer scrolls a long draft.
                while (ctx.measureText(text).width > width - 44 && text.length > 1) {
                    text = text.slice(1);
                }
                ctx.fillText(text, x + 18, y + 24);
                ctx.fillStyle = pal.text;
                ctx.fillRect(x + 19 + ctx.measureText(text).width, y + 16, 1.5, 16);
            } else {
                const back = sent ? ease.inOutSine((t - SEND - 0.2) / 0.4) : 1;
                ctx.globalAlpha = back;
                ctx.fillStyle = pal.faint;
                ctx.fillText('Ask anything, or / commands, @ files', x + 18, y + 24);
                ctx.globalAlpha = 1;
            }
            const by = y + COMPOSER_H - 22;
            ctx.strokeStyle = pal.border;
            ctx.beginPath();
            ctx.arc(x + 32, by, 12, 0, TAU);
            ctx.stroke();
            iconAt('plus', x + 32, by, pal.muted);
            R.roundRect(ctx, x + 50, by - 12, 122, 24, 12);
            ctx.stroke();
            iconAt('claude', x + 64, by, pal.muted);
            ctx.font = '500 12px ' + SANS;
            ctx.fillStyle = pal.text;
            ctx.fillText('Opus 5.5', x + 76, by + 0.5);
            ctx.fillStyle = pal.muted;
            ctx.font = '400 12px ' + SANS;
            ctx.fillText('Edits', x + 134, by + 0.5);
            const press = Math.sin(Math.PI * R.clamp((t - SEND + 0.08) / 0.24));
            const scale = 1 - 0.12 * press;
            ctx.save();
            ctx.translate(x + width - 32, by);
            ctx.scale(scale, scale);
            ctx.fillStyle = pal.accent;
            ctx.beginPath();
            ctx.arc(0, 0, 13, 0, TAU);
            ctx.fill();
            iconAt('up', 0, 0, '#ffffff');
            ctx.restore();
        };

        const drawThread = (script, t, top, alpha, pointer) => {
            const left = NODE.x + PAD;
            let y = top;
            const bin = bubbleIn(t);
            if (bin > 0) {
                ctx.globalAlpha = alpha * R.clamp(bin * 1.6);
                const right = NODE.x + NODE.w - PAD;
                const from = NODE.y + NODE.h - COMPOSER_H;
                const by = R.lerp(from, y, bin);
                R.roundRect(ctx, right - script.bubbleW, by, script.bubbleW, script.bubbleH, 15);
                ctx.fillStyle = pal.active;
                ctx.fill();
                ctx.font = FONT_TEXT;
                ctx.fillStyle = pal.text;
                ctx.textBaseline = 'middle';
                script.bubble.forEach((row, li) => {
                    for (const word of row) {
                        ctx.fillText(word.word, right - script.bubbleW + 14 + word.x, by + 9 + LEAD / 2 + li * LEAD);
                    }
                });
                y += (script.bubbleH + 14) * bin;
            }
            for (const item of script.items) {
                const height = itemHeight(item, t);
                if (height <= 0.01) {
                    continue;
                }
                ctx.globalAlpha = alpha;
                if (item.kind === 'text') {
                    drawText(item, left, y, t, alpha);
                } else {
                    const inside = pointer.active > 0.01 && pointer.y > y && pointer.y < y + 28 && pointer.x > left - 6 && pointer.x < left + TEXT_W + 6;
                    drawTool(item, left, y, t, alpha, inside ? pointer.active : 0);
                }
                y += height + 12 * R.clamp(height / 20);
            }
            const work = working(script, t);
            if (work > 0.01) {
                ctx.globalAlpha = alpha * work;
                ctx.fillStyle = pal.running;
                ctx.globalAlpha *= 0.75 + 0.25 * Math.cos(t * Math.PI);
                ctx.beginPath();
                ctx.arc(left + 4, y + 11, 4, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = alpha * work;
                ctx.font = '400 13px ' + SANS;
                ctx.textBaseline = 'middle';
                const lw = ctx.measureText('Working for').width;
                ctx.fillStyle = shineFill(left + 16, lw, t);
                ctx.fillText('Working for', left + 16, y + 11.5);
                ctx.fillStyle = pal.faint;
                ctx.fillText('00:' + String(Math.max(0, Math.floor(t - SEND))).padStart(2, '0'), left + 22 + lw, y + 11.5);
            }
        };

        return {
            draw(time) {
                layout();
                const pointer = env.pointer;
                const index = Math.floor(time / SPAN) % SCRIPTS.length;
                const script = SCRIPTS[index];
                const t = R.mod(time, SPAN);
                env.clear();
                const running = t > SEND + 0.3 && t < script.items[script.items.length - 1].end + 0.2;

                ctx.save();
                ctx.translate(pointer.nx * -3 * pointer.active, pointer.ny * -2 * pointer.active);
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 24;
                ctx.shadowOffsetY = 8;
                R.roundRect(ctx, NODE.x, NODE.y, NODE.w, NODE.h, 12);
                ctx.fillStyle = pal.surface;
                ctx.fill();
                ctx.restore();

                // The thread, clipped to the view between the header and the composer.
                const scroll = scrollAt(script, t);
                ctx.save();
                ctx.beginPath();
                ctx.rect(NODE.x, VIEW_TOP, NODE.w, VIEW_BOTTOM - VIEW_TOP + 16);
                ctx.clip();
                const bin = bubbleIn(t);
                if (bin < 1) {
                    // The previous exchange stays in the thread until the new question pushes it up and out.
                    const other = SCRIPTS[(index + 1) % SCRIPTS.length];
                    drawThread(other, SPAN, VIEW_TOP + 16 - scrollAt(other, SPAN) - ease.inOutCubic(bin) * 150, 1 - ease.inOutSine(bin), pointer);
                }
                drawThread(script, t, VIEW_TOP + 16 - scroll, 1, pointer);
                ctx.restore();
                ctx.globalAlpha = 1;
                const topFade = ctx.createLinearGradient(0, VIEW_TOP, 0, VIEW_TOP + 22);
                topFade.addColorStop(0, pal.surface);
                topFade.addColorStop(1, 'rgba(19,19,22,0)');
                ctx.fillStyle = topFade;
                ctx.fillRect(NODE.x, VIEW_TOP, NODE.w, 22);

                // The header: the Claude mark, the chat's name and what it is doing.
                ctx.save();
                R.roundRect(ctx, NODE.x, NODE.y, NODE.w, NODE.h, 12);
                ctx.clip();
                ctx.fillStyle = pal.raised;
                ctx.fillRect(NODE.x, NODE.y, NODE.w, HEAD);
                ctx.fillStyle = pal.border;
                ctx.fillRect(NODE.x, NODE.y + HEAD - 1, NODE.w, 1);
                ctx.restore();
                iconAt('claude', NODE.x + 17, NODE.y + HEAD / 2, pal.muted);
                ctx.font = '500 13px ' + SANS;
                ctx.fillStyle = pal.text;
                ctx.textBaseline = 'middle';
                ctx.fillText('Storefront', NODE.x + 32, NODE.y + HEAD / 2 + 0.5);
                const label = running ? 'Running' : 'Idle';
                ctx.font = '500 11.5px ' + SANS;
                const pw = ctx.measureText(label).width + 24;
                const px = NODE.x + NODE.w - 34 - pw;
                R.roundRect(ctx, px, NODE.y + HEAD / 2 - 9.5, pw, 19, 9.5);
                ctx.fillStyle = pal.sunken;
                ctx.fill();
                ctx.fillStyle = running ? pal.running : pal.idle;
                ctx.globalAlpha = running ? 0.75 + 0.25 * Math.cos(t * Math.PI) : 1;
                ctx.beginPath();
                ctx.arc(px + 10, NODE.y + HEAD / 2, 3.5, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = pal.muted;
                ctx.fillText(label, px + 18, NODE.y + HEAD / 2 + 0.5);
                iconAt('close', NODE.x + NODE.w - 17, NODE.y + HEAD / 2, pal.faint);

                drawComposer(script, t);
                R.roundRect(ctx, NODE.x + 0.5, NODE.y + 0.5, NODE.w - 1, NODE.h - 1, 11.5);
                ctx.strokeStyle = pal.border;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
                env.fadeEdges(0.8, 1.04);
            }
        };
    }
});
