Reel.add({
    id: 'agent-loop',
    title: 'The Loop',
    line: 'Read, edit, run, read the result. Watch the loop close on green.',
    principles: ['Timing', 'Arcs'],
    tech: 'Canvas 2D, orbital tool-call cycle',
    hint: 'Point at a station to bring it forward',
    poster: 9.0,
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
        const CYCLE = 17.2;
        const CX = 280;
        const CY = 258;
        const R_START = 114;
        const R_END = 88;
        const STATIONS = ['Think', 'Read', 'Edit', 'Run', 'Check'];
        // Each lap is quicker than the last: the agent stops less and moves faster as it closes in.
        const LAPS = [
            { move: 0.62, dwell: 0.62 },
            { move: 0.46, dwell: 0.34 },
            { move: 0.34, dwell: 0.2 }
        ];
        const TASKS = [
            {
                title: 'Fix the checkout test',
                laps: [
                    ['Why does the cart empty?', 'cart.ts', ['- cart = null', '+ cart = restore(id)'], '3 failed'],
                    ['The guest cart is lost', 'session.ts', ['- save(cart)', '+ save(merged)'], '1 failed'],
                    ['Await the merge', 'cart.test.ts', ['- merge(guest)', '+ await merge(guest)'], 'all passed']
                ]
            },
            {
                title: 'Fix the flaky login',
                laps: [
                    ['Why does login flake?', 'auth.ts', ['- setTimeout(done)', '+ await ready()'], '2 failed'],
                    ['The token expires early', 'token.ts', ['- ttl = 60', '+ ttl = 3600'], '1 failed'],
                    ['The test clock drifts', 'login.test.ts', ['- Date.now()', '+ clock.now()'], 'all passed']
                ]
            }
        ];

        // Keyframes of the token as (time, q), where q counts stations: a whole lap is 1, a station 0.2.
        const keys = [];
        const visits = [];
        let time = 0.45;
        for (let lap = 0; lap < LAPS.length; lap++) {
            for (let pos = 0; pos < STATIONS.length; pos++) {
                const turns = lap + pos / 5;
                visits.push({ lap, station: pos, at: time });
                keys.push([time, turns]);
                time += LAPS[lap].dwell;
                keys.push([time, turns]);
                const last = lap === LAPS.length - 1 && pos === STATIONS.length - 1;
                if (!last) {
                    time += LAPS[lap].move;
                }
            }
        }
        const FINAL = time;
        const SWEEP = FINAL + 0.15;
        const SWEEP_LEN = 1.15;
        keys.push([SWEEP, 2.8]);
        keys.push([SWEEP + SWEEP_LEN, 3.8]);
        const SETTLE = SWEEP + SWEEP_LEN;
        const RESET = 15.7;
        visits.forEach((visit, i) => {
            const next = visits[i + 1];
            visit.until = next ? next.at + 0.28 : RESET;
        });

        const qAt = (local) => {
            if (local <= keys[0][0]) {
                return 0;
            }
            for (let i = 1; i < keys.length; i++) {
                if (local < keys[i][0]) {
                    const [t0, q0] = keys[i - 1];
                    const [t1, q1] = keys[i];
                    if (q0 === q1) {
                        return q0;
                    }
                    // The final sweep leaves Check with a push and runs on; every other move eases in and out.
                    const frac = (local - t0) / (t1 - t0);
                    return R.lerp(q0, q1, i === keys.length - 1 ? R.ease.inOutQuad(frac) : R.ease.inOutCubic(frac));
                }
            }
            return keys[keys.length - 1][1];
        };
        const radiusAt = (turns) => R_START - (R_START - R_END) * R.clamp(turns / 3);
        const angleAt = (turns) => -Math.PI / 2 + turns * TAU;

        const stationGlow = new Float32Array(STATIONS.length);
        const hoverGlow = new Float32Array(STATIONS.length);

        const drawArtifact = (task, visit, local, t, ringR) => {
            const since = local - visit.at - 0.04;
            const left = visit.until - local;
            if (since < 0 || left < -0.3) {
                return;
            }
            const appear = R.ease.outBack(R.clamp(since / 0.38), 1.3);
            const vanish = R.clamp(-left / 0.3);
            const alpha = R.clamp(since / 0.2) * (1 - vanish);
            if (alpha <= 0) {
                return;
            }
            const pos = visit.station;
            const angle = angleAt(pos / 5);
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            // Out from the station along a small curve, bending the way the token was going.
            const reach = ringR + R.lerp(4, 20, appear) + vanish * 6;
            const bend = (1 - R.clamp(appear)) * 14;
            const ax = CX + dx * reach - dy * bend;
            const ay = CY + dy * reach + dx * bend;
            const content = TASKS[task].laps[visit.lap];
            ctx.globalAlpha = alpha;
            ctx.textBaseline = 'middle';
            const place = (wide, tall) => {
                let x = ax - wide / 2;
                let y = ay - tall / 2;
                // Side stations push their artifact sideways; the two at the foot hang theirs straight below.
                if (dy > 0.5) {
                    y = ay;
                } else if (dx > 0.3) {
                    x = ax;
                } else if (dx < -0.3) {
                    x = ax - wide;
                } else if (dy < -0.8) {
                    y = ay - tall;
                }
                return [x, y];
            };
            if (pos === 0) {
                sans(12, 400);
                const text = content[0];
                const wide = measure(text);
                const [x, y] = place(wide, 16);
                if (local < visit.until - 0.2) {
                    shine(text, x, y + 8, t);
                } else {
                    ctx.fillStyle = pal.muted;
                    ctx.fillText(text, x, y + 8);
                }
            } else if (pos === 1) {
                mono(11, 400);
                const wide = 30 + measure(content[1]);
                const [x, y] = place(wide, 22);
                R.roundRect(ctx, x, y, wide, 22, 6);
                ctx.fillStyle = pal.raised;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 1;
                R.roundRect(ctx, x + 0.5, y + 0.5, wide - 1, 21, 5.5);
                ctx.stroke();
                // Lucide `eye`, small.
                ctx.strokeStyle = pal.muted;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.ellipse(x + 11, y + 11, 5, 3.2, 0, 0, TAU);
                ctx.stroke();
                disc(x + 11, y + 11, 1.3, pal.muted);
                ctx.fillStyle = pal.text;
                ctx.fillText(content[1], x + 22, y + 11.5);
            } else if (pos === 2) {
                mono(11, 400);
                const lines = content[2];
                const wide = Math.max(measure(lines[0]), measure(lines[1])) + 14;
                const [x, y] = place(wide, 38);
                R.roundRect(ctx, x, y, wide, 38, 6);
                ctx.fillStyle = pal.sunken;
                ctx.fill();
                ctx.save();
                R.roundRect(ctx, x, y, wide, 38, 6);
                ctx.clip();
                ctx.fillStyle = R.rgba(pal.red, 0.13);
                ctx.fillRect(x, y + 3, wide, 16);
                ctx.fillStyle = R.rgba(pal.green, 0.12);
                ctx.fillRect(x, y + 19, wide, 16);
                ctx.restore();
                ctx.fillStyle = R.mix(pal.red, pal.text, 0.35);
                ctx.fillText(lines[0], x + 7, y + 11.5);
                // The added line types itself while the token stands on Edit.
                const typed = Math.floor(R.clamp(since / 0.5) * lines[1].length);
                ctx.fillStyle = R.mix(pal.green, pal.text, 0.35);
                ctx.fillText(lines[1].slice(0, Math.max(1, typed)), x + 7, y + 27.5);
            } else if (pos === 3) {
                mono(11, 400);
                const text = '$ bun test';
                const wide = measure(text) + 26;
                const [x, y] = place(wide, 22);
                R.roundRect(ctx, x, y, wide, 22, 6);
                ctx.fillStyle = pal.termBg;
                ctx.fill();
                R.roundRect(ctx, x + 0.5, y + 0.5, wide - 1, 21, 5.5);
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = pal.termFg;
                ctx.fillText(text, x + 8, y + 11.5);
                if (R.fract(t * 1.6) < 0.55 && local < visit.until - 0.25) {
                    ctx.fillStyle = pal.termFg;
                    ctx.fillRect(x + wide - 14, y + 6, 5.5, 10);
                }
            } else {
                const passed = content[3] === 'all passed';
                const color = passed ? pal.green : pal.red;
                sans(12, 500);
                const wide = measure(content[3]) + 30;
                const [x, y] = place(wide, 22);
                // A failure lands with a small shake; a pass just settles.
                const shake = passed ? 0 : Math.sin(since * 42) * 2.2 * Math.exp(-since * 7) * (since > 0.12 ? 1 : 0);
                R.roundRect(ctx, x + shake, y, wide, 22, 11);
                ctx.fillStyle = R.rgba(color, 0.12);
                ctx.fill();
                R.roundRect(ctx, x + shake + 0.5, y + 0.5, wide - 1, 21, 10.5);
                ctx.strokeStyle = R.rgba(color, 0.3);
                ctx.lineWidth = 1;
                ctx.stroke();
                if (passed) {
                    circleCheck(x + 12 + shake, y + 11, 11, color, R.clamp(since / 0.4), 1.4);
                } else {
                    disc(x + 12 + shake, y + 11, 3.2, color);
                }
                ctx.fillStyle = color;
                ctx.fillText(content[3], x + 21 + shake, y + 11.5);
            }
            ctx.textBaseline = 'alphabetic';
            ctx.globalAlpha = 1;
        };

        return {
            update(t, dt) {
                const pointer = env.pointer;
                const local = R.mod(t, CYCLE);
                const turns = qAt(local);
                const ringR = radiusAt(turns);
                let nearest = -1;
                let best = 46;
                for (let pos = 0; pos < STATIONS.length; pos++) {
                    const angle = angleAt(pos / 5);
                    const howFar = Math.hypot(pointer.x - (CX + Math.cos(angle) * ringR), pointer.y - (CY + Math.sin(angle) * ringR));
                    if (howFar < best) {
                        best = howFar;
                        nearest = pos;
                    }
                }
                const smoothing = 1 - Math.exp(-dt * 10);
                for (let pos = 0; pos < STATIONS.length; pos++) {
                    hoverGlow[pos] += ((pos === nearest ? pointer.active : 0) - hoverGlow[pos]) * smoothing;
                }
            },
            draw(t) {
                env.clear();
                const period = Math.floor(t / CYCLE);
                const task = R.mod(period, 2);
                const local = t - period * CYCLE;
                const pointer = env.pointer;
                const ox = pointer.nx * 5 * pointer.active;
                const oy = pointer.ny * 4 * pointer.active;
                grid(ox * 0.4, oy * 0.4);
                ctx.save();
                ctx.translate(ox, oy);

                const turns = qAt(local);
                const reset = R.ease.inOutCubic((local - RESET) / 1.1);
                // After the green lap the ring breathes out, swings back once and comes to rest; at the reset it opens up again.
                const since = local - SETTLE;
                const breathe = since > 0 ? 7 * Math.exp(-since * 3.2) * Math.sin(since * 8) : 0;
                const ringR = R.lerp(radiusAt(turns) + breathe, R_START, reset);
                const green = R.ease.inOutCubic((local - SWEEP) / SWEEP_LEN) * (1 - R.smoothstep(RESET, RESET + 0.6, local));

                /* The path so far, as a faint spiral: every lap sits inside the last one. */
                const traceAlpha = 1 - R.smoothstep(RESET, RESET + 0.7, local);
                if (turns > 0.001 && traceAlpha > 0) {
                    const qEnd = Math.min(turns, 2.8);
                    const steps = Math.max(2, Math.ceil(qEnd * 90));
                    ctx.beginPath();
                    for (let i = 0; i <= steps; i++) {
                        const qq = (i / steps) * qEnd;
                        const rad = radiusAt(qq);
                        const x = CX + Math.cos(angleAt(qq)) * rad;
                        const y = CY + Math.sin(angleAt(qq)) * rad;
                        if (i === 0) {
                            ctx.moveTo(x, y);
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }
                    ctx.strokeStyle = 'rgba(255,255,255,' + 0.07 * traceAlpha + ')';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }

                /* The ring itself, and the green that closes it. */
                ring(CX, CY, ringR, 'rgba(255,255,255,0.1)', 1.2);
                if (green > 0) {
                    const from = angleAt(2.8);
                    ctx.beginPath();
                    ctx.arc(CX, CY, ringR, from, from + TAU * R.clamp(green / (1 - R.smoothstep(RESET, RESET + 0.6, local) || 1)));
                    ctx.strokeStyle = R.rgba(pal.idle, 0.55 * (1 - R.smoothstep(RESET, RESET + 0.6, local)));
                    ctx.lineWidth = 1.8;
                    ctx.stroke();
                }

                /* The token's recent path: an arc that is brightest right behind it. */
                if (local > keys[0][0] - 0.2 && local < SETTLE + 0.4) {
                    const tail = 0.16;
                    const glowUp = 1 - R.clamp((local - SETTLE) / 0.4);
                    const steps = 18;
                    const color = green > 0.02 ? pal.idle : pal.running;
                    for (let i = 0; i < steps; i++) {
                        const q0 = turns - tail + (i / steps) * tail;
                        const q1 = turns - tail + ((i + 1) / steps) * tail;
                        if (q1 <= 0) {
                            continue;
                        }
                        ctx.beginPath();
                        ctx.arc(CX, CY, radiusAt(Math.max(q0, 0)) * (1 - reset) + R_START * reset, angleAt(Math.max(q0, 0)), angleAt(q1));
                        ctx.strokeStyle = R.rgba(color, (i / steps) * 0.8 * glowUp);
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                }

                /* Stations: a dot on the ring, the name inside it. */
                const nearAngle = angleAt(turns);
                for (let pos = 0; pos < STATIONS.length; pos++) {
                    const angle = angleAt(pos / 5);
                    const x = CX + Math.cos(angle) * ringR;
                    const y = CY + Math.sin(angle) * ringR;
                    const gap = Math.abs(R.mod(nearAngle - angle + Math.PI, TAU) - Math.PI);
                    const here = local < SETTLE ? 1 - R.smoothstep(0.05, 0.5, gap) : 0;
                    const lit = Math.max(here, hoverGlow[pos]);
                    const greenAt = R.clamp((green * 5 - R.mod(pos - 4, 5)) / 1.2);
                    const size = 5 + lit * 1.4;
                    disc(x, y, size + 1.5, GROUND);
                    disc(x, y, size, R.mix(pal.raised, pal.idle, greenAt * 0.85));
                    ring(x, y, size, greenAt > 0.1 ? R.rgba(pal.idle, 0.6) : R.mix(pal.faint, pal.running, lit, 0.5 + lit * 0.5), 1.2);
                    sans(12, lit > 0.5 ? 500 : 400);
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = R.mix(pal.faint, pal.text, Math.max(lit, greenAt * 0.6));
                    ctx.fillText(STATIONS[pos], CX + Math.cos(angle) * (ringR - 29), CY + Math.sin(angle) * (ringR - 21));
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';
                }
                ctx.globalAlpha = 1;

                /* What each station produced, beside the ring. */
                for (const visit of visits) {
                    drawArtifact(task, visit, local, t, ringR);
                }

                /* The token. */
                if (local > keys[0][0] - 0.25 && local < SETTLE + 0.5) {
                    const rad = radiusAt(turns) * (1 - reset) + R_START * reset;
                    const x = CX + Math.cos(angleAt(turns)) * rad;
                    const y = CY + Math.sin(angleAt(turns)) * rad;
                    const amt = R.clamp((local - keys[0][0] + 0.25) / 0.3) * (1 - R.clamp((local - SETTLE) / 0.5));
                    const color = green > 0.02 ? pal.idle : pal.running;
                    const glow = ctx.createRadialGradient(x, y, 0, x, y, 16);
                    glow.addColorStop(0, R.rgba(color, 0.4 * amt));
                    glow.addColorStop(1, R.rgba(color, 0));
                    ctx.fillStyle = glow;
                    ctx.fillRect(x - 16, y - 16, 32, 32);
                    ctx.globalAlpha = amt;
                    disc(x, y, 3.8, green > 0.02 ? '#dcfce7' : '#dbeafe');
                    ctx.globalAlpha = 1;
                }

                /* The chat it belongs to, as a title over the ring and a status in its middle. */
                const swap = R.clamp((local - RESET - 0.3) / 0.5);
                ctx.globalAlpha = Math.abs(swap * 2 - 1);
                sans(13, 500);
                const title = TASKS[swap >= 0.5 ? R.mod(task + 1, 2) : task].title;
                const tw = measure(title) + 18;
                claudeMark(CX - tw / 2 + 6, 86, 12, pal.muted);
                ctx.fillStyle = pal.text;
                ctx.fillText(title, CX - tw / 2 + 18, 90.5);
                ctx.globalAlpha = 1;

                sans(12, 500);
                ctx.textBaseline = 'middle';
                const done = R.clamp((local - SETTLE + 0.2) / 0.35) * (1 - R.clamp((local - RESET) / 0.4));
                if (done > 0) {
                    ctx.globalAlpha = done;
                    const wide = measure('Done') + 16;
                    circleCheck(CX - wide / 2 + 5, CY, 11, pal.idle, R.clamp((local - SETTLE + 0.1) / 0.45), 1.4);
                    ctx.fillStyle = pal.idle;
                    ctx.fillText('Done', CX - wide / 2 + 15, CY + 0.5);
                }
                if (done < 1) {
                    ctx.globalAlpha = 1 - done;
                    const wide = measure('Working') + 12;
                    disc(CX - wide / 2 + 3, CY, 3.2, pal.running);
                    shine('Working', CX - wide / 2 + 12, CY + 0.5, t);
                }
                ctx.textBaseline = 'alphabetic';
                ctx.globalAlpha = 1;

                ctx.restore();
                env.fadeEdges(0.8, 1.06);
            }
        };
    }
});
