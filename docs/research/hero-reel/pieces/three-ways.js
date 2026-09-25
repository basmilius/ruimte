Reel.add({
    id: 'three-ways',
    title: 'Three Ways',
    line: 'Conflicts are worked out stretch by stretch, never with markers in a file.',
    principles: ['Slow in and slow out', 'Staging'],
    tech: 'Canvas 2D, three-way merge choreography',
    hint: 'Hover a line to line it up across the versions',
    poster: 5.95,
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
        const ARROW = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');
        const KEYWORDS = new Set(['const', 'function', 'return', 'import', 'from']);

        const CYCLE = 18;
        const DIALOG = { x: 62, y: 70, w: 436, h: 354 };
        const LH = 15;
        const COLS = [
            { key: 'ours', label: 'ours', branch: 'main', x: 74 },
            { key: 'base', label: 'base', branch: '', x: 214 },
            { key: 'theirs', label: 'theirs', branch: 'fix/carts', x: 354 }
        ];
        const COL_W = 132;
        const COL_Y = DIALOG.y + 48;
        const COL_HEAD = 22;
        const ROWS = 7;
        const COL_H = COL_HEAD + ROWS * LH + 12;
        const RES = { x: 74, y: COL_Y + COL_H + 12, w: 412, h: 0 };
        RES.h = 26 + ROWS * LH + 12;
        const GUTTER = 26;

        const BASE = ["import { days } from './time';", 'const TTL = days(7);', 'function save(c) {', '  put(c, TTL);', '}', 'function load(id) {', '  return get(id);'];
        const VERSIONS = {
            base: BASE,
            ours: BASE.map((text, i) => (i === 1 ? 'const TTL = days(30);' : i === 3 ? '  put(c.id, c, TTL);' : i === 6 ? '  return get(id) ?? [];' : text)),
            theirs: BASE.map((text, i) => (i === 1 ? 'const TTL = env.TTL;' : i === 3 ? '  put(c, TTL, touch);' : i === 6 ? '  return up(get(id));' : text))
        };
        const STRETCHES = [
            { line: 1, text: 'const TTL = env.TTL ?? days(30);', at: 0.9 },
            { line: 3, text: '  put(c.id, c, TTL, touch);', at: 4.1 },
            { line: 6, text: '  return up(get(id)) ?? [];', at: 7.3 }
        ];
        const SETTLE = 2.6;
        const COLLAPSE = 10.4;
        const GRAPH = 11.0;
        const GRAPH_OUT = 16.2;
        const BACK = 16.8;

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
                } else if (/^[{}()=>;,.?[\]]+$/.test(part)) {
                    color = '#8b8b96';
                }
                if (part.trim()) {
                    out.push({ part, col, color });
                }
                col += part.length;
            }
            return out;
        };
        const TOKENS = {};
        for (const key of Object.keys(VERSIONS)) {
            TOKENS[key] = VERSIONS[key].map(tokenize);
        }
        for (const stretch of STRETCHES) {
            stretch.tokens = tokenize(stretch.text);
        }

        let charW = 5.7;
        let measured = -1;
        const layout = () => {
            ctx.font = '400 9.5px ' + MONO;
            const probe = ctx.measureText('0000000000').width;
            if (probe !== measured) {
                measured = probe;
                charW = probe / 10;
            }
        };
        const drawCode = (tokens, x, y, alpha) => {
            for (const token of tokens) {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = token.color;
                ctx.fillText(token.part, x + token.col * charW, y);
            }
        };

        const line = (x1, y1, x2, y2) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };

        const accepted = (k, t) => ease.inOutSine((t - STRETCHES[k].at - 2.2) / 0.45);
        const remaining = (t) => STRETCHES.reduce((count, stretch, k) => count + (t < stretch.at + 2.3 ? 1 : 0), 0);

        /* The staging band: one stretch at a time, gliding with slow in and slow out from one to the next. */
        const focusAt = (t) => {
            let y = STRETCHES[0].line;
            for (let k = 1; k < STRETCHES.length; k++) {
                const frac = ease.inOutCubic((t - STRETCHES[k].at + 0.35) / 0.6);
                y = R.lerp(y, STRETCHES[k].line, frac);
            }
            const on = ease.inOutSine((t - 0.3) / 0.5) * (1 - ease.inOutSine((t - (STRETCHES[2].at + SETTLE)) / 0.5));
            return { line: y, on };
        };

        const ghostRect = (k, t) => {
            const stretch = STRETCHES[k];
            const travel = ease.inOutCubic((t - stretch.at - 0.75) / 0.85);
            const from = { x: COLS[1].x + 4, y: COL_Y + COL_HEAD + 6 + stretch.line * LH, w: COL_W - 8 };
            const to = { x: RES.x + GUTTER, y: RES.y + 26 + 6 + stretch.line * LH, w: RES.w - GUTTER - 8 };
            return {
                travel,
                x: R.lerp(from.x, to.x, travel),
                y: R.lerp(from.y, to.y, travel) + Math.sin(Math.PI * travel) * 10,
                w: R.lerp(from.w, to.w, travel)
            };
        };

        const cursorAt = (t) => {
            const rest = [506, 452];
            for (let k = 0; k < STRETCHES.length; k++) {
                const start = STRETCHES[k].at;
                const button = [RES.x + RES.w - 36, RES.y + 26 + 6 + STRETCHES[k].line * LH + LH / 2 + 2];
                if (t >= start + 1.3 && t < start + 2.2) {
                    const frac = ease.inOutCubic((t - start - 1.3) / 0.8);
                    const x = R.lerp(rest[0], button[0], frac);
                    const y = R.lerp(rest[1], button[1], frac) - Math.sin(Math.PI * frac) * 18;
                    return { x, y, press: 0, on: R.clamp((t - start - 1.3) / 0.3) };
                }
                if (t >= start + 2.2 && t < start + 3.1) {
                    const back = ease.inOutCubic((t - start - 2.5) / 0.6);
                    const press = Math.sin(Math.PI * R.clamp((t - start - 2.12) / 0.26));
                    return { x: R.lerp(button[0], rest[0], back), y: R.lerp(button[1], rest[1], back), press, on: 1 - R.clamp((t - start - 2.8) / 0.3) };
                }
            }
            return { x: rest[0], y: rest[1], press: 0, on: 0 };
        };

        const drawDialog = (t, alpha, collapse, pointer) => {
            const focus = focusAt(t);
            ctx.save();
            ctx.globalAlpha = alpha;
            // The dialog frame goes as the result closes, so what is left is the history it made.
            const frameAlpha = alpha * (1 - ease.inOutSine(collapse * 1.4));
            ctx.save();
            ctx.globalAlpha = frameAlpha;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 24;
            ctx.shadowOffsetY = 8;
            R.roundRect(ctx, DIALOG.x, DIALOG.y, DIALOG.w, DIALOG.h, 14);
            ctx.fillStyle = pal.surface;
            ctx.fill();
            ctx.restore();
            ctx.globalAlpha = frameAlpha;
            R.roundRect(ctx, DIALOG.x + 0.5, DIALOG.y + 0.5, DIALOG.w - 1, DIALOG.h - 1, 13.5);
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = pal.border;
            ctx.fillRect(DIALOG.x, DIALOG.y + 38, DIALOG.w, 1);
            ctx.textBaseline = 'middle';
            ctx.font = '600 13px ' + SANS;
            ctx.fillStyle = pal.text;
            ctx.fillText('Resolve conflicts', DIALOG.x + 16, DIALOG.y + 19.5);
            const tw = ctx.measureText('Resolve conflicts').width;
            ctx.font = '400 11px ' + MONO;
            ctx.fillStyle = pal.faint;
            ctx.fillText('cart.ts', DIALOG.x + 26 + tw, DIALOG.y + 20);
            const left = remaining(t);
            ctx.font = '400 11.5px ' + SANS;
            ctx.textAlign = 'right';
            ctx.fillStyle = pal.muted;
            const counter = left === 0 ? 'All resolved' : left + (left === 1 ? ' conflict left' : ' conflicts left');
            ctx.fillText(counter, DIALOG.x + DIALOG.w - 16, DIALOG.y + 19.5);
            const cw = ctx.measureText(counter).width;
            ctx.textAlign = 'left';
            ctx.fillStyle = left === 0 ? pal.idle : pal.needs;
            ctx.beginPath();
            ctx.arc(DIALOG.x + DIALOG.w - 26 - cw, DIALOG.y + 19.5, 3.5, 0, TAU);
            ctx.fill();

            // The three versions side by side, ours, base and theirs, lifting away as the merge completes.
            const lift = ease.inOutCubic(collapse);
            ctx.save();
            ctx.globalAlpha = alpha * (1 - lift);
            ctx.translate(0, -lift * 16);
            const hoverLine = pointer.active > 0.02 && pointer.y > COL_Y + COL_HEAD + 6 && pointer.y < COL_Y + COL_HEAD + 6 + ROWS * LH ? Math.floor((pointer.y - COL_Y - COL_HEAD - 6) / LH) : -1;
            for (const col of COLS) {
                R.roundRect(ctx, col.x, COL_Y, COL_W, COL_H, 9);
                ctx.fillStyle = pal.sunken;
                ctx.fill();
                ctx.strokeStyle = pal.border;
                ctx.stroke();
                ctx.fillStyle = pal.border;
                ctx.fillRect(col.x, COL_Y + COL_HEAD, COL_W, 1);
                ctx.font = '500 11px ' + SANS;
                ctx.fillStyle = pal.muted;
                ctx.fillText(col.label, col.x + 10, COL_Y + COL_HEAD / 2 + 0.5);
                if (col.branch) {
                    const lw = ctx.measureText(col.label).width;
                    ctx.font = '400 10px ' + MONO;
                    ctx.fillStyle = pal.faint;
                    ctx.fillText(col.branch, col.x + 16 + lw, COL_Y + COL_HEAD / 2 + 0.5);
                }
                ctx.save();
                ctx.beginPath();
                ctx.rect(col.x, COL_Y + COL_HEAD, COL_W, COL_H - COL_HEAD);
                ctx.clip();
                const tokens = TOKENS[col.key];
                ctx.font = '400 9.5px ' + MONO;
                for (let i = 0; i < ROWS; i++) {
                    const ry = COL_Y + COL_HEAD + 6 + i * LH;
                    const k = STRETCHES.findIndex((entry) => entry.line === i);
                    if (i === hoverLine) {
                        ctx.globalAlpha = alpha * (1 - lift) * pointer.active;
                        ctx.fillStyle = 'rgba(255,255,255,0.06)';
                        ctx.fillRect(col.x, ry, COL_W, LH);
                    }
                    let textAlpha = 1;
                    if (k >= 0) {
                        const near = 1 - R.clamp(Math.abs(focus.line - i) / 3);
                        const lit = R.lerp(0.35, 1, near * focus.on + (1 - focus.on));
                        const done = accepted(k, t);
                        textAlpha = lit;
                        const tint = col.key === 'base' ? '248,113,113' : '74,222,128';
                        ctx.globalAlpha = alpha * (1 - lift) * lit * (1 - done * 0.6);
                        ctx.fillStyle = 'rgba(' + tint + ',0.11)';
                        ctx.fillRect(col.x, ry, COL_W, LH);
                        ctx.fillStyle = col.key === 'base' ? pal.red : pal.green;
                        ctx.fillRect(col.x, ry, 2, LH);
                    } else {
                        textAlpha = R.lerp(1, 0.55, focus.on);
                    }
                    drawCode(tokens[i], col.x + 9, ry + LH / 2 + 0.5, alpha * (1 - lift) * textAlpha);
                }
                ctx.restore();
            }
            ctx.restore();

            // The result: the merged file, with a slot for every stretch that still disagrees.
            // The text leaves first, then the empty result closes into the merge commit.
            const shrink = ease.inOutCubic(R.clamp((collapse - 0.2) / 0.8));
            const textFade = 1 - R.clamp(collapse / 0.2);
            const dot = { x: 398, y: 250 };
            const rx = R.lerp(RES.x, dot.x - 7, shrink);
            const ry0 = R.lerp(RES.y, dot.y - 7, shrink);
            const rw = R.lerp(RES.w, 14, shrink);
            const rh = R.lerp(RES.h, 14, shrink);
            ctx.globalAlpha = alpha;
            R.roundRect(ctx, rx, ry0, rw, rh, R.lerp(9, 7, shrink));
            ctx.fillStyle = shrink > 0 ? R.mix(pal.sunken, pal.idle, R.smoothstep(0.6, 1, shrink), 1) : pal.sunken;
            ctx.fill();
            ctx.strokeStyle = shrink > 0.9 ? 'rgba(0,0,0,0)' : pal.borderStrong;
            ctx.stroke();
            if (textFade > 0) {
                const fade = textFade;
                ctx.save();
                ctx.beginPath();
                ctx.rect(rx, ry0, rw, rh);
                ctx.clip();
                ctx.globalAlpha = alpha * fade;
                ctx.fillStyle = pal.border;
                ctx.fillRect(RES.x, RES.y + 26, RES.w, 1);
                ctx.font = '500 11px ' + SANS;
                ctx.fillStyle = pal.text;
                ctx.fillText('result', RES.x + 10, RES.y + 13.5);
                ctx.font = '400 10px ' + MONO;
                ctx.fillStyle = pal.faint;
                ctx.fillText('cart.ts', RES.x + 48, RES.y + 13.5);
                ctx.font = '400 9.5px ' + MONO;
                for (let i = 0; i < ROWS; i++) {
                    const ry = RES.y + 26 + 6 + i * LH;
                    const cy = ry + LH / 2 + 0.5;
                    if (i === hoverLine) {
                        ctx.globalAlpha = alpha * fade * pointer.active;
                        ctx.fillStyle = 'rgba(255,255,255,0.06)';
                        ctx.fillRect(RES.x, ry, RES.w, LH);
                    }
                    ctx.globalAlpha = alpha * fade;
                    ctx.textAlign = 'right';
                    ctx.fillStyle = pal.faint;
                    ctx.fillText(String(i + 1), RES.x + GUTTER - 8, cy);
                    ctx.textAlign = 'left';
                    const k = STRETCHES.findIndex((entry) => entry.line === i);
                    if (k < 0) {
                        drawCode(TOKENS.base[i], RES.x + GUTTER + 6, cy, alpha * fade * R.lerp(1, 0.6, focus.on));
                        continue;
                    }
                    const stretch = STRETCHES[k];
                    const done = accepted(k, t);
                    const ghost = ghostRect(k, t);
                    if (ghost.travel < 1) {
                        // An open slot, waiting: the conflict marked in amber, never as markers in the text.
                        ctx.globalAlpha = alpha * fade * (1 - ghost.travel);
                        ctx.fillStyle = 'rgba(251,191,36,0.08)';
                        ctx.fillRect(RES.x + GUTTER, ry, RES.w - GUTTER, LH);
                        ctx.fillStyle = pal.needs;
                        ctx.fillRect(RES.x + GUTTER, ry, 2, LH);
                        ctx.fillStyle = 'rgba(251,191,36,0.7)';
                        ctx.font = '400 10px ' + SANS;
                        ctx.fillText('Conflict ' + (k + 1) + ', unresolved', RES.x + GUTTER + 10, cy);
                        ctx.font = '400 9.5px ' + MONO;
                    }
                    if (done > 0) {
                        const flash = 1 - R.clamp((t - stretch.at - 2.35) / 1.2);
                        ctx.globalAlpha = alpha * fade * Math.max(0.35, flash) * done;
                        ctx.fillStyle = 'rgba(74,222,128,' + (0.06 + 0.1 * flash).toFixed(3) + ')';
                        ctx.fillRect(RES.x + GUTTER, ry, RES.w - GUTTER, LH);
                        ctx.globalAlpha = alpha * fade;
                        ctx.fillStyle = pal.green;
                        ctx.fillRect(RES.x + GUTTER, ry, 2, LH);
                        // The check draws itself, a short stroke then the long one.
                        const draw = ease.outCubic((t - stretch.at - 2.25) / 0.35);
                        ctx.strokeStyle = pal.green;
                        ctx.lineWidth = 1.6;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        const cx = RES.x + RES.w - 16;
                        ctx.beginPath();
                        ctx.moveTo(cx - 4, cy);
                        const first = R.clamp(draw / 0.4);
                        ctx.lineTo(cx - 4 + 2.5 * first, cy + 2.5 * first);
                        if (draw > 0.4) {
                            const second = (draw - 0.4) / 0.6;
                            ctx.lineTo(cx - 1.5 + 5.5 * second, cy + 2.5 - 6 * second);
                        }
                        ctx.stroke();
                        drawCode(stretch.tokens, RES.x + GUTTER + 6, cy, alpha * fade);
                    }
                }
                ctx.restore();
            }

            // The proposals in flight: a ghost of the stretch slides from the base into its slot.
            for (let k = 0; k < STRETCHES.length; k++) {
                const stretch = STRETCHES[k];
                if (t < stretch.at + 0.55 || collapse > 0) {
                    continue;
                }
                const done = accepted(k, t);
                if (done >= 1) {
                    continue;
                }
                const ghost = ghostRect(k, t);
                const appear = ease.outCubic((t - stretch.at - 0.55) / 0.3);
                ctx.save();
                ctx.globalAlpha = alpha * appear * (1 - done);
                R.roundRect(ctx, ghost.x, ghost.y - 1, ghost.w, LH + 2, 4);
                ctx.fillStyle = 'rgba(21,93,252,0.14)';
                ctx.fill();
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = 'rgba(96,165,250,0.7)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.rect(ghost.x, ghost.y - 1, ghost.w, LH + 2);
                ctx.clip();
                ctx.font = '400 9.5px ' + MONO;
                drawCode(stretch.tokens, ghost.x + 6, ghost.y + LH / 2 + 0.5, alpha * appear * (1 - done) * 0.6);
                ctx.restore();
                // Once it has landed: who proposed it, and the button a person presses.
                const landed = R.clamp((t - stretch.at - 1.55) / 0.3) * (1 - done);
                if (landed > 0) {
                    const cy = ghost.y + LH / 2;
                    ctx.globalAlpha = alpha * landed;
                    const bx = RES.x + RES.w - 58;
                    ctx.save();
                    ctx.translate(bx - 58, cy - 6);
                    ctx.scale(11 / 24, 11 / 24);
                    ctx.fillStyle = pal.muted;
                    ctx.fill(CLAUDE);
                    ctx.restore();
                    ctx.font = '400 10px ' + SANS;
                    ctx.fillStyle = pal.muted;
                    ctx.fillText('proposed', bx - 44, cy + 0.5);
                    const press = Math.sin(Math.PI * R.clamp((t - stretch.at - 2.12) / 0.26));
                    ctx.save();
                    ctx.translate(bx + 22, cy);
                    ctx.scale(1 - 0.08 * press, 1 - 0.08 * press);
                    R.roundRect(ctx, -22, -8.5, 44, 17, 5);
                    ctx.fillStyle = pal.text;
                    ctx.fill();
                    ctx.fillStyle = pal.bg;
                    ctx.font = '500 10px ' + SANS;
                    ctx.textAlign = 'center';
                    ctx.fillText('Accept', 0, 0.5);
                    ctx.restore();
                    ctx.textAlign = 'left';
                }
            }
            ctx.restore();
        };

        /* What the merge leaves behind: two branch lines drawn into one commit. */
        const MAIN = [
            [96, 250],
            [470, 250]
        ];
        const BRANCH = [];
        {
            const pts = [
                [170, 250],
                [206, 250],
                [226, 296],
                [262, 300],
                [330, 300],
                [370, 296],
                [398, 250]
            ];
            for (let i = 0; i < pts.length - 1; i++) {
                for (let k = 0; k < 10; k++) {
                    const frac = k / 10;
                    BRANCH.push([R.lerp(pts[i][0], pts[i + 1][0], frac), R.lerp(pts[i][1], pts[i + 1][1], frac)]);
                }
            }
            BRANCH.push(pts[pts.length - 1]);
            // Smooth the corners of the polyline once, so the branch reads as a curve.
            for (let pass = 0; pass < 6; pass++) {
                for (let i = 1; i < BRANCH.length - 1; i++) {
                    BRANCH[i] = [(BRANCH[i - 1][0] + BRANCH[i][0] * 2 + BRANCH[i + 1][0]) / 4, (BRANCH[i - 1][1] + BRANCH[i][1] * 2 + BRANCH[i + 1][1]) / 4];
                }
            }
        }
        const partial = (points, frac) => {
            const last = points.length - 1;
            const at = R.clamp(frac) * last;
            const whole = Math.floor(at);
            ctx.beginPath();
            ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i <= whole; i++) {
                ctx.lineTo(points[i][0], points[i][1]);
            }
            if (whole < last) {
                const k = at - whole;
                ctx.lineTo(R.lerp(points[whole][0], points[whole + 1][0], k), R.lerp(points[whole][1], points[whole + 1][1], k));
            }
            ctx.stroke();
        };
        const drawGraph = (t) => {
            const out = 1 - ease.inOutSine((t - GRAPH_OUT) / 0.6);
            if (t < GRAPH || out <= 0) {
                return;
            }
            ctx.save();
            ctx.globalAlpha = out;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const mainDraw = ease.inOutCubic((t - GRAPH) / 1.0);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(236,236,241,0.5)';
            const mainPts = [];
            for (let i = 0; i <= 40; i++) {
                mainPts.push([R.lerp(MAIN[0][0], MAIN[1][0], i / 40), 250]);
            }
            partial(mainPts, mainDraw);
            const branchDraw = ease.inOutCubic((t - GRAPH - 0.15) / 1.0);
            ctx.strokeStyle = pal.running;
            partial(BRANCH, branchDraw);
            const commits = [
                [130, 0.1],
                [170, 0.2],
                [300, 0.55]
            ];
            for (const [x, reach] of commits) {
                if (mainDraw > reach) {
                    ctx.fillStyle = pal.bg;
                    ctx.strokeStyle = 'rgba(236,236,241,0.6)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, 250, 4.5 * ease.outBack((mainDraw - reach) / 0.15, 2), 0, TAU);
                    ctx.fill();
                    ctx.stroke();
                }
            }
            if (branchDraw > 0.5) {
                ctx.fillStyle = pal.bg;
                ctx.strokeStyle = pal.running;
                ctx.beginPath();
                ctx.arc(296, 300, 4.5 * ease.outBack((branchDraw - 0.5) / 0.15, 2), 0, TAU);
                ctx.fill();
                ctx.stroke();
            }
            // The merge commit: the result's last pose, sitting where both lines meet.
            const meet = ease.outBack((t - GRAPH - 1.05) / 0.4, 2.6);
            ctx.fillStyle = pal.idle;
            ctx.beginPath();
            ctx.arc(398, 250, 7 * Math.max(1, meet), 0, TAU);
            ctx.fill();
            const ring = R.clamp((t - GRAPH - 1.05) / 0.8);
            if (ring > 0 && ring < 1) {
                ctx.strokeStyle = 'rgba(74,222,128,' + (0.6 * (1 - ring)).toFixed(3) + ')';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(398, 250, 8 + ring * 22, 0, TAU);
                ctx.stroke();
            }
            ctx.font = '400 11px ' + MONO;
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = out * R.clamp((t - GRAPH - 0.4) / 0.5);
            ctx.fillStyle = pal.muted;
            ctx.fillText('main', 96, 232);
            ctx.fillStyle = '#93c5fd';
            ctx.fillText('fix/carts', 212, 320);
            ctx.globalAlpha = out * R.clamp((t - GRAPH - 1.3) / 0.5);
            ctx.font = '500 13px ' + SANS;
            ctx.fillStyle = pal.text;
            ctx.textAlign = 'center';
            ctx.fillText('Merge fix/carts into main', 398, 206);
            ctx.font = '400 11px ' + SANS;
            ctx.fillStyle = pal.faint;
            ctx.fillText('3 conflicts, resolved stretch by stretch', 398, 222);
            ctx.textAlign = 'left';
            ctx.restore();
        };

        const drawCursor = (t) => {
            const pose = cursorAt(t);
            if (pose.on <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha = pose.on;
            ctx.translate(pose.x, pose.y);
            const scale = 1 - 0.12 * pose.press;
            ctx.scale(scale, scale);
            ctx.translate(-1.5, -1.5);
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
            ctx.fillStyle = '#000';
            ctx.fill(ARROW);
            ctx.shadowColor = 'transparent';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.4;
            ctx.lineJoin = 'round';
            ctx.stroke(ARROW);
            ctx.restore();
        };

        return {
            draw(time) {
                layout();
                const t = R.mod(time, CYCLE);
                env.clear();
                const collapse = R.clamp((t - COLLAPSE) / 1.1);
                // The dialog comes back for the next conflict with the same slow in it left with.
                const back = ease.inOutCubic((t - BACK) / 0.9);
                const gone = t >= COLLAPSE + 1.1 && t < BACK;
                if (t < COLLAPSE + 1.1) {
                    drawDialog(t, 1, ease.inOutCubic(collapse), env.pointer);
                } else if (!gone) {
                    ctx.save();
                    ctx.translate(280, 250);
                    const scale = R.lerp(0.97, 1, back);
                    ctx.scale(scale, scale);
                    ctx.translate(-280, -250);
                    drawDialog(0, back, 0, env.pointer);
                    ctx.restore();
                }
                drawGraph(t);
                drawCursor(t);
                env.fadeEdges(0.82, 1.04);
            }
        };
    }
});
