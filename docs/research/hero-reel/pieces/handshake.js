Reel.add({
    id: 'handshake',
    title: 'Pairing',
    line: 'Pair a machine once. After that, it opens like your own.',
    principles: ['Arcs', 'Staging'],
    tech: 'Canvas 2D, key exchange choreography',
    hint: 'Move to lean the diagram',
    poster: 10.55,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const ease = R.ease;
        const phase = R.phase;

        const CYCLE = 18;
        const ZOOM = 1.12;
        const ZOOM_X = 280;
        const ZOOM_Y = 262;
        const STROKE = 'rgba(255,255,255,0.24)';
        const EDGE = R.mix(pal.bg, pal.accent, 0.55);
        const PROJECTS = [
            { name: 'acme-web', color: '#f54900' },
            { name: 'api', color: '#4ade80' },
            { name: 'infra', color: '#c084fc' }
        ];

        // The whole exchange, in seconds of one cycle. Phase A pairs the MacBook, phase B the iPhone, faster: it is the second time.
        const A = { key: 0.4, out: 1.2, back: 4.1, link: 6.9, rows: 7.8, leg: 1.0, dwell: 0.5 };
        const B = { key: 9.1, out: 9.5, back: 11.7, link: 13.9, rows: 14.6, leg: 0.8, dwell: 0.4 };
        const RESET = 16.7;

        const home = {
            broker: { x: 280, y: 112, depth: 0.45 },
            laptop: { x: 152, y: 256, depth: 1 },
            server: { x: 408, y: 256, depth: 1 },
            phone: { x: 280, y: 346, depth: 1.35 }
        };
        const at = { broker: { x: 0, y: 0 }, laptop: { x: 0, y: 0 }, server: { x: 0, y: 0 }, phone: { x: 0, y: 0 } };

        const identicon = (seed) => {
            const cells = [];
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 3; col++) {
                    if (R.hash(seed * 31 + row * 7 + col * 3) > 0.45) {
                        cells.push([col, row], ...(col < 2 ? [[4 - col, row]] : []));
                    }
                }
            }
            // Revealed top to bottom, the way a key is read out.
            cells.sort((one, two) => one[1] - two[1] || one[0] - two[0]);
            return cells;
        };
        const KEYS = {
            laptop: { cells: identicon(3), hex: '7f3a 91c2' },
            server: { cells: identicon(11), hex: 'c4e8 02bd' },
            phone: { cells: identicon(29), hex: '5a1f e7c0' }
        };

        const qpoint = (from, ctrl, to, k, out) => {
            const rest = 1 - k;
            out.x = rest * rest * from.x + 2 * rest * k * ctrl.x + k * k * to.x;
            out.y = rest * rest * from.y + 2 * rest * k * ctrl.y + k * k * to.y;
            return out;
        };
        const tmp = { x: 0, y: 0 };
        const tmp2 = { x: 0, y: 0 };

        // The two lanes of a round trip: the request goes out on the high arch, the answer comes back on the low one.
        const legs = (from, to, high) => {
            const broker = at.broker;
            const lift = high ? -34 : 46;
            const start = anchorOf(from, 'up');
            const end = anchorOf(to, 'up');
            return [
                { from: start, ctrl: ctrlFor(start, broker, lift), to: broker },
                { from: broker, ctrl: ctrlFor(end, broker, lift), to: end }
            ];
        };
        const ctrlFor = (device, broker, lift) => {
            if (Math.abs(device.x - broker.x) < 20) {
                // The phone sits under the broker: bow its lane sideways so it reads as an arc, not a lift.
                return { x: broker.x + (lift < 0 ? -58 : 58), y: (device.y + broker.y) / 2 + 24 };
            }
            return { x: device.x, y: broker.y + lift };
        };
        const anchorOf = (name, side) => {
            const pos = at[name];
            if (name === 'phone') {
                return { x: pos.x, y: pos.y - 64 };
            }
            if (name === 'server') {
                return { x: pos.x, y: pos.y - (side === 'up' ? 44 : 0) };
            }
            return { x: pos.x, y: pos.y - (side === 'up' ? 46 : 0) };
        };

        const envelopeAt = (t, start, from, to, high, leg, dwell, out) => {
            const local = t - start;
            const total = leg * 2 + dwell;
            if (local < 0 || local > total) {
                return null;
            }
            const path = legs(from, to, high);
            let scale = 1;
            if (local < leg) {
                const k = ease.inOutCubic(local / leg);
                qpoint(path[0].from, path[0].ctrl, path[0].to, k, out);
                scale = ease.outBack(phase(local, 0, 0.28), 2.2);
                out.lift = Math.sin(Math.PI * k);
            } else if (local < leg + dwell) {
                const k = (local - leg) / dwell;
                out.x = at.broker.x;
                out.y = at.broker.y - Math.sin(Math.PI * k) * 3;
                out.lift = 0;
            } else {
                const k = ease.inOutCubic((local - leg - dwell) / leg);
                qpoint(path[1].from, path[1].ctrl, path[1].to, k, out);
                scale = 1 - ease.inBack(phase(local, total - 0.26, 0.26), 1.6);
                out.lift = Math.sin(Math.PI * k);
            }
            // Bank into the turn from where the envelope is heading a moment later.
            const ahead = Math.min(total, local + 0.04);
            let hx = out.x;
            if (ahead < leg) {
                hx = qpoint(path[0].from, path[0].ctrl, path[0].to, ease.inOutCubic(ahead / leg), tmp2).x;
            } else if (ahead > leg + dwell) {
                hx = qpoint(path[1].from, path[1].ctrl, path[1].to, ease.inOutCubic((ahead - leg - dwell) / leg), tmp2).x;
            }
            out.angle = R.clamp((hx - out.x) / 18, -0.32, 0.32);
            out.scale = Math.max(0, scale) * (1 + out.lift * 0.14);
            out.dwell = local >= leg && local <= leg + dwell ? Math.sin(Math.PI * ((local - leg) / dwell)) : 0;
            return out;
        };
        const env1 = { x: 0, y: 0 };

        const drawLane = (path, alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.setLineDash([2, 5]);
            ctx.lineCap = 'round';
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = R.rgba('#ffffff', 0.16 * alpha);
            for (const part of path) {
                ctx.beginPath();
                ctx.moveTo(part.from.x, part.from.y);
                ctx.quadraticCurveTo(part.ctrl.x, part.ctrl.y, part.to.x, part.to.y);
                ctx.stroke();
            }
            ctx.restore();
        };
        const laneAlpha = (t, start, leg, dwell) => {
            const end = start + leg * 2 + dwell;
            return ease.outCubic(phase(t, start - 0.45, 0.4)) * (1 - ease.inOutSine(phase(t, end - 0.1, 0.6)));
        };

        const drawEnvelope = (pos) => {
            if (pos.scale <= 0.01) {
                return;
            }
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(pos.angle);
            ctx.scale(pos.scale, pos.scale);
            ctx.fillStyle = 'rgba(0,0,0,' + (0.28 - pos.lift * 0.1) + ')';
            R.roundRect(ctx, -12, -6 + 4 + pos.lift * 5, 24, 16, 3);
            ctx.fill();
            ctx.fillStyle = pal.markLight;
            R.roundRect(ctx, -12, -8, 24, 16, 2.5);
            ctx.fill();
            ctx.strokeStyle = 'rgba(28,34,51,0.5)';
            ctx.lineWidth = 1.2;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(-10.5, -6.5);
            ctx.lineTo(0, 1.2);
            ctx.lineTo(10.5, -6.5);
            ctx.stroke();
            ctx.fillStyle = pal.accent;
            ctx.beginPath();
            ctx.arc(0, 1.2, 2.8, 0, R.TAU);
            ctx.fill();
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
        const drawMark = (cx, cy, size, alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            plane(cx - size * 0.2, cy - size * 0.2, size, size * 0.17, size * 0.16);
            ctx.fillStyle = '#2a3350';
            ctx.fill();
            plane(cx + size * 0.2, cy + size * 0.2, size, size * 0.17, size * 0.16);
            ctx.fillStyle = R.rgba(pal.markLight, 0.85);
            ctx.fill();
            ctx.restore();
        };

        // A key's fingerprint: read out cell by cell, then tinted once the other side trusts it.
        const drawKey = (key, cx, cy, cell, reveal, trust, hex, t) => {
            if (reveal <= 0.01) {
                return;
            }
            const gap = cell > 4 ? 1.2 : 0.8;
            const size = cell * 5 + gap * 4;
            const x0 = cx - size / 2;
            const y0 = cy - size / 2;
            const count = key.cells.length;
            const color = R.mix(pal.muted, pal.running, trust);
            ctx.fillStyle = color;
            for (let i = 0; i < count; i++) {
                const shown = R.clamp(reveal * (count + 6) - i);
                if (shown <= 0) {
                    continue;
                }
                const [col, row] = key.cells[i];
                const grow = ease.outBack(shown, 2);
                const inset = (cell * (1 - grow)) / 2;
                ctx.globalAlpha = Math.min(1, shown * 1.5) * (0.75 + trust * 0.25);
                ctx.fillRect(x0 + col * (cell + gap) + inset, y0 + row * (cell + gap) + inset, cell * grow, cell * grow);
            }
            ctx.globalAlpha = 1;
            if (hex) {
                ctx.font = '400 12px ' + R.fonts.mono;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = R.rgba(trust > 0.5 ? pal.running : pal.faint, R.clamp(reveal * 2 - 1) * (0.8 + trust * 0.2));
                ctx.fillText(hex, cx, cy + size / 2 + 15);
            }
        };
        const trustRing = (cx, cy, k) => {
            if (k <= 0 || k >= 1) {
                return;
            }
            ctx.strokeStyle = R.rgba(pal.running, 0.55 * (1 - k));
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, 10 + ease.outCubic(k) * 26, 0, R.TAU);
            ctx.stroke();
        };

        const drawRows = (x, y, width, reveal, text, t) => {
            for (let i = 0; i < PROJECTS.length; i++) {
                const shown = ease.outCubic(R.clamp(reveal * 1.9 - i * 0.28));
                if (shown <= 0) {
                    continue;
                }
                const rowY = y + i * 17 + (1 - shown) * 7;
                ctx.globalAlpha = shown;
                if (i === 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.06)';
                    R.roundRect(ctx, x - 3, rowY - 7, width + 6, 15, 3);
                    ctx.fill();
                }
                ctx.fillStyle = R.rgba(PROJECTS[i].color, 0.9);
                R.roundRect(ctx, x + 1, rowY - 3.5, 7, 7, 1.5);
                ctx.fill();
                if (text) {
                    ctx.fillStyle = i === 0 ? pal.text : pal.muted;
                    ctx.font = '500 12px ' + R.fonts.display;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(PROJECTS[i].name, x + 14, rowY + 0.5);
                } else {
                    ctx.fillStyle = i === 0 ? 'rgba(236,236,241,0.7)' : 'rgba(154,154,166,0.45)';
                    R.roundRect(ctx, x + 12, rowY - 2, width - 16 - i * 6, 4, 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
        };

        const label = (name, detail, cx, y, alpha) => {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.font = '500 13px ' + R.fonts.display;
            ctx.fillStyle = R.rgba(pal.text, 0.92 * alpha);
            ctx.fillText(name, cx, y);
            if (detail) {
                ctx.font = '400 12px ' + R.fonts.mono;
                ctx.fillStyle = R.rgba(pal.faint, alpha);
                ctx.fillText(detail, cx, y + 16);
            }
        };

        const deviceStroke = (name) => {
            const pointer = env.pointer;
            const pos = at[name];
            const px = (pointer.x - ZOOM_X) / ZOOM + ZOOM_X;
            const py = (pointer.y - ZOOM_Y) / ZOOM + ZOOM_Y;
            const near = 1 - R.smoothstep(40, 110, R.dist(px, py, pos.x, pos.y));
            return 'rgba(255,255,255,' + (0.22 + near * pointer.active * 0.2).toFixed(3) + ')';
        };

        const drawLaptop = (t, state) => {
            const { x, y } = at.laptop;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = deviceStroke('laptop');
            ctx.fillStyle = pal.sunken;
            R.roundRect(ctx, x - 62, y - 40, 124, 80, 7);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = pal.surface;
            R.roundRect(ctx, x - 80, y + 43, 160, 7, 3.5);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.14)';
            ctx.beginPath();
            ctx.moveTo(x - 12, y + 43.5);
            ctx.lineTo(x + 12, y + 43.5);
            ctx.stroke();

            drawMark(x, y - 2, 18, state.idle);
            drawKey(KEYS.laptop, x, y - 8, 5, state.key, state.trust, KEYS.laptop.hex, t);
            if (state.rows > 0) {
                ctx.font = '500 12px ' + R.fonts.mono;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = R.rgba(pal.faint, ease.outCubic(R.clamp(state.rows * 2)));
                ctx.fillText('build-box', x - 50, y - 25);
                ctx.fillStyle = R.rgba(pal.idle, ease.outCubic(R.clamp(state.rows * 2)));
                ctx.beginPath();
                ctx.arc(x + 48, y - 25, 3, 0, R.TAU);
                ctx.fill();
                drawRows(x - 50, y - 6, 100, state.rows, true, t);
            }
            label('MacBook', 'this Mac', x, y + 74, 1);
        };

        const drawServer = (t, state) => {
            const { x, y } = at.server;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = deviceStroke('server');
            ctx.fillStyle = pal.surface;
            R.roundRect(ctx, x - 52, y - 38, 104, 80, 7);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(x - 52, y + 2);
            ctx.lineTo(x + 52, y + 2);
            ctx.stroke();
            for (let unit = 0; unit < 2; unit++) {
                const uy = y - 18 + unit * 40;
                for (let i = 0; i < 2; i++) {
                    const blink = unit === 0 && i === 1 ? 0.35 + 0.65 * (R.fract(t * 1.7 + 0.3) < 0.5 ? 1 : 0.3) * state.busy : 1;
                    ctx.fillStyle = i === 0 ? R.rgba(pal.idle, 0.85) : R.rgba(pal.running, 0.25 + 0.6 * blink * state.busy);
                    ctx.beginPath();
                    ctx.arc(x - 40 + i * 9, uy, 2.4, 0, R.TAU);
                    ctx.fill();
                }
                ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                for (let i = 0; i < 4; i++) {
                    ctx.beginPath();
                    ctx.moveTo(x + 30 + i * 5, uy - 6);
                    ctx.lineTo(x + 30 + i * 5, uy + 6);
                    ctx.stroke();
                }
            }
            ctx.fillStyle = pal.sunken;
            R.roundRect(ctx, x - 18, y - 33, 40, 30, 4);
            ctx.fill();
            drawKey(KEYS.server, x + 2, y - 18, 3.4, 1, state.trust, null, t);
            label('build-box', 'npx ruimte', x, y + 74, 1);
        };

        const drawPhone = (t, state, alpha) => {
            const { x, y } = at.phone;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = deviceStroke('phone');
            ctx.fillStyle = pal.sunken;
            R.roundRect(ctx, x - 31, y - 60, 62, 120, 14);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            R.roundRect(ctx, x - 9, y - 53, 18, 5.5, 2.75);
            ctx.fill();
            drawMark(x, y - 2, 13, state.idle);
            drawKey(KEYS.phone, x, y - 8, 4, state.key, state.trust, null, t);
            if (state.rows > 0) {
                ctx.fillStyle = R.rgba(pal.faint, ease.outCubic(R.clamp(state.rows * 2)));
                R.roundRect(ctx, x - 21, y - 33, 26, 4, 2);
                ctx.fill();
                drawRows(x - 21, y - 16, 40, state.rows, false, t);
            }
            label('iPhone', null, x, y + 80, 1);
            ctx.restore();
        };

        const drawBroker = (t, pulse) => {
            const { x, y } = at.broker;
            ctx.save();
            ctx.setLineDash([3, 5]);
            ctx.lineDashOffset = -t * 6;
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.1 + pulse * 0.16).toFixed(3) + ')';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, y, 30 + pulse * 3, 0, R.TAU);
            ctx.stroke();
            ctx.restore();
            ctx.fillStyle = pal.surface;
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.13 + pulse * 0.12).toFixed(3) + ')';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, 19, 0, R.TAU);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = pal.muted;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x - 7, y - 3);
            ctx.lineTo(x + 7, y - 3);
            ctx.lineTo(x + 4, y - 6);
            ctx.moveTo(x + 7, y + 3);
            ctx.lineTo(x - 7, y + 3);
            ctx.lineTo(x - 4, y + 6);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.font = '400 12px ' + R.fonts.mono;
            ctx.fillStyle = pal.faint;
            ctx.fillText('broker', x, y + 46);
        };

        // A direct channel draws itself from both ends and meets in the middle, then carries traffic both ways.
        const drawChannel = (from, to, draw, alpha, t, seed) => {
            if (draw <= 0 || alpha <= 0.01) {
                return;
            }
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.lineCap = 'round';
            ctx.lineWidth = 2;
            ctx.strokeStyle = EDGE;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(R.lerp(from.x, mx, draw), R.lerp(from.y, my, draw));
            ctx.moveTo(to.x, to.y);
            ctx.lineTo(R.lerp(to.x, mx, draw), R.lerp(to.y, my, draw));
            ctx.stroke();
            for (const end of [from, to]) {
                ctx.fillStyle = pal.bg;
                ctx.strokeStyle = EDGE;
                ctx.beginPath();
                ctx.arc(end.x, end.y, 4.5, 0, R.TAU);
                ctx.fill();
                ctx.stroke();
            }
            if (draw >= 1) {
                for (let i = 0; i < 3; i++) {
                    for (let dir = 0; dir < 2; dir++) {
                        const k = R.fract(t * 0.42 + i / 3 + dir * 0.17 + seed);
                        const along = dir === 0 ? k : 1 - k;
                        const fadeEnds = Math.sin(Math.PI * k);
                        ctx.fillStyle = R.rgba(pal.running, 0.85 * fadeEnds);
                        ctx.beginPath();
                        ctx.arc(R.lerp(from.x, to.x, along), R.lerp(from.y, to.y, along) + (dir === 0 ? -1.2 : 1.2), 1.7, 0, R.TAU);
                        ctx.fill();
                    }
                }
            }
            ctx.restore();
        };

        return {
            draw(time) {
                const t = R.mod(time, CYCLE);
                env.clear();
                const pointer = env.pointer;
                const leanX = pointer.nx * pointer.active * 9;
                const leanY = pointer.ny * pointer.active * 6;
                for (const name of Object.keys(home)) {
                    at[name].x = home[name].x + leanX * home[name].depth;
                    at[name].y = home[name].y + leanY * home[name].depth;
                }

                ctx.save();
                ctx.translate(ZOOM_X, ZOOM_Y);
                ctx.scale(ZOOM, ZOOM);
                ctx.translate(-ZOOM_X, -ZOOM_Y);
                const reset = ease.inOutSine(phase(t, RESET, 1.2));
                const keep = 1 - reset;
                const aTrustServer = ease.outCubic(phase(t, A.out + A.leg * 2 + A.dwell - 0.05, 0.5));
                const aTrustLaptop = ease.outCubic(phase(t, A.back + A.leg * 2 + A.dwell - 0.05, 0.5));
                const bTrustServer = phase(t, B.out + B.leg * 2 + B.dwell - 0.05, 0.4);
                const bTrustPhone = ease.outCubic(phase(t, B.back + B.leg * 2 + B.dwell - 0.05, 0.4));
                const laptopRows = phase(t, A.rows, 1.1) * keep;
                const phoneRows = phase(t, B.rows, 1.0) * keep;
                const laptopKey = ease.outCubic(phase(t, A.key, 0.7)) * (1 - ease.inOutSine(phase(t, A.rows - 0.3, 0.5)));
                const phoneKey = ease.outCubic(phase(t, B.key, 0.6)) * (1 - ease.inOutSine(phase(t, B.rows - 0.3, 0.5)));
                // The iPhone steps back while the MacBook pairs, and forward when its turn comes.
                const phoneFocus = R.lerp(0.42, 1, ease.inOutSine(phase(t, B.key - 0.9, 0.9))) * keep + 0.42 * reset;

                const aLink = ease.inOutCubic(phase(t, A.link, 0.8));
                const bLink = ease.inOutCubic(phase(t, B.link, 0.6));
                const laptopEnd = { x: at.laptop.x + 70, y: at.laptop.y };
                const serverEnd = { x: at.server.x - 60, y: at.server.y };
                const phoneEnd = { x: at.phone.x + 39, y: at.phone.y - 18 };
                const serverLow = { x: at.server.x - 34, y: at.server.y + 50 };

                drawLane(legs('laptop', 'server', true), laneAlpha(t, A.out, A.leg, A.dwell));
                drawLane(legs('server', 'laptop', false), laneAlpha(t, A.back, A.leg, A.dwell));
                drawLane(legs('phone', 'server', true), laneAlpha(t, B.out, B.leg, B.dwell) * phoneFocus);
                drawLane(legs('server', 'phone', false), laneAlpha(t, B.back, B.leg, B.dwell) * phoneFocus);

                drawChannel(laptopEnd, serverEnd, aLink, keep, t, 0);
                drawChannel(phoneEnd, serverLow, bLink, keep, t, 0.4);

                const flights = [
                    envelopeAt(t, A.out, 'laptop', 'server', true, A.leg, A.dwell, env1),
                    envelopeAt(t, A.back, 'server', 'laptop', false, A.leg, A.dwell, env1),
                    envelopeAt(t, B.out, 'phone', 'server', true, B.leg, B.dwell, env1),
                    envelopeAt(t, B.back, 'server', 'phone', false, B.leg, B.dwell, env1)
                ];
                let flight = null;
                for (const candidate of flights) {
                    if (candidate) {
                        flight = candidate;
                    }
                }
                drawBroker(t, flight ? flight.dwell : 0);

                drawLaptop(t, {
                    idle: Math.max(0, 1 - laptopKey * 1.6 - laptopRows * 5),
                    key: laptopKey,
                    trust: aTrustLaptop * keep,
                    rows: laptopRows
                });
                trustRing(at.laptop.x, at.laptop.y - 8, phase(t, A.back + A.leg * 2 + A.dwell - 0.05, 0.8));
                drawServer(t, { trust: Math.max(aTrustServer, bTrustServer) * keep, busy: Math.max(aLink, bLink) * keep });
                trustRing(at.server.x + 2, at.server.y - 18, phase(t, A.out + A.leg * 2 + A.dwell - 0.05, 0.8));
                trustRing(at.server.x + 2, at.server.y - 18, phase(t, B.out + B.leg * 2 + B.dwell - 0.05, 0.7));
                drawPhone(
                    t,
                    {
                        idle: Math.max(0, 1 - phoneKey * 1.6 - phoneRows * 5),
                        key: phoneKey,
                        trust: bTrustPhone * keep,
                        rows: phoneRows
                    },
                    phoneFocus
                );
                trustRing(at.phone.x, at.phone.y - 8, phase(t, B.back + B.leg * 2 + B.dwell - 0.05, 0.7));

                if (flight) {
                    drawEnvelope(flight);
                }
                ctx.restore();
                env.fadeEdges(0.7, 1.02);
            }
        };
    }
});
