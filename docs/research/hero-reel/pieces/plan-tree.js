Reel.add({
    id: 'plan-tree',
    title: 'The Plan',
    line: 'Open the agent\'s plan beside the chat and follow it step by step.',
    principles: ['Timing', 'Follow through and overlapping action'],
    tech: 'Canvas 2D, checklist tree',
    hint: 'Move over the plan to look along its steps',
    poster: 7.4,
    create(env) {
        const R = env.R;
        const ctx = env.ctx;
        const pal = R.pal;
        const TAU = R.TAU;
        const GROUND = '#0d0d10';
        // Colors the client mixes in CSS (`color-mix`), mixed once here and kept as hex so they can be mixed again.
        const hexMix = (from, to, amount) => {
            const x = R.hexToRgb(from);
            const y = R.hexToRgb(to);
            return '#' + x.map((channel, i) => Math.round(R.lerp(channel, y[i], amount)).toString(16).padStart(2, '0')).join('');
        };
        const EDGE_CONTEXT = hexMix(pal.accent, GROUND, 0.45);
        const EDGE_LINE = hexMix(pal.text, GROUND, 0.87);
        const ACTIVE = '#28282e';
        const ACCENT_SOFT = hexMix(pal.accent, pal.surface, 0.84);

        /* The app's own kit, drawn the way apps/site/src/components/app draws it, at canvas scale. */
        const CLAUDE = new Path2D(
            'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
        );
        const widths = new Map();
        const sans = (size, weight = 400) => {
            ctx.font = weight + ' ' + size + 'px ' + R.fonts.sans;
        };
        const mono = (size, weight = 400) => {
            ctx.font = weight + ' ' + size + 'px ' + R.fonts.mono;
        };
        // Widths are cached only once the fonts are in, so a fallback face never sticks.
        const measure = (text) => {
            const key = ctx.font + '|' + text;
            let width = widths.get(key);
            if (width === undefined) {
                width = ctx.measureText(text).width;
                if (!document.fonts || document.fonts.status === 'loaded') {
                    widths.set(key, width);
                }
            }
            return width;
        };
        const claudeMark = (x, y, size, color) => {
            ctx.save();
            ctx.translate(x - size / 2, y - size / 2);
            ctx.scale(size / 24, size / 24);
            ctx.fillStyle = color;
            ctx.fill(CLAUDE);
            ctx.restore();
        };
        const disc = (x, y, radius, color) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, TAU);
            ctx.fillStyle = color;
            ctx.fill();
        };
        const ring = (x, y, radius, color, width) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, TAU);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();
        };
        // `.status-pulse`: 2s, down to half opacity and back.
        const statusPulse = (t) => 0.75 + 0.25 * Math.cos((t * TAU) / 2);
        // `.shine`: a light band crosses the muted words of whatever is working.
        const shine = (text, x, y, t, alpha = 1) => {
            const width = measure(text);
            const band = Math.max(18, width * 0.35);
            const center = x - band + R.fract(t / 1.5) * (width + band * 2);
            const gradient = ctx.createLinearGradient(center - band, 0, center + band, 0);
            gradient.addColorStop(0, R.rgba(pal.muted, alpha));
            gradient.addColorStop(0.5, R.rgba(pal.text, alpha));
            gradient.addColorStop(1, R.rgba(pal.muted, alpha));
            ctx.fillStyle = gradient;
            ctx.fillText(text, x, y);
            return width;
        };
        // Lucide `circle-check`: the ring draws, then the tick, as `progress` runs 0..1.
        const circleCheck = (x, y, size, color, progress, lineWidth = 1.5) => {
            const unit = size / 24;
            const around = R.clamp(progress / 0.55);
            const tick = R.clamp((progress - 0.45) / 0.55);
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = color;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (around > 0) {
                ctx.beginPath();
                ctx.arc(x, y, 10 * unit, -Math.PI / 2, -Math.PI / 2 + TAU * around);
                ctx.stroke();
            }
            if (tick > 0) {
                // m9 12 2 2 4-4: a short leg of 2.83 and a long one of 5.66, drawn as one stroke.
                const first = 2.83 / 8.49;
                ctx.beginPath();
                ctx.moveTo(x - 3 * unit, y);
                if (tick < first) {
                    const frac = tick / first;
                    ctx.lineTo(x + (-3 + 2 * frac) * unit, y + 2 * frac * unit);
                } else {
                    const frac = (tick - first) / (1 - first);
                    ctx.lineTo(x - 1 * unit, y + 2 * unit);
                    ctx.lineTo(x + (-1 + 4 * frac) * unit, y + (2 - 4 * frac) * unit);
                }
                ctx.stroke();
            }
        };
        const shadowOn = (lift = 0) => {
            ctx.shadowColor = 'rgba(0,0,0,' + (0.42 + lift * 0.04) + ')';
            ctx.shadowBlur = 14 + lift * 2.5;
            ctx.shadowOffsetY = 4 + lift * 1.2;
        };
        const shadowOff = () => {
            ctx.shadowColor = 'rgba(0,0,0,0)';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
        };
        /* `CanvasNode`: a surface card with a raised header strip, a hairline under it and a hairline border. */
        const nodeFrame = (x, y, wide, tall, header, lift = 0, border = 0.1) => {
            shadowOn(lift);
            R.roundRect(ctx, x, y, wide, tall, 9);
            ctx.fillStyle = pal.surface;
            ctx.fill();
            shadowOff();
            ctx.save();
            R.roundRect(ctx, x, y, wide, tall, 9);
            ctx.clip();
            ctx.fillStyle = pal.raised;
            ctx.fillRect(x, y, wide, header);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + header - 0.5, wide, 1);
            ctx.restore();
            R.roundRect(ctx, x + 0.5, y + 0.5, wide - 1, tall - 1, 8.5);
            ctx.strokeStyle = 'rgba(255,255,255,' + border + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
        };
        const nodeTitle = (x, y, header, title, size = 12, color = pal.text) => {
            claudeMark(x + 13, y + header / 2, 11, pal.muted);
            sans(size, 500);
            ctx.fillStyle = color;
            ctx.textBaseline = 'middle';
            ctx.fillText(title, x + 25, y + header / 2 + 0.5);
            ctx.textBaseline = 'alphabetic';
        };
        /* The canvas ground: a neutral dot every 24 units, never tinted. */
        const grid = (offsetX, offsetY, alpha = 0.075) => {
            const pitch = 24;
            const startX = R.mod(offsetX, pitch) - pitch;
            const startY = R.mod(offsetY, pitch) - pitch;
            ctx.beginPath();
            for (let y = startY; y < env.H + pitch; y += pitch) {
                for (let x = startX; x < env.W + pitch; x += pitch) {
                    ctx.rect(x - 0.6, y - 0.6, 1.2, 1.2);
                }
            }
            ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
            ctx.fill();
        };
        /* A connector route as polyline samples, so a pulse or a card can ride it by arc length. */
        const makeRoute = () => ({ xs: new Float32Array(64), ys: new Float32Array(64), ls: new Float32Array(64), n: 0, length: 0 });
        const routePush = (route, x, y) => {
            const i = route.n;
            route.xs[i] = x;
            route.ys[i] = y;
            route.ls[i] = i === 0 ? 0 : route.ls[i - 1] + Math.hypot(x - route.xs[i - 1], y - route.ys[i - 1]);
            route.n = i + 1;
            route.length = route.ls[i];
        };
        // Out of the bottom of one node, a rail midway, into the top of the other; every corner rounded.
        const routeDown = (route, ax, ay, bx, by, corner = 12) => {
            route.n = 0;
            routePush(route, ax, ay);
            const mid = (ay + by) / 2;
            const dx = bx - ax;
            if (Math.abs(dx) < 0.5) {
                routePush(route, bx, by);
                return route;
            }
            const rad = Math.min(corner, Math.abs(dx) / 2, (by - ay) / 4);
            const sx = Math.sign(dx);
            const corners = [
                [ax, mid - rad, ax, mid, ax + sx * rad, mid],
                [bx - sx * rad, mid, bx, mid, bx, mid + rad]
            ];
            for (const [x0, y0, cx, cy, x1, y1] of corners) {
                routePush(route, x0, y0);
                for (let k = 1; k <= 8; k++) {
                    const frac = k / 8;
                    const inv = 1 - frac;
                    routePush(route, inv * inv * x0 + 2 * inv * frac * cx + frac * frac * x1, inv * inv * y0 + 2 * inv * frac * cy + frac * frac * y1);
                }
            }
            routePush(route, bx, by);
            return route;
        };
        // The same, sideways: out of the right side of one node into the left side of the other.
        const routeAcross = (route, ax, ay, bx, by, corner = 12) => {
            route.n = 0;
            routePush(route, ax, ay);
            const mid = (ax + bx) / 2;
            const dy = by - ay;
            if (Math.abs(dy) < 0.5) {
                routePush(route, bx, by);
                return route;
            }
            const rad = Math.min(corner, Math.abs(dy) / 2, (bx - ax) / 4);
            const sy = Math.sign(dy);
            const corners = [
                [mid - rad, ay, mid, ay, mid, ay + sy * rad],
                [mid, by - sy * rad, mid, by, mid + rad, by]
            ];
            for (const [x0, y0, cx, cy, x1, y1] of corners) {
                routePush(route, x0, y0);
                for (let k = 1; k <= 8; k++) {
                    const frac = k / 8;
                    const inv = 1 - frac;
                    routePush(route, inv * inv * x0 + 2 * inv * frac * cx + frac * frac * x1, inv * inv * y0 + 2 * inv * frac * cy + frac * frac * y1);
                }
            }
            routePush(route, bx, by);
            return route;
        };
        const at = { x: 0, y: 0, ax: 0, ay: 1 };
        const routeAt = (route, pos) => {
            pos = R.clamp(pos, 0, route.length);
            let i = 1;
            while (i < route.n - 1 && route.ls[i] < pos) {
                i++;
            }
            const l0 = route.ls[i - 1];
            const span = route.ls[i] - l0 || 1;
            const frac = (pos - l0) / span;
            const dx = route.xs[i] - route.xs[i - 1];
            const dy = route.ys[i] - route.ys[i - 1];
            at.x = route.xs[i - 1] + dx * frac;
            at.y = route.ys[i - 1] + dy * frac;
            const len = Math.hypot(dx, dy) || 1;
            at.ax = dx / len;
            at.ay = dy / len;
            return at;
        };
        // Strokes the stretch of a route between two arc lengths.
        const strokeRoute = (route, s0, s1) => {
            if (s1 <= s0) {
                return;
            }
            ctx.beginPath();
            routeAt(route, s0);
            ctx.moveTo(at.x, at.y);
            for (let i = 1; i < route.n; i++) {
                if (route.ls[i] > s0 && route.ls[i] < s1) {
                    ctx.lineTo(route.xs[i], route.ys[i]);
                }
            }
            routeAt(route, s1);
            ctx.lineTo(at.x, at.y);
            ctx.stroke();
        };
        // The marker at a connector's head: a ring filled with the ground, so the line seems to end in a socket.
        const headDot = (x, y, color, alpha = 1) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.beginPath();
            ctx.arc(x, y, 3.4, 0, TAU);
            ctx.fillStyle = GROUND;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = color;
            ctx.stroke();
            ctx.restore();
        };
        // A spring's step response, for lifts and settles that have to stay a pure function of time.
        const springStep = (elapsed, omega = 16, zeta = 0.5) => {
            if (elapsed <= 0) {
                return 0;
            }
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * elapsed) * (Math.cos(wd * elapsed) + ((zeta * omega) / wd) * Math.sin(wd * elapsed));
        };
        const CYCLE = 17.5;
        const OUT = 16.2;
        const PX = 200;
        const PY = 108;
        const PW = 266;
        // Taller than the box, so the panel runs on past the fade the way a docked panel runs to the window's foot.
        const PH = 372;
        const CHAT = { x: 86, y: 76, wide: 200, tall: 280 };
        const STEP_H = 26;
        const SUB_H = 23;

        const ROWS = [
            { label: 'Preserve the cart', level: 0, done: 3.6, expand: 0.9, collapse: 3.85 },
            { label: 'Read cart.ts', level: 1, parent: 0, done: 2.3 },
            { label: 'Store cart in session', level: 1, parent: 0, done: 3.4 },
            { label: 'Restore the session', level: 0, done: 9.25, expand: 3.95, collapse: 9.5 },
            { label: 'Load on sign-in', level: 1, parent: 3, done: 5.1 },
            { label: 'Keep the old API route', level: 1, parent: 3, done: 8.0, insert: 6.7 },
            { label: 'Merge guest cart', level: 1, parent: 3, done: 9.05 },
            { label: 'Add a regression test', level: 0, done: 10.85, expand: 9.6, collapse: 11.1 },
            { label: 'Guest to user flow', level: 1, parent: 7, done: 10.65 },
            { label: 'Run checkout tests', level: 0, done: 12.3 }
        ];
        const STEPS = ROWS.filter((row) => row.level === 0);
        // What the agent works on, and from when; the marker glides from one to the next.
        const WORK = [
            [1, 1.1],
            [2, 2.3],
            [4, 4.05],
            [6, 5.1],
            [5, 6.95],
            [6, 8.0],
            [8, 9.7],
            [9, 11.1],
            [-1, 12.3]
        ];
        const NOTE_IN = 5.4;
        const NOTE_FOLD = 9.45;
        ROWS.forEach((row, i) => {
            row.stepIndex = row.level === 0 ? STEPS.indexOf(row) : -1;
            if (row.level === 1) {
                const siblings = ROWS.filter((other) => other.parent === row.parent);
                row.k = siblings.indexOf(row);
                row.n = siblings.length;
            }
            row.index = i;
        });

        const heights = new Float32Array(ROWS.length);
        const ys = new Float32Array(ROWS.length);
        const rowY = new Float32Array(ROWS.length);
        const rowH = new Float32Array(ROWS.length);
        let hoverY = -1;
        let hoverA = 0;

        // How open a row is at `u`: steps build in and out with the cycle; sub-steps open with their step and fold back into it.
        const openness = (row, local) => {
            if (row.level === 0) {
                const build = R.ease.outCubic((local - 0.15 - row.stepIndex * 0.09) / 0.45);
                const out = R.ease.inOutCubic((local - OUT - row.stepIndex * 0.07) / 0.4);
                return build * (1 - out);
            }
            const parent = ROWS[row.parent];
            const start = row.insert !== undefined ? row.insert : parent.expand + row.k * 0.08;
            const grow = springStep(local - start, 13, 0.62);
            const fold = R.ease.inOutCubic((local - parent.collapse - (row.n - 1 - row.k) * 0.07) / 0.42);
            return Math.max(0, grow * (1 - fold));
        };

        const ROW_TOP = PY + 30 + 78 + 30;
        const layout = (local) => {
            let y = ROW_TOP;
            for (let i = 0; i < ROWS.length; i++) {
                const row = ROWS[i];
                heights[i] = openness(row, local);
                ys[i] = y;
                y += heights[i] * (row.level === 0 ? STEP_H : SUB_H);
            }
        };

        // Rows further down follow a little later, so a change runs down the list instead of moving it as one block.
        const place = (local) => {
            for (let i = 0; i < ROWS.length; i++) {
                layout(local - i * 0.028);
                rowY[i] = ys[i];
                rowH[i] = heights[i];
            }
        };

        const activeAt = (local) => {
            let current = -1;
            let previous = -1;
            let since = 99;
            for (const [row, start] of WORK) {
                if (local >= start) {
                    previous = current;
                    current = row;
                    since = local - start;
                }
            }
            return { current, previous, since };
        };

        const doneSteps = (local) => {
            let value = 0;
            for (const step of STEPS) {
                value += R.ease.outCubic((local - step.done) / 0.5);
            }
            return value * (1 - R.ease.inOutCubic((local - OUT - 0.2) / 0.6));
        };

        const loader = (x, y, radius, t, color) => {
            const spin = t * TAU * 1.1;
            ctx.beginPath();
            ctx.arc(x, y, radius, spin, spin + TAU * 0.72);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();
        };

        const checkCheck = (x, y, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x - 7, y);
            ctx.lineTo(x - 4, y + 3);
            ctx.lineTo(x + 2, y - 3.5);
            ctx.moveTo(x - 1, y + 2);
            ctx.lineTo(x, y + 3);
            ctx.lineTo(x + 6.5, y - 3.5);
            ctx.stroke();
        };

        const drawChat = (local, t, ox, oy) => {
            const x = CHAT.x + ox;
            const y = CHAT.y + oy;
            nodeFrame(x, y, CHAT.wide, CHAT.tall, 26, 0, 0.08);
            nodeTitle(x, y, 26, 'Fix checkout', 12);
            const finished = local >= 12.3 && local < OUT + 0.4;
            ctx.globalAlpha = finished ? 1 : statusPulse(t);
            disc(x + CHAT.wide - 13, y + 13, 3.3, finished ? pal.idle : pal.running);
            ctx.globalAlpha = 1;
            sans(12, 400);
            // Only the left of the chat shows past the plan, so its rows are the ones that read from the left.
            ctx.fillStyle = pal.muted;
            ctx.fillText('Plan', x + 12, y + 50);
            mono(11, 400);
            ctx.fillStyle = pal.faint;
            ctx.fillText('4 steps', x + 44, y + 50);
            const { current } = activeAt(local);
            sans(12, 400);
            const lines = ['Updated', 'Edited', 'Read'];
            const files = ['cart.ts', 'session.ts', 'api.ts'];
            for (let k = 0; k < 3; k++) {
                const amt = R.clamp((local - 2.3 - k * 2.6) / 0.4) * (1 - R.clamp((local - OUT) / 0.5));
                if (amt <= 0) {
                    continue;
                }
                ctx.globalAlpha = amt * 0.9;
                ctx.fillStyle = pal.muted;
                ctx.fillText(lines[k], x + 12, y + 76 + k * 22);
                const wide = measure(lines[k]);
                mono(11, 400);
                ctx.fillStyle = pal.faint;
                ctx.fillText(files[k], x + 18 + wide, y + 76 + k * 22);
                sans(12, 400);
            }
            ctx.globalAlpha = 1;
            const label = current >= 0 ? ROWS[current].label : finished ? 'All steps done' : 'Planning';
            const amt = current >= 0 || !finished ? 1 : 1;
            ctx.globalAlpha = amt;
            if (finished) {
                ctx.fillStyle = pal.text;
                ctx.fillText(label, x + 12, y + 150);
            } else {
                shine(label, x + 12, y + 150, t);
            }
            ctx.globalAlpha = 1;
        };

        const drawNote = (local, t, anchorX, anchorY, restX, restY) => {
            if (local < NOTE_IN) {
                return;
            }
            const arrive = R.clamp((local - NOTE_IN) / 0.55);
            const e = R.ease.outCubic(arrive);
            const fold = R.ease.inOutCubic((local - NOTE_FOLD) / 0.5);
            const out = 1 - R.clamp((local - OUT) / 0.4);
            // In on a short arc from the upper right; once pinned it swings a little and comes to rest.
            const x = R.lerp(anchorX + 60, anchorX, e);
            const y = R.lerp(anchorY - 46, anchorY, e) - Math.sin(e * Math.PI) * 10;
            const since = local - NOTE_IN - 0.55;
            const swing = since > 0 ? -0.05 * Math.exp(-since * 4.5) * Math.cos(since * 13) : -0.12 * (1 - e);
            ctx.save();
            ctx.globalAlpha = R.clamp(arrive * 3) * out;
            ctx.translate(x, y);
            ctx.rotate(swing - 0.02 * (1 - fold));
            const scale = R.lerp(1, 0.18, fold);
            ctx.scale(scale, scale);
            if (fold < 0.98) {
                ctx.globalAlpha *= 1 - fold;
                shadowOn(2);
                R.roundRect(ctx, -6, -6, 118, 40, 7);
                ctx.fillStyle = pal.note;
                ctx.fill();
                shadowOff();
                R.roundRect(ctx, -5.5, -5.5, 117, 39, 6.5);
                ctx.strokeStyle = R.rgba(pal.needs, 0.28);
                ctx.lineWidth = 1;
                ctx.stroke();
                sans(11.5, 500);
                ctx.fillStyle = pal.text;
                ctx.fillText('Keep the old API', 10, 8);
                sans(11.5, 400);
                ctx.fillStyle = R.mix(pal.text, pal.needs, 0.35);
                ctx.fillText('for now', 10, 23);
                ctx.globalAlpha = R.clamp(arrive * 3) * out;
            }
            ctx.restore();
            // The pin itself, which is what remains once the step that answered it is done.
            const pinX = R.lerp(x - 4, restX, fold);
            const pinY = R.lerp(y - 4, restY, fold);
            const press = since > 0 ? 1 + 0.35 * Math.exp(-since * 9) * Math.cos(since * 20) : 1;
            ctx.globalAlpha = R.clamp(arrive * 3) * out;
            disc(pinX, pinY, 3.6 * press, pal.needs);
            disc(pinX - 1, pinY - 1, 1.1, '#fff4d0');
            ctx.globalAlpha = 1;
        };

        return {
            update(t, dt) {
                const pointer = env.pointer;
                const inside = pointer.x > PX && pointer.x < PX + PW && pointer.y > ROW_TOP - 4 && pointer.y < PY + PH;
                const smoothing = 1 - Math.exp(-dt * 12);
                hoverA += ((inside ? pointer.active : 0) - hoverA) * smoothing;
                if (inside) {
                    hoverY = pointer.y;
                }
            },
            draw(t) {
                env.clear();
                const local = R.mod(t, CYCLE);
                const pointer = env.pointer;
                const ox = pointer.nx * 7 * pointer.active;
                const oy = pointer.ny * 5 * pointer.active;
                grid(ox * 0.3, oy * 0.3);

                // Two depths: the chat behind moves less than the plan in front of it.
                drawChat(local, t, ox * 0.45, oy * 0.45);
                ctx.save();
                ctx.translate(ox, oy);

                /* The panel. */
                shadowOn(4);
                R.roundRect(ctx, PX, PY, PW, PH, 10);
                ctx.fillStyle = pal.surface;
                ctx.fill();
                shadowOff();
                R.roundRect(ctx, PX + 0.5, PY + 0.5, PW - 1, PH - 1, 9.5);
                ctx.strokeStyle = 'rgba(255,255,255,0.13)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,0.07)';
                ctx.fillRect(PX, PY + 30, PW, 1);
                ctx.fillRect(PX, PY + 30 + 78, PW, 1);
                sans(12, 500);
                ctx.fillStyle = pal.muted;
                ctx.fillText('Fix checkout', PX + 12, PY + 19);
                for (let k = 0; k < 3; k++) {
                    disc(PX + PW - 42 + k * 4, PY + 15, 1.1, pal.muted);
                }
                ctx.strokeStyle = pal.muted;
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.moveTo(PX + PW - 20, PY + 11);
                ctx.lineTo(PX + PW - 12, PY + 19);
                ctx.moveTo(PX + PW - 12, PY + 11);
                ctx.lineTo(PX + PW - 20, PY + 19);
                ctx.stroke();

                const done = doneSteps(local);
                const whole = Math.round(done);
                checkCheck(PX + 20, PY + 50, pal.muted);
                sans(14, 500);
                ctx.fillStyle = pal.text;
                ctx.fillText('Reliable checkout', PX + 33, PY + 55);
                sans(12, 400);
                ctx.fillStyle = pal.muted;
                ctx.fillText('Keep the cart through sign-in.', PX + 13, PY + 74);
                ctx.fillText('Plan', PX + 13, PY + 92);
                ctx.fillText(whole + '/4 done', PX + 44, PY + 92);
                R.roundRect(ctx, PX + 110, PY + 87, PW - 124, 5, 2.5);
                ctx.fillStyle = pal.sunken;
                ctx.fill();
                if (done > 0.01) {
                    R.roundRect(ctx, PX + 110, PY + 87, (PW - 124) * (done / 4), 5, 2.5);
                    ctx.fillStyle = pal.idle;
                    ctx.fill();
                }

                sans(13, 500);
                ctx.fillStyle = pal.text;
                ctx.fillText('Implementation', PX + 28, PY + 128);
                ctx.strokeStyle = pal.faint;
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(PX + 12, PY + 122);
                ctx.lineTo(PX + 16, PY + 126);
                ctx.lineTo(PX + 20, PY + 122);
                ctx.stroke();
                sans(12, 400);
                ctx.fillStyle = pal.muted;
                const count = whole + '/4';
                ctx.fillText(count, PX + PW - 14 - measure(count), PY + 128);

                /* The rows. */
                place(local);
                ctx.save();
                R.roundRect(ctx, PX, ROW_TOP - 4, PW, PY + PH - ROW_TOP, 10);
                ctx.clip();

                if (hoverA > 0.01) {
                    for (let i = 0; i < ROWS.length; i++) {
                        const tall = (ROWS[i].level === 0 ? STEP_H : SUB_H) * rowH[i];
                        if (hoverY >= rowY[i] && hoverY < rowY[i] + tall && rowH[i] > 0.5) {
                            R.roundRect(ctx, PX + 5, rowY[i], PW - 10, tall, 6);
                            ctx.fillStyle = R.rgba('#ffffff', 0.035 * hoverA);
                            ctx.fill();
                        }
                    }
                }

                // The marker glides between rows, easing out of one and settling into the next.
                const active = activeAt(local);
                if (active.current >= 0 || active.since < 0.5) {
                    const target = active.current >= 0 ? active.current : active.previous;
                    const from = active.previous >= 0 ? active.previous : target;
                    const e = R.ease.inOutCubic(active.since / 0.45);
                    const heightOf = (i) => (ROWS[i].level === 0 ? STEP_H : SUB_H);
                    const y = R.lerp(rowY[from], rowY[target], e);
                    const tall = R.lerp(heightOf(from), heightOf(target), e);
                    const fadeIn = active.previous < 0 ? R.clamp(active.since / 0.3) : 1;
                    const fadeOut = active.current < 0 ? 1 - R.clamp(active.since / 0.4) : 1;
                    const amt = fadeIn * fadeOut;
                    R.roundRect(ctx, PX + 5, y, PW - 10, tall, 6);
                    ctx.fillStyle = R.rgba(ACCENT_SOFT, amt);
                    ctx.fill();
                    const glow = ctx.createLinearGradient(PX + 5, 0, PX + 70, 0);
                    glow.addColorStop(0, R.rgba(pal.accent, 0.22 * amt));
                    glow.addColorStop(1, R.rgba(pal.accent, 0));
                    R.roundRect(ctx, PX + 5, y, PW - 10, tall, 6);
                    ctx.fillStyle = glow;
                    ctx.fill();
                    R.roundRect(ctx, PX + 5, y + 5, 2.5, tall - 10, 1.25);
                    ctx.fillStyle = R.rgba(pal.running, amt);
                    ctx.fill();
                }

                // Guides under an open step, so its sub-steps read as its own.
                for (let i = 0; i < ROWS.length; i++) {
                    const row = ROWS[i];
                    if (row.level !== 1 || row.k !== row.n - 1 || rowH[i] < 0.05) {
                        continue;
                    }
                    const top = rowY[row.parent] + STEP_H - 3;
                    const bottom = rowY[i] + SUB_H * rowH[i] - 6;
                    if (bottom > top) {
                        ctx.fillStyle = 'rgba(255,255,255,0.08)';
                        ctx.fillRect(PX + 29.5, top, 1, bottom - top);
                    }
                }

                for (let i = 0; i < ROWS.length; i++) {
                    const row = ROWS[i];
                    const open = rowH[i];
                    if (open < 0.02) {
                        continue;
                    }
                    const step = row.level === 0;
                    const tall = step ? STEP_H : SUB_H;
                    const y = rowY[i];
                    const mid = y + tall / 2;
                    const iconX = step ? PX + 30 : PX + 46;
                    const textX = step ? PX + 44 : PX + 57;
                    // Folding rows fade faster than they shrink, so they vanish into the step instead of piling onto it.
                    ctx.globalAlpha = step ? open : open * open;
                    const isActive = activeAt(local).current === i;
                    const finished = local >= row.done;
                    const radius = step ? 6 : 5;
                    if (finished) {
                        const since = local - row.done;
                        const pop = 1 + 0.28 * Math.sin(R.clamp(since / 0.32) * Math.PI) * (since < 0.32 ? 1 : 0);
                        ctx.save();
                        ctx.translate(iconX, mid);
                        ctx.scale(pop, pop);
                        circleCheck(0, 0, radius * 2.4, pal.idle, R.clamp(since / 0.38), 1.5);
                        ctx.restore();
                    } else if (isActive) {
                        loader(iconX, mid, radius - 0.5, t, pal.running);
                    } else {
                        ring(iconX, mid, radius - 0.5, pal.faint, 1.3);
                    }
                    sans(step ? 13 : 12, step ? 500 : 400);
                    const textIn = row.insert !== undefined ? R.clamp((local - row.insert - 0.15) / 0.4) : 1;
                    ctx.globalAlpha *= textIn;
                    ctx.fillStyle = finished ? pal.muted : step ? pal.text : R.mix(pal.text, pal.muted, 0.3);
                    ctx.fillText(row.label, textX + (1 - textIn) * 6, mid + 4.5);
                    if (step && row.expand !== undefined && local > row.expand && local < row.collapse + 0.3) {
                        const subs = ROWS.filter((other) => other.parent === i && (other.insert === undefined || local >= other.insert));
                        const checked = subs.filter((other) => local >= other.done).length;
                        const label = checked + '/' + subs.length;
                        sans(12, 400);
                        ctx.fillStyle = pal.faint;
                        ctx.globalAlpha = open * R.clamp((local - row.expand) / 0.3) * (1 - R.clamp((local - row.collapse) / 0.3));
                        ctx.fillText(label, PX + PW - 14 - measure(label), mid + 4.5);
                    }
                    ctx.globalAlpha = 1;
                }
                ctx.restore();

                sans(13, 500);
                drawNote(local, t, PX + PW - 94, rowY[3] + 10, PX + 44 + measure(ROWS[3].label) + 10, rowY[3] + STEP_H / 2);
                ctx.restore();
                env.fadeEdges(0.72, 1.0);
            }
        };
    }
});
