Reel.add({
    id: 'phantom-cursor',
    title: 'Second Cursor',
    line: 'The agent gets a cursor of its own, so yours stays free.',
    principles: ['Secondary action', 'Anticipation'],
    tech: 'Canvas 2D, dual cursor choreography with outline morphing',
    hint: 'Move: your cursor is free while the agent works',
    poster: 9.4,
    create(env) {
        const { R } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const ease = R.ease;
        const phase = R.phase;

        const CYCLE = 16;
        const MAC_BLUE = '#0a84ff';
        const WINDOW_BG = '#1e1e22';
        // `OverlayStyle.Motion.move`: no overshoot, a pointer that springs past its target reads as a slip.
        const MOVE_EASE = ease.bezier(0.4, 0, 0.2, 1);
        const MORPH_EASE = ease.bezier(0.34, 1.56, 0.64, 1);

        /* The main window: a contact card the agent fills in. */
        const WIN = { x: 196, y: 134, w: 276, h: 266 };
        const FIELD_X = 282;
        const FIELD_W = 172;
        const FIELDS = {
            first: { y: 240, label: 'First' },
            last: { y: 272, label: 'Last' },
            company: { y: 304, label: 'Company' }
        };
        const TOGGLE = { x: 432, y: 336 };
        const DONE = { x: 406, y: 368, w: 52, h: 22 };
        const EDITOR = { x: 70, y: 176, w: 200, h: 214 };

        const THINK_AT = { x: 368, y: 188 };
        const FIRST_AT = { x: 318, y: 244 };
        const LAST_AT = { x: 338, y: 276 };
        const TOGGLE_AT = { x: 436, y: 340 };
        const DONE_AT = { x: 428, y: 382 };
        const COMPANY_AT = { x: 344, y: 308 };

        const MOVES = [
            { start: 1.4, dur: 0.7, to: FIRST_AT, bow: -1 },
            { start: 3.25, dur: 0.55, to: LAST_AT, bow: 1 },
            { start: 5.4, dur: 0.62, to: TOGGLE_AT, bow: -1 },
            { start: 6.72, dur: 0.85, to: COMPANY_AT, bow: 1, freeze: 7.16 },
            { start: 11.5, dur: 0.6, to: DONE_AT, bow: -1 },
            { start: 12.9, dur: 0.95, to: THINK_AT, bow: -1 }
        ];
        const CLICKS = [2.2, 3.9, 6.1, 12.15];
        const TYPE_FIRST = { start: 2.45, rate: 0.16, text: 'Ada' };
        const TYPE_LAST = { start: 4.1, rate: 0.13, text: 'Lovelace' };
        const TYPE_COMPANY = { start: 8.75, rate: 0.072, text: 'Analytical Engine' };
        const PAUSE = 7.22;
        const RESUME = 11.2;
        const RESET = 14.5;
        const KEYS_AT = [7.05, 11.0];
        const KEY_Y = 412;
        const LABELS = [
            [0, 'Looking at Contacts'],
            [1.3, 'First name'],
            [2.4, 'first', true],
            [3.2, 'Last name'],
            [4.05, 'last', true],
            [5.35, 'Favorite'],
            [6.62, 'Company'],
            [PAUSE, 'Paused'],
            [RESUME + 0.05, 'Done'],
            [12.75, null],
            [13.6, 'Looking at Contacts']
        ];

        /* The person's own pointer: selects code in the editor, steps over to fix a field, goes back. */
        const PERSON = [
            [0, 112, 250],
            [0.7, 102, 234],
            [1.6, 176, 282, 'drag'],
            [2.5, 150, 326],
            [3.6, 98, 298],
            [4.6, 188, 314, 'drag'],
            [5.6, 130, 262],
            [7.6, 130, 262],
            [8.4, 300, 308],
            [8.75, 294, 334],
            [10.1, 294, 334],
            [10.95, 150, 300],
            [12.4, 100, 330],
            [13.3, 170, 346, 'drag'],
            [14.8, 112, 250],
            [16, 112, 250]
        ];
        const SELECTIONS = [
            { from: 0.7, to: 1.6, clear: 2.9, lines: [3, 6] },
            { from: 3.6, to: 4.6, clear: 5.9, lines: [7, 8] },
            { from: 12.4, to: 13.3, clear: 14.5, lines: [9, 10] }
        ];
        const PERSON_CLICKS = [2.9, 8.45];

        const CODE = [];
        {
            const rand = R.rng(77);
            const tints = [pal.magenta, pal.termFg, pal.cyan, pal.termFg, pal.yellow, pal.termFg];
            for (let i = 0; i < 12; i++) {
                const indent = i === 0 || i === 11 ? 0 : i % 4 === 0 ? 1 : 2;
                const words = [];
                let cursor = indent * 14;
                const count = 2 + Math.floor(rand() * 3);
                for (let j = 0; j < count; j++) {
                    const width = 14 + Math.floor(rand() * 34);
                    words.push({ x: cursor, w: width, color: tints[Math.floor(rand() * tints.length)] });
                    cursor += width + 6;
                }
                CODE.push(words);
            }
        }

        /* The phantom's forms, sampled at the same points from the tip, so one can morph into another. */
        const COUNT = 48;
        const sample = (segments) => {
            const lengths = segments.map((seg) => (seg.arc ? seg.radius * (seg.end - seg.begin) : Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1])));
            const total = lengths.reduce((sum, len) => sum + len, 0);
            const pts = new Float32Array(COUNT * 2);
            for (let i = 0; i < COUNT; i++) {
                let along = (total * i) / COUNT;
                let k = 0;
                while (k < segments.length - 1 && along > lengths[k]) {
                    along -= lengths[k];
                    k++;
                }
                const seg = segments[k];
                const frac = R.clamp(along / lengths[k]);
                if (seg.arc) {
                    const angle = R.lerp(seg.begin, seg.end, frac);
                    pts[i * 2] = seg.cx + seg.radius * Math.cos(angle);
                    pts[i * 2 + 1] = seg.cy + seg.radius * Math.sin(angle);
                } else {
                    pts[i * 2] = R.lerp(seg.from[0], seg.to[0], frac);
                    pts[i * 2 + 1] = R.lerp(seg.from[1], seg.to[1], frac);
                }
            }
            return pts;
        };
        const poly = (corners) => corners.map((corner, i) => ({ from: corner, to: corners[(i + 1) % corners.length] }));
        const tear = (tip, cx, cy, radius) => {
            const phi = Math.atan2(tip[1] - cy, tip[0] - cx);
            const opening = Math.acos(radius / Math.hypot(tip[0] - cx, tip[1] - cy));
            const begin = phi + opening;
            const end = phi + R.TAU - opening;
            const onCircle = (angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
            return [
                { from: tip, to: onCircle(begin) },
                { arc: true, cx, cy, radius, begin, end },
                { from: onCircle(end), to: tip }
            ];
        };
        const ARROW = sample(poly([[4, 3.5], [20.5, 10.5], [13.5, 13.5], [10.5, 20.5]]));
        const DROP = sample(tear([4, 3.5], 12.5, 12.5, 7));
        const SMALL = sample(tear([4, 3.5], 10.5, 10.5, 4.5));
        const shape = new Float32Array(COUNT * 2);
        const PERSON_ARROW = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');

        const moveAt = (t, out) => {
            let x = THINK_AT.x;
            let y = THINK_AT.y;
            out.moving = 0;
            for (const move of MOVES) {
                if (t <= move.start - 0.22) {
                    break;
                }
                let local = t - move.start;
                if (move.freeze !== undefined && t > move.freeze) {
                    // Frozen mid-stride: it stops within a few frames, it does not glide on.
                    local = move.freeze - move.start + (1 - Math.exp(-(t - move.freeze) * 16)) / 16;
                }
                const k = R.clamp(local / move.dur);
                const eased = MOVE_EASE(k);
                const dx = move.to.x - x;
                const dy = move.to.y - y;
                const len = Math.hypot(dx, dy) || 1;
                const ux = dx / len;
                const uy = dy / len;
                // Anticipation: a small draw back against the direction of travel before it sets off.
                const back = ease.outQuad(phase(t, move.start - 0.22, 0.22)) * (1 - eased);
                const bow = Math.sin(Math.PI * eased) * len * 0.13 * move.bow;
                x = x + dx * eased - uy * bow - ux * 4.5 * back;
                y = y + dy * eased + ux * bow - uy * 4.5 * back;
                if (k > 0 && k < 1) {
                    out.moving = Math.sin(Math.PI * k);
                }
            }
            out.x = x;
            out.y = y;
            return out;
        };
        const phantom = { x: 0, y: 0, moving: 0 };
        const lagged = { x: 0, y: 0, moving: 0 };

        const personAt = (t, out) => {
            let i = 0;
            while (i < PERSON.length - 2 && t >= PERSON[i + 1][0]) {
                i++;
            }
            const from = PERSON[i];
            const to = PERSON[i + 1];
            const k = R.clamp((t - from[0]) / (to[0] - from[0]));
            const eased = to[3] === 'drag' ? ease.inOutSine(k) : ease.inOutCubic(k);
            const bow = to[3] === 'drag' ? 0 : Math.sin(Math.PI * eased) * 18;
            out.x = R.lerp(from[1], to[1], eased);
            out.y = R.lerp(from[2], to[2], eased) - bow;
            out.down = to[3] === 'drag' && k > 0 && k < 1;
            return out;
        };
        const person = { x: 0, y: 0, down: false };

        const formWeights = (t) => {
            const toArrow = MORPH_EASE(phase(t, 1.05, 0.46));
            const toThink = MORPH_EASE(phase(t, 13.62, 0.46));
            const toPaused = MORPH_EASE(phase(t, PAUSE + 0.02, 0.46));
            const unpause = MORPH_EASE(phase(t, RESUME + 0.12, 0.46));
            return { drop: 1 - toArrow + toThink, paused: toPaused - unpause };
        };

        const drawPhantom = (x, y, t, weights) => {
            const arrowWeight = 1 - weights.drop - weights.paused;
            for (let i = 0; i < COUNT * 2; i++) {
                shape[i] = ARROW[i] * arrowWeight + DROP[i] * weights.drop + SMALL[i] * weights.paused;
            }
            let squash = 1;
            for (const click of CLICKS) {
                const k = phase(t, click, 0.35);
                if (k > 0 && k < 1) {
                    squash = k < 0.35 ? R.lerp(1, 0.8, ease.outQuad(k / 0.35)) : k < 0.75 ? R.lerp(0.8, 1.08, ease.inOutSine((k - 0.35) / 0.4)) : R.lerp(1.08, 1, ease.inOutSine((k - 0.75) / 0.25));
                }
                const ring = phase(t, click + 0.03, 0.55);
                if (ring > 0 && ring < 1) {
                    ctx.strokeStyle = R.rgba(pal.accent, 0.9 * (1 - ease.outCubic(ring)));
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, 18 * R.lerp(0.3, 1, ease.outCubic(ring)), 0, R.TAU);
                    ctx.stroke();
                }
            }
            const color = R.mix(pal.accent, pal.muted, R.clamp(weights.paused));
            const scale = 1.15 * squash;
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            ctx.translate(-4, -3.5);
            ctx.beginPath();
            ctx.moveTo(shape[0], shape[1]);
            for (let i = 1; i < COUNT; i++) {
                ctx.lineTo(shape[i * 2], shape[i * 2 + 1]);
            }
            ctx.closePath();
            ctx.lineJoin = 'round';
            ctx.shadowColor = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = 3 * env.scale;
            ctx.shadowOffsetY = 1 * env.scale;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 7;
            ctx.stroke();
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();
            if (weights.drop > 0.5) {
                ctx.fillStyle = R.rgba('#ffffff', R.clamp((weights.drop - 0.5) * 3));
                for (let i = 0; i < 3; i++) {
                    const bob = Math.sin((t / 0.9) * R.TAU - i * 1.05);
                    ctx.beginPath();
                    ctx.arc(9.3 + i * 3.2, 12.5 - Math.max(0, bob) * 1.2, 1.1, 0, R.TAU);
                    ctx.fill();
                }
            }
            if (weights.paused > 0.5) {
                ctx.fillStyle = R.rgba('#ffffff', R.clamp((weights.paused - 0.5) * 3));
                R.roundRect(ctx, 8.6, 8.5, 1.6, 4, 0.5);
                ctx.fill();
                R.roundRect(ctx, 11.2, 8.5, 1.6, 4, 0.5);
                ctx.fill();
            }
            ctx.restore();
        };

        const labelAt = (t) => {
            let index = 0;
            for (let i = 0; i < LABELS.length; i++) {
                if (t >= LABELS[i][0]) {
                    index = i;
                }
            }
            return index;
        };
        const typed = (spec, t) => spec.text.slice(0, R.clamp(Math.floor((t - spec.start) / spec.rate) + 1, 0, spec.text.length));

        const drawPill = (x, y, t) => {
            const index = labelAt(t);
            const entry = LABELS[index];
            if (!entry[1]) {
                return;
            }
            const since = t - entry[0];
            const fadeOut = index + 1 < LABELS.length && !LABELS[index + 1][1] ? 1 - phase(t, LABELS[index + 1][0] - 0.12, 0.12) : 1;
            const shown = ease.outQuad(R.clamp(since / 0.12)) * fadeOut;
            if (shown <= 0.01) {
                return;
            }
            let text = entry[1];
            const mono = !!entry[2];
            if (text === 'first') {
                text = typed(TYPE_FIRST, t);
            } else if (text === 'last') {
                text = typed(TYPE_LAST, t);
            }
            ctx.font = mono ? '400 12px ' + R.fonts.mono : '500 12px ' + R.fonts.display;
            const width = Math.max(ctx.measureText(text).width, mono ? 8 : 0) + 20;
            const scale = R.lerp(0.96, 1, shown);
            const px = x + 20;
            const py = y + 22;
            ctx.save();
            ctx.globalAlpha = shown;
            ctx.translate(px, py);
            ctx.scale(scale, scale);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            R.roundRect(ctx, 0, 2, width, 24, 12);
            ctx.fill();
            ctx.fillStyle = pal.raised;
            R.roundRect(ctx, 0, 0, width, 24, 12);
            ctx.fill();
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            if (!mono && text !== 'Paused' && text !== 'Done' && entry[0] === 0) {
                // Shines while the agent looks, like every working word in Ruimte.
                const tw = ctx.measureText(text).width;
                const sweep = R.fract(t / 1.6);
                const gradient = ctx.createLinearGradient(10 + tw * (1.4 - sweep * 1.8) - 30, 0, 10 + tw * (1.4 - sweep * 1.8) + 30, 0);
                gradient.addColorStop(0, pal.muted);
                gradient.addColorStop(0.5, pal.text);
                gradient.addColorStop(1, pal.muted);
                ctx.fillStyle = gradient;
            } else {
                ctx.fillStyle = mono ? pal.text : text === 'Paused' ? pal.muted : pal.text;
            }
            ctx.fillText(text, 10, 12.5);
            ctx.restore();
        };

        const trafficLights = (x, y) => {
            const colors = ['#ff5f57', '#febc2e', '#28c840'];
            for (let i = 0; i < 3; i++) {
                ctx.fillStyle = colors[i];
                ctx.beginPath();
                ctx.arc(x + i * 14, y, 4.5, 0, R.TAU);
                ctx.fill();
            }
        };

        const drawEditor = (t, lift) => {
            const { x, y, w, h } = EDITOR;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            R.roundRect(ctx, x, y + 6, w, h, 10);
            ctx.fill();
            ctx.fillStyle = pal.surface;
            R.roundRect(ctx, x, y, w, h, 10);
            ctx.fill();
            ctx.save();
            ctx.clip();
            ctx.fillStyle = pal.raised;
            ctx.fillRect(x, y, w, 30);
            ctx.fillStyle = pal.border;
            ctx.fillRect(x, y + 30, w, 1);
            trafficLights(x + 16, y + 15);
            ctx.font = '500 12px ' + R.fonts.display;
            ctx.fillStyle = pal.muted;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('cart.ts', x + 66, y + 15.5);
            const top = y + 46;
            for (const sel of SELECTIONS) {
                const grow = phase(t, sel.from, sel.to - sel.from);
                const gone = 1 - phase(t, sel.clear, 0.25);
                if (grow <= 0 || gone <= 0) {
                    continue;
                }
                const reach = Math.floor(R.lerp(sel.lines[0], sel.lines[1] + 0.999, ease.inOutSine(grow)));
                ctx.fillStyle = R.rgba(pal.accent, 0.3 * gone);
                for (let line = sel.lines[0]; line <= reach; line++) {
                    ctx.fillRect(x + 30, top + line * 14 - 7, w - 44, 14);
                }
            }
            for (let i = 0; i < CODE.length; i++) {
                const ly = top + i * 14;
                ctx.fillStyle = pal.faint;
                ctx.font = '400 12px ' + R.fonts.mono;
                ctx.textAlign = 'right';
                ctx.fillText(String(i + 12), x + 22, ly + 0.5);
                for (const word of CODE[i]) {
                    ctx.fillStyle = R.rgba(word.color, 0.7);
                    R.roundRect(ctx, x + 32 + word.x, ly - 2.5, word.w, 5, 2.5);
                    ctx.fill();
                }
            }
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.1 + lift * 0.06).toFixed(3) + ')';
            ctx.lineWidth = 1;
            R.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10);
            ctx.stroke();
            ctx.restore();
        };

        const focusFor = (t) => {
            if (t >= 2.2 && t < 3.3) {
                return 'first';
            }
            if (t >= 3.9 && t < 5.45) {
                return 'last';
            }
            if (t >= 8.45 && t < 10.25) {
                return 'company';
            }
            return null;
        };

        const drawContact = (t) => {
            const { x, y, w, h } = WIN;
            const keep = 1 - ease.inOutSine(phase(t, RESET, 0.55));
            const back = ease.inOutSine(phase(t, RESET + 0.45, 0.55));
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            R.roundRect(ctx, x - 4, y + 10, w + 8, h + 4, 14);
            ctx.fill();
            ctx.fillStyle = WINDOW_BG;
            R.roundRect(ctx, x, y, w, h, 11);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            R.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 11);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(x, y + 32, w, 1);
            trafficLights(x + 16, y + 16);
            ctx.font = '600 12px ' + R.fonts.display;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Contacts', x + w / 2, y + 16.5);

            const first = t >= RESET + 1 ? '' : typed(TYPE_FIRST, t);
            const last = t >= RESET + 1 ? '' : typed(TYPE_LAST, t);
            const company = t >= RESET + 1 ? '' : typed(TYPE_COMPANY, t);
            const initials = ease.outBack(phase(t, TYPE_LAST.start, 0.3), 2) * keep;

            // Avatar and the name above the form, which fill in as the agent types (a secondary beat).
            const ax = x + 38;
            const ay = y + 68;
            ctx.fillStyle = '#3a3a42';
            ctx.beginPath();
            ctx.arc(ax, ay, 21, 0, R.TAU);
            ctx.fill();
            const glyph = t >= RESET ? back : 1 - R.clamp(initials);
            if (glyph > 0.01) {
                ctx.fillStyle = R.rgba('#ffffff', 0.35 * glyph);
                ctx.beginPath();
                ctx.arc(ax, ay - 5, 6, 0, R.TAU);
                ctx.fill();
                ctx.beginPath();
                ctx.ellipse(ax, ay + 11, 11, 7, 0, Math.PI, R.TAU);
                ctx.fill();
            }
            if (initials > 0.01) {
                ctx.fillStyle = R.rgba(MAC_BLUE, 0.9 * R.clamp(initials));
                ctx.beginPath();
                ctx.arc(ax, ay, 21 * R.clamp(initials, 0, 1.1), 0, R.TAU);
                ctx.fill();
                ctx.fillStyle = R.rgba('#ffffff', R.clamp(initials));
                ctx.font = '600 15px ' + R.fonts.display;
                ctx.fillText('AL', ax, ay + 1);
            }
            ctx.textAlign = 'left';
            // While the card resets, the typed values leave first and the placeholders follow, so two texts never sit on each other.
            const name = (first + (last ? ' ' + last : '')).trim();
            ctx.font = '600 16px ' + R.fonts.display;
            if (name) {
                ctx.fillStyle = R.rgba('#ffffff', 0.92 * keep);
                ctx.fillText(name, ax + 34, ay - 7);
            }
            ctx.fillStyle = R.rgba('#ffffff', 0.3 * (name ? back : 1));
            ctx.fillText('New Contact', ax + 34, ay - 7);
            ctx.font = '400 12px ' + R.fonts.display;
            if (company) {
                ctx.fillStyle = R.rgba('#ffffff', 0.55 * keep);
                ctx.fillText(company, ax + 34, ay + 12);
            }
            ctx.fillStyle = R.rgba('#ffffff', 0.3 * (company ? back : 1));
            ctx.fillText('No company', ax + 34, ay + 12);

            const focus = focusFor(t);
            const values = { first, last, company };
            for (const key of Object.keys(FIELDS)) {
                const field = FIELDS[key];
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.textAlign = 'right';
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.fillText(field.label, FIELD_X - 10, field.y + 1);
                ctx.fillStyle = 'rgba(0,0,0,0.22)';
                R.roundRect(ctx, FIELD_X, field.y - 11, FIELD_W, 22, 5);
                ctx.fill();
                const focused = focus === key;
                ctx.strokeStyle = focused ? R.rgba(MAC_BLUE, 0.9) : 'rgba(255,255,255,0.14)';
                ctx.lineWidth = focused ? 2 : 1;
                ctx.stroke();
                ctx.textAlign = 'left';
                ctx.font = '400 13px ' + R.fonts.display;
                const value = values[key];
                ctx.fillStyle = R.rgba('#ffffff', 0.92 * keep);
                ctx.fillText(value, FIELD_X + 8, field.y + 1);
                if (focused && R.fract(t * 1.6) < 0.6) {
                    const cx = FIELD_X + 9 + ctx.measureText(value).width;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(cx, field.y - 7, 1.2, 15);
                }
            }

            ctx.font = '400 12px ' + R.fonts.display;
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillText('Favorite', FIELD_X - 10, TOGGLE.y + 1);
            const on = ease.outBack(phase(t, 6.12, 0.32), 2.2) - ease.inOutCubic(phase(t, RESET + 0.2, 0.5));
            const trackX = FIELD_X;
            ctx.fillStyle = R.mix('#3a3a42', '#28c840', R.clamp(on));
            R.roundRect(ctx, trackX, TOGGLE.y - 9, 32, 18, 9);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(trackX + 9 + 14 * on, TOGGLE.y, 7, 0, R.TAU);
            ctx.fill();

            const press = phase(t, 12.15, 0.3);
            const pressScale = press > 0 && press < 1 ? 1 - Math.sin(Math.PI * press) * 0.05 : 1;
            const saved = ease.outCubic(phase(t, 12.35, 0.35)) * keep;
            ctx.save();
            ctx.translate(DONE.x + DONE.w / 2, DONE.y);
            ctx.scale(pressScale, pressScale);
            ctx.fillStyle = MAC_BLUE;
            R.roundRect(ctx, -DONE.w / 2, -DONE.h / 2, DONE.w, DONE.h, 6);
            ctx.fill();
            if (press > 0 && press < 1) {
                ctx.fillStyle = 'rgba(0,0,0,' + (Math.sin(Math.PI * press) * 0.2).toFixed(3) + ')';
                ctx.fill();
            }
            ctx.font = '500 12px ' + R.fonts.display;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Done', 0, 1);
            ctx.restore();
            if (saved > 0.01) {
                ctx.save();
                ctx.globalAlpha = saved;
                ctx.font = '500 12px ' + R.fonts.display;
                ctx.textAlign = 'left';
                ctx.fillStyle = pal.idle;
                const sx = FIELD_X + 2;
                ctx.strokeStyle = pal.idle;
                ctx.lineWidth = 1.6;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                const draw = ease.outCubic(phase(t, 12.35, 0.3));
                ctx.moveTo(sx, DONE.y);
                ctx.lineTo(sx + 3.5 * R.clamp(draw * 2), DONE.y + 3.5 * R.clamp(draw * 2));
                if (draw > 0.5) {
                    ctx.lineTo(sx + 3.5 + 6 * (draw - 0.5) * 2, DONE.y + 3.5 - 7 * (draw - 0.5) * 2);
                }
                ctx.stroke();
                ctx.fillText('Saved', sx + 16, DONE.y + 1);
                ctx.restore();
            }
        };

        const drawSessionBar = (t, paused) => {
            const text = 'Ruimte is using Contacts';
            ctx.font = '500 13px ' + R.fonts.display;
            const tw = ctx.measureText(text).width;
            const width = tw + 100;
            const x = 280 - width / 2;
            const y = 86;
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            R.roundRect(ctx, x, y + 3, width, 32, 10);
            ctx.fill();
            ctx.fillStyle = pal.raised;
            R.roundRect(ctx, x, y, width, 32, 10);
            ctx.fill();
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            const color = R.mix(pal.accent, pal.muted, paused);
            ctx.save();
            ctx.translate(x + 11, y + 9);
            ctx.scale(0.62, 0.62);
            ctx.translate(-2, -1);
            ctx.beginPath();
            ctx.moveTo(ARROW[0], ARROW[1]);
            for (let i = 1; i < COUNT; i++) {
                ctx.lineTo(ARROW[i * 2], ARROW[i * 2 + 1]);
            }
            ctx.closePath();
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = pal.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + 32, y + 16.5);
            const bx = x + width - 56;
            ctx.fillStyle = pal.muted;
            ctx.save();
            ctx.translate(bx + 12, y + 16);
            if (paused > 0.5) {
                ctx.beginPath();
                ctx.moveTo(-3, -5.5);
                ctx.lineTo(5.5, 0);
                ctx.lineTo(-3, 5.5);
                ctx.closePath();
                ctx.fill();
            } else {
                R.roundRect(ctx, -4.5, -5.5, 3.2, 11, 1.2);
                ctx.fill();
                R.roundRect(ctx, 1.3, -5.5, 3.2, 11, 1.2);
                ctx.fill();
            }
            ctx.restore();
            R.roundRect(ctx, bx + 30, y + 10.5, 11, 11, 2.2);
            ctx.fill();
        };

        const drawKeys = (t) => {
            for (const at of KEYS_AT) {
                const shown = ease.outCubic(phase(t, at - 0.3, 0.3)) * (1 - ease.inCubic(phase(t, at + 0.95, 0.35)));
                if (shown <= 0.01) {
                    continue;
                }
                const press = phase(t, at, 0.26);
                const caps = [
                    { text: 'option', symbol: '⌥', w: 64, delay: 0 },
                    { text: 'space', w: 100, delay: 0.05 }
                ];
                let cx = 280 - (64 + 100 + 8) / 2;
                ctx.save();
                ctx.globalAlpha = shown;
                for (const cap of caps) {
                    const own = cap.delay ? phase(t, at + cap.delay, 0.26) : press;
                    const sink = own > 0 && own < 1 ? Math.sin(Math.PI * own) * 2.5 : 0;
                    const top = KEY_Y + (1 - shown) * 8 + sink;
                    ctx.fillStyle = '#0a0a0c';
                    R.roundRect(ctx, cx, KEY_Y + (1 - shown) * 8 + 3, cap.w, 30, 7);
                    ctx.fill();
                    ctx.fillStyle = sink > 0.2 ? pal.hover : pal.raised;
                    R.roundRect(ctx, cx, top, cap.w, 30 - sink * 0.4, 7);
                    ctx.fill();
                    ctx.strokeStyle = pal.borderStrong;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.fillStyle = pal.muted;
                    ctx.font = '500 12px ' + R.fonts.display;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText(cap.text, cx + 8, top + 23);
                    if (cap.symbol) {
                        ctx.textAlign = 'right';
                        ctx.fillText(cap.symbol, cx + cap.w - 8, top + 13);
                    }
                    cx += cap.w + 8;
                }
                ctx.restore();
            }
        };

        const drawPerson = (t, alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            personAt(t, person);
            ctx.save();
            ctx.globalAlpha = alpha;
            for (const click of PERSON_CLICKS) {
                const ring = phase(t, click, 0.45);
                if (ring > 0 && ring < 1) {
                    ctx.fillStyle = R.rgba('#ffffff', 0.4 * (1 - ring));
                    ctx.beginPath();
                    ctx.arc(person.x, person.y, 12 * R.lerp(0.3, 1.4, ring), 0, R.TAU);
                    ctx.fill();
                }
            }
            ctx.translate(person.x - 1.5, person.y - 1.5);
            const squeeze = person.down ? 0.94 : 1;
            ctx.scale(squeeze, squeeze);
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 2 * env.scale;
            ctx.shadowOffsetY = 1 * env.scale;
            ctx.fillStyle = '#000000';
            ctx.fill(PERSON_ARROW);
            ctx.shadowColor = 'transparent';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.lineJoin = 'round';
            ctx.stroke(PERSON_ARROW);
            ctx.restore();
        };

        return {
            draw(time) {
                const t = R.mod(time, CYCLE);
                env.clear();
                const pointer = env.pointer;
                const weights = formWeights(t);

                const onEditor = personAt(t, person).x < WIN.x - 4 ? 1 : 0;
                drawEditor(t, onEditor);
                drawContact(t);
                drawSessionBar(t, R.clamp(weights.paused));
                drawKeys(t);

                moveAt(t, phantom);
                moveAt(t - 0.07, lagged);
                drawPhantom(phantom.x, phantom.y, t, weights);
                // The pill trails its cursor by a few frames: it is carried, not glued on.
                drawPill(lagged.x, lagged.y, t);
                // With a real pointer over the take, that pointer is the person's cursor; the drawn one steps aside.
                drawPerson(t, 1 - pointer.active);
                env.fadeEdges(0.74, 1.04);
            }
        };
    }
});
