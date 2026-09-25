Reel.add({
    id: 'attention-stack',
    title: 'The Stack',
    line: 'Whatever needs you lands on one stack, in the order it came.',
    principles: ['Follow through and overlapping action', 'Arcs'],
    tech: 'Canvas 2D, card stack physics',
    hint: 'Hover the stack to fan it out',
    poster: 3.6,
    create(env) {
        const { R } = env;
        /* The app's own parts, drawn the way the site's React redraw of the client measures them. */
        const ctx = env.ctx;
        const pal = R.pal;
        const SANS = R.fonts.sans;
        const MONO = R.fonts.mono;
        const STATUS = { running: pal.running, needs: pal.needs, idle: pal.idle, error: pal.error };
        const STATUS_LABEL = { running: 'Running', needs: 'Needs you', idle: 'Idle', error: 'Error' };
        const ring = (cx, cy, rad) => `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0`;
        const box = (x, y, wide, tall, rad) => `M${x + rad} ${y}h${wide - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${tall - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}h${-(wide - 2 * rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}v${-(tall - 2 * rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}z`;
        // Lucide's own paths (24 unit box, 1.75 stroke), so a glyph reads as the app's glyph.
        const ICONS = {
            terminal: ['M12 19h8', 'm4 17 6-6-6-6'],
            chat: ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'],
            browser: [ring(12, 12, 10), 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
            drawing: [
                'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
                'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
                'm2.3 2.3 7.286 7.286',
                ring(11, 11, 2)
            ],
            file: ['M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z', 'M14 2v5a1 1 0 0 0 1 1h5', 'M10 9H8', 'M16 13H8', 'M16 17H8'],
            note: ['M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z', 'M15 3v5a1 1 0 0 0 1 1h5'],
            canvas: [box(3, 3, 7, 7, 1), box(14, 3, 7, 7, 1), box(14, 14, 7, 7, 1), box(3, 14, 7, 7, 1)],
            circle: [ring(12, 12, 10)],
            circleCheck: [ring(12, 12, 10), 'm16 9-5.5 5.5L8 12'],
            question: ['M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
            hand: [
                'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
                'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
                'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
                'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'
            ],
            arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
            arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
            enter: ['M20 4v7a4 4 0 0 1-4 4H4', 'm9 10-5 5 5 5'],
            chevronLeft: ['m15 18-6-6 6-6'],
            chevronRight: ['m9 18 6-6-6-6'],
            chevronDown: ['m6 9 6 6 6-6'],
            maximize: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'],
            close: ['M18 6 6 18', 'm6 6 12 12'],
            eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', ring(12, 12, 3)],
            edit: ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'],
            check: ['M20 6 9 17l-5-5'],
            lock: [box(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 10 0v4'],
            reload: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
            plus: ['M5 12h14', 'M12 5v14']
        };
        const MARKS = {
            claude: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
            codex: 'M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.554 5.554 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.019.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.001zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z'
        };
        const pathCache = new Map();
        const pathsOf = (name) => {
            let list = pathCache.get(name);
            if (!list) {
                list = ICONS[name].map((svg) => new Path2D(svg));
                pathCache.set(name, list);
            }
            return list;
        };
        const markPaths = { claude: new Path2D(MARKS.claude), codex: new Path2D(MARKS.codex) };
        // x, y is the glyph's top left; size its box, as Lucide's `size`.
        const icon = (name, x, y, size, color, weight = 1.75) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(size / 24, size / 24);
            ctx.strokeStyle = color;
            ctx.lineWidth = weight;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const path of pathsOf(name)) {
                ctx.stroke(path);
            }
            ctx.restore();
        };
        const mark = (kind, x, y, size, color) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(size / 24, size / 24);
            ctx.fillStyle = color;
            ctx.fill(markPaths[kind]);
            ctx.restore();
        };
        const setFont = (size, weight = 400, family = SANS) => {
            ctx.font = `${weight} ${size}px ${family}`;
        };
        // Widths are kept only once the fonts are in, or a fallback's measure would stick.
        const widths = new Map();
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
        const label = (text, x, y, size, color, weight = 400, family = SANS, align = 'left') => {
            setFont(size, weight, family);
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(text, x, y);
        };
        // The client's `.shine`: muted words with a light that runs over them from right to left every 1.6 s.
        const shine = (text, x, y, size, now, weight = 400, family = SANS) => {
            setFont(size, weight, family);
            const width = measure(text);
            const sweep = R.fract(now / 1.6);
            const center = x + width * (1.7 - 2.4 * sweep);
            const band = Math.max(16, width * 0.34);
            const gradient = ctx.createLinearGradient(center - band, 0, center + band, 0);
            gradient.addColorStop(0, pal.muted);
            gradient.addColorStop(0.5, pal.text);
            gradient.addColorStop(1, pal.muted);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = gradient;
            ctx.fillText(text, x, y);
            return width;
        };
        const pulseOf = (status, now) => (status === 'running' ? 0.75 + 0.25 * Math.cos((now * Math.PI * 2) / 2) : 1);
        const statusDot = (x, y, status, now, radius = 4, color = null) => {
            ctx.globalAlpha *= pulseOf(status, now);
            ctx.fillStyle = color || STATUS[status];
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha /= pulseOf(status, now);
        };
        const fillRound = (x, y, wide, tall, rad, color) => {
            R.roundRect(ctx, x, y, wide, tall, rad);
            ctx.fillStyle = color;
            ctx.fill();
        };
        const strokeRound = (x, y, wide, tall, rad, color, width) => {
            R.roundRect(ctx, x, y, wide, tall, rad);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();
        };
        // `StatusPill`: a sunken capsule with the dot and the word, its right edge at `right`.
        const pill = (right, y, status, now, size = 12, color = null) => {
            setFont(size, 400);
            const word = STATUS_LABEL[status];
            const width = measure(word) + size * 1.95;
            const height = size * 1.62;
            fillRound(right - width, y - height / 2, width, height, height / 2, pal.sunken);
            statusDot(right - width + size * 0.72, y, status, now, size / 3.25, color);
            label(word, right - width + size * 1.2, y + 0.5, size, pal.muted);
            return width;
        };
        // `NodeFrame`: an 11 radius frame, a 39 tall raised header with the glyph, the title, the pill and two buttons.
        const HEADER = 39;
        const nodeFrame = (x, y, wide, tall, opts) => {
            const hair = opts.hair || 1;
            const header = opts.header === undefined ? HEADER : opts.header;
            const ground = opts.kind === 'note' ? pal.note : opts.kind === 'terminal' ? pal.termBg : pal.surface;
            fillRound(x - 1, y + 1, wide + 2, tall + 3, 12, 'rgba(0,0,0,0.2)');
            fillRound(x, y + 1, wide, tall + 1, 11, 'rgba(0,0,0,0.22)');
            fillRound(x, y, wide, tall, 11, ground);
            if (header > 0) {
                ctx.save();
                R.roundRect(ctx, x, y, wide, tall, 11);
                ctx.clip();
                ctx.fillStyle = opts.kind === 'note' ? pal.note : pal.raised;
                ctx.fillRect(x, y, wide, header);
                ctx.fillStyle = opts.kind === 'note' ? 'rgba(236,236,241,0.12)' : 'rgba(255,255,255,0.07)';
                ctx.fillRect(x, y + header - hair, wide, hair);
                ctx.restore();
            }
            strokeRound(x + hair / 2, y + hair / 2, wide - hair, tall - hair, 11, opts.border || 'rgba(255,255,255,0.08)', hair);
        };
        const nodeHeader = (x, y, wide, opts, now) => {
            const mid = y + HEADER / 2;
            if (opts.agent) {
                mark(opts.agent, x + 10, mid - 7, 14, pal.muted);
            } else {
                icon(opts.kind, x + 10, mid - 7, 14, pal.muted);
            }
            let right = x + wide - 4;
            if (opts.buttons !== false) {
                icon('close', right - 21, mid - 7, 14, pal.muted);
                icon('maximize', right - 49, mid - 7, 14, pal.muted);
                right -= 60;
            }
            if (opts.status) {
                right -= pill(right, mid, opts.status, now, 12, opts.statusColor) + 8;
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 30, y, Math.max(0, right - x - 30), HEADER);
            ctx.clip();
            label(opts.title, x + 34, mid + 0.5, 13, pal.text, 500);
            ctx.restore();
        };
        // A rectangular feather instead of the ellipse: a window of UI keeps its corners, the box edges still dissolve.
        const edgeRamps = new Map();
        const ramp = (length, margin) => {
            const key = length + ':' + margin;
            let gradient = edgeRamps.get(key);
            if (!gradient) {
                const horizontal = length === env.W;
                gradient = horizontal ? ctx.createLinearGradient(0, 0, env.W, 0) : ctx.createLinearGradient(0, 0, 0, env.H);
                const share = margin / length;
                const curve = [0, 0.16, 0.5, 0.84, 1];
                for (let i = 0; i < curve.length; i++) {
                    gradient.addColorStop((share * i) / 4, `rgba(0,0,0,${curve[i]})`);
                    gradient.addColorStop(1 - (share * i) / 4, `rgba(0,0,0,${curve[i]})`);
                }
                edgeRamps.set(key, gradient);
            }
            return gradient;
        };
        const softEdges = (mx = 56, my = 50) => {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.fillStyle = ramp(env.W, mx);
            ctx.fillRect(0, 0, env.W, env.H);
            ctx.fillStyle = ramp(env.H, my);
            ctx.fillRect(0, 0, env.W, env.H);
            ctx.restore();
        };
        // The canvas ground: neutral dots on a pitch, never the accent.
        const dotGrid = (pitch, ox, oy, alpha, size = 1.2) => {
            if (alpha <= 0.004) {
                return;
            }
            ctx.fillStyle = `rgba(255,255,255,${0.085 * alpha})`;
            const x0 = R.mod(ox, pitch);
            const y0 = R.mod(oy, pitch);
            for (let y = y0; y < env.H; y += pitch) {
                for (let x = x0; x < env.W; x += pitch) {
                    ctx.fillRect(x - size / 2, y - size / 2, size, size);
                }
            }
        };
        // A connector as the client routes it: out of the middle of the facing sides, one rail between, corners rounded.
        const EDGE_CONTEXT = R.mix(pal.accent, pal.bg, 0.45);
        const routeBetween = (first, second) => {
            const dx = second.x + second.wide / 2 - (first.x + first.wide / 2);
            const dy = second.y + second.tall / 2 - (first.y + first.tall / 2);
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            const along = horizontal ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
            const side = (rect, ax, ay) => [
                ax === 0 ? rect.x + rect.wide / 2 : ax > 0 ? rect.x + rect.wide + 9 : rect.x - 9,
                ay === 0 ? rect.y + rect.tall / 2 : ay > 0 ? rect.y + rect.tall + 9 : rect.y - 9
            ];
            const start = side(first, along[0], along[1]);
            const end = side(second, -along[0], -along[1]);
            if (horizontal) {
                const rail = (start[0] + end[0]) / 2;
                return [start, [rail, start[1]], [rail, end[1]], end];
            }
            const rail = (start[1] + end[1]) / 2;
            return [start, [start[0], rail], [end[0], rail], end];
        };
        const traceRoute = (points) => {
            ctx.beginPath();
            ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length - 1; i++) {
                const [px, py] = points[i - 1];
                const [cx, cy] = points[i];
                const [nx, ny] = points[i + 1];
                const radius = Math.min(15, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
                if (radius < 0.5) {
                    ctx.lineTo(cx, cy);
                } else {
                    ctx.arcTo(cx, cy, nx, ny, radius);
                }
            }
            const last = points[points.length - 1];
            ctx.lineTo(last[0], last[1]);
        };
        const edge = (first, second, color, width, dashed = false) => {
            const points = routeBetween(first, second);
            traceRoute(points);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash(dashed ? [6, 6] : []);
            ctx.stroke();
            ctx.setLineDash([]);
            const end = points[points.length - 1];
            ctx.beginPath();
            ctx.arc(end[0], end[1], 5, 0, Math.PI * 2);
            ctx.fillStyle = pal.bg;
            ctx.fill();
            ctx.stroke();
            return points;
        };
        // The person's own pointer, black with a white rim, tip at x, y.
        const CURSOR = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');
        const cursor = (x, y, scale = 1, alpha = 1) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x - 1.5 * scale, y - 1.5 * scale);
            ctx.scale(scale, scale);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.translate(0, 1);
            ctx.fill(CURSOR);
            ctx.translate(0, -1);
            ctx.fillStyle = '#000000';
            ctx.fill(CURSOR);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.lineJoin = 'round';
            ctx.stroke(CURSOR);
            ctx.restore();
        };

        const LOOP = 13;
        const spring = (elapsed, omega, zeta) => {
            if (elapsed <= 0) {
                return 0;
            }
            const damped = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * elapsed) * (Math.cos(damped * elapsed) + ((zeta * omega) / damped) * Math.sin(damped * elapsed));
        };

        /* The agents that ask, small and far, and the stack in front of them. */
        const SOURCES = [
            { cx: 116, title: 'Install deps', agent: 'claude' },
            { cx: 280, title: 'Saved carts', agent: 'claude' },
            { cx: 444, title: 'Flaky test', agent: 'codex' }
        ];
        const SRC_Y = 52;
        const SRC_SCALE = 0.6;
        const SRC_W = 226;
        const SRC_H = 108;
        const CARD_W = 360;
        const CARD_H = 204;
        const CARD_X = 280 - CARD_W / 2;
        const FRONT_TOP = 232;

        /* Each card: when it lands, when it is answered, and every place in the stack in between. */
        const CARDS = [
            {
                source: 0,
                kind: 'approval',
                who: 'Claude',
                clock: '12:05',
                command: 'bun install',
                cwd: '~/acme-web',
                arrive: [10.8],
                answer: 5.05,
                moves: [[0, 0]]
            },
            {
                source: 1,
                kind: 'question',
                who: 'Claude',
                clock: '12:06',
                question: 'How long should we keep a saved cart?',
                choices: ['Keep for 30 days', 'Clear on sign-out', 'Something else…'],
                arrive: [0.55],
                pick: 6.72,
                answer: 7.42,
                moves: [[0.55, 1], [5.3, 0]]
            },
            {
                source: 2,
                kind: 'approval',
                who: 'Codex',
                clock: '12:08',
                command: 'git push origin fix/flaky-test',
                cwd: '~/acme-web',
                arrive: [1.65],
                answer: 9.25,
                moves: [[1.65, 2], [5.37, 1], [7.7, 0]]
            }
        ];
        const FAN_OPEN = 2.75;
        const FAN_CLOSE = 4.35;
        const FLICK = 0.2;
        const FLICK_DUR = 0.62;

        const waitingAt = (card, time) => {
            if (card.moves[0][0] === 0 && time < card.answer + FLICK) {
                return true;
            }
            for (const at of card.arrive) {
                if (time >= at && (at > card.answer || time < card.answer + FLICK)) {
                    return true;
                }
            }
            return false;
        };
        const countAt = (time) => {
            let tally = 0;
            for (const card of CARDS) {
                if (waitingAt(card, time)) {
                    tally++;
                }
            }
            return tally;
        };
        const indexAt = (card, time) => {
            let index = card.moves[0][1];
            for (let k = 1; k < card.moves.length; k++) {
                const [at, to] = card.moves[k];
                index += (to - card.moves[k - 1][1]) * spring(time - at, 12, 0.66);
            }
            return index;
        };

        const pose = { x: 0, y: 0, scale: 1, rotate: 0, alpha: 1, dim: 0 };
        const restPose = (index, fan) => {
            const spacing = R.lerp(10, 54, fan);
            pose.y = FRONT_TOP - index * spacing;
            pose.scale = 1 - index * R.lerp(0.05, 0.03, fan);
            pose.dim = index * R.lerp(0.34, 0.16, fan);
            pose.x = 0;
            pose.rotate = 0;
            pose.alpha = 1;
            return pose;
        };
        const sourceCenter = (index) => ({ x: SOURCES[index].cx, y: SRC_Y + (SRC_H * SRC_SCALE) / 2 });
        // Quadratic arcs: in from the agent over a high curve, back out along a lower one.
        const along = (ax, ay, cx, cy, bx, by, amount) => {
            const rest = 1 - amount;
            return [rest * rest * ax + 2 * rest * amount * cx + amount * amount * bx, rest * rest * ay + 2 * rest * amount * cy + amount * amount * by];
        };
        // A card landing behind the stack pushes the ones in front down a touch, and they spring back.
        const landing = (card, time, index) => {
            let bump = 0;
            for (const other of CARDS) {
                if (other === card) {
                    continue;
                }
                for (const at of other.arrive) {
                    const amount = R.phase(time, at + 0.42, 0.55);
                    bump += Math.sin(Math.PI * 2 * amount) * Math.exp(-amount * 3) * 4 * (indexAt(other, at + 1) > index ? 1 : 0);
                }
            }
            return bump;
        };
        const cardPose = (card, time, fan) => {
            const index = indexAt(card, time);
            restPose(index, fan);
            pose.y += landing(card, time, index);
            const home = sourceCenter(card.source);
            for (const at of card.arrive) {
                const elapsed = time - at;
                if (elapsed < 0 || (at < card.answer && time > card.answer + FLICK)) {
                    continue;
                }
                const amount = spring(elapsed, 6.6, 0.6);
                if (elapsed > 1.8) {
                    continue;
                }
                const slotY = pose.y + CARD_H / 2;
                const cx = R.lerp(home.x, 280, 0.2) + (card.source === 1 ? -120 : 0);
                const [x, y] = along(home.x, home.y, cx, home.y - 30, 280, slotY, R.clamp(amount));
                pose.x = x - 280;
                // Past the slot the spring's overshoot carries on down, so the card lands and settles.
                pose.y = y - CARD_H / 2 + (amount > 1 ? (amount - 1) * 60 : 0);
                const eased = R.clamp(amount);
                pose.scale = R.lerp(0.34, pose.scale, eased);
                pose.rotate = (1 - eased) * (card.source === 2 ? 0.2 : -0.2);
                pose.alpha = R.smoothstep(0, 0.18, eased);
            }
            const flick = R.phase(time, card.answer + FLICK, FLICK_DUR);
            if (flick > 0 && time < card.answer + FLICK + FLICK_DUR + 0.01) {
                const amount = R.ease.inOutCubic(flick);
                const startY = FRONT_TOP + CARD_H / 2;
                const cx = R.lerp(280, home.x, 0.9) + (card.source === 1 ? 150 : 0);
                const [x, y] = along(280, startY, cx, startY - 40, home.x, home.y, amount);
                pose.x = x - 280;
                pose.y = y - CARD_H / 2;
                pose.scale = R.lerp(1, 0.3, amount);
                pose.rotate = Math.sin(Math.PI * amount) * (card.source === 0 ? -0.14 : 0.14);
                pose.alpha = 1 - R.smoothstep(0.55, 0.95, amount);
                pose.dim = 0;
            } else if (!waitingAt(card, time)) {
                pose.alpha = 0;
            }
            return pose;
        };

        /* The bodies, as `PromptCard` draws an approval and a question. */
        const sourceRow = (card, x, y, wide, count, index, status, now) => {
            const src = SOURCES[card.source];
            statusDot(x + 16, y + 15, status, now);
            label(src.title, x + 26, y + 15.5, 13, pal.text, 500);
            setFont(13, 500);
            label(`${card.who} · chat · ${card.clock}`, x + 34 + measure(src.title), y + 15.5, 12, pal.muted);
            if (count > 1) {
                const text = `${index + 1} of ${count}`;
                setFont(12);
                const tw = measure(text);
                icon('chevronRight', x + wide - 22, y + 9, 12, pal.muted);
                label(text, x + wide - 26, y + 15.5, 12, pal.muted, 400, SANS, 'right');
                icon('chevronLeft', x + wide - 42 - tw, y + 9, 12, pal.faint);
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, y + 30.5);
            ctx.lineTo(x + wide, y + 30.5);
            ctx.stroke();
            ctx.setLineDash([]);
        };
        const button = (text, right, y, variant, press = 0, glyph = null) => {
            setFont(13, 500);
            const wide = measure(text) + (glyph ? 42 : 20);
            const x = right - wide;
            ctx.save();
            ctx.translate(x + wide / 2, y + 14);
            ctx.scale(1 - press * 0.05, 1 - press * 0.05);
            if (variant === 'inverse') {
                fillRound(-wide / 2, -14, wide, 28, 6, pal.text);
            }
            const color = variant === 'inverse' ? pal.bg : pal.muted;
            if (glyph) {
                icon(glyph, -wide / 2 + 10, -8, 16, color);
            }
            label(text, -wide / 2 + (glyph ? 32 : 10), 0.5, 13, color, 500);
            ctx.restore();
            return wide;
        };
        const approvalBody = (card, x, y, wide, press) => {
            const top = y + 42;
            icon('hand', x + 12, top + 3, 16, pal.needs);
            label('Run command', x + 36, top + 10, 14, pal.text, 600);
            label('1 request waiting', x + 36, top + 29, 12, pal.muted);
            const boxY = top + 50;
            fillRound(x + 12, boxY, wide - 24, 56, 12, pal.sunken);
            label(card.cwd, x + 24, boxY + 18, 12, pal.muted, 400, MONO);
            label(card.command, x + 24, boxY + 37, 13, pal.text, 400, MONO);
            const by = boxY + 68;
            let right = x + wide - 12;
            right -= button('Allow', right, by, 'inverse', press, 'circleCheck') + 6;
            right -= button('Deny', right, by, 'ghost') + 6;
            button('Always allow', right, by, 'ghost');
        };
        const questionBody = (card, x, y, wide, time) => {
            const top = y + 42;
            icon('question', x + 12, top + 1, 16, pal.needs);
            label(card.question, x + 36, top + 9, 14, pal.text, 600);
            const picked = time >= card.pick;
            for (let i = 0; i < 3; i++) {
                const ry = top + 26 + i * 33;
                const chosen = picked && i === 0;
                fillRound(x + 12, ry, wide - 24, 28, 8, chosen ? R.mix(pal.surface, pal.accent, 0.16) : pal.hover);
                strokeRound(x + 12.5, ry + 0.5, wide - 25, 27, 7.5, chosen ? pal.accent : 'rgba(255,255,255,0.07)', 1);
                icon(chosen ? 'circleCheck' : 'circle', x + 22, ry + 7, 14, chosen ? pal.text : pal.muted);
                label(card.choices[i], x + 44, ry + 14.5, 13, i === 2 ? pal.muted : pal.text);
            }
            const press = Math.sin(Math.PI * R.phase(time, card.answer - 0.08, 0.2));
            button('Answer', x + wide - 12, top + 26 + 3 * 33 + 5, 'inverse', press, null);
        };

        const drawCard = (card, time, fan, count, index) => {
            const amount = cardPose(card, time, fan);
            if (amount.alpha <= 0.005) {
                return;
            }
            const waiting = time < card.answer + 0.12 || card.arrive.some((at) => at > card.answer && time >= at);
            const status = waiting ? 'needs' : 'running';
            ctx.save();
            ctx.globalAlpha = amount.alpha;
            ctx.translate(280 + amount.x, amount.y);
            ctx.rotate(amount.rotate);
            ctx.scale(amount.scale, amount.scale);
            ctx.translate(-CARD_W / 2, 0);
            fillRound(-2, 4, CARD_W + 4, CARD_H + 4, 17, 'rgba(0,0,0,0.22)');
            fillRound(0, 2, CARD_W, CARD_H, 15, 'rgba(0,0,0,0.3)');
            fillRound(0, 0, CARD_W, CARD_H, 15, pal.raised);
            ctx.save();
            R.roundRect(ctx, 0, 0, CARD_W, CARD_H, 15);
            ctx.clip();
            sourceRow(card, 0, 0, CARD_W, count, Math.round(index), status, time);
            if (card.kind === 'approval') {
                approvalBody(card, 0, 0, CARD_W, Math.sin(Math.PI * R.phase(time, card.answer - 0.1, 0.22)));
            } else {
                questionBody(card, 0, 0, CARD_W, time);
            }
            if (amount.dim > 0.001) {
                ctx.fillStyle = `rgba(12,12,15,${R.clamp(amount.dim)})`;
                ctx.fillRect(0, 0, CARD_W, CARD_H);
            }
            ctx.restore();
            strokeRound(0.5, 0.5, CARD_W - 1, CARD_H - 1, 14.5, `rgba(255,255,255,${0.08 + 0.05 * (1 - R.clamp(amount.dim * 3))})`, 1);
            ctx.restore();
        };

        const drawSource = (src, index, time) => {
            const card = CARDS.find((slot) => slot.source === index);
            // Amber from the moment its card leaves until the answer is home again.
            const waiting = waitingAt(card, time) || (time >= card.answer && time < card.answer + FLICK + FLICK_DUR * 0.85);
            const status = waiting ? 'needs' : 'running';
            // A card leaving the agent tugs it, and one coming home nudges it: follow through on the far end.
            let nudge = 0;
            for (const at of card.arrive) {
                nudge += Math.sin(Math.PI * R.phase(time, at - 0.05, 0.3)) * -3;
            }
            nudge += Math.sin(Math.PI * R.phase(time, card.answer + FLICK + FLICK_DUR * 0.85, 0.35)) * 3;
            ctx.save();
            ctx.translate(src.cx - (SRC_W * SRC_SCALE) / 2, SRC_Y + nudge);
            ctx.scale(SRC_SCALE, SRC_SCALE);
            nodeFrame(0, 0, SRC_W, SRC_H, { kind: 'chat', hair: 1 / SRC_SCALE });
            nodeHeader(0, 0, SRC_W, { agent: src.agent, title: src.title, status, buttons: false }, time + index);
            if (waiting) {
                icon('question', 14, HEADER + 20, 14, pal.needs);
                label('Waiting for you', 36, HEADER + 27.5, 14, pal.muted);
            } else {
                statusDot(18, HEADER + 27, 'running', time + index);
                shine('Working', 32, HEADER + 27.5, 14, time + index * 0.5);
            }
            ctx.restore();
        };

        return {
            draw(now) {
                env.clear();
                const time = R.mod(now, LOOP);
                const pointer = env.pointer;
                dotGrid(24, 16 - pointer.nx * pointer.active * 4, 12 - pointer.ny * pointer.active * 4, 0.9);
                for (let i = 0; i < SOURCES.length; i++) {
                    drawSource(SOURCES[i], i, time);
                }

                const choreo = R.ease.inOutCubic(R.phase(time, FAN_OPEN, 0.5)) * (1 - R.ease.inOutCubic(R.phase(time, FAN_CLOSE, 0.45)));
                const over = pointer.x > CARD_X - 20 && pointer.x < CARD_X + CARD_W + 20 && pointer.y > 110 && pointer.y < FRONT_TOP + CARD_H + 20 ? 1 : 0;
                const fan = Math.max(choreo, pointer.active * over * (countAt(time) > 1 ? 1 : 0.35));
                const count = countAt(time);

                // Back to front, and a card in flight above them all.
                const order = CARDS.slice().sort((first, second) => indexAt(second, time) - indexAt(first, time));
                for (const card of order) {
                    drawCard(card, time, fan, count, indexAt(card, time));
                }

                /* The person's pointer: in once the stack has fanned, from card to card, then away. */
                const path = [
                    [4.1, 452, 470],
                    [4.75, 0, 0, 'allow0'],
                    [6.5, 0, 0, 'pick1'],
                    [7.3, 0, 0, 'answer1'],
                    [8.85, 0, 0, 'allow2'],
                    [9.9, 520, 470]
                ];
                const spot = (key) => {
                    if (key === 'allow0' || key === 'allow2') {
                        return [CARD_X + CARD_W - 50, FRONT_TOP + 42 + 50 + 68 + 14];
                    }
                    if (key === 'pick1') {
                        return [CARD_X + 120, FRONT_TOP + 42 + 26 + 14];
                    }
                    return [CARD_X + CARD_W - 44, FRONT_TOP + 42 + 26 + 99 + 19];
                };
                let cx = 0;
                let cy = 0;
                let alpha = 0;
                for (let k = 0; k < path.length - 1; k++) {
                    const [a0, ax0, ay0, key0] = path[k];
                    const [a1, ax1, ay1, key1] = path[k + 1];
                    const [fx, fy] = key0 ? spot(key0) : [ax0, ay0];
                    const [tx, ty] = key1 ? spot(key1) : [ax1, ay1];
                    const travel = k === 0 ? 0.65 : 0.42;
                    if (time >= a0 && time < a1 + (k === path.length - 2 ? 1 : 0)) {
                        const amount = R.ease.inOutCubic(R.phase(time, a1 - travel, travel));
                        cx = R.lerp(fx, tx, amount) + Math.sin(Math.PI * amount) * 18;
                        cy = R.lerp(fy, ty, amount) - Math.sin(Math.PI * amount) * 22;
                        alpha = R.smoothstep(4.1, 4.4, time) * (1 - R.smoothstep(9.9, 10.3, time));
                    }
                }
                const presses = [CARDS[0].answer - 0.1, CARDS[1].pick - 0.08, CARDS[1].answer - 0.08, CARDS[2].answer - 0.1];
                let press = 0;
                for (const at of presses) {
                    press = Math.max(press, Math.sin(Math.PI * R.phase(time, at, 0.22)));
                    const ripple = R.phase(time, at + 0.05, 0.45);
                    if (ripple > 0 && ripple < 1 && alpha > 0.1) {
                        ctx.globalAlpha = (1 - ripple) * 0.45;
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath();
                        ctx.arc(cx, cy, 4 + ripple * 14, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }
                }
                cursor(cx, cy, 1 - press * 0.12, alpha);
                softEdges(56, 44);
            }
        };
    }
});
