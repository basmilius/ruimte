Reel.add({
    id: 'napkin',
    title: 'Napkin',
    line: 'Sketch it and the agent reads it, in the order you meant it.',
    principles: ['Straight ahead and pose to pose'],
    tech: 'Canvas 2D, stroke reveal and point morphing',
    hint: 'Move to doodle beside the sketch',
    poster: 9.2,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;

        const CYCLE = 16;
        const DRAW_START = 0.5;
        const DRAW_END = 7.3;
        const MORPH = 8.3;
        const MORPH_LEN = 0.95;
        const STAGGER = 0.2;
        const UNMORPH = 13.3;
        const UNMORPH_LEN = 0.6;
        const ERASE = 14.35;
        const ERASE_LEN = 1.0;
        const INK = '#e4e5ea';
        const NODE_W = 104;
        const NODE_H = 68;
        const HEAD = 20;
        const LOOP = 1.14;
        const BOX_POINTS = 180;
        const EDGE_POINTS = 48;
        // The context edge color, the accent mixed into the ground at 55%, as hex so it can be blended from ink.
        const EDGE = '#11398f';
        const statusColor = { running: pal.running, needs: pal.needs, idle: pal.idle };

        const variants = [
            {
                boxes: [
                    { word: 'web', kind: 'browser', cx: 128, cy: 250, status: 'idle', lines: ['localhost:3000'] },
                    { word: 'api', kind: 'terminal', cx: 280, cy: 250, status: 'running', lines: ['$ bun run api', 'GET /carts 200', 'GET /user 200'] },
                    { word: 'db', kind: 'terminal', cx: 432, cy: 170, status: 'idle', lines: ['$ psql shop', 'carts  1284', 'ready'] },
                    { word: 'queue', kind: 'terminal', cx: 432, cy: 330, status: 'running', lines: ['$ bun worker', 'jobs  12', 'sent 3 mails'] }
                ],
                arrows: [
                    { from: 0, to: 1, a: [180, 250], b: [228, 250], ports: [[180, 250, 1, 0], [228, 250, -1, 0]] },
                    { from: 1, to: 2, a: [334, 232], b: [378, 180], ports: [[332, 240, 1, 0], [380, 170, -1, 0]] },
                    { from: 1, to: 3, a: [334, 268], b: [378, 322], ports: [[332, 260, 1, 0], [380, 330, -1, 0]] }
                ],
                order: [['box', 0], ['label', 0], ['box', 1], ['label', 1], ['shaft', 0], ['head', 0], ['box', 2], ['label', 2], ['shaft', 1], ['head', 1], ['box', 3], ['label', 3], ['shaft', 2], ['head', 2]]
            },
            {
                boxes: [
                    { word: 'claude', kind: 'chat', cx: 126, cy: 250, status: 'running', lines: ['Split into two', 'tasks. Starting.'] },
                    { word: 'codex', kind: 'chat', cx: 280, cy: 168, status: 'running', lines: ['Editing cart.ts', 'Running tests'] },
                    { word: 'review', kind: 'chat', cx: 280, cy: 332, status: 'needs', lines: ['Two comments', 'on the diff'] },
                    { word: 'ship', kind: 'terminal', cx: 434, cy: 250, status: 'idle', lines: ['$ bun run build', 'built in 1.4s', 'deployed'] }
                ],
                arrows: [
                    { from: 0, to: 1, a: [176, 232], b: [226, 178], ports: [[178, 244, 1, 0], [228, 168, -1, 0]] },
                    { from: 0, to: 2, a: [176, 268], b: [226, 322], ports: [[178, 256, 1, 0], [228, 332, -1, 0]] },
                    { from: 1, to: 3, a: [334, 178], b: [384, 234], ports: [[332, 168, 1, 0], [382, 244, -1, 0]] },
                    { from: 2, to: 3, a: [334, 322], b: [384, 266], ports: [[332, 332, 1, 0], [382, 256, -1, 0]] }
                ],
                order: [['box', 0], ['label', 0], ['box', 1], ['label', 1], ['shaft', 0], ['head', 0], ['box', 2], ['label', 2], ['shaft', 1], ['head', 1], ['box', 3], ['label', 3], ['shaft', 2], ['head', 2], ['shaft', 3], ['head', 3]]
            }
        ];

        // The drawing is shown 1.18x larger than it is laid out, so the outer columns sit a little closer in to stay clear of the edges.
        const ZOOM = 1.18;
        const SQUEEZE = 10;
        const shiftOf = (box) => (box.cx < 280 ? SQUEEZE : box.cx > 280 ? -SQUEEZE : 0);
        for (const variant of variants) {
            for (const arrow of variant.arrows) {
                const fromShift = shiftOf(variant.boxes[arrow.from]);
                const toShift = shiftOf(variant.boxes[arrow.to]);
                arrow.a = [arrow.a[0] + fromShift, arrow.a[1]];
                arrow.b = [arrow.b[0] + toShift, arrow.b[1]];
                arrow.ports = [
                    [arrow.ports[0][0] + fromShift, arrow.ports[0][1], arrow.ports[0][2], arrow.ports[0][3]],
                    [arrow.ports[1][0] + toShift, arrow.ports[1][1], arrow.ports[1][2], arrow.ports[1][3]]
                ];
            }
            for (const box of variant.boxes) {
                box.cx += shiftOf(box);
            }
        }
        const enlarge = () => {
            ctx.translate(280, 250);
            ctx.scale(ZOOM, ZOOM);
            ctx.translate(-280, -250);
        };
        // A soft rectangular edge instead of the ellipse: the diagram is wide, and an ellipse would eat its outer corners.
        const edgeX = ctx.createLinearGradient(0, 0, env.W, 0);
        const edgeY = ctx.createLinearGradient(0, 0, 0, env.H);
        for (const [gradient, size] of [
            [edgeX, env.W],
            [edgeY, env.H]
        ]) {
            const ramp = [
                [0, 0],
                [10, 0.12],
                [22, 0.45],
                [34, 0.82],
                [44, 1]
            ];
            for (const [at, alpha] of ramp) {
                gradient.addColorStop(at / size, 'rgba(0,0,0,' + alpha + ')');
                gradient.addColorStop(1 - at / size, 'rgba(0,0,0,' + alpha + ')');
            }
        }
        const fadeRect = () => {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.fillStyle = edgeX;
            ctx.fillRect(0, 0, env.W, env.H);
            ctx.fillStyle = edgeY;
            ctx.fillRect(0, 0, env.W, env.H);
            ctx.restore();
        };

        // A point on a rounded rectangle's outline at a fraction of its perimeter, clockwise from the top edge,
        // with the outward normal, so a hand can wobble around it.
        const rectPoint = (cx, cy, width, height, radius, fraction, out) => {
            const straightW = width - 2 * radius;
            const straightH = height - 2 * radius;
            const arc = (Math.PI / 2) * radius;
            const total = 2 * straightW + 2 * straightH + 4 * arc;
            let remaining = R.mod(fraction, 1) * total;
            const left = cx - width / 2;
            const top = cy - height / 2;
            const segments = [
                ['line', left + radius, top, 1, 0, straightW, 0, -1],
                ['arc', left + width - radius, top + radius, -Math.PI / 2],
                ['line', left + width, top + radius, 0, 1, straightH, 1, 0],
                ['arc', left + width - radius, top + height - radius, 0],
                ['line', left + width - radius, top + height, -1, 0, straightW, 0, 1],
                ['arc', left + radius, top + height - radius, Math.PI / 2],
                ['line', left, top + height - radius, 0, -1, straightH, -1, 0],
                ['arc', left + radius, top + radius, Math.PI]
            ];
            for (const seg of segments) {
                const length = seg[0] === 'line' ? seg[5] : arc;
                if (remaining <= length || seg === segments[segments.length - 1]) {
                    if (seg[0] === 'line') {
                        out.x = seg[1] + seg[3] * remaining;
                        out.y = seg[2] + seg[4] * remaining;
                        out.nx = seg[6];
                        out.ny = seg[7];
                    } else {
                        const angle = seg[3] + (radius > 0 ? remaining / radius : 0);
                        out.nx = Math.cos(angle);
                        out.ny = Math.sin(angle);
                        out.x = seg[1] + out.nx * radius;
                        out.y = seg[2] + out.ny * radius;
                    }
                    return out;
                }
                remaining -= length;
            }
            return out;
        };

        const tmp = { x: 0, y: 0, nx: 0, ny: 0 };
        let seed = 1;

        const buildBox = (box) => {
            const rw = 90 + R.hash(seed * 1.7) * 14;
            const rh = 56 + R.hash(seed * 2.3) * 10;
            const tilt = (R.hash(seed * 3.1) - 0.5) * 0.06;
            const start = 0.02 + R.hash(seed * 4.9) * 0.05;
            const make = (salt, amp) => {
                const xs = new Float32Array(BOX_POINTS);
                const ys = new Float32Array(BOX_POINTS);
                const cos = Math.cos(tilt);
                const sin = Math.sin(tilt);
                for (let i = 0; i < BOX_POINTS; i++) {
                    const along = (i / (BOX_POINTS - 1)) * LOOP;
                    rectPoint(0, 0, rw, rh, 5, start + along, tmp);
                    // Low wobble along the stroke, and the end of the loop drifts off instead of closing neatly.
                    const wobble = R.noise(along * 3.2 + salt, seed * 0.37) * 2.6 * amp + R.noise(along * 13 + salt, 7.1) * 0.7 * amp;
                    const drift = Math.max(0, along - 0.94) * 26;
                    const offset = wobble + drift;
                    const px = tmp.x + tmp.nx * offset;
                    const py = tmp.y + tmp.ny * offset;
                    xs[i] = box.cx + px * cos - py * sin;
                    ys[i] = box.cy + px * sin + py * cos;
                }
                return { x: xs, y: ys };
            };
            box.rough = make(seed * 11.3, 1);
            box.rough2 = make(seed * 11.3 + 40.7, 1.25);
            box.node = { x: box.cx - NODE_W / 2, y: box.cy - NODE_H / 2, w: NODE_W, h: NODE_H };
            const xs = new Float32Array(BOX_POINTS);
            const ys = new Float32Array(BOX_POINTS);
            for (let i = 0; i < BOX_POINTS; i++) {
                const along = (i / (BOX_POINTS - 1)) * LOOP;
                rectPoint(box.cx, box.cy, NODE_W, NODE_H, 8, start + along, tmp);
                xs[i] = tmp.x;
                ys[i] = tmp.y;
            }
            box.target = { x: xs, y: ys };
            seed++;
        };

        const buildArrow = (arrow) => {
            const [ax, ay] = arrow.a;
            const [bx, by] = arrow.b;
            const dx = bx - ax;
            const dy = by - ay;
            const length = Math.hypot(dx, dy);
            const nx = -dy / length;
            const ny = dx / length;
            const bow = (R.hash(seed * 5.3) - 0.5) * 12;
            const xs = new Float32Array(EDGE_POINTS);
            const ys = new Float32Array(EDGE_POINTS);
            for (let i = 0; i < EDGE_POINTS; i++) {
                const along = i / (EDGE_POINTS - 1);
                const off = Math.sin(along * Math.PI) * bow + R.noise(along * 3 + seed, 3.3) * 1.4;
                xs[i] = ax + dx * along + nx * off;
                ys[i] = ay + dy * along + ny * off;
            }
            arrow.rough = { x: xs, y: ys };
            // The head, one "<" motion: barb, tip, barb.
            const ex = xs[EDGE_POINTS - 1] - xs[EDGE_POINTS - 5];
            const ey = ys[EDGE_POINTS - 1] - ys[EDGE_POINTS - 5];
            const angle = Math.atan2(ey, ex);
            const tipX = xs[EDGE_POINTS - 1];
            const tipY = ys[EDGE_POINTS - 1];
            const barb = 11;
            const spread = 0.5 + (R.hash(seed * 9.1) - 0.5) * 0.12;
            arrow.head = {
                x: new Float32Array([tipX - Math.cos(angle - spread) * barb, tipX + 0.6 * Math.cos(angle), tipX - Math.cos(angle + spread) * barb]),
                y: new Float32Array([tipY - Math.sin(angle - spread) * barb, tipY + 0.6 * Math.sin(angle), tipY - Math.sin(angle + spread) * barb])
            };
            const [p0, p1] = arrow.ports;
            const reach = Math.max(20, Math.abs(p1[0] - p0[0]) * 0.55);
            const txs = new Float32Array(EDGE_POINTS);
            const tys = new Float32Array(EDGE_POINTS);
            for (let i = 0; i < EDGE_POINTS; i++) {
                const along = i / (EDGE_POINTS - 1);
                const inv = 1 - along;
                const c1x = p0[0] + p0[2] * reach;
                const c1y = p0[1] + p0[3] * reach;
                const c2x = p1[0] + p1[2] * reach;
                const c2y = p1[1] + p1[3] * reach;
                txs[i] = inv * inv * inv * p0[0] + 3 * inv * inv * along * c1x + 3 * inv * along * along * c2x + along * along * along * p1[0];
                tys[i] = inv * inv * inv * p0[1] + 3 * inv * inv * along * c1y + 3 * inv * along * along * c2y + along * along * along * p1[1];
            }
            arrow.target = { x: txs, y: tys };
            seed++;
        };

        const strokeEase = R.ease.bezier(0.42, 0, 0.58, 1);
        const airEase = R.ease.bezier(0.45, 0, 0.35, 1);

        for (const variant of variants) {
            for (const box of variant.boxes) {
                buildBox(box);
            }
            for (const arrow of variant.arrows) {
                buildArrow(arrow);
            }
            // The timeline: strokes in the order a person draws them, air moves between, scaled to fit the drawing window.
            const approxStart = (item) => {
                const [type, index] = item;
                if (type === 'box') {
                    const box = variant.boxes[index];
                    return [box.rough.x[0], box.rough.y[0]];
                }
                if (type === 'label') {
                    const box = variant.boxes[index];
                    return [box.cx - box.word.length * 5.5, box.cy];
                }
                if (type === 'shaft') {
                    return variant.arrows[index].a;
                }
                const head = variant.arrows[index].head;
                return [head.x[0], head.y[0]];
            };
            const approxEnd = (item) => {
                const [type, index] = item;
                if (type === 'box') {
                    const box = variant.boxes[index];
                    return [box.rough.x[BOX_POINTS - 1], box.rough.y[BOX_POINTS - 1]];
                }
                if (type === 'label') {
                    const box = variant.boxes[index];
                    return [box.cx + box.word.length * 5.5, box.cy];
                }
                if (type === 'shaft') {
                    return variant.arrows[index].b;
                }
                const head = variant.arrows[index].head;
                return [head.x[2], head.y[2]];
            };
            const durationOf = (item) => {
                const [type, index] = item;
                if (type === 'box') {
                    return 0.56;
                }
                if (type === 'label') {
                    return 0.16 + variant.boxes[index].word.length * 0.065;
                }
                if (type === 'shaft') {
                    return 0.3;
                }
                return 0.17;
            };
            const raw = [];
            let clock = 0;
            let previous = null;
            for (const item of variant.order) {
                const begin = approxStart(item);
                if (previous) {
                    const air = 0.13 + Math.hypot(begin[0] - previous[0], begin[1] - previous[1]) / 1500;
                    raw.push({ air: true, t0: clock, t1: clock + air });
                    clock += air;
                }
                const duration = durationOf(item);
                raw.push({ air: false, item, t0: clock, t1: clock + duration });
                clock += duration;
                previous = approxEnd(item);
            }
            const scale = (DRAW_END - DRAW_START) / clock;
            variant.timeline = raw.map((entry) => ({ ...entry, t0: DRAW_START + entry.t0 * scale, t1: DRAW_START + entry.t1 * scale }));
            variant.strokeTime = new Map();
            for (const entry of variant.timeline) {
                if (!entry.air) {
                    variant.strokeTime.set(entry.item[0] + entry.item[1], entry);
                }
            }
        }

        const inkStroke = (xs, ys, upto, width, alpha) => {
            if (upto <= 0) {
                return;
            }
            const last = xs.length - 1;
            const end = upto * last;
            const whole = Math.floor(end);
            ctx.globalAlpha = alpha;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(xs[0], ys[0]);
            for (let i = 1; i <= whole; i++) {
                ctx.lineTo(xs[i], ys[i]);
            }
            if (whole < last) {
                const frac = end - whole;
                ctx.lineTo(R.lerp(xs[whole], xs[whole + 1], frac), R.lerp(ys[whole], ys[whole + 1], frac));
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        };

        const blended = { x: new Float32Array(BOX_POINTS), y: new Float32Array(BOX_POINTS) };
        const blend = (from, to, morph, count) => {
            for (let i = 0; i < count; i++) {
                blended.x[i] = from.x[i] + (to.x[i] - from.x[i]) * morph;
                blended.y[i] = from.y[i] + (to.y[i] - from.y[i]) * morph;
            }
            return blended;
        };
        const blendedEdge = { x: new Float32Array(EDGE_POINTS), y: new Float32Array(EDGE_POINTS) };

        const glyph = (kind, cx, cy, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            if (kind === 'terminal') {
                ctx.moveTo(cx - 4, cy - 3);
                ctx.lineTo(cx - 1, cy);
                ctx.lineTo(cx - 4, cy + 3);
                ctx.moveTo(cx + 0.5, cy + 3.5);
                ctx.lineTo(cx + 4, cy + 3.5);
            } else if (kind === 'chat') {
                R.roundRect(ctx, cx - 4.5, cy - 4, 9, 6.5, 2);
                ctx.moveTo(cx - 2.5, cy + 2.5);
                ctx.lineTo(cx - 3.5, cy + 4.5);
            } else {
                ctx.arc(cx, cy, 4.2, 0, R.TAU);
                ctx.moveTo(cx - 4.2, cy);
                ctx.lineTo(cx + 4.2, cy);
                ctx.moveTo(cx, cy - 4.2);
                ctx.bezierCurveTo(cx + 2.6, cy - 2, cx + 2.6, cy + 2, cx, cy + 4.2);
                ctx.bezierCurveTo(cx - 2.6, cy + 2, cx - 2.6, cy - 2, cx, cy - 4.2);
            }
            ctx.stroke();
        };

        const drawNodeBody = (box, show, t) => {
            const node = box.node;
            ctx.globalAlpha = show;
            ctx.fillStyle = pal.surface;
            R.roundRect(ctx, node.x, node.y, node.w, node.h, 8);
            ctx.fill();
            ctx.fillStyle = pal.raised;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y + HEAD);
            ctx.arcTo(node.x, node.y, node.x + node.w, node.y, 8);
            ctx.arcTo(node.x + node.w, node.y, node.x + node.w, node.y + HEAD, 8);
            ctx.lineTo(node.x + node.w, node.y + HEAD);
            ctx.closePath();
            ctx.fill();
            if (box.kind === 'terminal') {
                ctx.fillStyle = pal.termBg;
                ctx.beginPath();
                ctx.moveTo(node.x, node.y + HEAD);
                ctx.lineTo(node.x + node.w, node.y + HEAD);
                ctx.arcTo(node.x + node.w, node.y + node.h, node.x, node.y + node.h, 8);
                ctx.arcTo(node.x, node.y + node.h, node.x, node.y + HEAD, 8);
                ctx.closePath();
                ctx.fill();
            }
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y + HEAD + 0.5);
            ctx.lineTo(node.x + node.w, node.y + HEAD + 0.5);
            ctx.stroke();
            const inner = R.smoothstep(0.55, 1, show);
            if (inner > 0) {
                ctx.globalAlpha = inner;
                glyph(box.kind, node.x + 11, node.y + HEAD / 2, pal.muted);
                const color = statusColor[box.status];
                const beat = box.status === 'idle' ? 1 : 0.65 + 0.35 * Math.sin(t * (box.status === 'needs' ? 3.3 : 4.6));
                ctx.globalAlpha = inner * beat;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x + node.w - 10, node.y + HEAD / 2, 2.8 * R.ease.outBack(inner, 2.5), 0, R.TAU);
                ctx.fill();
                ctx.globalAlpha = inner;
                if (box.kind === 'browser') {
                    ctx.fillStyle = pal.sunken;
                    R.roundRect(ctx, node.x + 8, node.y + HEAD + 7, node.w - 16, 13, 6.5);
                    ctx.fill();
                    ctx.fillStyle = pal.muted;
                    ctx.font = '400 8px ' + R.fonts.mono;
                    ctx.fillText(box.lines[0], node.x + 14, node.y + HEAD + 16.5);
                    ctx.fillStyle = pal.hover;
                    R.roundRect(ctx, node.x + 8, node.y + HEAD + 26, 40, 14, 3);
                    ctx.fill();
                    R.roundRect(ctx, node.x + 52, node.y + HEAD + 26, node.w - 60, 5, 2.5);
                    ctx.fill();
                    R.roundRect(ctx, node.x + 52, node.y + HEAD + 35, node.w - 76, 5, 2.5);
                    ctx.fill();
                } else {
                    ctx.font = box.kind === 'terminal' ? '400 8px ' + R.fonts.mono : '400 8.5px ' + R.fonts.sans;
                    const count = box.lines.length;
                    for (let j = 0; j < count; j++) {
                        const appear = R.clamp((inner - 0.3 - j * 0.2) / 0.3);
                        if (appear <= 0) {
                            continue;
                        }
                        ctx.globalAlpha = inner * appear;
                        const line = box.lines[j];
                        if (box.kind === 'terminal') {
                            ctx.fillStyle = line.startsWith('$') ? pal.termFg : j === count - 1 ? pal.green : pal.termDim;
                        } else {
                            ctx.fillStyle = j === 0 ? pal.text : pal.muted;
                        }
                        ctx.fillText(line, node.x + 9, node.y + HEAD + 14 + j * 11);
                    }
                }
            }
            ctx.globalAlpha = 1;
        };

        const scribble = [];
        const SCRIBBLE_LIFE = 1.6;
        let now = 0;

        const drawScene = (variant, cycleTime, t, alphaScale) => {
            const timeline = variant.strokeTime;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = INK;
            const morphOf = (index) => {
                const into = R.ease.inOutCubic((cycleTime - MORPH - index * STAGGER) / MORPH_LEN);
                const out = R.ease.inOutCubic((cycleTime - UNMORPH - index * 0.1) / UNMORPH_LEN);
                return into * (1 - out);
            };
            const progressOf = (type, index) => {
                const entry = timeline.get(type + index);
                return strokeEase((cycleTime - entry.t0) / (entry.t1 - entry.t0));
            };

            // Edges under nodes.
            for (let i = 0; i < variant.arrows.length; i++) {
                const arrow = variant.arrows[i];
                const shaft = progressOf('shaft', i);
                if (shaft <= 0) {
                    continue;
                }
                const morph = Math.min(morphOf(arrow.from), morphOf(arrow.to));
                if (morph <= 0.001) {
                    ctx.strokeStyle = INK;
                    inkStroke(arrow.rough.x, arrow.rough.y, shaft, 2.4, 0.95 * alphaScale);
                } else {
                    for (let k = 0; k < EDGE_POINTS; k++) {
                        blendedEdge.x[k] = arrow.rough.x[k] + (arrow.target.x[k] - arrow.rough.x[k]) * morph;
                        blendedEdge.y[k] = arrow.rough.y[k] + (arrow.target.y[k] - arrow.rough.y[k]) * morph;
                    }
                    ctx.strokeStyle = R.mix(INK, EDGE, R.smoothstep(0.2, 0.8, morph));
                    inkStroke(blendedEdge.x, blendedEdge.y, 1, R.lerp(2.4, 1.6, morph), alphaScale);
                    const flow = R.smoothstep(0.85, 1, morph);
                    if (flow > 0) {
                        const flowAt = R.fract(t * 0.55 + i * 0.37);
                        const index = flowAt * (EDGE_POINTS - 1);
                        const k = Math.floor(index);
                        const frac = index - k;
                        const x = R.lerp(arrow.target.x[k], arrow.target.x[Math.min(k + 1, EDGE_POINTS - 1)], frac);
                        const y = R.lerp(arrow.target.y[k], arrow.target.y[Math.min(k + 1, EDGE_POINTS - 1)], frac);
                        ctx.globalAlpha = flow * Math.sin(flowAt * Math.PI) * alphaScale;
                        ctx.fillStyle = pal.running;
                        ctx.beginPath();
                        ctx.arc(x, y, 2.3, 0, R.TAU);
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }
                    const ports = R.smoothstep(0.5, 0.9, morph) * alphaScale;
                    if (ports > 0) {
                        ctx.globalAlpha = ports;
                        ctx.fillStyle = EDGE;
                        ctx.beginPath();
                        ctx.arc(arrow.target.x[0], arrow.target.y[0], 2.6, 0, R.TAU);
                        ctx.arc(arrow.target.x[EDGE_POINTS - 1], arrow.target.y[EDGE_POINTS - 1], 2.6, 0, R.TAU);
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }
                }
                const head = progressOf('head', i);
                const headFade = 1 - R.smoothstep(0, 0.45, morph);
                if (head > 0 && headFade > 0) {
                    ctx.strokeStyle = INK;
                    inkStroke(arrow.head.x, arrow.head.y, head, 2.4, 0.95 * headFade * alphaScale);
                }
            }

            // Boxes, their words, and the nodes they become.
            for (let i = 0; i < variant.boxes.length; i++) {
                const box = variant.boxes[i];
                const drawn = progressOf('box', i);
                if (drawn <= 0) {
                    continue;
                }
                const morph = morphOf(i);
                if (morph > 0.001) {
                    drawNodeBody(box, R.smoothstep(0.25, 0.9, morph) * alphaScale, t);
                }
                const outline = blend(box.rough, box.target, morph, BOX_POINTS);
                ctx.strokeStyle = morph > 0.001 ? R.mix(INK, '#3a3a42', R.smoothstep(0.3, 1, morph)) : INK;
                if (morph >= 0.999) {
                    ctx.globalAlpha = alphaScale;
                    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
                    ctx.lineWidth = 1;
                    R.roundRect(ctx, box.node.x, box.node.y, box.node.w, box.node.h, 8);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                } else {
                    inkStroke(outline.x, outline.y, drawn, R.lerp(2.4, 1, morph), alphaScale);
                    const second = blend(box.rough2, box.target, morph, BOX_POINTS);
                    ctx.strokeStyle = INK;
                    inkStroke(second.x, second.y, drawn, 1.2, 0.42 * (1 - morph) * alphaScale);
                }

                const written = progressOf('label', i);
                if (written > 0) {
                    ctx.font = '700 22px ' + R.fonts.hand;
                    const handWidth = ctx.measureText(box.word).width;
                    ctx.font = '500 11px ' + R.fonts.sans;
                    const typeWidth = ctx.measureText(box.word).width;
                    const fromX = box.cx - handWidth / 2;
                    const fromY = box.cy + 7;
                    const toX = box.node.x + 22;
                    const toY = box.node.y + HEAD / 2 + 4;
                    const x = R.lerp(fromX, toX, morph);
                    const y = R.lerp(fromY, toY, morph) - Math.sin(morph * Math.PI) * 6;
                    const size = R.lerp(1, 0.5, morph);
                    const hand = (1 - R.smoothstep(0.15, 0.6, morph)) * alphaScale;
                    if (hand > 0) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(fromX - 6, fromY - 30, handWidth * written + 8, 44);
                        ctx.clip();
                        ctx.translate(x, y);
                        ctx.scale(size, size);
                        ctx.globalAlpha = hand;
                        ctx.fillStyle = INK;
                        ctx.font = '700 22px ' + R.fonts.hand;
                        ctx.fillText(box.word, 0, 0);
                        ctx.restore();
                    }
                    const typed = R.smoothstep(0.35, 0.8, morph) * alphaScale;
                    if (typed > 0) {
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.scale(size * 2, size * 2);
                        ctx.globalAlpha = typed;
                        ctx.fillStyle = pal.text;
                        ctx.font = '500 11px ' + R.fonts.sans;
                        ctx.fillText(box.word, 0, 0);
                        ctx.restore();
                    }
                    box.handWidth = handWidth;
                    box.typeWidth = typeWidth;
                }
            }
        };

        // Where the pen is: on a stroke, between strokes in the air, or away.
        const penAt = (variant, cycleTime) => {
            const home = [600, 470];
            const timeline = variant.timeline;
            const first = timeline[0];
            const last = timeline[timeline.length - 1];
            const strokePoint = (entry, progress) => {
                const [type, index] = entry.item;
                if (type === 'box') {
                    const box = variant.boxes[index];
                    const k = Math.min(BOX_POINTS - 1, Math.round(progress * (BOX_POINTS - 1)));
                    return [box.rough.x[k], box.rough.y[k]];
                }
                if (type === 'label') {
                    const box = variant.boxes[index];
                    const width = box.handWidth || box.word.length * 11;
                    return [box.cx - width / 2 + width * progress, box.cy - 1 + Math.sin(progress * Math.PI * box.word.length * 1.6) * 5];
                }
                const path = type === 'shaft' ? variant.arrows[index].rough : variant.arrows[index].head;
                const count = path.x.length - 1;
                const position = progress * count;
                const k = Math.min(count - 1, Math.floor(position));
                return [R.lerp(path.x[k], path.x[k + 1], position - k), R.lerp(path.y[k], path.y[k + 1], position - k)];
            };
            const firstStart = strokePoint(timeline[0], 0);
            if (cycleTime < first.t0) {
                const progress = airEase(R.clamp((cycleTime - (first.t0 - 0.5)) / 0.5));
                return { x: R.lerp(home[0], firstStart[0], progress), y: R.lerp(home[1], firstStart[1], progress) - Math.sin(progress * Math.PI) * 30, lift: 1 - progress * 0.9, down: false };
            }
            if (cycleTime > last.t1) {
                const lastEnd = strokePoint(last, 1);
                const progress = airEase(R.clamp((cycleTime - last.t1) / 0.7));
                return { x: R.lerp(lastEnd[0], home[0], progress), y: R.lerp(lastEnd[1], home[1], progress) - Math.sin(progress * Math.PI) * 30, lift: 0.1 + progress * 0.9, down: false };
            }
            for (let i = 0; i < timeline.length; i++) {
                const entry = timeline[i];
                if (cycleTime > entry.t1) {
                    continue;
                }
                const progress = R.clamp((cycleTime - entry.t0) / (entry.t1 - entry.t0));
                if (!entry.air) {
                    const [x, y] = strokePoint(entry, strokeEase(progress));
                    return { x, y, lift: 0.1, down: true };
                }
                const from = strokePoint(timeline[i - 1], 1);
                const to = strokePoint(timeline[i + 1], 0);
                const e = airEase(progress);
                const hop = Math.min(26, Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.25);
                return { x: R.lerp(from[0], to[0], e), y: R.lerp(from[1], to[1], e) - Math.sin(e * Math.PI) * hop, lift: 0.1 + Math.sin(progress * Math.PI) * 0.9, down: false };
            }
            return { x: home[0], y: home[1], lift: 1, down: false };
        };

        const drawPen = (pen) => {
            const lift = pen.lift;
            ctx.save();
            ctx.translate(pen.x, pen.y);
            // Shadow first: it falls further from the tip the higher the pen is held.
            ctx.save();
            ctx.translate(3 + lift * 9, 4 + lift * 12);
            ctx.rotate(-1.02);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            R.roundRect(ctx, 8, -5, 76, 10, 5);
            ctx.fill();
            ctx.restore();
            ctx.rotate(-1.02);
            ctx.fillStyle = '#3a3a42';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(10, -3.4);
            ctx.lineTo(10, 3.4);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = pal.markLight;
            R.roundRect(ctx, 9, -5, 76, 10, 3);
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(9, 1.5, 76, 3.5);
            ctx.fillStyle = '#2b2b31';
            R.roundRect(ctx, 62, -5.4, 24, 10.8, 3);
            ctx.fill();
            ctx.restore();
            if (pen.down) {
                ctx.fillStyle = INK;
                ctx.beginPath();
                ctx.arc(pen.x, pen.y, 1.6, 0, R.TAU);
                ctx.fill();
            }
        };

        const drawEraser = (x, y, angle) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            R.roundRect(ctx, -16, -40, 40, 92, 8);
            ctx.fill();
            ctx.fillStyle = '#2a2a30';
            R.roundRect(ctx, -20, -46, 36, 92, 8);
            ctx.fill();
            ctx.fillStyle = '#8a8b95';
            ctx.beginPath();
            ctx.moveTo(-10, -46);
            ctx.lineTo(-12, -46);
            ctx.arcTo(-20, -46, -20, -38, 8);
            ctx.lineTo(-20, 38);
            ctx.arcTo(-20, 46, -12, 46, 8);
            ctx.lineTo(-10, 46);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.13)';
            ctx.lineWidth = 1;
            R.roundRect(ctx, -20, -46, 36, 92, 8);
            ctx.stroke();
            ctx.restore();
        };

        return {
            update(t, dt) {
                now = t;
                const pointer = env.pointer;
                if (pointer.active > 0.3 && pointer.inside) {
                    const last = scribble[scribble.length - 1];
                    if (!last || Math.hypot(last.x - pointer.x, last.y - pointer.y) > 1.5) {
                        scribble.push({ x: pointer.x, y: pointer.y, t });
                    }
                }
                while (scribble.length && t - scribble[0].t > SCRIBBLE_LIFE) {
                    scribble.shift();
                }
                if (scribble.length > 240) {
                    scribble.splice(0, scribble.length - 240);
                }
            },
            draw(t) {
                env.clear();
                const cycle = Math.floor(t / CYCLE);
                const cycleTime = t - cycle * CYCLE;
                const variant = variants[((cycle % variants.length) + variants.length) % variants.length];

                if (cycleTime < ERASE) {
                    ctx.save();
                    enlarge();
                    drawScene(variant, cycleTime, t, 1);
                    ctx.restore();
                } else {
                    // The eraser scrubs up and down as it crosses; everything left of it is gone but a little chalk dust.
                    const wipe = R.clamp((cycleTime - ERASE) / ERASE_LEN);
                    const sweep = R.lerp(-40, 620, R.ease.inOutSine(wipe));
                    const slant = 0.18;
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(sweep - 250 * slant, 0);
                    ctx.lineTo(env.W + 40, 0);
                    ctx.lineTo(env.W + 40, env.H);
                    ctx.lineTo(sweep + 250 * slant, env.H);
                    ctx.closePath();
                    ctx.clip();
                    enlarge();
                    drawScene(variant, ERASE - 0.001, t, 1);
                    ctx.restore();
                    const dust = 0.12 * (1 - wipe);
                    if (dust > 0.005) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(-40, 0);
                        ctx.lineTo(sweep - 250 * slant, 0);
                        ctx.lineTo(sweep + 250 * slant, env.H);
                        ctx.lineTo(-40, env.H);
                        ctx.closePath();
                        ctx.clip();
                        ctx.translate(-3, 2);
                        enlarge();
                        drawScene(variant, ERASE - 0.001, t, dust);
                        ctx.restore();
                    }
                    if (wipe < 1) {
                        const scrub = Math.sin(wipe * Math.PI * 6);
                        const y = 250 + scrub * 125;
                        drawEraser(sweep + (y - 250) * slant, y, 0.18 + Math.cos(wipe * Math.PI * 6) * 0.08);
                    }
                }

                const pen = penAt(variant, cycleTime);
                if (cycleTime < DRAW_END + 1) {
                    ctx.save();
                    enlarge();
                    drawPen(pen);
                    ctx.restore();
                }

                if (scribble.length > 1) {
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = 1.4;
                    for (let i = 1; i < scribble.length; i++) {
                        const prev = scribble[i - 1];
                        const curr = scribble[i];
                        const age = now - curr.t;
                        const alpha = 0.5 * (1 - age / SCRIBBLE_LIFE);
                        if (alpha <= 0) {
                            continue;
                        }
                        ctx.strokeStyle = R.rgba(pal.muted, alpha);
                        ctx.beginPath();
                        ctx.moveTo(prev.x, prev.y);
                        ctx.lineTo(curr.x, curr.y);
                        ctx.stroke();
                    }
                }

                fadeRect();
            }
        };
    }
});
