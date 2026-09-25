Reel.add({
    id: 'split-flap',
    title: 'Split-Flap',
    line: 'Every session on one board. It flips when an agent needs you.',
    principles: ['Timing', 'Follow through and overlapping action'],
    tech: 'Canvas 2D, mechanical flap cascade, glyph atlas',
    hint: 'Hover a row to flip it',
    poster: 2.3,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const PI = Math.PI;

        const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.:/';
        const DRUM_N = DRUM.length;
        const DRUM_INDEX = {};
        for (let i = 0; i < DRUM_N; i++) {
            DRUM_INDEX[DRUM[i]] = i;
        }

        const CW = 11.5;
        const CH = 23;
        const HALF = CH / 2;
        const CG = 1.5;
        const GROUP_GAP = 11;
        const GROUPS = [6, 14, 9];
        const COLS = 29;
        const ROWS = 6;
        const ROW_PITCH = 30;
        const HEADER = 17;
        const PAD_X = 14;
        const PAD_Y = 12;
        const FONT_SIZE = 14.5;

        const colX = [];
        const groupStart = [];
        {
            let x = 0;
            for (let group = 0; group < GROUPS.length; group++) {
                groupStart.push(x);
                for (let i = 0; i < GROUPS[group]; i++) {
                    colX.push(x);
                    x += CW + CG;
                }
                x += GROUP_GAP - CG;
            }
        }
        const cellsW = colX[COLS - 1] + CW;
        const LAMP_X = cellsW + 13;
        const innerW = LAMP_X + 6;
        const innerH = HEADER + ROWS * ROW_PITCH - (ROW_PITCH - CH);
        const BOARD_W = innerW + PAD_X * 2;
        const BOARD_H = innerH + PAD_Y * 2;
        // Board space has its origin at the center of the board.
        const LEFT = -innerW / 2;
        const TOP = -innerH / 2;
        const CX = W / 2;
        const CY = H / 2 + 2;

        // Every row is a ring of messages. The schedule steps rows through their rings; a hover steps one more.
        const MESSAGES = [
            [
                ['CLAUDE', 'REFACTOR AUTH', 'RUNNING'],
                ['CLAUDE', 'REFACTOR AUTH', 'NEEDS YOU']
            ],
            [
                ['CODEX', 'FIX FLAKY TEST', 'RUNNING'],
                ['CODEX', 'FIX FLAKY TEST', 'DONE']
            ],
            [
                ['ZSH', 'NPM RUN DEV', 'RUNNING'],
                ['ZSH', 'NPM RUN BUILD', 'DONE']
            ],
            [
                ['CLAUDE', 'TRACE CHECKOUT', 'NEEDS YOU'],
                ['CLAUDE', 'TRACE CHECKOUT', 'RUNNING']
            ],
            [
                ['CODEX', 'BUILD SITE', 'DONE'],
                ['CLAUDE', 'REVIEW PR 214', 'RUNNING']
            ],
            [
                ['CODEX', 'UPDATE DOCS', 'RUNNING'],
                ['ZSH', 'BUN TEST', 'DONE']
            ]
        ];
        const pad = (text, size) => (text + ' '.repeat(size)).slice(0, size);
        const RINGS = MESSAGES.map((ring) =>
            ring.map((message) => ({
                chars: pad(message[0], 6) + pad(message[1], 14) + pad(message[2], 9),
                status: message[2]
            }))
        );
        const STATUS_COLOR = { RUNNING: pal.running, 'NEEDS YOU': pal.needs, DONE: pal.idle };

        const LOOP = 18;
        // Two steps per row per loop, so every ring is back where it started when the loop wraps.
        const SCHEDULE = [0, 3, 4, 5, 1, 0, 3, 5, 1, 4].map((row, i) => [0.8 + i * 1.8, row]);
        const perLoop = new Array(ROWS).fill(0);
        const lastInLoop = new Array(ROWS).fill(-Infinity);
        for (const [time, row] of SCHEDULE) {
            perLoop[row]++;
            lastInLoop[row] = Math.max(lastInLoop[row], time);
        }

        const bumps = new Array(ROWS).fill(0);
        const bumpTime = new Array(ROWS).fill(-Infinity);
        let hoverRow = -1;

        const rowState = { index: 0, changed: -Infinity };
        const stateOf = (row, t) => {
            const cycles = Math.floor(t / LOOP);
            const local = t - cycles * LOOP;
            let count = cycles * perLoop[row];
            let last = -Infinity;
            for (const [time, eventRow] of SCHEDULE) {
                if (eventRow === row && time <= local) {
                    count++;
                    last = Math.max(last, cycles * LOOP + time);
                }
            }
            if (last === -Infinity && perLoop[row] > 0) {
                last = (cycles - 1) * LOOP + lastInLoop[row];
            }
            rowState.index = count + bumps[row];
            rowState.changed = Math.max(last, bumpTime[row]);
            return rowState;
        };

        /* The glyph atlas: every drum character as a finished flap, both halves, drawn at twice the device
           resolution so the slight perspective scale stays crisp. */
        const atlas = document.createElement('canvas');
        const actx = atlas.getContext('2d');
        const ATLAS_COLS = 10;
        let tileW = 0;
        let tileH = 0;
        let atlasScale = 0;
        let atlasFont = false;
        const fontSpec = `700 ${FONT_SIZE}px ${R.fonts.mono}`;

        const halfPath = (pen, x, y, width, height, top) => {
            const radius = 1.7;
            pen.beginPath();
            if (top) {
                pen.moveTo(x, y + height);
                pen.lineTo(x, y + radius);
                pen.arcTo(x, y, x + radius, y, radius);
                pen.lineTo(x + width - radius, y);
                pen.arcTo(x + width, y, x + width, y + radius, radius);
                pen.lineTo(x + width, y + height);
            } else {
                pen.moveTo(x, y);
                pen.lineTo(x + width, y);
                pen.lineTo(x + width, y + height - radius);
                pen.arcTo(x + width, y + height, x + width - radius, y + height, radius);
                pen.lineTo(x + radius, y + height);
                pen.arcTo(x, y + height, x, y + height - radius, radius);
            }
            pen.closePath();
        };

        const drawTile = (pen, ch) => {
            const gap = 0.4;
            let gradient = pen.createLinearGradient(0, 0, 0, HALF);
            gradient.addColorStop(0, '#2b2b31');
            gradient.addColorStop(1, '#1f1f24');
            halfPath(pen, 0, 0, CW, HALF - gap, true);
            pen.fillStyle = gradient;
            pen.fill();
            gradient = pen.createLinearGradient(0, HALF, 0, CH);
            gradient.addColorStop(0, '#1b1b20');
            gradient.addColorStop(1, '#141418');
            halfPath(pen, 0, HALF + gap, CW, HALF - gap, false);
            pen.fillStyle = gradient;
            pen.fill();
            pen.fillStyle = 'rgba(255,255,255,0.08)';
            pen.fillRect(1, 0, CW - 2, 0.45);
            pen.fillStyle = 'rgba(0,0,0,0.55)';
            pen.fillRect(0, HALF + gap, CW, 0.5);
            if (ch !== ' ') {
                pen.font = fontSpec;
                pen.textAlign = 'center';
                pen.textBaseline = 'alphabetic';
                const base = HALF + FONT_SIZE * 0.365;
                pen.save();
                pen.beginPath();
                pen.rect(0, 0, CW, HALF - gap);
                pen.clip();
                pen.fillStyle = '#f2f2f5';
                pen.fillText(ch, CW / 2, base);
                pen.restore();
                pen.save();
                pen.beginPath();
                pen.rect(0, HALF + gap, CW, HALF - gap);
                pen.clip();
                pen.fillStyle = '#d4d4dc';
                pen.fillText(ch, CW / 2, base);
                pen.restore();
            }
        };

        const fontReady = () => !document.fonts || document.fonts.check(fontSpec);

        const buildAtlas = () => {
            atlasScale = env.scale;
            atlasFont = fontReady();
            const px = Math.min(6, env.scale * 2);
            tileW = Math.ceil(CW * px);
            tileH = Math.ceil(CH * px);
            atlas.width = tileW * ATLAS_COLS;
            atlas.height = tileH * Math.ceil(DRUM_N / ATLAS_COLS);
            actx.setTransform(1, 0, 0, 1, 0, 0);
            actx.clearRect(0, 0, atlas.width, atlas.height);
            for (let i = 0; i < DRUM_N; i++) {
                const ox = (i % ATLAS_COLS) * tileW;
                const oy = Math.floor(i / ATLAS_COLS) * tileH;
                actx.setTransform(tileW / CW, 0, 0, tileH / CH, ox, oy);
                drawTile(actx, DRUM[i]);
            }
        };

        // Draws one half of a character's flap, foreshortened by `fold` (1 flat, 0 edge-on) about the hinge.
        const drawHalf = (ch, top, x, hinge, scale, fold, widen, shade) => {
            if (fold < 0.02) {
                return;
            }
            const i = DRUM_INDEX[ch] || 0;
            const sx = (i % ATLAS_COLS) * tileW;
            const sy = Math.floor(i / ATLAS_COLS) * tileH + (top ? 0 : tileH / 2);
            const width = CW * scale * widen;
            const height = HALF * scale * fold;
            const dx = x - width / 2;
            const dy = top ? hinge - height : hinge;
            ctx.drawImage(atlas, sx, sy, tileW, tileH / 2, dx, dy, width, height);
            if (shade > 0.01) {
                ctx.fillStyle = `rgba(4,4,6,${shade.toFixed(3)})`;
                ctx.fillRect(dx, dy, width, height);
            }
        };

        const FLIP_EVERY = 0.062;
        const FALL = 0.13;
        // A flap falls like it is dropped: a little push over the top, then gravity.
        const fallAngle = (progress) => PI * (0.22 * progress + 0.78 * progress * progress);
        const bounceAngle = (progress, last) => {
            const amp = last ? 0.62 : 0.26;
            return amp * Math.exp(-progress * 13) * Math.abs(Math.sin((progress * PI) / 0.085));
        };

        const seq = new Array(12);
        const drawCell = (row, col, from, to, changed, index, x, y, scale, t) => {
            if (from === to || t < changed) {
                drawHalf(to, true, x, y, scale, 1, 1, 0);
                drawHalf(to, false, x, y, scale, 1, 1, 0);
                return;
            }
            const fromIndex = DRUM_INDEX[from] || 0;
            const toIndex = DRUM_INDEX[to] || 0;
            const distance = (toIndex - fromIndex + DRUM_N) % DRUM_N;
            const cap = 3 + Math.floor(R.hash(row * 97 + col * 13 + index * 7) * 6);
            const k = Math.min(distance, cap);
            seq[0] = from;
            for (let j = 1; j <= k; j++) {
                seq[j] = DRUM[(toIndex - (k - j) + DRUM_N) % DRUM_N];
            }
            const start = changed + 0.05 + col * 0.03 + R.hash(row * 31 + col * 5 + index) * 0.05;
            const lastEnd = start + (k - 1) * FLIP_EVERY + FALL + 0.3;
            if (t >= lastEnd) {
                drawHalf(to, true, x, y, scale, 1, 1, 0);
                drawHalf(to, false, x, y, scale, 1, 1, 0);
                return;
            }
            let started = 0;
            let landed = 0;
            for (let j = 1; j <= k; j++) {
                const sj = start + (j - 1) * FLIP_EVERY;
                if (t >= sj) {
                    started = j;
                }
                if (t >= sj + FALL) {
                    landed = j;
                }
            }
            // A tiny rattle of the whole cell when the last flap lands.
            let dy = 0;
            const settleAt = start + (k - 1) * FLIP_EVERY + FALL;
            if (t > settleAt) {
                const since = t - settleAt;
                dy = 0.45 * Math.sin(since * 95) * Math.exp(-since * 28) * scale;
            }
            const hinge = y + dy;

            drawHalf(seq[started], true, x, hinge, scale, 1, 1, 0);
            drawHalf(seq[Math.max(0, landed - 1)], false, x, hinge, scale, 1, 1, 0);
            let inFlight = 0;
            for (let j = landed + 1; j <= started; j++) {
                const progress = (t - start - (j - 1) * FLIP_EVERY) / FALL;
                inFlight = Math.max(inFlight, Math.sin(fallAngle(progress)));
            }
            if (inFlight > 0.01) {
                // The falling flap stands out toward the light and shades the half below it.
                const shadeAmount = Math.min(1, inFlight);
                ctx.fillStyle = `rgba(0,0,0,${(0.32 * shadeAmount).toFixed(3)})`;
                ctx.fillRect(x - (CW * scale) / 2, hinge, CW * scale, HALF * scale * 0.55);
            }
            if (landed > 0) {
                const since = t - (start + (landed - 1) * FLIP_EVERY + FALL);
                const phi = bounceAngle(since, landed === k);
                drawHalf(seq[landed], false, x, hinge, scale, Math.cos(phi), 1, 0.4 * Math.sin(phi));
            }
            // Lower half: the backs of flaps past the horizontal, oldest first so the newest lies on top.
            for (let j = landed + 1; j <= started; j++) {
                const progress = (t - start - (j - 1) * FLIP_EVERY) / FALL;
                const theta = fallAngle(progress);
                if (theta > PI / 2) {
                    drawHalf(seq[j], false, x, hinge, scale, -Math.cos(theta), 1 + 0.07 * Math.sin(theta), 0.62 * Math.sin(theta));
                }
            }
            // Upper half: flaps still above the horizontal, newest first so the one that fell further is in front.
            for (let j = started; j >= landed + 1; j--) {
                const progress = (t - start - (j - 1) * FLIP_EVERY) / FALL;
                const theta = fallAngle(progress);
                if (theta <= PI / 2) {
                    drawHalf(seq[j - 1], true, x, hinge, scale, Math.cos(theta), 1 + 0.07 * Math.sin(theta), 0.55 * Math.sin(theta));
                }
            }
        };

        /* A gentle perspective: the board leans back and turns a little with the pointer. */
        let cosA = 1;
        let sinA = 0;
        let cosB = 1;
        let sinB = 0;
        const FOCAL = 780;
        const projected = { x: 0, y: 0, s: 1 };
        const project = (bx, by) => {
            const x1 = bx * cosB;
            const z1 = bx * sinB;
            const y2 = by * cosA;
            const z2 = z1 - by * sinA;
            const depthScale = FOCAL / (FOCAL + z2);
            projected.x = CX + x1 * depthScale;
            projected.y = CY + y2 * depthScale;
            projected.s = depthScale;
            return projected;
        };
        const setTilt = (t) => {
            const pointer = env.pointer;
            const tiltX = 0.24 + 0.015 * Math.sin((R.TAU * t) / 9) + 0.07 * pointer.ny * pointer.active;
            const tiltY = 0.045 * Math.sin((R.TAU * t) / LOOP) - 0.14 * pointer.nx * pointer.active;
            cosA = Math.cos(tiltX);
            sinA = Math.sin(tiltX);
            cosB = Math.cos(tiltY);
            sinB = Math.sin(tiltY);
        };

        const corners = [0, 0, 0, 0, 0, 0, 0, 0];
        const housingPath = (grow, lift) => {
            const hw = BOARD_W / 2 + grow;
            const hh = BOARD_H / 2 + grow;
            const pts = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
            for (let i = 0; i < 4; i++) {
                const corner = project(pts[i * 2], pts[i * 2 + 1]);
                corners[i * 2] = corner.x;
                corners[i * 2 + 1] = corner.y + lift;
            }
            const radius = 11;
            ctx.beginPath();
            ctx.moveTo((corners[0] + corners[2]) / 2, (corners[1] + corners[3]) / 2);
            for (let i = 1; i <= 4; i++) {
                const current = i % 4;
                const next = (i + 1) % 4;
                ctx.arcTo(corners[current * 2], corners[current * 2 + 1], corners[next * 2], corners[next * 2 + 1], radius);
            }
            ctx.closePath();
        };

        const drawHousing = () => {
            // A soft shadow under the board, stacked from a few widening hulls.
            for (let i = 0; i < 5; i++) {
                housingPath(4 + i * 5, 10 + i * 4);
                ctx.fillStyle = 'rgba(0,0,0,0.075)';
                ctx.fill();
            }
            // The frame has a little thickness, seen below its front face.
            housingPath(0, 3.5);
            ctx.fillStyle = '#0a0a0c';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            ctx.stroke();
            housingPath(0, 0);
            const top = project(0, -BOARD_H / 2).y;
            const bottom = project(0, BOARD_H / 2).y;
            const gradient = ctx.createLinearGradient(0, top, 0, bottom);
            gradient.addColorStop(0, '#16161a');
            gradient.addColorStop(1, '#0e0e11');
            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.stroke();
            // The lit top edge of the frame.
            const edgeStart = project(-BOARD_W / 2 + 12, -BOARD_H / 2 + 0.8);
            const ax = edgeStart.x;
            const ay = edgeStart.y;
            const edgeEnd = project(BOARD_W / 2 - 12, -BOARD_H / 2 + 0.8);
            const hl = ctx.createLinearGradient(ax, 0, edgeEnd.x, 0);
            hl.addColorStop(0, 'rgba(255,255,255,0)');
            hl.addColorStop(0.5, 'rgba(255,255,255,0.14)');
            hl.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.strokeStyle = hl;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(edgeEnd.x, edgeEnd.y);
            ctx.stroke();
        };

        const LABELS = [
            ['AGENT', 0],
            ['TASK', 1],
            ['STATUS', 2]
        ];
        const drawHeader = () => {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = pal.faint;
            for (const [label, group] of LABELS) {
                const spot = project(LEFT + groupStart[group], TOP + 9);
                ctx.font = `500 ${(9.5 * spot.s).toFixed(2)}px ${R.fonts.mono}`;
                ctx.fillText(label, spot.x, spot.y);
            }
            // A thin rule between the header and the flaps.
            const ruleStart = project(LEFT, TOP + HEADER - 4.5);
            const ax = ruleStart.x;
            const ay = ruleStart.y;
            const ruleEnd = project(LEFT + cellsW, TOP + HEADER - 4.5);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ruleEnd.x, ruleEnd.y);
            ctx.stroke();
        };

        const drawLamp = (row, t, fromStatus, toStatus, changed) => {
            // The lamp waits for the word to settle, so the light comes on as the last flap lands.
            const switchAt = changed + 1.42;
            const on = t >= switchAt ? toStatus : fromStatus;
            const color = STATUS_COLOR[on] || pal.faint;
            let level = 0.8;
            if (on === 'NEEDS YOU') {
                level = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((R.TAU * t) / 1.6));
            } else if (on === 'RUNNING') {
                level = 0.72 + 0.12 * Math.sin((R.TAU * t) / 4 + row);
            }
            // A new status strikes a little bright, like a bulb warming up.
            const since = t - switchAt;
            if (since >= 0 && since < 1.2) {
                level += 0.7 * Math.exp(-since * 6) * (since < 0.05 ? since / 0.05 : 1);
            }
            const spot = project(LEFT + LAMP_X, TOP + HEADER + row * ROW_PITCH + HALF);
            const radius = 3.3 * spot.s;
            const glow = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, radius * 5);
            glow.addColorStop(0, R.rgba(color, Math.min(0.5, 0.3 * level)));
            glow.addColorStop(1, R.rgba(color, 0));
            ctx.fillStyle = glow;
            ctx.fillRect(spot.x - radius * 5, spot.y - radius * 5, radius * 10, radius * 10);
            ctx.beginPath();
            ctx.arc(spot.x, spot.y, radius + 1.1, 0, R.TAU);
            ctx.fillStyle = '#08080a';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(spot.x, spot.y, radius, 0, R.TAU);
            ctx.fillStyle = R.mix('#1a1a1f', color, R.clamp(0.35 + 0.65 * level));
            ctx.fill();
            ctx.beginPath();
            ctx.arc(spot.x - radius * 0.3, spot.y - radius * 0.35, radius * 0.38, 0, R.TAU);
            ctx.fillStyle = `rgba(255,255,255,${(0.35 * Math.min(1, level)).toFixed(3)})`;
            ctx.fill();
        };

        const rowY = (row) => TOP + HEADER + row * ROW_PITCH + HALF;

        return {
            update(t) {
                const pointer = env.pointer;
                if (!pointer.inside || pointer.active < 0.3) {
                    hoverRow = -1;
                    return;
                }
                setTilt(t);
                let found = -1;
                for (let row = 0; row < ROWS; row++) {
                    const center = project(0, rowY(row));
                    const left = project(-BOARD_W / 2, rowY(row)).x;
                    const right = project(BOARD_W / 2, rowY(row)).x;
                    if (Math.abs(pointer.y - center.y) < (ROW_PITCH / 2) * center.s && pointer.x > left && pointer.x < right) {
                        found = row;
                    }
                }
                if (found !== hoverRow) {
                    hoverRow = found;
                    if (found >= 0) {
                        const state = stateOf(found, t);
                        if (t - state.changed > 1.4) {
                            bumps[found]++;
                            bumpTime[found] = t;
                        }
                    }
                }
            },
            draw(t) {
                env.clear();
                if (atlasScale !== env.scale || (!atlasFont && fontReady())) {
                    buildAtlas();
                }
                setTilt(t);
                drawHousing();
                drawHeader();
                for (let row = 0; row < ROWS; row++) {
                    const state = stateOf(row, t);
                    const ring = RINGS[row];
                    const next = ring[R.mod(state.index, ring.length)];
                    const prev = ring[R.mod(state.index - 1, ring.length)];
                    const by = rowY(row);
                    for (let col = 0; col < COLS; col++) {
                        const spot = project(LEFT + colX[col] + CW / 2, by);
                        drawCell(row, col, prev.chars[col], next.chars[col], state.changed, state.index, spot.x, spot.y, spot.s, t);
                    }
                    drawLamp(row, t, prev.status, next.status, state.changed);
                }
                env.fadeEdges(0.84, 1.02);
            },
            resize() {
                atlasScale = 0;
            }
        };
    }
});
