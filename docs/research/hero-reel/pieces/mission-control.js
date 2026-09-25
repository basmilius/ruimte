Reel.add({
    id: 'mission-control',
    title: 'All Hands',
    line: 'Every session on every machine, at a glance.',
    principles: ['Timing', 'Staging'],
    tech: 'Canvas 2D, status field at scale',
    hint: 'Move over the field to read a session',
    poster: 5.2,
    create(env) {
        const { R } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const ease = R.ease;
        const phase = R.phase;

        const CYCLE = 20;
        const ZOOM = 1.12;
        const CENTER_Y = 262;
        const TILE_W = 26;
        const TILE_H = 20;
        const GAP = 6;
        const X0 = 204;
        const LABEL_X = 96;
        const BANDS = [
            { name: 'studio', detail: 'Mac Studio', icon: 'monitor', count: 16, perRow: 8, y: 138 },
            { name: 'build server', detail: 'Linux', icon: 'server', count: 14, perRow: 7, y: 222 },
            { name: 'macbook', detail: 'This Mac', icon: 'laptop', count: 10, perRow: 5, y: 306 }
        ];
        const COLORS = { running: pal.running, needs: pal.needs, done: pal.idle, error: pal.error, retry: pal.muted };
        const TASKS = [
            'saved carts', 'fix flaky test', 'bundle size', 'query analysis', 'request tracing', 'migrate auth', 'docs sweep',
            'perf budget', 'release notes', 'type errors', 'cache headers', 'retry policy', 'image sizes', 'feature flags',
            'error pages', 'seed data', 'rate limits', 'webhooks', 'search index', 'onboarding'
        ];

        /* Every tile's day, as events over one cycle; the state before the first event is the last one, so it loops. */
        const tiles = [];
        {
            const rand = R.rng(4210);
            BANDS.forEach((band, bandIndex) => {
                for (let i = 0; i < band.count; i++) {
                    const col = i % band.perRow;
                    const row = Math.floor(i / band.perRow);
                    let events;
                    if (bandIndex === 0 && i === 5) {
                        events = [[0, 'done'], [1.3, 'running'], [3.4, 'needs'], [8.4, 'running'], [15.6, 'done']];
                    } else if (bandIndex === 1 && i === 9) {
                        events = [[0, 'running'], [12.4, 'needs'], [17.3, 'running']];
                    } else if (bandIndex === 1 && i === 3) {
                        events = [[0, 'done'], [5.6, 'running'], [10.2, 'error'], [11.4, 'retry'], [12.5, 'running'], [18.4, 'done']];
                    } else if (rand() < 0.62) {
                        // Starts ripple along a machine's row a beat apart, and the rows and machines are spread
                        // over the cycle, so the field is always about as busy.
                        const start = R.mod(bandIndex * 6.7 + col * 2.9 + row * 9.3 + rand() * 0.8, CYCLE);
                        const length = 8.5 + rand() * 4.5;
                        events = [[start, 'running'], [R.mod(start + length, CYCLE), 'done']].sort((one, two) => one[0] - two[0]);
                        rand();
                    } else {
                        events = [[0, 'done']];
                        rand();
                        rand();
                    }
                    tiles.push({
                        band: bandIndex,
                        x: X0 + col * (TILE_W + GAP),
                        y: band.y + row * (TILE_H + GAP),
                        events,
                        agent: rand() < 0.7 ? 'claude' : 'codex',
                        task: TASKS[(i * 7 + bandIndex * 3) % TASKS.length],
                        seed: rand() * 10
                    });
                }
            });
        }

        const stateOut = { state: 'done', prev: 'done', since: 0 };
        const stateAt = (tile, t, out) => {
            const events = tile.events;
            let index = -1;
            for (let i = 0; i < events.length; i++) {
                if (events[i][0] <= t) {
                    index = i;
                }
            }
            const current = index < 0 ? events.length - 1 : index;
            const at = index < 0 ? events[current][0] - CYCLE : events[current][0];
            const before = events[(current - 1 + events.length) % events.length];
            out.state = events[current][1];
            out.prev = events.length > 1 ? before[1] : out.state;
            out.since = events.length > 1 ? t - at : 99;
            return out;
        };

        const counts = { running: 0, needs: 0, done: 0 };
        const countAt = (t, out) => {
            out.running = 0;
            out.needs = 0;
            out.done = 0;
            for (const tile of tiles) {
                const state = stateAt(tile, R.mod(t, CYCLE), stateOut).state;
                if (state === 'done') {
                    out.done++;
                } else if (state === 'needs') {
                    out.needs++;
                } else {
                    out.running++;
                }
            }
            return out;
        };
        const earlier = { running: 0, needs: 0, done: 0 };

        // How much the field steps back while one session asks for a person: in, hold, and ease back part way.
        const spotlight = (t) => {
            let value = 0;
            for (const tile of tiles) {
                for (const event of tile.events) {
                    if (event[1] !== 'needs') {
                        continue;
                    }
                    const local = R.mod(t - event[0] + 0.3, CYCLE) - 0.3;
                    const rise = ease.inOutSine(phase(local, -0.1, 0.4));
                    const fall = ease.inOutSine(phase(local, 1.8, 1.0));
                    value = Math.max(value, rise * (1 - fall * 0.6) * (local < 5 ? 1 : 1 - phase(local, 4.6, 0.5)));
                }
            }
            return value;
        };

        const machineIcon = (name, x, y) => {
            ctx.strokeStyle = pal.muted;
            ctx.lineWidth = 1.3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            if (name === 'monitor') {
                R.roundRect(ctx, x - 6, y - 5, 12, 8, 1.5);
                ctx.moveTo(x - 3, y + 6);
                ctx.lineTo(x + 3, y + 6);
                ctx.moveTo(x, y + 3);
                ctx.lineTo(x, y + 6);
            } else if (name === 'server') {
                R.roundRect(ctx, x - 6, y - 6, 12, 5, 1.2);
                ctx.stroke();
                ctx.beginPath();
                R.roundRect(ctx, x - 6, y + 1, 12, 5, 1.2);
            } else {
                R.roundRect(ctx, x - 5, y - 5, 10, 7, 1.5);
                ctx.moveTo(x - 7, y + 4.5);
                ctx.lineTo(x + 7, y + 4.5);
            }
            ctx.stroke();
        };

        // A load history per machine: periodic in the cycle, and louder the more of its sessions are working.
        const load = (bandIndex, t) => {
            const phaseA = (t / CYCLE) * 7 + bandIndex * 0.31;
            const phaseB = (t / CYCLE) * 13 + bandIndex * 0.77;
            return 0.5 + 0.28 * Math.sin(phaseA * R.TAU) + 0.18 * Math.sin(phaseB * R.TAU + 1.3);
        };
        const busyOf = (bandIndex, t) => {
            let busy = 0;
            let all = 0;
            for (const tile of tiles) {
                if (tile.band !== bandIndex) {
                    continue;
                }
                all++;
                const state = stateAt(tile, R.mod(t, CYCLE), stateOut).state;
                if (state !== 'done') {
                    busy++;
                }
            }
            return busy / all;
        };

        const drawLabels = (t, dim) => {
            BANDS.forEach((band, bandIndex) => {
                const y = band.y;
                ctx.globalAlpha = 1 - dim * 0.35;
                machineIcon(band.icon, LABEL_X + 6, y + 6);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.font = '500 13px ' + R.fonts.display;
                ctx.fillStyle = pal.text;
                ctx.fillText(band.name, LABEL_X + 20, y + 6.5);
                ctx.font = '400 12px ' + R.fonts.mono;
                ctx.fillStyle = pal.faint;
                ctx.fillText(band.detail, LABEL_X + 20, y + 23);
                const busy = busyOf(bandIndex, t);
                for (let i = 0; i < 14; i++) {
                    const sample = R.clamp(load(bandIndex, t - (13 - i) * 0.22) * (0.3 + busy * 1.1));
                    const height = Math.max(1.5, Math.round(sample * 12));
                    ctx.fillStyle = i === 13 ? R.rgba(pal.running, 0.9) : R.rgba(pal.muted, 0.22 + (i / 13) * 0.3);
                    ctx.fillRect(LABEL_X + 20 + i * 4, y + 44 - height, 2.5, height);
                }
                ctx.globalAlpha = 1;
            });
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            for (let i = 1; i < BANDS.length; i++) {
                ctx.fillRect(LABEL_X, BANDS[i].y - 17, 360, 1);
            }
        };

        const drawTile = (tile, t, scale, dim, info) => {
            const { state, prev, since } = info;
            const k = ease.outCubic(R.clamp(since / 0.45));
            const color = R.mix(COLORS[prev], COLORS[state], k);
            const cx = tile.x + TILE_W / 2;
            const cy = tile.y + TILE_H / 2;
            let pop = 1;
            if (state === 'needs') {
                // A small draw in before it lifts: the tile asks, it does not jump.
                pop = since < 0.2 ? R.lerp(1, 0.9, ease.outQuad(since / 0.2)) : R.lerp(0.9, 1, ease.outBack(R.clamp((since - 0.2) / 0.45), 3));
            } else if (state === 'done' && since < 0.6) {
                pop = 1 + Math.sin((since / 0.6) * Math.PI) * 0.06;
            }
            let shake = 0;
            if (state === 'error' && since < 0.5) {
                shake = Math.sin(since * 48) * 2.2 * (1 - since / 0.5);
            }
            const focus = state === 'needs' ? 0 : dim;
            ctx.save();
            ctx.globalAlpha = 1 - focus * 0.55;
            ctx.translate(cx + shake, cy);
            ctx.scale(scale * pop, scale * pop);
            ctx.translate(-TILE_W / 2, -TILE_H / 2);
            ctx.fillStyle = pal.surface;
            R.roundRect(ctx, 0, 0, TILE_W, TILE_H, 4);
            ctx.fill();
            ctx.fillStyle = pal.raised;
            R.roundRect(ctx, 0, 0, TILE_W, 6, 4);
            ctx.fill();
            ctx.fillRect(0, 3, TILE_W, 3);
            let border = 'rgba(255,255,255,0.08)';
            if (state === 'needs') {
                border = R.rgba(pal.needs, 0.55 * k);
            } else if (state === 'error') {
                border = R.rgba(pal.error, 0.5 * k);
            }
            ctx.strokeStyle = border;
            ctx.lineWidth = 1;
            R.roundRect(ctx, 0.5, 0.5, TILE_W - 1, TILE_H - 1, 4);
            ctx.stroke();

            // Two lines of activity: a working session shimmers, a finished one lies still.
            const working = state === 'running' || state === 'retry' ? 1 : 0;
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.fillRect(4, 10, 14 + (tile.seed % 4), 1.5);
            ctx.fillRect(4, 14, 9 + ((tile.seed * 3) % 6), 1.5);
            if (working || (prev === 'running' && state === 'done' && k < 1)) {
                const strength = working ? R.clamp(since / 0.4) : 1 - k;
                const sweep = R.fract(t * 0.6 + tile.seed * 0.13);
                ctx.fillStyle = R.rgba(pal.running, 0.55 * strength);
                ctx.fillRect(4 + sweep * 14, 10, 5, 1.5);
            }
            let dotAlpha = 1;
            if (state === 'running') {
                dotAlpha = 0.6 + 0.4 * Math.cos(((t + tile.seed) / 2) * R.TAU);
            }
            if (state === 'retry') {
                ctx.strokeStyle = R.rgba(pal.muted, 0.9);
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                const spin = t * 7;
                ctx.arc(TILE_W - 5, 3.5, 2.4, spin, spin + 4.2);
                ctx.stroke();
            } else {
                const grow = state === 'done' && since < 0.5 ? 1 + (1 - ease.outBack(since / 0.5, 3)) * 0.8 : 1;
                ctx.fillStyle = color;
                ctx.globalAlpha *= dotAlpha;
                ctx.beginPath();
                ctx.arc(TILE_W - 5, 3.5, 2.2 * grow, 0, R.TAU);
                ctx.fill();
            }
            ctx.restore();
            if (state === 'needs') {
                // A gentle ring that keeps asking without shouting.
                for (let i = 0; i < 2; i++) {
                    const ring = R.fract((since - 0.3) / 1.8 + i * 0.5);
                    if (since < 0.3 + i * 0.9) {
                        continue;
                    }
                    ctx.strokeStyle = R.rgba(pal.needs, 0.5 * (1 - ring));
                    ctx.lineWidth = 1.2;
                    R.roundRect(ctx, tile.x - ring * 7, tile.y - ring * 7, TILE_W + ring * 14, TILE_H + ring * 14, 4 + ring * 5);
                    ctx.stroke();
                }
            }
        };

        const drawCounter = (t, dim) => {
            countAt(t, counts);
            countAt(t - 0.3, earlier);
            const chips = [
                { key: 'running', label: 'running', color: pal.running },
                { key: 'needs', label: 'needs you', color: pal.needs },
                { key: 'done', label: 'done', color: pal.idle }
            ];
            ctx.font = '500 12px ' + R.fonts.mono;
            const widths = chips.map((chip) => ctx.measureText('00 ' + chip.label).width + 26);
            const total = widths.reduce((sum, width) => sum + width, 0) + 8 * 2;
            let x = 280 - total / 2;
            const y = 390;
            ctx.textBaseline = 'middle';
            chips.forEach((chip, i) => {
                const value = counts[chip.key];
                const was = earlier[chip.key];
                const quiet = chip.key === 'needs' && value === 0 && was === 0;
                const lit = chip.key === 'needs' ? Math.max(value > 0 ? 1 : 0, dim) : 0;
                ctx.fillStyle = lit > 0 ? R.rgba(pal.needs, 0.1 * lit) : 'rgba(255,255,255,0.03)';
                R.roundRect(ctx, x, y - 13, widths[i], 26, 8);
                ctx.fill();
                ctx.strokeStyle = lit > 0 ? R.rgba(pal.needs, 0.25 * lit) : pal.border;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.globalAlpha = quiet ? 0.45 : 1;
                ctx.fillStyle = chip.color;
                ctx.beginPath();
                ctx.arc(x + 12, y, 3, 0, R.TAU);
                ctx.fill();
                ctx.textAlign = 'right';
                const numberRight = x + 22 + ctx.measureText('00').width;
                ctx.save();
                ctx.beginPath();
                ctx.rect(x + 18, y - 10, numberRight - x - 16, 20);
                ctx.clip();
                if (value !== was) {
                    // The number rolls like a counter: the old one leaves upward as the new one arrives.
                    const roll = ease.inOutCubic(R.clamp(changeAge(chip.key, t) / 0.3));
                    ctx.fillStyle = pal.text;
                    ctx.fillText(String(was), numberRight, y + 0.5 - roll * 14);
                    ctx.fillText(String(value), numberRight, y + 0.5 + (1 - roll) * 14);
                } else {
                    ctx.fillStyle = pal.text;
                    ctx.fillText(String(value), numberRight, y + 0.5);
                }
                ctx.restore();
                ctx.textAlign = 'left';
                ctx.fillStyle = pal.muted;
                ctx.fillText(chip.label, numberRight + 7, y + 0.5);
                ctx.globalAlpha = 1;
                x += widths[i] + 8;
            });
        };
        // Seconds since the count of `key` last changed, looked back over a short window.
        const probe = { running: 0, needs: 0, done: 0 };
        const changeAge = (key, t) => {
            const now = countAt(t, probe)[key];
            for (let back = 0.03; back <= 0.3; back += 0.03) {
                if (countAt(t - back, probe)[key] !== now) {
                    return back;
                }
            }
            return 0.3;
        };

        const infos = tiles.map(() => ({ state: 'done', prev: 'done', since: 0 }));
        const order = tiles.map((tile, i) => i);
        const scales = new Float32Array(tiles.length);

        const drawTooltip = (tile, info, scale) => {
            const text = tile.agent + '  ' + tile.task;
            ctx.font = '500 12px ' + R.fonts.display;
            const width = ctx.measureText(text).width + 32;
            const x = R.clamp(tile.x + TILE_W / 2 - width / 2, 70, 490 - width);
            const y = tile.y - 12 - (scale - 1) * 14 - 26;
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            R.roundRect(ctx, x, y + 2, width, 24, 8);
            ctx.fill();
            ctx.fillStyle = pal.raised;
            R.roundRect(ctx, x, y, width, 24, 8);
            ctx.fill();
            ctx.strokeStyle = pal.borderStrong;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = COLORS[info.state];
            ctx.beginPath();
            ctx.arc(x + 12, y + 12, 3, 0, R.TAU);
            ctx.fill();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = pal.muted;
            ctx.fillText(tile.agent, x + 21, y + 12.5);
            ctx.fillStyle = pal.text;
            ctx.fillText(tile.task, x + 21 + ctx.measureText(tile.agent + '  ').width, y + 12.5);
        };

        return {
            draw(time) {
                const t = R.mod(time, CYCLE);
                env.clear();
                const raw = env.pointer;
                const pointer = { x: (raw.x - 280) / ZOOM + 280, y: (raw.y - CENTER_Y) / ZOOM + CENTER_Y, active: raw.active };
                ctx.save();
                ctx.translate(280, CENTER_Y);
                ctx.scale(ZOOM, ZOOM);
                ctx.translate(-280, -CENTER_Y);
                const dim = spotlight(t);
                drawLabels(t, dim);

                let nearest = -1;
                let nearestDist = 1e9;
                for (let i = 0; i < tiles.length; i++) {
                    const tile = tiles[i];
                    stateAt(tile, t, infos[i]);
                    const dx = pointer.x - (tile.x + TILE_W / 2);
                    const dy = pointer.y - (tile.y + TILE_H / 2);
                    const distance = Math.hypot(dx, dy);
                    // A loupe: the tiles under the pointer swell, their neighbors a little less.
                    scales[i] = 1 + 0.42 * pointer.active * Math.exp(-(distance * distance) / (2 * 30 * 30));
                    if (distance < nearestDist) {
                        nearestDist = distance;
                        nearest = i;
                    }
                }
                order.sort((one, two) => scales[one] - scales[two]);
                for (const i of order) {
                    drawTile(tiles[i], t, scales[i], dim, infos[i]);
                }
                drawCounter(t, dim);
                if (nearest >= 0 && pointer.active > 0.3 && nearestDist < 26) {
                    ctx.globalAlpha = R.clamp((pointer.active - 0.3) * 2);
                    drawTooltip(tiles[nearest], infos[nearest], scales[nearest]);
                    ctx.globalAlpha = 1;
                }
                ctx.restore();
                env.fadeEdges(0.76, 1.04);
            }
        };
    }
});
