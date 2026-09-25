Reel.add({
    id: 'wake-chain',
    title: 'Wake Up',
    line: 'A finished task wakes the chat that asked for it, once, and never before.',
    principles: ['Timing', 'Follow through and overlapping action'],
    tech: 'Canvas 2D, event propagation',
    hint: 'Point at an agent to trace who it answers to',
    poster: 7.3,
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
        const CYCLE = 16;
        const HEADER = 22;
        // The beats of one hand-off: the child settles, its result travels, lands, and only then the parent wakes.
        const DEPART = 0.22;
        const TRAVEL = 0.8;
        const BEAT = 0.3;
        const READ = 1.1;
        const ANSWER = 1.5;
        const LIFT = 4;
        const RESET = 14.6;

        const NODES = [
            { level: 0, cx: 280, y: 96, wide: 196, tall: 60, parent: -1 },
            { level: 1, cx: 180, y: 208, wide: 164, tall: 58, parent: 0 },
            { level: 1, cx: 380, y: 208, wide: 164, tall: 58, parent: 0 },
            { level: 2, cx: 132, y: 316, wide: 88, tall: 54, parent: 1 },
            { level: 2, cx: 228, y: 316, wide: 88, tall: 54, parent: 1 },
            { level: 2, cx: 332, y: 316, wide: 88, tall: 54, parent: 2 },
            { level: 2, cx: 428, y: 316, wide: 88, tall: 54, parent: 2 }
        ];
        const TASKS = [
            {
                titles: ['Ship saved carts', 'Cart API', 'Checkout UI', 'Schema', 'Routes', 'Drawer', 'Tests'],
                answer: 'Carts persist. Tests pass.',
                leafDone: [1.2, 4.3, 2.5, 6.2]
            },
            {
                titles: ['Speed up search', 'Index', 'Query layer', 'Profile', 'Rebuild', 'Cache', 'Bench'],
                answer: 'Search is 4x faster now.',
                leafDone: [6.2, 2.5, 4.3, 1.2]
            }
        ];

        // Every event of a task, worked out once: when each node finishes, when its result lands, when its parent wakes.
        const plans = TASKS.map((task) => {
            const nodes = NODES.map(() => ({ done: Infinity, depart: Infinity, land: Infinity, wakes: [], answer: Infinity }));
            const settle = (i) => {
                nodes[i].depart = nodes[i].done + DEPART;
                nodes[i].land = nodes[i].depart + TRAVEL;
            };
            for (let i = 0; i < 4; i++) {
                nodes[3 + i].done = task.leafDone[i];
                settle(3 + i);
            }
            const wakeParent = (prog) => {
                const lands = [];
                NODES.forEach((node, i) => {
                    if (node.parent === prog) {
                        lands.push(nodes[i].land);
                    }
                });
                lands.sort((first, second) => first - second);
                nodes[prog].wakes = lands.map((land) => land + BEAT);
                const last = nodes[prog].wakes[nodes[prog].wakes.length - 1];
                if (prog === 0) {
                    nodes[prog].answer = last + READ;
                    nodes[prog].done = nodes[prog].answer + ANSWER;
                } else {
                    nodes[prog].done = last + READ;
                    settle(prog);
                }
            };
            wakeParent(1);
            wakeParent(2);
            wakeParent(0);
            return nodes;
        });

        const routes = NODES.map(() => makeRoute());
        const hover = new Float32Array(NODES.length);
        const chain = new Float32Array(NODES.length);
        const liftNow = new Float32Array(NODES.length);
        const nodeX = new Float32Array(NODES.length);
        const nodeY = new Float32Array(NODES.length);

        // Which task a level shows at `u`. Between tasks each level flips its content, root first, the way work flows down.
        const shownTask = (t, level) => {
            const cycle = Math.floor(t / CYCLE);
            const local = t - cycle * CYCLE;
            const flip = RESET + 0.2 + level * 0.25;
            if (local < flip + 0.25) {
                const out = R.ease.inCubic(R.clamp((local - flip) / 0.25));
                return { task: R.mod(cycle, 2), local, fade: 1 - out, shift: -4 * out };
            }
            const into = R.ease.outCubic(R.clamp((local - flip - 0.25) / 0.35));
            return { task: R.mod(cycle + 1, 2), local: 0, fade: into, shift: 4 * (1 - into) };
        };

        const lift = (plan, i, local) => {
            const node = plan[i];
            let value = 0;
            node.wakes.forEach((wake, k) => {
                const last = k === node.wakes.length - 1;
                const end = last ? node.done : wake + READ;
                if (local >= wake && local < end + 0.6) {
                    const rise = springStep(local - wake, 15, 0.42);
                    const fall = local > end ? R.ease.inOutCubic((local - end) / 0.6) : 0;
                    value = Math.max(value, rise * (1 - fall));
                }
            });
            // A result that lands knocks the parent down a hair before it wakes.
            node.wakes.forEach((wake) => {
                const since = local - (wake - BEAT);
                if (since > 0 && since < 0.4) {
                    value -= 0.35 * Math.sin((since / 0.4) * Math.PI) * (1 - since / 0.4);
                }
            });
            return value * LIFT;
        };

        const awake = (plan, i, local) => {
            const node = plan[i];
            for (let k = 0; k < node.wakes.length; k++) {
                const wake = node.wakes[k];
                const last = k === node.wakes.length - 1;
                if (local >= wake && local < (last ? node.done : wake + READ)) {
                    return wake;
                }
            }
            return -1;
        };

        const pendingTasks = (plan, prog, local) => {
            let count = 0;
            NODES.forEach((node, i) => {
                if (node.parent === prog && plan[i].land + BEAT > local) {
                    count++;
                }
            });
            return count;
        };

        const statusDot = (x, y, color, alpha, scale = 1) => {
            ctx.globalAlpha = alpha;
            disc(x, y, 3.3 * scale, color);
            ctx.globalAlpha = 1;
        };

        const drawBody = (i, x, y, wide, t, plan, local, fade) => {
            const node = NODES[i];
            const state = plan[i];
            const base = y + HEADER + 19;
            sans(12, 400);
            ctx.textBaseline = 'alphabetic';
            const since = (start) => R.clamp((local - start) / 0.3);
            const rise = (start) => (1 - R.ease.outCubic(since(start))) * 3;
            if (local >= state.done) {
                const shown = since(state.done);
                ctx.globalAlpha = fade * shown;
                ctx.save();
                ctx.translate(x + 16, base - 4 + rise(state.done));
                const pop = 1 + 0.25 * Math.sin(R.clamp((local - state.done) / 0.35) * Math.PI);
                ctx.scale(pop, pop);
                circleCheck(0, 0, 11, pal.idle, R.clamp((local - state.done) / 0.45), 1.4);
                ctx.restore();
                if (i === 0) {
                    ctx.globalAlpha = fade;
                    ctx.fillStyle = pal.text;
                    ctx.fillText(TASKS[shownTaskIndex].answer, x + 10 + 16 * R.ease.outCubic(shown), base);
                } else {
                    ctx.fillStyle = pal.idle;
                    ctx.fillText('Done', x + 26, base + rise(state.done));
                }
                ctx.globalAlpha = 1;
                return;
            }
            if (node.level === 2) {
                ctx.globalAlpha = fade;
                shine('Working', x + 10, base, t + i * 0.37, 1);
                ctx.globalAlpha = 1;
                return;
            }
            if (i === 0 && local >= state.answer) {
                const words = TASKS[shownTaskIndex].answer.split(' ');
                const shown = Math.floor(R.clamp((local - state.answer) / (ANSWER * 0.8)) * words.length + 0.001);
                ctx.globalAlpha = fade;
                ctx.fillStyle = pal.text;
                ctx.fillText(words.slice(0, Math.max(1, shown)).join(' '), x + 10, base);
                ctx.globalAlpha = 1;
                return;
            }
            const woke = awake(plan, i, local);
            if (woke >= 0) {
                ctx.globalAlpha = fade * since(woke);
                shine('Reading result', x + 10, base + rise(woke), t, 1);
                ctx.globalAlpha = 1;
                return;
            }
            const count = pendingTasks(plan, i, local);
            let changed = 0;
            state.wakes.forEach((wake) => {
                if (local >= wake) {
                    changed = wake + READ;
                }
            });
            ctx.globalAlpha = fade * (changed ? since(changed) : 1);
            ctx.fillStyle = pal.faint;
            ctx.fillText('Waiting on ' + count + (count === 1 ? ' task' : ' tasks'), x + 10, base + (changed ? rise(changed) : 0));
            ctx.globalAlpha = 1;
        };

        let shownTaskIndex = 0;

        return {
            update(t, dt) {
                const pointer = env.pointer;
                let nearest = -1;
                let best = 1e9;
                for (let i = 0; i < NODES.length; i++) {
                    const node = NODES[i];
                    const dx = Math.max(0, Math.abs(pointer.x - node.cx) - node.wide / 2);
                    const dy = Math.max(0, Math.abs(pointer.y - (node.y + node.tall / 2)) - node.tall / 2);
                    const howFar = Math.hypot(dx, dy);
                    if (howFar < 18 && howFar < best) {
                        best = howFar;
                        nearest = i;
                    }
                }
                const smoothing = 1 - Math.exp(-dt * 10);
                for (let i = 0; i < NODES.length; i++) {
                    let onChain = 0;
                    for (let j = nearest; j >= 0; j = NODES[j].parent) {
                        if (j === i) {
                            onChain = 1;
                        }
                    }
                    const target = pointer.active > 0.2 && nearest >= 0 ? 1 : 0;
                    hover[i] += ((i === nearest ? target : 0) - hover[i]) * smoothing;
                    chain[i] += (onChain * target - chain[i]) * smoothing;
                }
            },
            draw(t) {
                env.clear();
                const pointer = env.pointer;
                const ox = pointer.nx * 6 * pointer.active;
                const oy = pointer.ny * 4 * pointer.active;
                grid(ox * 0.5, oy * 0.5);

                for (let i = 0; i < NODES.length; i++) {
                    const view = shownTask(t, NODES[i].level);
                    liftNow[i] = lift(plans[view.task], i, view.local);
                    nodeX[i] = NODES[i].cx - NODES[i].wide / 2 + ox;
                    nodeY[i] = NODES[i].y + oy - liftNow[i];
                }

                /* Connectors: dashed while the task is open; the result rides up and leaves solid line behind it. */
                ctx.lineCap = 'round';
                for (let i = 1; i < NODES.length; i++) {
                    const node = NODES[i];
                    const prog = node.parent;
                    const view = shownTask(t, node.level);
                    const plan = plans[view.task];
                    const state = plan[i];
                    const route = routeDown(routes[i], nodeX[prog] + NODES[prog].wide / 2, nodeY[prog] + NODES[prog].tall + 6, nodeX[i] + node.wide / 2, nodeY[i] - 6);
                    const length = route.length;
                    const local = view.local;
                    const travel = R.ease.inOutCubic((local - state.depart) / TRAVEL);
                    const reached = local >= state.depart ? length * (1 - travel) : length;
                    const lit = chain[i];
                    const color = lit > 0.01 ? R.mix(EDGE_CONTEXT, pal.accent, lit) : EDGE_CONTEXT;
                    ctx.lineWidth = 1.5 + lit * 0.5;
                    ctx.strokeStyle = color;
                    ctx.globalAlpha = 0.3 + 0.7 * view.fade;
                    ctx.setLineDash([4, 4]);
                    strokeRoute(route, 0, reached);
                    ctx.setLineDash([]);
                    strokeRoute(route, reached, length);
                    ctx.globalAlpha = 1;
                    headDot(nodeX[i] + node.wide / 2, nodeY[i] - 6, color, Math.max(view.fade, 0.35));

                    // The result: a green bead with a short tail, easing out of the child and into the parent.
                    if (local >= state.depart && local < state.land + 0.05) {
                        const pos = reached;
                        for (let k = 9; k >= 1; k--) {
                            const back = routeAt(route, Math.min(length, pos + k * 2.6 * (0.4 + Math.sin(travel * Math.PI))));
                            ctx.globalAlpha = (1 - k / 10) * 0.5 * view.fade;
                            disc(back.x, back.y, 2.6 * (1 - k / 12), pal.idle);
                        }
                        const head = routeAt(route, pos);
                        const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 12);
                        glow.addColorStop(0, R.rgba(pal.idle, 0.45));
                        glow.addColorStop(1, R.rgba(pal.idle, 0));
                        ctx.globalAlpha = view.fade;
                        ctx.fillStyle = glow;
                        ctx.fillRect(head.x - 12, head.y - 12, 24, 24);
                        disc(head.x, head.y, 3, '#d9fbe6');
                        ctx.globalAlpha = 1;
                    }
                    // Where it lands, a ring spreads from the parent's port.
                    const landed = local - state.land;
                    if (landed > 0 && landed < 0.6) {
                        const frac = landed / 0.6;
                        ctx.globalAlpha = (1 - frac) * 0.7 * view.fade;
                        ring(nodeX[prog] + NODES[prog].wide / 2, nodeY[prog] + NODES[prog].tall + 6, 3 + R.ease.outCubic(frac) * 14, pal.idle, 1.5);
                        ctx.globalAlpha = 1;
                    }
                }

                /* Nodes, children first so a lifted parent's shadow falls over their lines. */
                for (let i = NODES.length - 1; i >= 0; i--) {
                    const node = NODES[i];
                    const view = shownTask(t, node.level);
                    const plan = plans[view.task];
                    shownTaskIndex = view.task;
                    const state = plan[i];
                    const local = view.local;
                    const x = nodeX[i];
                    const y = nodeY[i];
                    const woke = node.level < 2 ? awake(plan, i, local) : -1;
                    const answering = i === 0 && local >= state.answer && local < state.done;
                    const done = local >= state.done;
                    const sleeping = node.level < 2 && woke < 0 && !answering && !done;
                    const sleepDim = sleeping ? 0.62 : 1;
                    nodeFrame(x, y, node.wide, node.tall, HEADER, Math.max(0, liftNow[i]), 0.09 + chain[i] * 0.12 + hover[i] * 0.06);

                    // Content trails the frame by a few frames, so a wake reads as a lift with weight behind it.
                    const lag = lift(plan, i, local - 0.07) - liftNow[i];
                    ctx.save();
                    ctx.translate(0, view.shift - lag);
                    ctx.globalAlpha = view.fade * (0.55 + 0.45 * sleepDim);
                    nodeTitle(x, y, HEADER, TASKS[view.task].titles[i], 12, sleeping ? pal.muted : pal.text);
                    ctx.globalAlpha = 1;
                    drawBody(i, x, y, node.wide, t, plan, local, view.fade * (sleeping ? 0.9 : 1));

                    const dx = x + node.wide - 12;
                    const dy = y + HEADER / 2;
                    if (done) {
                        const pop = 1 + 0.45 * Math.sin(R.clamp((local - state.done) / 0.3) * Math.PI);
                        statusDot(dx, dy, pal.idle, view.fade, pop);
                    } else if (node.level === 2 || woke >= 0 || answering) {
                        const since = woke >= 0 ? local - woke : 1;
                        statusDot(dx, dy, pal.running, view.fade * statusPulse(t + i * 0.3) * R.clamp(since / 0.2 + 0.3));
                        if (since < 0.55) {
                            ctx.globalAlpha = (1 - since / 0.55) * 0.6 * view.fade;
                            ring(dx, dy, 3.3 + R.ease.outCubic(since / 0.55) * 9, pal.running, 1.2);
                            ctx.globalAlpha = 1;
                        }
                    } else {
                        // Asleep: the dot breathes slowly in the faint gray, nothing more.
                        const breath = 0.45 + 0.25 * Math.sin((t * TAU) / 3.2 + i);
                        statusDot(dx, dy, pal.faint, view.fade * breath);
                    }
                    ctx.restore();
                }

                env.fadeEdges(0.7, 1.0);
            }
        };
    }
});
