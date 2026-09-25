Reel.add({
    id: 'transit',
    title: 'Transit',
    line: 'Worktrees branch off, do their work and merge back, on time.',
    principles: ['Slow in and slow out', 'Staging'],
    tech: 'Canvas 2D, path choreography with arc-length',
    hint: 'Hover to slow the clock and trace a line',
    poster: 5.9,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;

        const MAIN_Y = 268;
        const RISE = 76;
        const SPEED = 28;
        const UNIT = 520;
        const LINE = 6;
        const CORNER = 30;
        const REVEAL_AT = 446;
        const MERGE_AT = 286;
        const REVEAL = 2.4;
        const DWELL = 0.8;
        const mainColor = '#8e929e';
        const ground = pal.bg;
        const groundRgb = R.hexToRgb(ground);
        const historyRgb = R.hexToRgb('#2a2c34');
        const rgbCache = new Map();
        const rgbOf = (hex) => {
            let value = rgbCache.get(hex);
            if (!value) {
                value = R.hexToRgb(hex);
                rgbCache.set(hex, value);
            }
            return value;
        };
        // Lines are shaded by mixing toward the ground instead of by alpha, so a dimmed line never shows what runs under it.
        const shade = (hex, history, dim) => {
            const base = rgbOf(hex);
            let out = 'rgb(';
            for (let i = 0; i < 3; i++) {
                const aged = base[i] + (historyRgb[i] - base[i]) * history;
                out += Math.round(aged + (groundRgb[i] - aged) * (1 - dim)) + (i < 2 ? ',' : ')');
            }
            return out;
        };

        // A path with 45 degree segments and rounded corners, resampled so any arc length maps to a point.
        const buildPath = (waypoints) => {
            const xs = [];
            const ys = [];
            const push = (x, y) => {
                xs.push(x);
                ys.push(y);
            };
            const straight = (ax, ay, bx, by) => {
                const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
                for (let i = 1; i <= steps; i++) {
                    push(R.lerp(ax, bx, i / steps), R.lerp(ay, by, i / steps));
                }
            };
            let lastX = waypoints[0][0];
            let lastY = waypoints[0][1];
            push(lastX, lastY);
            for (let k = 1; k < waypoints.length - 1; k++) {
                const [px, py] = waypoints[k - 1];
                const [cx, cy] = waypoints[k];
                const [nx, ny] = waypoints[k + 1];
                const la = Math.hypot(cx - px, cy - py);
                const lb = Math.hypot(nx - cx, ny - cy);
                const ax = (cx - px) / la;
                const ay = (cy - py) / la;
                const bx = (nx - cx) / lb;
                const by = (ny - cy) / lb;
                const turn = Math.acos(R.clamp(ax * bx + ay * by, -1, 1));
                const reach = Math.min(CORNER * Math.tan(turn / 2), la / 2, lb / 2);
                const t1x = cx - ax * reach;
                const t1y = cy - ay * reach;
                const t2x = cx + bx * reach;
                const t2y = cy + by * reach;
                straight(lastX, lastY, t1x, t1y);
                for (let i = 1; i <= 10; i++) {
                    const along = i / 10;
                    const inv = 1 - along;
                    push(inv * inv * t1x + 2 * inv * along * cx + along * along * t2x, inv * inv * t1y + 2 * inv * along * cy + along * along * t2y);
                }
                lastX = t2x;
                lastY = t2y;
            }
            const end = waypoints[waypoints.length - 1];
            straight(lastX, lastY, end[0], end[1]);
            const count = xs.length;
            const path = { x: new Float32Array(xs), y: new Float32Array(ys), s: new Float32Array(count), n: count, length: 0 };
            for (let i = 1; i < count; i++) {
                path.s[i] = path.s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
            }
            path.length = path.s[count - 1];
            return path;
        };

        const sampleAt = (path, distance, out) => {
            const clamped = R.clamp(distance, 0, path.length);
            let lo = 0;
            let hi = path.n - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (path.s[mid] <= clamped) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            const span = path.s[hi] - path.s[lo] || 1;
            const along = (clamped - path.s[lo]) / span;
            out.x = R.lerp(path.x[lo], path.x[hi], along);
            out.y = R.lerp(path.y[lo], path.y[hi], along);
            out.angle = Math.atan2(path.y[hi] - path.y[lo], path.x[hi] - path.x[lo]);
            return out;
        };

        const arcAtX = (path, x, from) => {
            for (let i = 1; i < path.n; i++) {
                if (path.s[i] >= from && path.x[i] >= x) {
                    return path.s[i];
                }
            }
            return path.length;
        };

        // Templates: a branch leaves its parent line at local x 0 and joins it again `span` later.
        const template = (flat, dir, lead) => {
            const rise = RISE * dir;
            const span = RISE * 2 + flat;
            const path = buildPath([
                [-lead, 0],
                [0, 0],
                [RISE, rise],
                [RISE + flat, rise],
                [span, 0],
                [span + lead, 0]
            ]);
            return { path, span, rise, dir, splitS: lead, mergeS: path.length - lead, flatStart: RISE, flatEnd: RISE + flat };
        };
        const upper = template(290, -1, 24);
        const lower = template(252, 1, 24);
        // A child joins its parent's flat stretch, so its lead is only as long as its own rounded corner.
        const nested = template(76, -1, 13);
        const withStations = (tpl, xs) => {
            tpl.stops = [tpl.splitS];
            for (const x of xs) {
                tpl.stops.push(arcAtX(tpl.path, x, tpl.splitS + 10));
            }
            tpl.stops.push(tpl.mergeS);
            return tpl;
        };
        withStations(upper, [156, 250]);
        withStations(lower, [120, 214, 296]);
        withStations(nested, [114]);

        const upperNames = ['feat/saved-carts', 'feat/search', 'feat/dark-mode', 'feat/checkout'];
        const lowerNames = ['fix/flaky-test', 'fix/auth-redirect', 'fix/cache-miss', 'fix/slow-build'];
        const nestedNames = ['agent/trace', 'agent/review'];
        const upperColors = [pal.magenta, pal.running, pal.magenta, pal.running];
        const lowerColors = [pal.needs, pal.idle, pal.needs, pal.idle];

        const branchesOf = (k) => {
            const origin = k * UNIT;
            const list = [];
            const wrap = (value, size) => ((value % size) + size) % size;
            const upperBranch = {
                key: 'u' + k,
                tpl: upper,
                x: origin,
                y: MAIN_Y,
                color: upperColors[wrap(k, 4)],
                name: upperNames[wrap(k, 4)],
                parent: null
            };
            if (wrap(k, 2) === 0) {
                list.push({
                    key: 'n' + k,
                    tpl: nested,
                    x: origin + 104,
                    y: MAIN_Y - RISE,
                    color: pal.cyan,
                    name: nestedNames[wrap(k / 2, 2)],
                    parent: upperBranch
                });
            }
            list.push(upperBranch);
            list.push({
                key: 'd' + k,
                tpl: lower,
                x: origin + 262,
                y: MAIN_Y,
                color: lowerColors[wrap(k, 4)],
                name: lowerNames[wrap(k, 4)],
                parent: null
            });
            return list;
        };

        // Constant acceleration, a cruise and constant braking: the way a train covers one leg.
        const ACCEL = 0.32;
        const vmax = 1 / (1 - ACCEL);
        const trapezoid = (progress) => {
            if (progress <= 0) {
                return 0;
            }
            if (progress >= 1) {
                return 1;
            }
            if (progress < ACCEL) {
                return (0.5 * vmax * progress * progress) / ACCEL;
            }
            if (progress > 1 - ACCEL) {
                return 1 - (0.5 * vmax * (1 - progress) * (1 - progress)) / ACCEL;
            }
            return 0.5 * vmax * ACCEL + vmax * (progress - ACCEL);
        };

        const timing = (branch) => {
            const tpl = branch.tpl;
            const reveal = (branch.x - REVEAL_AT) / SPEED;
            const depart = reveal + REVEAL + 0.5;
            const arrive = (branch.x + tpl.span - MERGE_AT) / SPEED;
            return { reveal, depart, arrive };
        };

        const trainAt = (branch, clock, when) => {
            const stops = branch.tpl.stops;
            const legs = stops.length - 1;
            const travel = when.arrive - when.depart - DWELL * (legs - 1);
            const total = stops[legs] - stops[0];
            let start = when.depart;
            if (clock < start) {
                return stops[0];
            }
            for (let i = 0; i < legs; i++) {
                const span = ((stops[i + 1] - stops[i]) / total) * travel;
                if (clock < start + span) {
                    return stops[i] + (stops[i + 1] - stops[i]) * trapezoid((clock - start) / span);
                }
                start += span;
                if (i < legs - 1) {
                    if (clock < start + DWELL) {
                        return stops[i + 1];
                    }
                    start += DWELL;
                }
            }
            return stops[legs];
        };

        let clock = 0;
        const highlight = new Map();
        const point = { x: 0, y: 0, angle: 0 };

        const visibleBranches = (camera) => {
            const list = [];
            const first = Math.floor((camera - 700) / UNIT);
            const last = Math.ceil((camera + 600) / UNIT);
            for (let k = first; k <= last; k++) {
                for (const branch of branchesOf(k)) {
                    list.push(branch);
                }
            }
            return list;
        };

        const cameraAt = (time) => SPEED * time;

        const strokePartial = (branch, camera, upto) => {
            const path = branch.tpl.path;
            const ox = branch.x - camera;
            const oy = branch.y;
            ctx.beginPath();
            ctx.moveTo(path.x[0] + ox, path.y[0] + oy);
            for (let i = 1; i < path.n; i++) {
                if (path.s[i] > upto) {
                    sampleAt(path, upto, point);
                    ctx.lineTo(point.x + ox, point.y + oy);
                    break;
                }
                ctx.lineTo(path.x[i] + ox, path.y[i] + oy);
            }
            ctx.stroke();
        };

        const pill = (x, y, fill, scale) => {
            if (scale <= 0.01) {
                return;
            }
            const width = 18 * scale;
            const height = 11 * scale;
            ctx.fillStyle = ground;
            R.roundRect(ctx, x - width / 2 - 2, y - height / 2 - 2, width + 4, height + 4, height / 2 + 2);
            ctx.fill();
            ctx.fillStyle = fill;
            R.roundRect(ctx, x - width / 2, y - height / 2, width, height, height / 2);
            ctx.fill();
        };

        const station = (x, y, scale, fill) => {
            ctx.fillStyle = ground;
            ctx.beginPath();
            ctx.arc(x, y, 6.2 * scale, 0, R.TAU);
            ctx.fill();
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.arc(x, y, 4 * scale, 0, R.TAU);
            ctx.fill();
        };

        return {
            update(t, dt) {
                const pointer = env.pointer;
                // Hover slows the clock itself, so the whole map drifts instead of stopping dead.
                clock += dt * (1 - 0.82 * pointer.active);
                const camera = cameraAt(clock);
                let best = null;
                let bestDistance = 34;
                if (pointer.active > 0.05) {
                    for (const branch of visibleBranches(camera)) {
                        const when = timing(branch);
                        if (clock < when.reveal + REVEAL * 0.5) {
                            continue;
                        }
                        const path = branch.tpl.path;
                        for (let i = 0; i < path.n; i += 3) {
                            const distance = Math.hypot(path.x[i] + branch.x - camera - pointer.x, path.y[i] + branch.y - pointer.y);
                            if (distance < bestDistance) {
                                bestDistance = distance;
                                best = branch.key;
                            }
                        }
                    }
                    if (!best && Math.abs(pointer.y - MAIN_Y) < 26) {
                        best = 'main';
                    }
                }
                const rate = 1 - Math.exp(-dt * 8);
                if (best && !highlight.has(best)) {
                    highlight.set(best, 0);
                }
                for (const [key, value] of highlight) {
                    const next = value + ((key === best ? 1 : 0) - value) * rate;
                    if (next < 0.001 && key !== best) {
                        highlight.delete(key);
                    } else {
                        highlight.set(key, next);
                    }
                }
            },
            draw(t) {
                env.clear();
                const camera = cameraAt(clock);
                const branches = visibleBranches(camera);
                let focus = 0;
                for (const value of highlight.values()) {
                    focus = Math.max(focus, value);
                }
                const dimOthers = (key) => {
                    const own = highlight.get(key) || 0;
                    return 1 - 0.62 * focus * (1 - own);
                };
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // Lines, children before parents so a parent covers the stretch it shares with its child.
                for (const branch of branches) {
                    const when = timing(branch);
                    const progress = R.ease.inOutCubic((clock - when.reveal) / REVEAL);
                    if (progress <= 0) {
                        continue;
                    }
                    const tpl = branch.tpl;
                    const upto = tpl.splitS + (tpl.path.length - tpl.splitS) * progress;
                    const merged = R.smoothstep(when.arrive + 0.4, when.arrive + 1.8, clock);
                    ctx.strokeStyle = shade(branch.color, merged * 0.62, dimOthers(branch.key));
                    ctx.lineWidth = LINE;
                    strokePartial(branch, camera, upto);
                }
                ctx.strokeStyle = shade(mainColor, 0, dimOthers('main'));
                ctx.lineWidth = LINE;
                ctx.beginPath();
                ctx.moveTo(-20, MAIN_Y);
                ctx.lineTo(env.W + 20, MAIN_Y);
                ctx.stroke();

                // Stations and interchanges.
                for (const branch of branches) {
                    const when = timing(branch);
                    const since = clock - when.reveal;
                    if (since <= 0) {
                        continue;
                    }
                    const tpl = branch.tpl;
                    const ox = branch.x - camera;
                    const alpha = dimOthers(branch.key);
                    ctx.globalAlpha = alpha;
                    const reached = tpl.splitS + (tpl.path.length - tpl.splitS) * R.ease.inOutCubic(since / REVEAL);
                    const train = trainAt(branch, clock, when);
                    for (let i = 1; i < tpl.stops.length - 1; i++) {
                        const stop = tpl.stops[i];
                        if (stop > reached) {
                            continue;
                        }
                        sampleAt(tpl.path, stop, point);
                        const pop = R.ease.outBack(R.clamp((reached - stop) / 60), 2.2);
                        const here = Math.abs(train - stop) < 1 && clock > when.depart && clock < when.arrive ? 1 : 0;
                        station(point.x + ox, point.y + branch.y, pop * (1 + 0.18 * here), pal.text);
                    }
                    const splitPop = R.ease.outBack(R.clamp(since / 0.5), 2.4);
                    pill(ox, branch.y, pal.text, splitPop);
                    if (reached >= tpl.mergeS - 1) {
                        const flash = R.clamp(1 - Math.abs(clock - when.arrive - 0.25) / 0.6);
                        const mergePop = R.ease.outBack(R.clamp((reached - tpl.mergeS + 40) / 40), 2.4);
                        pill(ox + tpl.span, branch.y, flash > 0 ? R.mix(pal.text, branch.color, flash) : pal.text, mergePop * (1 + 0.25 * flash));
                    }
                    ctx.globalAlpha = 1;
                }

                // Trains.
                for (const branch of branches) {
                    const when = timing(branch);
                    if (clock < when.depart - 0.5 || clock > when.arrive + 1) {
                        continue;
                    }
                    const tpl = branch.tpl;
                    const along = trainAt(branch, clock, when);
                    sampleAt(tpl.path, along, point);
                    const appear = R.ease.outCubic(R.clamp((clock - when.depart + 0.5) / 0.5));
                    const leave = R.ease.inCubic(R.clamp((clock - when.arrive - 0.3) / 0.6));
                    const size = appear * (1 - leave);
                    if (size <= 0.01) {
                        continue;
                    }
                    ctx.save();
                    ctx.globalAlpha = dimOthers(branch.key);
                    ctx.translate(point.x + branch.x - camera, point.y + branch.y);
                    ctx.rotate(point.angle);
                    ctx.scale(size, size);
                    ctx.fillStyle = ground;
                    R.roundRect(ctx, -12, -6.5, 24, 13, 6.5);
                    ctx.fill();
                    ctx.fillStyle = '#f4f5f8';
                    R.roundRect(ctx, -10, -4.5, 20, 9, 4.5);
                    ctx.fill();
                    ctx.fillStyle = branch.color;
                    R.roundRect(ctx, 3, -2.5, 5, 5, 2.5);
                    ctx.fill();
                    ctx.restore();
                }

                // Merge pulses: a ring in the branch's color when it joins its parent.
                for (const branch of branches) {
                    const when = timing(branch);
                    const age = clock - when.arrive;
                    if (age < 0 || age > 1.4) {
                        continue;
                    }
                    const grow = R.ease.outCubic(age / 1.4);
                    ctx.strokeStyle = R.rgba(branch.color, 0.7 * (1 - grow));
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(branch.x - camera + branch.tpl.span, branch.y, 10 + grow * 30, 0, R.TAU);
                    ctx.stroke();
                }

                // Labels.
                ctx.font = '500 12px ' + R.fonts.mono;
                for (const branch of branches) {
                    const when = timing(branch);
                    const shown = R.smoothstep(0.35, 0.8, (clock - when.reveal) / REVEAL);
                    if (shown <= 0) {
                        continue;
                    }
                    const tpl = branch.tpl;
                    const merged = R.smoothstep(when.arrive + 0.4, when.arrive + 1.8, clock);
                    const own = highlight.get(branch.key) || 0;
                    const x = branch.x - camera + tpl.flatStart + 6;
                    const y = branch.y + tpl.rise + (tpl.dir < 0 ? -14 : 24);
                    ctx.globalAlpha = shown * dimOthers(branch.key) * (0.95 - 0.5 * merged + 0.05 * own);
                    ctx.fillStyle = R.mix(branch.color, pal.text, 0.25 + 0.4 * own);
                    ctx.fillText(branch.name, x, y);
                }
                ctx.globalAlpha = dimOthers('main') * 0.9;
                ctx.fillStyle = pal.muted;
                ctx.fillText('main', 96, MAIN_Y + 24);
                ctx.globalAlpha = 1;

                env.fadeEdges(0.6, 0.98);
            }
        };
    }
});
