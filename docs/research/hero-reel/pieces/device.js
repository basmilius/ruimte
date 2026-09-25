Reel.add({
    id: 'device',
    title: 'On Your Phone',
    line: 'Answer your agents from your phone.',
    principles: ['Staging', 'Appeal'],
    tech: 'Canvas 2D, device frame and approval flow with spring sheets',
    hint: 'Move to tilt the phone',
    poster: 4.55,
    create(env) {
        const { R, W, H } = env;
        // Swapped to an offscreen buffer while the laptop draws, so it can dim as one layer.
        let ctx = env.ctx;
        const laptopLayer = env.buffer();
        const pal = R.pal;
        const ease = R.ease;
        const phase = R.phase;

        const CYCLE = 18;
        const CLAUDE = new Path2D(
            'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
        );

        const PHONE = { x: 276, y: 80, w: 170, h: 334, r: 32 };
        const SCREEN = { x: PHONE.x + 5, y: PHONE.y + 5, w: PHONE.w - 10, h: PHONE.h - 10, r: 27 };
        const LAPTOP = { x: 40, y: 200, w: 236, h: 150 };
        const NODE = { x: 56, y: 216, w: 204, h: 120 };

        // Two asks per cycle: an approval, then a question. Every beat of one is offset from `start`.
        const FLOWS = [
            { start: 0.9, kind: 'approve', title: 'claude needs you', body: ['Allow bun install?'] },
            { start: 9.7, kind: 'question', title: 'claude asks', body: ['How long should', 'saved carts last?'] }
        ];
        const BEAT = { sync: 0.1, banner: 0.6, expand: 1.9, thumb: 3.2, press: 3.75, chosen: 3.95, dismiss: 4.45, back: 4.65, resume: 5.15 };
        const RESET = 16.9;
        const OPTIONS = ['7 days', '30 days', 'Until checkout', 'Write your own'];
        const CHOICE = 1;

        const springy = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.exp(-k * 6.5) * Math.cos(k * 9.5) * (1 - k * 0.2));

        const shineFill = (x, width, t) => {
            const band = x + width * (1.3 - 1.6 * R.fract(t / 1.6));
            const gradient = ctx.createLinearGradient(band - 26, 0, band + 26, 0);
            gradient.addColorStop(0, pal.muted);
            gradient.addColorStop(0.5, pal.text);
            gradient.addColorStop(1, pal.muted);
            return gradient;
        };

        const drawClaude = (x, y, size, color) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(size / 24, size / 24);
            ctx.fillStyle = color;
            ctx.fill(CLAUDE);
            ctx.restore();
        };

        const plane = (cx, cy, side, skew, radius) => {
            const corners = [
                [cx - side / 2 + skew, cy - side / 2],
                [cx + side / 2 + skew, cy - side / 2],
                [cx + side / 2 - skew, cy + side / 2],
                [cx - side / 2 - skew, cy + side / 2]
            ];
            ctx.beginPath();
            ctx.moveTo((corners[0][0] + corners[1][0]) / 2, corners[0][1]);
            for (let i = 1; i <= 4; i++) {
                const corner = corners[i % 4];
                const next = corners[(i + 1) % 4];
                ctx.arcTo(corner[0], corner[1], next[0], next[1], radius);
            }
            ctx.closePath();
        };
        const appIcon = (x, y, size) => {
            ctx.fillStyle = '#e9ecf1';
            R.roundRect(ctx, x, y, size, size, size * 0.24);
            ctx.fill();
            const side = size * 0.44;
            plane(x + size * 0.42, y + size * 0.42, side, side * 0.18, side * 0.18);
            ctx.fillStyle = pal.markDark;
            ctx.fill();
            plane(x + size * 0.58, y + size * 0.58, side, side * 0.18, side * 0.18);
            ctx.fillStyle = 'rgba(160,170,186,0.95)';
            ctx.fill();
        };

        /* What the chat on the laptop shows, beat by beat; each state is three short lines. */
        const THREAD = [
            { at: 0, status: 'running', lines: [['user', 'Add saved carts'], ['tool', 'Edit', 'cart.ts'], ['shine', 'Working']] },
            { at: FLOWS[0].start, status: 'needs', lines: [['tool', 'Edit', 'cart.ts'], ['shine', 'Working'], ['ask', 'Run bun install']] },
            { at: FLOWS[0].start + BEAT.resume, status: 'running', lines: [['ask-done', 'Allowed', 'bun install'], ['tool', 'Run', 'bun install'], ['shine', 'Working']] },
            { at: FLOWS[1].start, status: 'needs', lines: [['tool', 'Run', 'bun install'], ['tool', 'Read', 'cart.ts'], ['ask', 'How long should carts last?']] },
            { at: FLOWS[1].start + BEAT.resume, status: 'running', lines: [['tool', 'Read', 'cart.ts'], ['user', '30 days'], ['shine', 'Working']] },
            { at: RESET, status: 'running', lines: [['user', 'Add saved carts'], ['tool', 'Edit', 'cart.ts'], ['shine', 'Working']] }
        ];

        const drawLine = (line, x, y, width, alpha, t) => {
            ctx.globalAlpha = alpha;
            ctx.textBaseline = 'middle';
            const kind = line[0];
            if (kind === 'user') {
                ctx.font = '400 12px ' + R.fonts.display;
                const tw = ctx.measureText(line[1]).width;
                ctx.fillStyle = pal.active;
                R.roundRect(ctx, x + width - tw - 18, y - 10, tw + 18, 20, 10);
                ctx.fill();
                ctx.fillStyle = pal.text;
                ctx.textAlign = 'left';
                ctx.fillText(line[1], x + width - tw - 9, y + 0.5);
            } else if (kind === 'tool') {
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.textAlign = 'left';
                ctx.strokeStyle = pal.muted;
                ctx.lineWidth = 1.2;
                R.roundRect(ctx, x + 1, y - 4.5, 9, 9, 2);
                ctx.stroke();
                ctx.fillStyle = pal.muted;
                ctx.fillText(line[1], x + 16, y + 0.5);
                const lw = ctx.measureText(line[1]).width;
                ctx.font = '400 12px ' + R.fonts.mono;
                ctx.fillStyle = pal.faint;
                ctx.fillText(line[2], x + 21 + lw, y + 0.5);
            } else if (kind === 'shine') {
                ctx.fillStyle = pal.running;
                ctx.beginPath();
                ctx.arc(x + 4, y, 3, 0, R.TAU);
                ctx.fill();
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.textAlign = 'left';
                const tw = ctx.measureText(line[1]).width;
                ctx.fillStyle = shineFill(x + 14, tw, t);
                ctx.fillText(line[1], x + 14, y + 0.5);
            } else if (kind === 'ask') {
                ctx.fillStyle = R.rgba(pal.needs, 0.1);
                R.roundRect(ctx, x - 2, y - 11, width + 4, 22, 6);
                ctx.fill();
                ctx.fillStyle = pal.needs;
                ctx.beginPath();
                ctx.arc(x + 6, y, 3, 0, R.TAU);
                ctx.fill();
                ctx.font = '500 12px ' + R.fonts.display;
                ctx.textAlign = 'left';
                ctx.fillStyle = pal.text;
                ctx.fillText(line[1], x + 15, y + 0.5);
            } else if (kind === 'ask-done') {
                ctx.strokeStyle = pal.idle;
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(x + 1, y);
                ctx.lineTo(x + 4, y + 3);
                ctx.lineTo(x + 9, y - 3);
                ctx.stroke();
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.textAlign = 'left';
                ctx.fillStyle = pal.muted;
                ctx.fillText(line[1], x + 16, y + 0.5);
                const lw = ctx.measureText(line[1]).width;
                ctx.font = '400 12px ' + R.fonts.mono;
                ctx.fillStyle = pal.faint;
                ctx.fillText(line[2], x + 21 + lw, y + 0.5);
            }
            ctx.globalAlpha = 1;
        };

        const threadAt = (t) => {
            let index = 0;
            for (let i = 0; i < THREAD.length; i++) {
                if (t >= THREAD[i].at) {
                    index = i;
                }
            }
            return index;
        };

        const drawLaptop = (t, focus, ox, oy) => {
            const { x, y, w, h } = LAPTOP;
            ctx.save();
            ctx.translate(ox, oy);
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#1a1a1e';
            R.roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 10);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = pal.bg;
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#26262b';
            ctx.beginPath();
            ctx.moveTo(x - 22, y + h + 8);
            ctx.lineTo(x + w + 22, y + h + 8);
            ctx.lineTo(x + w + 14, y + h + 15);
            ctx.lineTo(x - 14, y + h + 15);
            ctx.closePath();
            ctx.fill();
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            ctx.fillStyle = pal.dot;
            for (let gx = x + 6; gx < x + w; gx += 12) {
                for (let gy = y + 6; gy < y + h; gy += 12) {
                    ctx.fillRect(gx - 0.6, gy - 0.6, 1.2, 1.2);
                }
            }
            const { x: nx, y: ny, w: nw, h: nh } = NODE;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            R.roundRect(ctx, nx, ny + 2, nw, nh, 8);
            ctx.fill();
            ctx.fillStyle = pal.surface;
            R.roundRect(ctx, nx, ny, nw, nh, 8);
            ctx.fill();
            ctx.save();
            ctx.clip();
            ctx.fillStyle = pal.raised;
            ctx.fillRect(nx, ny, nw, 26);
            ctx.fillStyle = pal.border;
            ctx.fillRect(nx, ny + 26, nw, 1);
            drawClaude(nx + 8, ny + 7, 12, pal.muted);
            ctx.font = '500 12px ' + R.fonts.display;
            ctx.fillStyle = pal.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('saved carts', nx + 26, ny + 13.5);

            const index = threadAt(t);
            const state = THREAD[index];
            const previous = THREAD[Math.max(0, index - 1)];
            const change = index === 0 ? 1 : ease.outCubic(phase(t, state.at, 0.45));
            const needs = state.status === 'needs' ? change : previous.status === 'needs' ? 1 - change : 0;
            const pillText = needs > 0.5 ? 'Needs you' : 'Running';
            ctx.font = '400 12px ' + R.fonts.display;
            const pw = ctx.measureText(pillText).width + 22;
            ctx.fillStyle = pal.sunken;
            R.roundRect(ctx, nx + nw - pw - 6, ny + 5, pw, 17, 8.5);
            ctx.fill();
            const pulse = needs > 0.5 ? 1 : 0.6 + 0.4 * Math.cos((t / 2) * R.TAU);
            ctx.fillStyle = R.mix(pal.running, pal.needs, needs, pulse);
            ctx.beginPath();
            ctx.arc(nx + nw - pw + 3, ny + 13.5, 3, 0, R.TAU);
            ctx.fill();
            ctx.fillStyle = pal.muted;
            ctx.fillText(pillText, nx + nw - pw + 11, ny + 14);

            // New lines come in from below and push the thread up, the way a chat scrolls.
            const lx = nx + 12;
            const lw = nw - 24;
            const rowY = (i) => ny + 48 + i * 27;
            if (change < 1) {
                for (let i = 0; i < 3; i++) {
                    drawLine(previous.lines[i], lx, rowY(i) - change * 10, lw, (1 - change) * focus.text, t);
                }
            }
            for (let i = 0; i < 3; i++) {
                drawLine(state.lines[i], lx, rowY(i) + (1 - change) * 10, lw, change * focus.text, t);
            }
            ctx.restore();
            ctx.strokeStyle = needs > 0.01 ? R.rgba(pal.needs, 0.35 * needs) : pal.border;
            ctx.lineWidth = 1;
            R.roundRect(ctx, nx + 0.5, ny + 0.5, nw - 1, nh - 1, 8);
            ctx.stroke();
            ctx.restore();
            ctx.restore();
        };

        const drawBanner = (flow, rect, reveal) => {
            ctx.fillStyle = 'rgba(58,58,66,0.86)';
            R.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.save();
            ctx.globalAlpha *= reveal;
            appIcon(rect.x + 9, rect.y + 12, 24);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '600 12px ' + R.fonts.display;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(flow.title, rect.x + 41, rect.y + 18);
            ctx.font = '400 12px ' + R.fonts.display;
            ctx.fillStyle = 'rgba(255,255,255,0.72)';
            for (let i = 0; i < flow.body.length; i++) {
                ctx.fillText(flow.body[i], rect.x + 41, rect.y + 34 + i * 15);
            }
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillText('now', rect.x + rect.w - 9, rect.y + 18);
            ctx.restore();
        };

        const stagger = (t, start, i) => ease.outCubic(phase(t, start + 0.12 + i * 0.06, 0.3));

        const drawApproval = (rect, t, open, pressed, chosen) => {
            const x = rect.x + 12;
            const top = rect.y;
            const width = rect.w - 24;
            let row = stagger(t, open, 0);
            ctx.globalAlpha = row;
            ctx.strokeStyle = pal.needs;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x + 2, top + 26);
            ctx.lineTo(x + 2, top + 18);
            ctx.moveTo(x + 5, top + 26);
            ctx.lineTo(x + 5, top + 16);
            ctx.moveTo(x + 8, top + 26);
            ctx.lineTo(x + 8, top + 17);
            ctx.moveTo(x + 11, top + 26);
            ctx.lineTo(x + 11, top + 20);
            ctx.stroke();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '600 13px ' + R.fonts.display;
            ctx.fillStyle = pal.text;
            ctx.fillText('Run command', x + 20, top + 21);
            ctx.font = '400 12px ' + R.fonts.display;
            ctx.fillStyle = pal.muted;
            ctx.fillText('saved carts', x + 20, top + 38);
            row = stagger(t, open, 1);
            ctx.globalAlpha = row;
            ctx.fillStyle = pal.sunken;
            R.roundRect(ctx, x, top + 52 + (1 - row) * 4, width, 42, 8);
            ctx.fill();
            ctx.font = '400 12px ' + R.fonts.mono;
            ctx.fillStyle = pal.muted;
            ctx.fillText('~/acme-web', x + 9, top + 65 + (1 - row) * 4);
            ctx.fillStyle = pal.text;
            ctx.fillText('bun install', x + 9, top + 81 + (1 - row) * 4);
            row = stagger(t, open, 2);
            ctx.globalAlpha = row;
            const by = top + 106 + (1 - row) * 4;
            ctx.font = '500 12px ' + R.fonts.display;
            ctx.textAlign = 'center';
            ctx.fillStyle = pal.muted;
            ctx.fillText('Deny', x + 26, by + 12);
            ctx.save();
            const allowX = x + width - 34;
            ctx.translate(allowX, by + 12);
            const squash = 1 - pressed * 0.06;
            ctx.scale(squash, squash);
            ctx.fillStyle = chosen > 0.5 ? R.mix(pal.text, pal.idle, (chosen - 0.5) * 2) : pal.text;
            R.roundRect(ctx, -34, -12, 68, 24, 7);
            ctx.fill();
            ctx.fillStyle = pal.bg;
            ctx.fillText(chosen > 0.5 ? 'Allowed' : 'Allow', 0, 0.5);
            ctx.restore();
            ctx.globalAlpha = 1;
            return { x: allowX, y: by + 12 };
        };

        const drawQuestion = (rect, t, open, pressed, chosen) => {
            const x = rect.x + 12;
            const top = rect.y;
            const width = rect.w - 24;
            let row = stagger(t, open, 0);
            ctx.globalAlpha = row;
            ctx.fillStyle = pal.needs;
            ctx.beginPath();
            ctx.arc(x + 4, top + 19, 3, 0, R.TAU);
            ctx.fill();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '400 12px ' + R.fonts.display;
            ctx.fillStyle = pal.muted;
            ctx.fillText('claude asks', x + 13, top + 19.5);
            ctx.font = '600 13px ' + R.fonts.display;
            ctx.fillStyle = pal.text;
            ctx.fillText('How long should', x, top + 40);
            ctx.fillText('saved carts last?', x, top + 57);
            let target = null;
            for (let i = 0; i < OPTIONS.length; i++) {
                row = stagger(t, open, i + 1);
                ctx.globalAlpha = row;
                const oy = top + 80 + i * 25 + (1 - row) * 5;
                const isChoice = i === CHOICE;
                if (isChoice && chosen > 0) {
                    ctx.fillStyle = R.rgba('#ffffff', 0.09 * Math.min(1, chosen * 2));
                    const grow = ease.outBack(Math.min(1, chosen * 2), 2);
                    R.roundRect(ctx, x - 4 + (1 - grow) * 6, oy - 11, width + 8 - (1 - grow) * 12, 22, 7);
                    ctx.fill();
                }
                if (isChoice && pressed > 0) {
                    ctx.fillStyle = R.rgba('#ffffff', 0.06 * pressed);
                    R.roundRect(ctx, x - 4, oy - 11, width + 8, 22, 7);
                    ctx.fill();
                }
                ctx.strokeStyle = isChoice && chosen > 0.3 ? pal.text : 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.arc(x + 6, oy, 5.5, 0, R.TAU);
                ctx.stroke();
                if (isChoice && chosen > 0.3) {
                    ctx.fillStyle = pal.text;
                    ctx.beginPath();
                    ctx.arc(x + 6, oy, 2.8 * ease.outBack(R.clamp((chosen - 0.3) * 2.5), 2.5), 0, R.TAU);
                    ctx.fill();
                }
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.fillStyle = i === OPTIONS.length - 1 ? pal.faint : pal.text;
                ctx.fillText(OPTIONS[i], x + 19, oy + 0.5);
                if (isChoice) {
                    target = { x: x + 48, y: oy };
                }
            }
            ctx.globalAlpha = 1;
            return target;
        };

        const tmpRect = { x: 0, y: 0, w: 0, h: 0 };

        const drawPhone = (t, ox, oy) => {
            const px = PHONE.x + ox;
            const py = PHONE.y + oy;
            const sx = SCREEN.x + ox;
            const sy = SCREEN.y + oy;
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            R.roundRect(ctx, px + 6, py + 18, PHONE.w - 12, PHONE.h, PHONE.r);
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            R.roundRect(ctx, px + 2, py + 8, PHONE.w - 4, PHONE.h, PHONE.r);
            ctx.fill();
            ctx.fillStyle = '#2a2a31';
            ctx.fillRect(px - 2, py + 70, 3, 22);
            ctx.fillRect(px - 2, py + 100, 3, 36);
            ctx.fillRect(px + PHONE.w - 1, py + 96, 3, 50);
            ctx.fillStyle = '#26262d';
            R.roundRect(ctx, px, py, PHONE.w, PHONE.h, PHONE.r);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.save();
            R.roundRect(ctx, sx, sy, SCREEN.w, SCREEN.h, SCREEN.r);
            ctx.clip();
            const wall = ctx.createLinearGradient(sx, sy, sx + SCREEN.w * 0.6, sy + SCREEN.h);
            wall.addColorStop(0, '#16192a');
            wall.addColorStop(0.55, '#0e0f16');
            wall.addColorStop(1, '#0a0a0d');
            ctx.fillStyle = wall;
            ctx.fillRect(sx, sy, SCREEN.w, SCREEN.h);

            // Which ask is on screen, and how far along it is.
            let flow = null;
            for (const candidate of FLOWS) {
                if (t >= candidate.start && t < candidate.start + BEAT.resume + 0.2) {
                    flow = candidate;
                }
            }
            const local = flow ? t - flow.start : -1;
            const expand = flow ? springy(phase(local, BEAT.expand, 0.75)) : 0;
            const dismiss = flow ? ease.inCubic(phase(local, BEAT.dismiss, 0.32)) : 0;
            const sheet = R.clamp(ease.outCubic(phase(local, BEAT.expand, 0.35))) * (1 - ease.outCubic(phase(local, BEAT.dismiss + 0.05, 0.4)));

            // The lock screen steps back behind a sheet: smaller, dimmer, softer.
            const cx = sx + SCREEN.w / 2;
            const back = sheet;
            ctx.save();
            ctx.translate(cx, sy + 110);
            const shrink = 1 - back * 0.06;
            ctx.scale(shrink, shrink);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            if (back > 0.02) {
                ctx.filter = 'blur(' + (back * 2.5 * env.scale).toFixed(2) + 'px)';
            }
            ctx.font = '500 12px ' + R.fonts.display;
            ctx.fillStyle = R.rgba('#ffffff', 0.75 - back * 0.4);
            ctx.fillText('Friday, September 25', 0, -52);
            ctx.font = '600 50px ' + R.fonts.display;
            ctx.fillStyle = R.rgba('#e9ecf4', 0.95 - back * 0.5);
            ctx.fillText('9:41', 0, -4);
            ctx.filter = 'none';
            ctx.restore();
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.arc(cx + side * 50, sy + SCREEN.h - 42, 15, 0, R.TAU);
                ctx.fill();
            }
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            R.roundRect(ctx, cx - 5, sy + SCREEN.h - 48, 10, 12, 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + 50, sy + SCREEN.h - 42, 4.5, 0, R.TAU);
            ctx.fill();

            if (back > 0.01) {
                ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * back).toFixed(3) + ')';
                ctx.fillRect(sx, sy, SCREEN.w, SCREEN.h);
            }

            let target = null;
            if (flow && local >= BEAT.banner) {
                const drop = springy(phase(local, BEAT.banner, 0.7));
                const bannerY = sy + 150;
                const card = flow.kind === 'approve' ? { h: 142 } : { h: 190 };
                const cardY = flow.kind === 'approve' ? sy + 98 : sy + 72;
                tmpRect.x = R.lerp(sx + 7, sx + 5, expand);
                tmpRect.w = R.lerp(SCREEN.w - 14, SCREEN.w - 10, expand);
                tmpRect.y = R.lerp(R.lerp(sy - 70, bannerY, drop), cardY, expand) - dismiss * 40;
                tmpRect.h = R.lerp(37 + flow.body.length * 15, card.h, expand);
                const alpha = R.clamp(drop * 3) * (1 - dismiss);
                ctx.save();
                ctx.globalAlpha = alpha;
                if (expand < 0.5) {
                    drawBanner(flow, tmpRect, 1 - expand * 2);
                } else {
                    ctx.fillStyle = R.mix('#3a3a42', pal.raised, R.clamp((expand - 0.5) * 2), 0.96);
                    R.roundRect(ctx, tmpRect.x, tmpRect.y, tmpRect.w, tmpRect.h, R.lerp(14, 20, expand));
                    ctx.fill();
                    ctx.strokeStyle = pal.border;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    const pressed = Math.sin(Math.PI * phase(local, BEAT.press, 0.22));
                    const chosen = ease.outCubic(phase(local, BEAT.chosen - 0.1, 0.35));
                    const open = flow.start + BEAT.expand + 0.15;
                    target = flow.kind === 'approve' ? drawApproval(tmpRect, t, open, pressed, chosen) : drawQuestion(tmpRect, t, open, pressed, chosen);
                }
                ctx.restore();
            }

            ctx.fillStyle = '#000000';
            R.roundRect(ctx, cx - 26, sy + 9, 52, 15, 7.5);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            R.roundRect(ctx, cx - 28, sy + SCREEN.h - 9, 56, 4, 2);
            ctx.fill();
            // A glare that slides as the phone leans, so the glass reads as glass.
            const lean = env.pointer.nx * env.pointer.active;
            const glareX = sx + SCREEN.w * (0.2 + lean * 0.35);
            const glare = ctx.createLinearGradient(glareX - 80, sy, glareX + 80, sy + SCREEN.h * 0.7);
            glare.addColorStop(0, 'rgba(255,255,255,0)');
            glare.addColorStop(0.5, 'rgba(255,255,255,0.045)');
            glare.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glare;
            ctx.fillRect(sx, sy, SCREEN.w, SCREEN.h);
            ctx.restore();

            if (flow && target) {
                drawThumb(t - flow.start, target);
            }
        };

        const drawThumb = (local, target) => {
            const come = ease.outCubic(phase(local, BEAT.thumb, 0.5));
            const leave = ease.inCubic(phase(local, BEAT.chosen + 0.1, 0.35));
            const shown = come * (1 - leave);
            if (shown <= 0.01) {
                return;
            }
            // It hovers a hair above the glass, then sinks onto it: the press is anticipated before it lands.
            const press = phase(local, BEAT.press - 0.08, 0.3);
            const down = Math.sin(Math.PI * press);
            const hover = (1 - come) * 22 + leave * 16;
            const radius = 21 * (1 + hover / 40) * (1 - down * 0.12);
            const tx = target.x + hover * 0.6;
            const ty = target.y + hover;
            ctx.save();
            ctx.globalAlpha = shown;
            ctx.fillStyle = 'rgba(0,0,0,' + (0.22 * (1 - down)).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(tx + 2, ty + 4 + hover * 0.3, radius, 0, R.TAU);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,' + (0.22 + down * 0.16).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(tx, ty, radius, 0, R.TAU);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            const ripple = phase(local, BEAT.press + 0.05, 0.5);
            if (ripple > 0 && ripple < 1) {
                ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - ripple)).toFixed(3) + ')';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(tx, ty, radius + ease.outCubic(ripple) * 20, 0, R.TAU);
                ctx.stroke();
            }
            ctx.restore();
        };

        // A dot that carries the ask from the laptop to the phone, and the answer back.
        const drawSync = (t, ox, oy) => {
            const from = { x: NODE.x + NODE.w - 18, y: NODE.y - 2 };
            const to = { x: PHONE.x + ox + 2, y: PHONE.y + oy + 140 };
            const ctrl = { x: (from.x + to.x) / 2 + 4, y: Math.min(from.y, to.y) - 52 };
            for (const flow of FLOWS) {
                for (const leg of [
                    { start: flow.start + BEAT.sync, dir: 1 },
                    { start: flow.start + BEAT.back, dir: -1 }
                ]) {
                    const k = phase(t, leg.start, 0.5);
                    const line = ease.outCubic(phase(t, leg.start - 0.1, 0.3)) * (1 - ease.inOutSine(phase(t, leg.start + 0.45, 0.4)));
                    if (line <= 0.01) {
                        continue;
                    }
                    ctx.save();
                    ctx.setLineDash([2, 4]);
                    ctx.lineCap = 'round';
                    ctx.lineWidth = 1.3;
                    ctx.strokeStyle = R.rgba(leg.dir > 0 ? pal.needs : pal.running, 0.5 * line);
                    ctx.beginPath();
                    ctx.moveTo(from.x, from.y);
                    ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
                    ctx.stroke();
                    ctx.restore();
                    if (k > 0 && k < 1) {
                        const along = leg.dir > 0 ? ease.inOutSine(k) : 1 - ease.inOutSine(k);
                        const rest = 1 - along;
                        const dx = rest * rest * from.x + 2 * rest * along * ctrl.x + along * along * to.x;
                        const dy = rest * rest * from.y + 2 * rest * along * ctrl.y + along * along * to.y;
                        ctx.fillStyle = leg.dir > 0 ? pal.needs : pal.running;
                        ctx.beginPath();
                        ctx.arc(dx, dy, 3, 0, R.TAU);
                        ctx.fill();
                        ctx.fillStyle = R.rgba(leg.dir > 0 ? pal.needs : pal.running, 0.18);
                        ctx.beginPath();
                        ctx.arc(dx, dy, 7, 0, R.TAU);
                        ctx.fill();
                    }
                }
            }
        };

        return {
            draw(time) {
                const t = R.mod(time, CYCLE);
                env.clear();
                const pointer = env.pointer;
                const ox = pointer.nx * pointer.active * 7;
                const oy = pointer.ny * pointer.active * 5;
                // The laptop only lights up when the answer lands there; the rest of the time the phone has the stage.
                let lit = 0.25;
                for (const flow of FLOWS) {
                    lit = Math.max(lit, 0.6 * ease.inOutSine(phase(t, flow.start - 0.2, 0.3)) * (1 - ease.inOutSine(phase(t, flow.start + 0.5, 0.5))));
                    lit = Math.max(lit, ease.inOutSine(phase(t, flow.start + BEAT.resume - 0.2, 0.4)) * (1 - ease.inOutSine(phase(t, flow.start + BEAT.resume + 2.2, 0.8))));
                }
                ctx = laptopLayer.ctx;
                ctx.clearRect(0, 0, W, H);
                drawLaptop(t, { lit, text: 1 }, -ox * 0.5, -oy * 0.5);
                ctx = env.ctx;
                ctx.globalAlpha = 0.5 + 0.5 * lit;
                ctx.drawImage(laptopLayer.canvas, 0, 0, W, H);
                ctx.globalAlpha = 1;
                drawSync(t, ox, oy);
                drawPhone(t, ox, oy);
                env.fadeEdges(0.76, 1.04);
            }
        };
    }
});
