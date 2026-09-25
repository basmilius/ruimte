Reel.add({
    id: 'question-card',
    title: 'Your Call',
    line: 'The agent asks. You decide. It carries on with your choice.',
    principles: ['Anticipation', 'Slow in and slow out'],
    tech: 'Canvas 2D, UI micro-interactions',
    hint: 'Move over the choices',
    poster: 5.9,
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

        const LOOP = 12;
        const glide = R.ease.bezier(0.45, 0, 0.2, 1);
        const unfold = R.ease.bezier(0.3, 0, 0, 1);

        /* The node and the card, in the box. */
        const NW = 392;
        const NH = 384;
        const NX = (560 - NW) / 2;
        const NY = 58;
        const PAD = 16;
        const CX = NX + 14;
        const CW = NW - 28;
        const COMPOSER_H = 52;
        const ROW_H = 34;
        const ROW_GAP = 6;
        const CHOICES = ['7 days', '30 days', 'Until checkout'];
        const DETAILS = ['Short and tidy', 'Time to come back', 'Kept while it exists'];
        const CARD_H = 12 + 22 + 8 + 4 * ROW_H + 3 * ROW_GAP + 10 + 28 + 12;

        /* The beats of one loop. */
        const T_STREAM = 0.7;
        const T_ASK = 2.55;
        const T_DIP = 2.55;
        const T_OPEN = 2.72;
        const OPEN_DUR = 0.72;
        const T_FOCUS = 3.75;
        const KEYS = [
            { at: 4.3, key: 'down', to: 1 },
            { at: 4.95, key: 'down', to: 2 },
            { at: 5.65, key: 'up', to: 1 }
        ];
        const T_ENTER = 6.35;
        const T_PICK = 6.62;
        const T_CLOSE = 7.25;
        const CLOSE_DUR = 0.72;
        const T_RESUME = T_CLOSE + CLOSE_DUR;
        const T_EDIT = 8.25;
        const T_EDITED = 9.3;
        const T_REPLY = 9.45;
        const T_FADE = 11.25;

        const ASK = 'The cart now survives sign-in. Saved carts: how long should they last?';
        const REPLY = 'Saved carts now last 30 days. The cleanup job runs nightly.';
        const wordTimes = (text, start, pace, seed) => {
            const words = text.split(' ');
            const times = [];
            let at = start;
            for (let i = 0; i < words.length; i++) {
                times.push(at);
                // Streams come in bursts: most words land close together, a few wait.
                at += pace * (0.55 + R.hash(seed + i * 7.3) * 0.9) + (R.hash(seed + i * 3.1) > 0.82 ? pace * 2.2 : 0);
            }
            return { words, times };
        };
        const ask = wordTimes(ASK, T_STREAM, 0.1, 11);
        const reply = wordTimes(REPLY, T_REPLY, 0.085, 29);

        const layouts = new Map();
        const wrap = (stream, width, size) => {
            setFont(size);
            const key = stream.words.join(' ') + ctx.font;
            let layout = layouts.get(key);
            if (layout) {
                return layout;
            }
            layout = [];
            const space = measure(' ');
            let x = 0;
            let line = 0;
            for (const word of stream.words) {
                const wide = measure(word);
                if (x > 0 && x + wide > width) {
                    x = 0;
                    line++;
                }
                layout.push({ x, line });
                x += wide + space;
            }
            layout.lines = line + 1;
            if (!document.fonts || document.fonts.status === 'loaded') {
                layouts.set(key, layout);
            }
            return layout;
        };
        const drawStream = (stream, x, y, width, now, alpha) => {
            const layout = wrap(stream, width, 14);
            setFont(14);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < stream.words.length; i++) {
                const amount = R.ease.outCubic(R.phase(now, stream.times[i], 0.22));
                if (amount <= 0) {
                    continue;
                }
                ctx.globalAlpha = alpha * amount;
                ctx.fillStyle = pal.text;
                ctx.fillText(stream.words[i], x + layout[i].x, y + layout[i].line * 21 + 10.5 + (1 - amount) * 4);
            }
            ctx.globalAlpha = alpha;
        };
        const streamHeight = (stream, width) => wrap(stream, width, 14).lines * 21;

        /* Which choice has the focus ring, as a float that glides between rows. */
        const focusAt = (now) => {
            let at = 0;
            for (const press of KEYS) {
                const amount = glide(R.phase(now, press.at + 0.06, 0.34));
                at = R.lerp(at, press.to, amount);
            }
            return at;
        };
        const keyPress = (now, at) => {
            const down = R.phase(now, at, 0.07);
            const up = R.phase(now, at + 0.14, 0.12);
            return R.ease.outQuad(down) * (1 - R.ease.inOutQuad(up));
        };
        const openness = (now) => unfold(R.phase(now, T_OPEN, OPEN_DUR)) * (1 - glide(R.phase(now, T_CLOSE, CLOSE_DUR)));

        const bubble = (text, right, y, alpha, grow = 1) => {
            setFont(14);
            const wide = measure(text) + 28;
            ctx.globalAlpha = alpha;
            fillRound(right - wide * grow, y, wide * grow, 41, 16, pal.active);
            ctx.globalAlpha = alpha * R.smoothstep(0.6, 1, grow);
            label(text, right - wide + 14, y + 21, 14, pal.text);
            ctx.globalAlpha = 1;
        };
        const toolRow = (tool, word, detail, x, y, now, live, alpha) => {
            ctx.globalAlpha = alpha;
            icon(tool, x, y + 8, 12, live ? pal.accent : pal.muted);
            setFont(13);
            const wide = live ? shine(word, x + 20, y + 14, 13, now) : measure(word);
            if (!live) {
                label(word, x + 20, y + 14, 13, pal.muted);
            }
            label(detail, x + 28 + wide, y + 14.5, 12, pal.faint, 400, MONO);
            icon('chevronRight', x + NW - PAD * 2 - 14, y + 8, 12, pal.faint);
            ctx.globalAlpha = 1;
        };
        const keycap = (glyph, x, y, press, lit) => {
            const sink = press * 1.5;
            fillRound(x, y + 1.5, 20, 19, 5, 'rgba(0,0,0,0.5)');
            fillRound(x, y + sink, 20, 19 - sink * 0.6, 5, R.mix(pal.active, pal.hover, press));
            strokeRound(x + 0.5, y + sink + 0.5, 19, 18 - sink * 0.6, 4.5, `rgba(255,255,255,${0.1 + lit * 0.12})`, 1);
            icon(glyph, x + 4, y + 3.5 + sink * 0.8, 12, R.mix(pal.muted, pal.text, lit));
        };

        // Where the chosen row sat while the card was open, so the flight starts there on any frame.
        const PICKED_Y = NY + NH - 12 - CARD_H + 12 + 30 + ROW_H + ROW_GAP;

        return {
            draw(now) {
                env.clear();
                const time = R.mod(now, LOOP);
                const pointer = env.pointer;
                const px = pointer.nx * pointer.active;
                const py = pointer.ny * pointer.active;
                const ox = px * 5;
                const oy = py * 4;
                const asking = time >= T_ASK && time < T_RESUME;
                const status = asking ? 'needs' : 'running';
                const content = R.smoothstep(0, 0.5, time) * (1 - R.smoothstep(T_FADE, LOOP, time));
                const open = openness(time);
                const dip = Math.sin(Math.PI * R.phase(time, T_DIP, T_OPEN - T_DIP + 0.1)) * (1 - R.phase(time, T_OPEN, 0.3));

                dotGrid(24, 12 + ox * 0.4, 10 + oy * 0.4, 1);
                ctx.save();
                ctx.translate(ox, oy);
                const x = NX;
                const y = NY;
                nodeFrame(x, y, NW, NH, { kind: 'chat' });
                const pop = Math.sin(Math.PI * R.phase(time, T_ASK, 0.35)) + Math.sin(Math.PI * R.phase(time, T_RESUME, 0.35));
                const statusColor = asking ? R.mix(pal.needs, '#ffffff', pop * 0.35) : null;
                nodeHeader(x, y, NW, { agent: 'claude', title: 'Saved carts', status, statusColor }, time);

                /* The composer grows into the question card and folds back into it. */
                const cardH = R.lerp(COMPOSER_H, CARD_H, open) - dip * 3;
                const cardY = y + NH - 12 - cardH;
                const cardX = CX + dip * 2;
                const cardW = CW - dip * 4;

                /* The thread, anchored to the card's top, so the card pushes it up as it opens. */
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y + HEADER, NW, cardY - 6 - y - HEADER);
                ctx.clip();
                const textW = NW - PAD * 2;
                const answered = glide(R.phase(time, T_CLOSE, CLOSE_DUR));
                const editShown = R.ease.outCubic(R.phase(time, T_EDIT, 0.35));
                const replyShown = R.ease.outCubic(R.phase(time, T_REPLY, 0.3));
                const replyH = streamHeight(reply, textW);
                const workingShown = time < T_STREAM
                    ? 1 - R.smoothstep(T_STREAM - 0.3, T_STREAM, time)
                    : R.smoothstep(T_RESUME, T_RESUME + 0.3, time) * (1 - R.smoothstep(T_REPLY - 0.3, T_REPLY, time));
                let bottom = cardY - 18;
                const workingY = bottom - 19 * workingShown;
                if (workingShown > 0.01) {
                    ctx.globalAlpha = content * workingShown;
                    statusDot(x + PAD + 4, workingY + 9.5, 'running', time);
                    const wide = shine('Working for', x + PAD + 16, workingY + 9.5, 13, time);
                    const seconds = time < T_STREAM ? 4 : 12 + Math.floor(time - T_RESUME);
                    label(`00:${String(seconds).padStart(2, '0')}`, x + PAD + 22 + wide, workingY + 9.5, 13, pal.faint);
                    ctx.globalAlpha = 1;
                }
                bottom = workingY - 12 * workingShown;
                if (replyShown > 0) {
                    bottom -= replyH * replyShown;
                    drawStream(reply, x + PAD, bottom, textW, time, content);
                    bottom -= 12 * replyShown;
                }
                if (editShown > 0) {
                    bottom -= 28 * editShown;
                    toolRow('edit', time < T_EDITED ? 'Editing' : 'Edited', 'src/cart/store.ts', x + PAD, bottom, time, time < T_EDITED, content * editShown);
                    bottom -= 12 * editShown;
                }
                const answerSlot = 41 * answered;
                bottom -= answerSlot;
                const answerY = bottom;
                bottom -= 12 * answered;
                const askH = streamHeight(ask, textW);
                bottom -= askH;
                drawStream(ask, x + PAD, bottom, textW, time, content);
                bottom -= 12;
                bottom -= 56;
                toolRow('eye', 'Read', 'src/cart/store.ts', x + PAD, bottom, time, false, content);
                toolRow('edit', 'Edited', 'src/cart/session.ts', x + PAD, bottom + 28, time, false, content);
                bottom -= 12 + 41;
                bubble('Keep the cart when people sign in.', x + NW - PAD, bottom, content);
                bottom -= 12 + 21;
                ctx.globalAlpha = content;
                label('Done. Totals now round per line, as the tests expect.', x + PAD, bottom + 10.5, 14, pal.text);
                ctx.globalAlpha = 1;
                ctx.restore();

                /* The card. */
                fillRound(cardX, cardY + 2, cardW, cardH, 15, 'rgba(0,0,0,0.28)');
                fillRound(cardX, cardY, cardW, cardH, 15, pal.raised);
                strokeRound(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, 14.5, `rgba(255,255,255,${0.07 + 0.04 * open})`, 1);

                ctx.save();
                R.roundRect(ctx, cardX, cardY, cardW, cardH, 15);
                ctx.clip();
                const composerAlpha = (1 - R.smoothstep(0, 0.25, open)) * (time > T_RESUME - 0.2 || time < T_OPEN + 0.2 ? 1 : 0);
                if (composerAlpha > 0.01) {
                    ctx.globalAlpha = composerAlpha;
                    label('Ask anything', cardX + 18, cardY + cardH / 2, 14, pal.faint);
                    fillRound(cardX + cardW - 42, cardY + cardH / 2 - 15, 30, 30, 15, pal.accent);
                    icon('arrowUp', cardX + cardW - 34, cardY + cardH / 2 - 8, 16, '#ffffff');
                    ctx.globalAlpha = 1;
                }
                const inner = time < T_CLOSE ? R.smoothstep(0.35, 0.7, open) : 1 - R.smoothstep(T_CLOSE, T_CLOSE + 0.16, time);
                if (inner > 0.001 || (time >= T_CLOSE && time < T_CLOSE + 0.4)) {
                    // Closing, the rows hold still and the card folds over them, so the pick lifts from where it was.
                    const top = time >= T_CLOSE ? NY + NH - 12 - CARD_H + 12 : cardY + 12;
                    const qa = R.ease.outCubic(R.phase(time, T_OPEN + 0.22, 0.4));
                    ctx.globalAlpha = inner * qa;
                    icon('question', cardX + 12, top + 3, 16, pal.needs);
                    label('How long should saved carts last?', cardX + 36, top + 11 + (1 - qa) * 5, 14, pal.text, 600);
                    const focus = focusAt(time);
                    const focusIn = R.ease.outCubic(R.phase(time, T_FOCUS, 0.25)) * (1 - R.phase(time, T_PICK, 0.2));
                    const picked = R.phase(time, T_PICK, 0.01) >= 1;
                    const rowsTop = top + 30;
                    const rowX = cardX + 12;
                    const rowW = cardW - 24;
                    const hoverY = pointer.y - oy;
                    const hoverX = pointer.x - ox;
                    for (let i = 0; i < 4; i++) {
                        const rp = R.ease.outCubic(R.phase(time, T_OPEN + 0.3 + i * 0.075, 0.42));
                        const ry = rowsTop + i * (ROW_H + ROW_GAP) + (1 - rp) * 8;
                        // The chosen row stays a beat longer than the rest, so its words lift out of something solid.
                        const keep = i === 1 && time >= T_CLOSE ? 1 - R.smoothstep(T_CLOSE + 0.12, T_CLOSE + 0.4, time) : inner;
                        ctx.globalAlpha = keep * rp;
                        const hovered = pointer.active > 0.05 && hoverX > rowX && hoverX < rowX + rowW && hoverY > ry && hoverY < ry + ROW_H;
                        const selected = picked && i === 1;
                        fillRound(rowX, ry, rowW, ROW_H, 8, selected ? R.mix(pal.surface, pal.accent, 0.16) : hovered ? R.mix(pal.hover, pal.active, pointer.active) : pal.hover);
                        strokeRound(rowX + 0.5, ry + 0.5, rowW - 1, ROW_H - 1, 7.5, selected ? pal.accent : 'rgba(255,255,255,0.07)', 1);
                        if (i < 3) {
                            const answering = time >= T_CLOSE && i === 1;
                            icon(selected ? 'circleCheck' : 'circle', rowX + 12, ry + 9, 16, selected ? pal.text : pal.muted);
                            if (!answering) {
                                label(CHOICES[i], rowX + 36, ry + 17.5, 13, pal.text);
                                setFont(13);
                                label(DETAILS[i], rowX + 44 + measure(CHOICES[i]), ry + 17.5, 13, pal.muted);
                            }
                        } else {
                            icon('circle', rowX + 12, ry + 9, 16, pal.muted);
                            label('Something else…', rowX + 36, ry + 17.5, 13, pal.muted);
                        }
                    }
                    /* The focus ring glides between rows with slow in and slow out, and stretches a touch while it travels. */
                    if (focusIn > 0.001) {
                        const fy = rowsTop + focus * (ROW_H + ROW_GAP);
                        const travel = Math.abs(focus - Math.round(focus));
                        const stretch = Math.sin(Math.PI * Math.min(1, travel * 2)) * 5;
                        ctx.globalAlpha = inner * focusIn;
                        strokeRound(rowX - 2, fy - 2 - stretch / 2, rowW + 4, ROW_H + 4 + stretch, 10, pal.accent, 2);
                    }
                    /* The pick: a ring breathes out of the chosen row. */
                    const burst = R.phase(time, T_PICK, 0.55);
                    if (burst > 0 && burst < 1) {
                        const grow = R.ease.outCubic(burst) * 10;
                        ctx.globalAlpha = inner * (1 - burst) * 0.7;
                        strokeRound(rowX - grow, rowsTop + ROW_H + ROW_GAP - grow, rowW + grow * 2, ROW_H + grow * 2, 8 + grow, pal.accent, 1.5);
                    }
                    /* Keys and the answer button. */
                    const footY = rowsTop + 4 * ROW_H + 3 * ROW_GAP + 10;
                    const fa = R.ease.outCubic(R.phase(time, T_OPEN + 0.62, 0.4));
                    ctx.globalAlpha = inner * fa;
                    let upPress = 0;
                    let downPress = 0;
                    for (const press of KEYS) {
                        const amount = keyPress(time, press.at);
                        if (press.key === 'up') {
                            upPress = Math.max(upPress, amount);
                        } else {
                            downPress = Math.max(downPress, amount);
                        }
                    }
                    const enterDown = R.ease.outQuad(R.phase(time, T_ENTER, 0.09)) * (1 - R.ease.inOutQuad(R.phase(time, T_PICK - 0.04, 0.12)));
                    keycap('arrowUp', rowX, footY + 4, upPress, upPress);
                    keycap('arrowDown', rowX + 24, footY + 4, downPress, downPress);
                    label('Move', rowX + 52, footY + 14, 12, pal.faint);
                    keycap('enter', rowX + 90, footY + 4, enterDown, enterDown);
                    label('Answer', rowX + 118, footY + 14, 12, pal.faint);
                    const bw = 84;
                    const bs = 1 - enterDown * 0.04;
                    const bx = cardX + cardW - 12 - bw;
                    ctx.save();
                    ctx.translate(bx + bw / 2, footY + 14);
                    ctx.scale(bs, bs);
                    fillRound(-bw / 2, -14, bw, 28, 6, pal.text);
                    label('Answer', -bw / 2 + 12, 0.5, 13, pal.bg, 500);
                    icon('arrowUp', bw / 2 - 26, -8, 16, pal.bg);
                    ctx.restore();
                    ctx.globalAlpha = 1;
                }
                ctx.restore();

                /* The chosen words travel from their row to the answer bubble in the thread. */
                if (time >= T_CLOSE && time < LOOP) {
                    const amount = glide(R.phase(time, T_CLOSE, CLOSE_DUR + 0.05));
                    setFont(14);
                    const wide = measure('30 days') + 28;
                    const fromX = CX + 12 + 36;
                    const fromY = PICKED_Y + 17.5;
                    const right = x + NW - PAD;
                    const toX = right - wide + 14;
                    const toY = answerY + 21;
                    const tx = R.lerp(fromX, toX, amount);
                    const ty = R.lerp(fromY, toY, amount) - Math.sin(Math.PI * amount) * 14;
                    const clipTop = y + HEADER;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x, clipTop, NW, NH - HEADER);
                    ctx.clip();
                    ctx.globalAlpha = content * R.smoothstep(0.35, 0.9, amount);
                    fillRound(tx - 14, ty - 20.5, wide, 41, 16, pal.active);
                    ctx.globalAlpha = content;
                    label('30 days', tx, ty, R.lerp(13, 14, amount), pal.text);
                    ctx.restore();
                    ctx.globalAlpha = 1;
                }
                ctx.restore();
                softEdges(60, 52);
            }
        };
    }
});
