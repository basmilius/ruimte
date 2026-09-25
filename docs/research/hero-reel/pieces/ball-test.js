Reel.add({
    id: 'ball-test',
    title: 'The Ball Test',
    line: 'Every animator starts with a bouncing ball. Ours checks in on your agents.',
    principles: ['Squash and stretch', 'Arcs', 'Timing'],
    tech: 'Canvas 2D, ballistic arcs, onion skinning, spacing charts',
    hint: 'Move near the nodes to bend the jumps',
    poster: 3.3,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const PI = Math.PI;

        const FPS = 24;
        const GRAVITY = 1100;
        const RADIUS = 11;
        const NODE_W = 108;
        const NODE_H = 26;
        const NODES = [
            { x: 144, top: 208, title: 'claude', kind: 'chat' },
            { x: 238, top: 252, title: 'codex', kind: 'chat' },
            { x: 330, top: 296, title: 'zsh', kind: 'terminal' },
            { x: 418, top: 340, title: 'localhost', kind: 'browser' }
        ];
        const COLORS = [pal.running, pal.needs, pal.idle];

        // One lap in frames at 24 fps: the hops lose energy down the stairs, then the big leap back up.
        const SEGMENTS = [
            { type: 'contact', node: 0, frames: 4 },
            { type: 'hop', from: 0, to: 1, frames: 16 },
            { type: 'contact', node: 1, frames: 3 },
            { type: 'hop', from: 1, to: 2, frames: 14 },
            { type: 'contact', node: 2, frames: 3 },
            { type: 'hop', from: 2, to: 3, frames: 12 },
            { type: 'contact', node: 3, frames: 3 },
            { type: 'rest', node: 3, frames: 5 },
            { type: 'crouch', node: 3, frames: 9 },
            { type: 'hop', from: 3, to: 0, frames: 22 }
        ];
        let frameCount = 0;
        for (const seg of SEGMENTS) {
            seg.start = frameCount / FPS;
            seg.dur = seg.frames / FPS;
            frameCount += seg.frames;
        }
        const LAP = frameCount / FPS;
        const LAPS = 3;
        const LOOP = LAP * LAPS;
        const HOPS = SEGMENTS.filter((seg) => seg.type === 'hop');
        const LANDINGS = [];
        for (let lap = 0; lap < LAPS; lap++) {
            for (const seg of SEGMENTS) {
                if (seg.type === 'contact') {
                    LANDINGS.push({ time: lap * LAP + seg.start, node: seg.node });
                }
            }
        }
        const TAKEOFFS = [];
        for (let lap = 0; lap < LAPS; lap++) {
            for (const seg of HOPS) {
                TAKEOFFS.push({ time: lap * LAP + seg.start, node: seg.from, leap: seg.to === 0 });
            }
        }

        /* Node placement: the resting spot plus a lean toward the pointer. Dips are added separately. */
        const lean = NODES.map(() => ({ x: 0, y: 0, rot: 0 }));
        const updateLean = () => {
            const pointer = env.pointer;
            for (let i = 0; i < NODES.length; i++) {
                const node = NODES[i];
                const dx = pointer.x - node.x;
                const dy = pointer.y - (node.top + NODE_H / 2);
                const reach = Math.hypot(dx, dy) || 1;
                const pull = pointer.active * Math.exp(-reach / 170);
                lean[i].x = (dx / reach) * 14 * pull;
                lean[i].y = (dy / reach) * 16 * pull;
                lean[i].rot = R.clamp(dx / 400, -0.5, 0.5) * 0.16 * pull;
            }
        };

        // Where the ball stands on node i: the top center of the bar, turned with its lean.
        const standX = (i) => NODES[i].x + lean[i].x + Math.sin(lean[i].rot) * (NODE_H / 2);
        const standY = (i) => NODES[i].top + lean[i].y;

        const lastEvent = (list, node, t) => {
            let best = -Infinity;
            let speed = 0;
            for (const e of list) {
                if (node >= 0 && e.node !== node) {
                    continue;
                }
                for (let k = -1; k <= 0; k++) {
                    const time = e.time + k * LOOP;
                    if (time <= t && time > best) {
                        best = time;
                        speed = e.leap ? 1 : 0;
                    }
                }
            }
            return { time: best, leap: speed };
        };

        const dipOf = (i, t) => {
            const land = lastEvent(LANDINGS, i, t);
            const off = lastEvent(TAKEOFFS, i, t);
            let dip = 0;
            const s1 = t - land.time;
            if (s1 < 1.5) {
                dip += (i === 0 ? 9 : 6) * Math.exp(-s1 * 6.5) * Math.sin(s1 * 19);
            }
            const s2 = t - off.time;
            if (s2 < 1.5) {
                dip += (off.leap ? 7 : 3) * Math.exp(-s2 * 7) * Math.sin(s2 * 19);
            }
            // The crouch before the leap presses the last node down, and the leap lets it spring up.
            if (i === 3) {
                const crouch = SEGMENTS[8];
                const local = R.mod(t, LAP);
                if (local >= crouch.start && local < crouch.start + crouch.dur) {
                    dip += 4 * R.ease.outCubic(Math.min(1, (local - crouch.start) / (crouch.dur * 0.7)));
                }
            }
            return dip;
        };

        /* The ball as a pure function of time. */
        const ball = { x: 0, y: 0, angle: 0, along: 1, across: 1, color: 0, mix: 1 };
        const hopPoint = (seg, elapsed, out) => {
            const x0 = standX(seg.from);
            const y0 = standY(seg.from) - RADIUS;
            const x1 = standX(seg.to);
            const y1 = standY(seg.to) - RADIUS;
            const span = seg.dur;
            const vx = (x1 - x0) / span;
            const vy0 = (y1 - y0 - 0.5 * GRAVITY * span * span) / span;
            out.x = x0 + vx * elapsed;
            out.y = y0 + vy0 * elapsed + 0.5 * GRAVITY * elapsed * elapsed;
            out.vx = vx;
            out.vy = vy0 + GRAVITY * elapsed;
            return out;
        };
        const hp = { x: 0, y: 0, vx: 0, vy: 0 };

        const landingIndex = (t) => {
            const local = R.mod(t, LOOP);
            let latest = -1;
            for (let i = 0; i < LANDINGS.length; i++) {
                if (LANDINGS[i].time <= local) {
                    latest = i;
                }
            }
            return { m: latest, since: local - (latest >= 0 ? LANDINGS[latest].time : 0) };
        };

        const ballAt = (t) => {
            const local = R.mod(t, LAP);
            let seg = SEGMENTS[0];
            for (const segment of SEGMENTS) {
                if (local >= segment.start) {
                    seg = segment;
                }
            }
            const elapsed = local - seg.start;
            const progress = elapsed / seg.dur;
            ball.angle = 0;
            if (seg.type === 'hop') {
                hopPoint(seg, elapsed, hp);
                const speed = Math.hypot(hp.vx, hp.vy);
                const stretch = 1 + Math.min(0.4, speed * 0.00052) * R.smoothstep(0, 0.07, elapsed);
                ball.x = hp.x;
                ball.y = hp.y;
                ball.angle = Math.atan2(hp.vy, hp.vx);
                ball.along = stretch;
                ball.across = 1 / Math.pow(stretch, 0.85);
            } else {
                const i = seg.node;
                let sy = 1;
                let shift = 0;
                let tilt = 0;
                if (seg.type === 'contact') {
                    const hard = i === 0 ? 0.4 : 0.3;
                    sy = 1 - hard * Math.pow(1 - progress, 2) + 0.05 * Math.sin(PI * progress);
                } else if (seg.type === 'crouch') {
                    const bend = R.ease.outCubic(Math.min(1, progress / 0.72));
                    sy = 1 - 0.34 * bend;
                    shift = 4 * bend;
                    tilt = 0.1 * bend;
                }
                const sx = 1 + (1 - sy) * 1.05;
                ball.x = standX(i) + shift;
                ball.y = standY(i) + dipOf(i, t) - RADIUS * sy;
                ball.along = sx;
                ball.across = sy;
                ball.angle = tilt;
            }
            const land = landingIndex(t);
            const landed = land.m < 0 ? LANDINGS.length - 1 : land.m;
            ball.color = (landed + 1) % 3;
            ball.prev = landed % 3;
            ball.mix = R.smoothstep(0.0, 0.07, land.m < 0 ? 1 : land.since);
            return ball;
        };

        const nodeColor = (i, t) => {
            const local = R.mod(t, LOOP);
            let index = -1;
            let time = 0;
            for (let landing = 0; landing < LANDINGS.length; landing++) {
                if (LANDINGS[landing].node === i && LANDINGS[landing].time <= local) {
                    index = landing;
                    time = LANDINGS[landing].time;
                }
            }
            if (index < 0) {
                for (let landing = 0; landing < LANDINGS.length; landing++) {
                    if (LANDINGS[landing].node === i) {
                        index = landing;
                        time = LANDINGS[landing].time - LOOP;
                    }
                }
            }
            return { color: COLORS[index % 3], since: local - time };
        };

        /* The faint dot grid of a Ruimte canvas, drawn once per size. */
        const grid = env.buffer();
        const paintGrid = () => {
            const pen = grid.ctx;
            pen.save();
            pen.setTransform(1, 0, 0, 1, 0, 0);
            pen.clearRect(0, 0, grid.canvas.width, grid.canvas.height);
            pen.restore();
            for (let y = 10; y < H; y += 20) {
                for (let x = 10; x < W; x += 20) {
                    const radial = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2));
                    const alpha = 0.09 * (1 - R.smoothstep(0.35, 0.95, radial));
                    if (alpha > 0.004) {
                        pen.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
                        pen.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
                    }
                }
            }
        };
        paintGrid();

        const glyph = (kind, x, y) => {
            ctx.strokeStyle = pal.muted;
            ctx.lineWidth = 1.1;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (kind === 'terminal') {
                ctx.moveTo(x - 3, y - 3);
                ctx.lineTo(x, y);
                ctx.lineTo(x - 3, y + 3);
                ctx.moveTo(x + 1.2, y + 3.3);
                ctx.lineTo(x + 4.2, y + 3.3);
            } else if (kind === 'chat') {
                R.roundRect(ctx, x - 4.2, y - 3.6, 8.4, 6.2, 2);
                ctx.moveTo(x - 1.8, y + 2.6);
                ctx.lineTo(x - 3, y + 4.6);
            } else {
                ctx.arc(x, y, 4, 0, R.TAU);
                ctx.moveTo(x - 4, y);
                ctx.lineTo(x + 4, y);
                ctx.moveTo(x, y - 4);
                ctx.bezierCurveTo(x + 2.4, y - 1.8, x + 2.4, y + 1.8, x, y + 4);
                ctx.bezierCurveTo(x - 2.4, y + 1.8, x - 2.4, y - 1.8, x, y - 4);
            }
            ctx.stroke();
        };

        const drawNode = (i, t, ballPose) => {
            const node = NODES[i];
            const dip = dipOf(i, t);
            const nc = nodeColor(i, t);
            ctx.save();
            ctx.translate(node.x + lean[i].x, node.top + lean[i].y + dip + NODE_H / 2);
            ctx.rotate(lean[i].rot);
            // A soft shadow that tightens as the bar is pressed down.
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            R.roundRect(ctx, -NODE_W / 2 + 3, -NODE_H / 2 + 6 - dip * 0.3, NODE_W - 6, NODE_H, 8);
            ctx.fill();
            R.roundRect(ctx, -NODE_W / 2, -NODE_H / 2, NODE_W, NODE_H, 8);
            ctx.fillStyle = pal.surface;
            ctx.fill();
            // The ball lights the top edge in its own color as it comes close.
            const near = Math.max(0, 1 - Math.hypot(ballPose.x - node.x - lean[i].x, ballPose.y - node.top - lean[i].y) / 70);
            if (near > 0.01) {
                const gradient = ctx.createRadialGradient(ballPose.x - node.x - lean[i].x, -NODE_H / 2, 0, ballPose.x - node.x - lean[i].x, -NODE_H / 2, 46);
                gradient.addColorStop(0, R.rgba(COLORS[ballPose.color], 0.22 * near));
                gradient.addColorStop(1, R.rgba(COLORS[ballPose.color], 0));
                ctx.fillStyle = gradient;
                ctx.fill();
            }
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            R.roundRect(ctx, -NODE_W / 2 + 0.5, -NODE_H / 2 + 0.5, NODE_W - 1, NODE_H - 1, 7.5);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(-NODE_W / 2 + 8, -NODE_H / 2 + 0.6, NODE_W - 16, 0.8);
            glyph(node.kind, -NODE_W / 2 + 13, 0);
            ctx.font = `500 11px ${R.fonts.mono}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = pal.muted;
            ctx.fillText(node.title, -NODE_W / 2 + 24, 0.5);
            // The status dot catches the ball's color with a pop and a ring.
            const dx = NODE_W / 2 - 12;
            const since = nc.since;
            const pop = since >= 0 && since < 1 ? Math.exp(-since * 9) * Math.sin(Math.min(PI, since * 26)) : 0;
            if (since >= 0 && since < 0.7) {
                const k = since / 0.7;
                ctx.beginPath();
                ctx.arc(dx, 0, 3.5 + k * 11, 0, R.TAU);
                ctx.strokeStyle = R.rgba(nc.color, 0.5 * (1 - k));
                ctx.lineWidth = 1.2 * (1 - k) + 0.3;
                ctx.stroke();
            }
            const glow = ctx.createRadialGradient(dx, 0, 0, dx, 0, 10);
            glow.addColorStop(0, R.rgba(nc.color, 0.3));
            glow.addColorStop(1, R.rgba(nc.color, 0));
            ctx.fillStyle = glow;
            ctx.fillRect(dx - 10, -10, 20, 20);
            ctx.beginPath();
            ctx.arc(dx, 0, 3.5 * (1 + 0.8 * pop), 0, R.TAU);
            ctx.fillStyle = nc.color;
            ctx.fill();
            ctx.restore();
        };

        /* The animator's layout: every arc of the lap as a dotted path with a tick on every frame, so the
           spacing shows, tight at the top and open at the bottom. */
        const drawCharts = (t) => {
            const local = R.mod(t, LAP);
            ctx.lineCap = 'round';
            for (const seg of HOPS) {
                const inFlight = local >= seg.start && local < seg.start + seg.dur;
                const after = local - (seg.start + seg.dur);
                const before = seg.start - local;
                let focus = 0;
                if (inFlight) {
                    focus = 1;
                } else if (after >= 0 && after < 0.8) {
                    focus = 1 - R.smoothstep(0, 0.8, after);
                } else if (before > 0 && before < 0.6) {
                    focus = 1 - R.smoothstep(0, 0.6, before);
                }
                const base = seg.to === 0 ? 0.13 : 0.11;
                const alpha = base + (0.36 - base) * focus;
                ctx.setLineDash([0.01, 4.2]);
                ctx.lineWidth = 1.3;
                ctx.strokeStyle = `rgba(255,255,255,${(alpha * 0.9).toFixed(3)})`;
                ctx.beginPath();
                const steps = 28;
                for (let j = 0; j <= steps; j++) {
                    hopPoint(seg, (seg.dur * j) / steps, hp);
                    if (j === 0) {
                        ctx.moveTo(hp.x, hp.y);
                    } else {
                        ctx.lineTo(hp.x, hp.y);
                    }
                }
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineWidth = 1;
                ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
                ctx.beginPath();
                let apexX = 0;
                let apexY = Infinity;
                for (let frame = 0; frame <= seg.frames; frame++) {
                    hopPoint(seg, frame / FPS, hp);
                    const speed = Math.hypot(hp.vx, hp.vy) || 1;
                    const nx = -hp.vy / speed;
                    const ny = hp.vx / speed;
                    const len = frame === 0 || frame === seg.frames ? 6 : 3.2;
                    ctx.moveTo(hp.x - nx * len, hp.y - ny * len);
                    ctx.lineTo(hp.x + nx * len, hp.y + ny * len);
                    if (hp.y < apexY) {
                        apexY = hp.y;
                        apexX = hp.x;
                    }
                }
                ctx.stroke();
                ctx.font = `500 10px ${R.fonts.mono}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = `rgba(154,154,166,${(0.35 + 0.55 * focus).toFixed(3)})`;
                ctx.fillText(`${seg.frames}f`, apexX, apexY - 12);
            }
        };

        // A timing chart for the current move: one tick per frame at its share of the path.
        const CHART_X = 132;
        const CHART_Y = 400;
        const CHART_W = 150;
        const drawTimingChart = (t) => {
            const local = R.mod(t, LAP);
            let seg = HOPS[0];
            let bestGap = Infinity;
            for (const candidate of HOPS) {
                const gap = local < candidate.start ? candidate.start - local : local > candidate.start + candidate.dur ? local - candidate.start - candidate.dur : 0;
                const g2 = Math.min(gap, R.mod(candidate.start - local, LAP));
                if (g2 < bestGap) {
                    bestGap = g2;
                    seg = candidate;
                }
            }
            const lengths = [];
            let total = 0;
            let px = 0;
            let py = 0;
            const sub = 6;
            for (let j = 0; j <= seg.frames * sub; j++) {
                hopPoint(seg, j / (FPS * sub), hp);
                if (j > 0) {
                    total += Math.hypot(hp.x - px, hp.y - py);
                }
                if (j % sub === 0) {
                    lengths.push(total);
                }
                px = hp.x;
                py = hp.y;
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(CHART_X, CHART_Y);
            ctx.lineTo(CHART_X + CHART_W, CHART_Y);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.32)';
            ctx.beginPath();
            for (let frame = 0; frame < lengths.length; frame++) {
                const x = CHART_X + (lengths[frame] / total) * CHART_W;
                const key = frame === 0 || frame === lengths.length - 1;
                ctx.moveTo(x, CHART_Y - (key ? 7 : 4));
                ctx.lineTo(x, CHART_Y + (key ? 7 : 4));
            }
            ctx.stroke();
            ctx.font = `500 10px ${R.fonts.mono}`;
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(154,154,166,0.8)';
            ctx.fillText('spacing', CHART_X, CHART_Y - 13);
            ctx.textAlign = 'right';
            ctx.fillText(`${seg.frames}f`, CHART_X + CHART_W, CHART_Y - 13);
            const inFlight = local >= seg.start && local < seg.start + seg.dur;
            if (inFlight) {
                const frameAt = (local - seg.start) * FPS;
                const k = Math.min(lengths.length - 2, Math.floor(frameAt));
                const frac = (lengths[k] + (lengths[k + 1] - lengths[k]) * (frameAt - k)) / total;
                ctx.beginPath();
                ctx.arc(CHART_X + frac * CHART_W, CHART_Y, 2.6, 0, R.TAU);
                ctx.fillStyle = COLORS[ballAt(t).color];
                ctx.fill();
            }
        };

        const drawBallShape = (shape, fill, alpha, outline) => {
            ctx.save();
            ctx.translate(shape.x, shape.y);
            ctx.rotate(shape.angle);
            ctx.scale(shape.along, shape.across);
            ctx.beginPath();
            ctx.arc(0, 0, RADIUS, 0, R.TAU);
            ctx.restore();
            if (outline) {
                ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            } else {
                ctx.fillStyle = fill;
                ctx.fill();
            }
        };

        const now = { x: 0, y: 0, angle: 0, along: 1, across: 1, color: 0, prev: 0, mix: 1 };
        const onion = [];
        for (let k = 0; k < 6; k++) {
            onion.push({ x: 0, y: 0, angle: 0, along: 1, across: 1 });
        }

        return {
            update() {
                updateLean();
            },
            draw(t) {
                env.clear();
                updateLean();
                ctx.drawImage(grid.canvas, 0, 0, W, H);
                drawCharts(t);
                drawTimingChart(t);
                for (let k = onion.length - 1; k >= 0; k--) {
                    const pose = ballAt(t - (k + 1) * (2 / FPS));
                    onion[k].x = pose.x;
                    onion[k].y = pose.y;
                    onion[k].angle = pose.angle;
                    onion[k].along = pose.along;
                    onion[k].across = pose.across;
                }
                const current = Object.assign(now, ballAt(t));
                for (let i = 0; i < NODES.length; i++) {
                    drawNode(i, t, current);
                }
                for (let k = onion.length - 1; k >= 0; k--) {
                    const fade = 0.3 * (1 - (k + 1) / (onion.length + 1));
                    drawBallShape(onion[k], null, fade, true);
                }
                const color = R.mix(COLORS[current.prev], COLORS[current.color], current.mix);
                const glow = ctx.createRadialGradient(current.x, current.y, 0, current.x, current.y, RADIUS * 3.2);
                glow.addColorStop(0, R.rgba(COLORS[current.color], 0.22));
                glow.addColorStop(1, R.rgba(COLORS[current.color], 0));
                ctx.fillStyle = glow;
                ctx.fillRect(current.x - RADIUS * 3.2, current.y - RADIUS * 3.2, RADIUS * 6.4, RADIUS * 6.4);
                drawBallShape(current, color, 1, false);
                // A small highlight keeps it round and solid while it squashes.
                ctx.save();
                ctx.translate(current.x, current.y);
                ctx.rotate(current.angle);
                ctx.scale(current.along, current.across);
                ctx.rotate(-current.angle);
                ctx.beginPath();
                ctx.ellipse(-RADIUS * 0.32, -RADIUS * 0.36, RADIUS * 0.34, RADIUS * 0.24, -0.6, 0, R.TAU);
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.fill();
                ctx.restore();
                env.fadeEdges(0.8, 1.0);
            },
            resize() {
                paintGrid();
            }
        };
    }
});
