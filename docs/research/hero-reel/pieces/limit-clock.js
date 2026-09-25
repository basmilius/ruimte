Reel.add({
    id: 'limit-clock',
    title: 'Resume at Reset',
    line: 'When an agent hits its limit, it waits for the reset and picks up where it stopped.',
    principles: ['Timing', 'Anticipation'],
    tech: 'Canvas 2D, clock and status choreography',
    hint: 'Move around the clock to lift its marks',
    poster: 8.2,
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
        const LIMIT = 3.0;
        const DOT_OUT = 3.4;
        const DOT_IN = 3.95;
        const SWITCH = 4.55;
        const LAPSE = 5.0;
        const LAPSE_END = 10.5;
        // The last three marks come slower and slower, then the ring closes.
        const LAST_TICKS = [10.85, 11.25, 11.7];
        const CLICK = 12.15;
        const HOME = 12.45;
        const RESUME = 12.6;
        const DONE = 13.6;
        const DEPART = DONE + 0.25;
        const LAND = DEPART + 0.8;
        const WAKE = LAND + 0.3;
        const RESET = 16.5;
        const MARKS = 48;
        const START_MIN = 18 * 60 + 37;
        const END_MIN = 21 * 60;

        const PARENT = { x: 184, y: 70, wide: 192, tall: 58 };
        const CHILD = { x: 128, y: 166, wide: 304, tall: 238 };
        const HEADER = 26;
        const CLOCK_R = 33;
        const route = makeRoute();
        const markLift = new Float32Array(MARKS);
        let pointerAngle = 0;
        let pointerNear = 0;

        const ts = (text, x, y, color) => {
            ctx.fillStyle = color;
            ctx.fillText(text, x, y);
        };
        const clockText = (minutes) => {
            const hours = Math.floor(minutes / 60);
            const mins = Math.round(minutes - hours * 60);
            return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
        };

        // Marks passed on the ring, as a stepped value: each mark holds, then jumps on a quick ease.
        const marksAt = (local) => {
            if (local < LAPSE) {
                return 0;
            }
            const main = MARKS - LAST_TICKS.length;
            if (local < LAPSE_END + 0.2) {
                const prog = R.ease.inOutSine((local - LAPSE) / (LAPSE_END - LAPSE)) * main;
                const whole = Math.floor(prog);
                return Math.min(main, whole + R.ease.outCubic((prog - whole - 0.62) / 0.38));
            }
            let value = main;
            for (const tick of LAST_TICKS) {
                value += R.ease.outBack((local - tick) / 0.16, 2.2);
            }
            // Anticipation: before the last mark the hand draws back a hair, then snaps shut.
            const wind = R.clamp((local - (LAST_TICKS[2] + 0.1)) / 0.3);
            value -= Math.sin(wind * Math.PI * 0.5) * 0.45 * (local < CLICK ? 1 : 0);
            if (local >= CLICK) {
                value = MARKS;
            }
            return Math.min(value, MARKS);
        };

        const clockOpen = (local) => R.ease.outCubic((local - DOT_OUT) / 0.55) * (1 - R.ease.inOutCubic((local - HOME - 0.1) / 0.5));
        const inReset = (local) => R.smoothstep(RESET, RESET + 0.6, local);

        const statusPill = (x, y, label, dotColor, dotAlpha, hollow) => {
            sans(11.5, 400);
            const wide = measure(label) + 26;
            const px = x - wide;
            R.roundRect(ctx, px, y - 9, wide, 18, 9);
            ctx.fillStyle = pal.sunken;
            ctx.fill();
            if (hollow) {
                ctx.globalAlpha = 0.9;
                ring(px + 10, y, 2.8, pal.faint, 1);
            } else {
                ctx.globalAlpha = dotAlpha;
                disc(px + 10, y, 3.2, dotColor);
            }
            ctx.globalAlpha = 1;
            ts(label, px + 18, y + 4, pal.muted);
            return px + 10;
        };

        const toolRow = (x, y, verb, detail, alpha) => {
            ctx.globalAlpha = alpha;
            sans(12, 400);
            ts(verb, x, y, pal.muted);
            const wide = measure(verb);
            mono(11, 400);
            ts(detail, x + wide + 7, y, pal.faint);
            ctx.globalAlpha = 1;
        };

        return {
            update(t, dt) {
                const pointer = env.pointer;
                const cx = CHILD.x + 66;
                const cy = CHILD.y + 146;
                pointerAngle = Math.atan2(pointer.y - cy, pointer.x - cx);
                const howFar = Math.hypot(pointer.x - cx, pointer.y - cy);
                const near = pointer.active * (1 - R.smoothstep(40, 140, howFar));
                pointerNear += (near - pointerNear) * (1 - Math.exp(-dt * 8));
                for (let i = 0; i < MARKS; i++) {
                    const angle = -Math.PI / 2 + (i / MARKS) * TAU;
                    let diff = Math.abs(R.mod(angle - pointerAngle + Math.PI, TAU) - Math.PI);
                    const target = pointerNear * Math.max(0, 1 - diff / 0.7);
                    markLift[i] += (target - markLift[i]) * (1 - Math.exp(-dt * 12));
                }
            },
            draw(t) {
                env.clear();
                const local = R.mod(t, CYCLE);
                const pointer = env.pointer;
                const ox = pointer.nx * 5 * pointer.active;
                const oy = pointer.ny * 4 * pointer.active;
                grid(ox * 0.5, oy * 0.5);
                ctx.save();
                ctx.translate(ox, oy);
                const reset = inReset(local);

                /* The parent sleeps through all of it and wakes only when the result lands. */
                const woke = local >= WAKE && reset < 1;
                const wakeLift = local >= WAKE ? springStep(local - WAKE, 15, 0.42) * (1 - reset) : 0;
                const knock = local > LAND && local < LAND + 0.4 ? -0.35 * Math.sin(((local - LAND) / 0.4) * Math.PI) : 0;
                const parentY = PARENT.y - (wakeLift + knock) * 4;

                const ax = PARENT.x + PARENT.wide / 2;
                routeDown(route, ax, parentY + PARENT.tall + 6, ax, CHILD.y - 6);
                const travel = R.ease.inOutCubic((local - DEPART) / 0.8);
                const reached = local >= DEPART && reset < 0.5 ? route.length * (1 - travel) : route.length;
                ctx.lineCap = 'round';
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = EDGE_CONTEXT;
                ctx.setLineDash([4, 4]);
                strokeRoute(route, 0, reached);
                ctx.setLineDash([]);
                strokeRoute(route, reached, route.length);
                headDot(ax, CHILD.y - 6, EDGE_CONTEXT);
                if (local >= DEPART && local < LAND + 0.05) {
                    for (let k = 8; k >= 1; k--) {
                        const back = routeAt(route, Math.min(route.length, reached + k * 2.2));
                        ctx.globalAlpha = (1 - k / 9) * 0.5;
                        disc(back.x, back.y, 2.5 * (1 - k / 11), pal.idle);
                    }
                    const head = routeAt(route, reached);
                    ctx.globalAlpha = 1;
                    disc(head.x, head.y, 3, '#d9fbe6');
                }
                if (local > LAND && local < LAND + 0.6) {
                    const frac = (local - LAND) / 0.6;
                    ctx.globalAlpha = (1 - frac) * 0.7;
                    ring(ax, parentY + PARENT.tall + 6, 3 + R.ease.outCubic(frac) * 14, pal.idle, 1.5);
                }
                ctx.globalAlpha = 1;

                nodeFrame(PARENT.x, parentY, PARENT.wide, PARENT.tall, 22, Math.max(0, wakeLift * 4), 0.1);
                ctx.globalAlpha = woke ? 1 : 0.7;
                nodeTitle(PARENT.x, parentY, 22, 'Prepare v2.4', 12, woke ? pal.text : pal.muted);
                ctx.globalAlpha = 1;
                sans(12, 400);
                if (woke) {
                    ctx.globalAlpha = R.clamp((local - WAKE) / 0.3) * (1 - reset);
                    shine('Reading result', PARENT.x + 10, parentY + 41, t);
                    ctx.globalAlpha = 1;
                    disc(PARENT.x + PARENT.wide - 12, parentY + 11, 3.3, pal.running);
                    const since = local - WAKE;
                    if (since < 0.55) {
                        ctx.globalAlpha = (1 - since / 0.55) * 0.6;
                        ring(PARENT.x + PARENT.wide - 12, parentY + 11, 3.3 + R.ease.outCubic(since / 0.55) * 9, pal.running, 1.2);
                    }
                } else {
                    ctx.globalAlpha = local < RESET ? 1 : R.clamp((local - RESET - 0.3) / 0.3);
                    ts('Waiting on 1 task', PARENT.x + 10, parentY + 41, pal.faint);
                    ctx.globalAlpha = 0.45 + 0.25 * Math.sin((t * TAU) / 3.2);
                    disc(PARENT.x + PARENT.wide - 12, parentY + 11, 3.3, pal.faint);
                }
                ctx.globalAlpha = 1;

                /* The child. */
                const x = CHILD.x;
                const y = CHILD.y;
                nodeFrame(x, y, CHILD.wide, CHILD.tall, HEADER, 2, 0.12);
                nodeTitle(x, y, HEADER, 'Write the changelog', 12.5);

                const paused = local >= LIMIT && local < RESUME;
                const finished = local >= DONE && reset < 0.5;
                const dotAway = local >= DOT_OUT && local < HOME;
                const pillLabel = finished ? 'Done' : paused ? 'Paused' : 'Running';
                const pillColor = finished ? pal.idle : paused ? pal.muted : pal.running;
                const pillAlpha = finished || paused ? 1 : statusPulse(t);
                // The dot swells before it lets go of the pill: the one beat of warning before the wait.
                const swell = 1 + 0.4 * Math.sin(R.clamp((local - LIMIT - 0.1) / 0.3) * Math.PI);
                ctx.save();
                const pillDotX = statusPill(x + CHILD.wide - 10, y + HEADER / 2, pillLabel, pillColor, pillAlpha, dotAway);
                ctx.restore();
                if (!dotAway && local >= LIMIT && local < DOT_OUT) {
                    disc(pillDotX, y + HEADER / 2, 3.2 * swell, pal.muted);
                }

                const bodyX = x + 14;
                toolRow(bodyX, y + 50, 'Read', 'git log v2.3..HEAD', 1);
                toolRow(bodyX, y + 72, 'Edited', 'CHANGELOG.md', 1);
                sans(12, 400);
                const lineY = y + 94;
                if (local < LIMIT || local >= RESET + 0.3) {
                    ctx.globalAlpha = local < LIMIT ? 1 - R.clamp((local - LIMIT + 0.2) / 0.2) : R.clamp((local - RESET - 0.3) / 0.35);
                    shine('Working', bodyX, lineY, t);
                } else if (local < RESUME) {
                    ctx.globalAlpha = R.clamp((local - LIMIT) / 0.3) * (1 - R.clamp((local - RESUME + 0.25) / 0.25));
                    ts('Usage limit reached.', bodyX, lineY, pal.text);
                } else if (local < DONE) {
                    ctx.globalAlpha = R.clamp((local - RESUME) / 0.3);
                    shine('Picking up where it stopped', bodyX, lineY, t);
                } else {
                    const amt = R.clamp((local - DONE) / 0.3) * (1 - R.clamp((local - RESET) / 0.3));
                    ctx.globalAlpha = amt;
                    circleCheck(bodyX + 5, lineY - 4, 11, pal.idle, R.clamp((local - DONE) / 0.4), 1.4);
                    ts('Task done, 14 entries', bodyX + 15, lineY, pal.idle);
                }
                ctx.globalAlpha = 1;

                /* The clock: it grows out of the status dot, and the wait is drawn as marks around it. */
                const open = clockOpen(local);
                const cx = x + 66;
                const cy = y + 146;
                if (open > 0.01) {
                    const marks = marksAt(local);
                    const clickSince = local - CLICK;
                    const pinch = local > LAST_TICKS[2] + 0.1 && local < CLICK ? Math.sin(R.clamp((local - LAST_TICKS[2] - 0.1) / 0.3) * Math.PI * 0.5) * 0.035 : 0;
                    const bounce = clickSince > 0 ? 0.05 * Math.exp(-clickSince * 7) * Math.sin(clickSince * 26) : 0;
                    const scale = (0.6 + 0.4 * open) * (1 - pinch + bounce);
                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.scale(scale, scale);
                    ctx.globalAlpha = open;
                    ring(0, 0, CLOCK_R + 6, 'rgba(255,255,255,0.05)', 1);
                    ctx.lineCap = 'round';
                    for (let i = 0; i < MARKS; i++) {
                        // Marks come in around the ring one after another, and leave the same way.
                        const appear = R.clamp((local - DOT_IN - (i / MARKS) * 0.5) / 0.2) * (1 - R.clamp((local - HOME - (i / MARKS) * 0.35) / 0.2));
                        if (appear <= 0) {
                            continue;
                        }
                        const angle = -Math.PI / 2 + (i / MARKS) * TAU;
                        const passed = marks - i;
                        const major = i % 12 === 0;
                        const justNow = passed > 0 && passed < 1.6 ? 1 - (passed - 0.3) / 1.3 : 0;
                        const out = markLift[i] * 5 + Math.max(0, justNow) * 1.5;
                        const inner = CLOCK_R - (major ? 6 : 3.5) + out;
                        const outer = CLOCK_R + out;
                        const lit = passed > 0 || local >= CLICK;
                        ctx.strokeStyle = lit ? R.mix(pal.muted, pal.text, Math.max(0, justNow)) : 'rgba(255,255,255,0.14)';
                        if (local >= CLICK && local < CLICK + 0.7) {
                            ctx.strokeStyle = R.mix(pal.running, pal.muted, R.clamp(clickSince / 0.7));
                        }
                        ctx.lineWidth = major ? 1.6 : 1.1;
                        ctx.globalAlpha = open * appear;
                        ctx.beginPath();
                        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
                        ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = open;
                    if (marks > 0) {
                        const end = -Math.PI / 2 + (marks / MARKS) * TAU;
                        ctx.beginPath();
                        ctx.arc(0, 0, CLOCK_R - 10, -Math.PI / 2, end);
                        ctx.strokeStyle = local >= CLICK ? R.mix(pal.running, pal.muted, R.clamp(clickSince / 1.2) * 0.5) : 'rgba(236,236,241,0.45)';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        if (local < CLICK) {
                            disc(Math.cos(end) * (CLOCK_R - 10), Math.sin(end) * (CLOCK_R - 10), 2.2, pal.text);
                        }
                    }
                    if (clickSince > 0 && clickSince < 0.7) {
                        ctx.globalAlpha = (1 - clickSince / 0.7) * 0.8;
                        ring(0, 0, CLOCK_R + R.ease.outCubic(clickSince / 0.7) * 16, pal.running, 1.5);
                    }
                    ctx.restore();

                    const textIn = R.clamp((local - DOT_IN - 0.1) / 0.35) * (1 - R.clamp((local - HOME) / 0.3));
                    const tx = x + 124;
                    ctx.globalAlpha = textIn;
                    const minutes = START_MIN + (Math.min(marks, MARKS) / MARKS) * (END_MIN - START_MIN);
                    mono(24, 500);
                    ts(clockText(local >= CLICK ? END_MIN : minutes), tx, cy - 4, local >= CLICK ? pal.text : R.mix(pal.text, pal.muted, 0.15));
                    mono(11.5, 400);
                    ts('resets 21:00', tx + 1, cy + 14, pal.muted);

                    /* Resume at reset: a person turns it on; without it the chat would stay paused. */
                    const sy = cy + 30;
                    const flip = R.clamp((local - SWITCH) / 0.3);
                    const on = R.ease.inOutCubic(flip);
                    R.roundRect(ctx, tx, sy, 26, 15, 7.5);
                    ctx.fillStyle = R.mix(ACTIVE, pal.accent, on);
                    ctx.fill();
                    const stretch = Math.sin(flip * Math.PI) * 4;
                    const pre = local > SWITCH - 0.15 && local < SWITCH ? -1.2 * Math.sin(((local - SWITCH + 0.15) / 0.15) * Math.PI) : 0;
                    const knobX = tx + 2 + on * 11 + pre - (on > 0.5 ? stretch : 0);
                    R.roundRect(ctx, knobX, sy + 2, 11 + stretch, 11, 5.5);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                    sans(12, 400);
                    ts('Resume at reset', tx + 34, sy + 11.5, pal.text);
                    ctx.globalAlpha = 1;
                }

                /* The status dot's own trip: down into the clock at the limit, back into its pill at the reset. */
                if (local >= DOT_OUT && local < HOME) {
                    const goDown = R.ease.inOutCubic((local - DOT_OUT) / 0.55);
                    const goUp = R.ease.inOutCubic((local - (HOME - 0.45)) / 0.45);
                    const frac = goDown * (1 - goUp);
                    // Out along a bow to the right, so the trip reads as a throw and not a slide.
                    const lx = R.lerp(pillDotX, cx, frac);
                    const ly = R.lerp(y + HEADER / 2, cy, frac);
                    const arcX = Math.sin(frac * Math.PI) * 26;
                    const color = local >= CLICK ? pal.running : pal.muted;
                    const breath = local < CLICK ? 0.7 + 0.3 * Math.sin((t * TAU) / 2.6) : 1;
                    ctx.globalAlpha = breath;
                    disc(lx + arcX, ly, R.lerp(3.2, 5, frac), color);
                    ctx.globalAlpha = 1;
                }

                /* The composer at the foot of the chat. */
                const composerY = y + CHILD.tall - 40;
                R.roundRect(ctx, x + 10, composerY, CHILD.wide - 20, 30, 10);
                ctx.fillStyle = pal.raised;
                ctx.fill();
                R.roundRect(ctx, x + 10.5, composerY + 0.5, CHILD.wide - 21, 29, 9.5);
                ctx.strokeStyle = 'rgba(255,255,255,0.07)';
                ctx.lineWidth = 1;
                ctx.stroke();
                sans(12, 400);
                ts('Ask anything', x + 22, composerY + 19, pal.faint);
                disc(x + CHILD.wide - 25, composerY + 15, 9, paused ? ACTIVE : pal.accent);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(x + CHILD.wide - 25, composerY + 19.5);
                ctx.lineTo(x + CHILD.wide - 25, composerY + 10.5);
                ctx.moveTo(x + CHILD.wide - 29, composerY + 14.5);
                ctx.lineTo(x + CHILD.wide - 25, composerY + 10.5);
                ctx.lineTo(x + CHILD.wide - 21, composerY + 14.5);
                ctx.stroke();

                ctx.restore();
                env.fadeEdges(0.72, 1.0);
            }
        };
    }
});
