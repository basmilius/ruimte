Reel.add({
    id: 'grid-views',
    title: 'Three by Three',
    line: 'Open up to nine views at once. Every one keeps running.',
    principles: ['Follow through and overlapping action', 'Timing'],
    tech: 'Canvas 2D, tiling layout springs',
    hint: 'Move over a view to focus it',
    poster: 8.4,
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

        const LOOP = 15;
        const spring = (elapsed, omega, zeta) => {
            if (elapsed <= 0) {
                return 0;
            }
            const damped = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * elapsed) * (Math.cos(damped * elapsed) + ((zeta * omega) / damped) * Math.sin(damped * elapsed));
        };

        /* The window. */
        const WX = 40;
        const WY = 58;
        const WW = 480;
        const WH = 384;
        const SIDE = 134;
        const BAR = 30;
        const GX = WX + SIDE + 1;
        const GY = WY + BAR + 1;
        const GW = WX + WW - GX;
        const GH = WY + WH - GY;
        const ROW_H = 24;
        const ROWS_Y = WY + 40;

        const VIEWS = [
            { kind: 'chat', agent: 'claude', name: 'Fix signup' },
            { kind: 'terminal', name: 'dev server' },
            { kind: 'browser', name: 'Docs', url: 'docs.acme.dev/forms' },
            { kind: 'drawing', name: 'Architecture' },
            { kind: 'chat', agent: 'claude', name: 'Speed up checkout' },
            { kind: 'tests', name: 'test suite' },
            { kind: 'canvas', name: 'acme-web' },
            { kind: 'browser', name: 'Sign up', url: 'localhost:5173/signup' },
            { kind: 'chat', agent: 'codex', name: 'Refund emails' }
        ];
        // The tempo quickens as the grid fills: one view, then one more, then two, then five in a quick run.
        const STEPS = [
            { at: 0, tally: 1, gap: 0 },
            { at: 1.5, tally: 2, gap: 0 },
            { at: 3.5, tally: 4, gap: 0.16 },
            { at: 5.9, tally: 9, gap: 0.1 },
            { at: 10.5, tally: 1, gap: 0.045 }
        ];

        const rowRect = (i) => ({ x: WX + 8, y: ROWS_Y + i * ROW_H, wide: SIDE - 16, tall: ROW_H - 2 });
        const gridRect = (tally, i) => {
            const cols = tally === 1 ? 1 : tally <= 4 ? 2 : 3;
            const rows = tally <= 2 ? 1 : tally <= 4 ? 2 : 3;
            const cw = (GW - (cols - 1)) / cols;
            const ch = (GH - (rows - 1)) / rows;
            const col = i % cols;
            const row = Math.floor(i / cols);
            return { x: GX + col * (cw + 1), y: GY + row * (ch + 1), wide: cw, tall: ch };
        };
        const targetOf = (step, i) => (i < step.tally ? gridRect(step.tally, i) : rowRect(i));

        /* Where a cell is at time t: every layout change adds its own spring, a few frames after its neighbor's. */
        const cell = { x: 0, y: 0, wide: 0, tall: 0, alpha: 0, lagX: 0, lagY: 0, flying: false, opened: -1 };
        const cellAt = (i, time) => {
            const first = targetOf(STEPS[0], i);
            let x = first.x;
            let y = first.y;
            let wide = first.wide;
            let tall = first.tall;
            let softX = x;
            let softY = y;
            let alpha = i < STEPS[0].tally ? 1 : 0;
            let arc = 0;
            let opened = i < STEPS[0].tally ? 0 : -1;
            let flying = false;
            for (let k = 1; k < STEPS.length; k++) {
                const before = STEPS[k - 1];
                const step = STEPS[k];
                const from = targetOf(before, i);
                const to = targetOf(step, i);
                const opening = i >= before.tally && i < step.tally;
                const closing = i < before.tally && i >= step.tally;
                let delay = i * 0.035;
                if (opening) {
                    delay = 0.08 + (i - before.tally) * step.gap;
                } else if (closing) {
                    delay = (before.tally - 1 - i) * step.gap;
                }
                const elapsed = time - step.at - delay;
                const flight = opening || closing;
                const eased = flight ? spring(elapsed, 11, 0.78) : spring(elapsed, 15, 0.68);
                const soft = flight ? spring(elapsed - 0.03, 8.5, 0.8) : spring(elapsed - 0.03, 10.5, 0.72);
                x += (to.x - from.x) * eased;
                y += (to.y - from.y) * eased;
                wide += (to.wide - from.wide) * eased;
                tall += (to.tall - from.tall) * eased;
                softX += (to.x - from.x) * soft;
                softY += (to.y - from.y) * soft;
                if (flight && elapsed > 0) {
                    const amount = R.clamp(eased);
                    flying = flying || elapsed < 0.62;
                    arc += Math.sin(Math.PI * amount) * (opening ? -34 : -22);
                    if (opening) {
                        alpha = R.smoothstep(0, 0.22, amount);
                        opened = k;
                    } else {
                        alpha = 1 - R.smoothstep(0.72, 0.98, amount);
                    }
                }
            }
            cell.x = x;
            cell.y = y + arc;
            cell.wide = Math.max(0, wide);
            cell.tall = Math.max(0, tall);
            cell.alpha = alpha;
            // The content inside lags its frame by a touch, and catches up after the frame has landed.
            cell.lagX = R.clamp((softX - x) * 0.4, -14, 14);
            cell.lagY = R.clamp((softY - y) * 0.4, -14, 14);
            cell.opened = opened;
            cell.flying = flying;
            return cell;
        };
        const countAt = (time) => {
            let tally = 1;
            for (const step of STEPS) {
                if (time >= step.at) {
                    tally = step.tally;
                }
            }
            return tally;
        };
        const toolbarAt = (time) => R.smoothstep(0, 0.3, time - STEPS[1].at) * (1 - R.smoothstep(0.2, 0.55, time - STEPS[4].at));

        /* Views, each alive in its own way. Drawn in content space: 0, 0 is the top left of the body. */
        const THREADS = {
            'Fix signup': {
                ask: 'Fix the bug in the note and check it in the browser.',
                tools: [['eye', 'Read', 'SignupForm.tsx'], ['edit', 'Edit', 'SignupForm.tsx']],
                reply: 'The form resets before the request resolves, so a failed submit clears the email. Keeping the values until the server answers.'
            },
            'Speed up checkout': {
                ask: 'Checkout takes 4 seconds. Find out why.',
                tools: [['terminal', 'Ran', 'bun run trace'], ['eye', 'Read', 'cart/load.ts']],
                reply: 'The same cart loads 12 times per request. Batching the loads and the shipping call.'
            },
            'Refund emails': {
                ask: 'Send a receipt when a refund lands.',
                tools: [['eye', 'Read', 'mail/receipt.tsx'], ['edit', 'Edit', 'mail/refund.tsx']],
                reply: 'Added a refund template and a hook on the payment event. Writing the test now.'
            }
        };
        const wrapCache = new Map();
        const wrapWords = (text, width) => {
            const key = text + '|' + Math.round(width) + '|' + ctx.font;
            let lines = wrapCache.get(key);
            if (lines) {
                return lines;
            }
            lines = [];
            let line = '';
            for (const word of text.split(' ')) {
                const next = line ? line + ' ' + word : word;
                if (line && measure(next) > width) {
                    lines.push(line);
                    line = word;
                } else {
                    line = next;
                }
            }
            lines.push(line);
            if (!document.fonts || document.fonts.status === 'loaded') {
                wrapCache.set(key, lines);
            }
            return lines;
        };
        const chatView = (view, wide, tall, time, seed) => {
            const thread = THREADS[view.name];
            const colW = Math.min(wide - 20, 230);
            const left = (wide - colW) / 2;
            const cycle = R.mod(time + seed * 2.3, 7.5);
            let y = 10;
            setFont(10);
            const bubbleLines = wrapWords(thread.ask, colW * 0.72);
            let bw = 0;
            for (const line of bubbleLines) {
                bw = Math.max(bw, measure(line));
            }
            fillRound(left + colW - bw - 16, y, bw + 16, bubbleLines.length * 14 + 10, 10, pal.active);
            for (let k = 0; k < bubbleLines.length; k++) {
                label(bubbleLines[k], left + colW - bw - 8, y + 12 + k * 14, 10, pal.text);
            }
            y += bubbleLines.length * 14 + 20;
            for (let k = 0; k < thread.tools.length; k++) {
                const [glyph, word, detail] = thread.tools[k];
                const live = k === 1 && cycle < 1.4;
                icon(glyph, left, y - 5, 10, live ? pal.accent : pal.muted);
                setFont(10);
                const ww = live ? shine(word, left + 15, y, 10, time) : measure(word);
                if (!live) {
                    label(word, left + 15, y, 10, pal.muted);
                }
                label(detail, left + 20 + ww, y + 0.5, 9, pal.faint, 400, MONO);
                y += 17;
            }
            y += 6;
            // The reply streams word by word, then the thread rests and streams again.
            setFont(10);
            const lines = wrapWords(thread.reply, colW);
            const words = R.clamp((cycle - 1.4) / 3.2) * thread.reply.split(' ').length;
            const fade = 1 - R.smoothstep(6.9, 7.5, cycle);
            let shown = 0;
            ctx.globalAlpha *= fade;
            for (let k = 0; k < lines.length; k++) {
                const parts = lines[k].split(' ');
                let lx = left;
                for (const part of parts) {
                    const lhs = R.clamp(words - shown);
                    if (lhs > 0) {
                        ctx.globalAlpha *= lhs;
                        label(part, lx, y + (1 - lhs) * 2, 10, pal.text);
                        ctx.globalAlpha /= lhs;
                    }
                    lx += measure(part + ' ');
                    shown++;
                }
                y += 14;
            }
            ctx.globalAlpha /= fade;
            if (cycle < 1.4 || cycle > 4.8) {
                statusDot(left + 3, y + 8, 'running', time);
                const ww = shine('Working for', left + 11, y + 8, 10, time);
                label(`00:${String(8 + Math.floor(cycle)).padStart(2, '0')}`, left + 16 + ww, y + 8, 10, pal.faint);
            }
            // The composer at the foot of the column.
            const cy = tall - 36;
            if (cy > y + 14) {
                fillRound(left - 4, cy, colW + 8, 28, 10, pal.raised);
                strokeRound(left - 3.5, cy + 0.5, colW + 7, 27, 9.5, 'rgba(255,255,255,0.07)', 1);
                label('Ask anything', left + 6, cy + 14, 10, pal.faint);
                fillRound(left + colW - 18, cy + 5, 18, 18, 9, pal.accent);
                icon('arrowUp', left + colW - 14, cy + 9, 10, '#ffffff');
            }
        };
        const LOG = [
            ['GET', '/api/signup', '201', '38ms'],
            ['GET', '/signup', '200', '4ms'],
            ['POST', '/api/signup', '422', '12ms'],
            ['POST', '/api/signup', '201', '41ms'],
            ['GET', '/api/session', '200', '3ms'],
            ['GET', '/dashboard', '200', '6ms']
        ];
        const TESTS = ['cart/total', 'cart/discount', 'checkout/address', 'checkout/payment', 'orders/list', 'orders/refund', 'auth/session', 'auth/reset', 'search/index', 'search/rank'];
        const terminalView = (view, wide, tall, time) => {
            fillRoundless(0, 0, wide, tall, pal.termBg);
            const rows = Math.ceil(tall / 13) + 1;
            const period = view.kind === 'tests' ? 0.3 : 0.5;
            const step = time / period;
            const count = Math.floor(step);
            const scroll = R.ease.outCubic(R.clamp((step - count) * 4)) * 13;
            setFont(9, 400, MONO);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let k = 0; k < rows; k++) {
                const line = count - rows + k + 1;
                const ly = tall - 10 - (rows - 1 - k) * 13 + 13 - scroll - 13;
                if (ly < -8) {
                    continue;
                }
                if (view.kind === 'tests') {
                    ctx.fillStyle = pal.green;
                    ctx.fillText('pass', 7, ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(`src/${TESTS[R.mod(line, TESTS.length)]}.test.ts`, 34, ly);
                } else {
                    const entry = LOG[R.mod(line, LOG.length)];
                    const seconds = String(R.mod(line, 60)).padStart(2, '0');
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText(`12:04:${seconds}`, 7, ly);
                    ctx.fillStyle = pal.blue;
                    ctx.fillText(entry[0], 58, ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(entry[1], 88, ly);
                    ctx.fillStyle = entry[2][0] === '4' ? pal.yellow : pal.green;
                    ctx.fillText(entry[2], 164, ly);
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText(entry[3], 188, ly);
                }
            }
        };
        const fillRoundless = (x, y, wide, tall, color) => {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, wide, tall);
        };
        const browserView = (view, wide, tall, time, seed) => {
            fillRoundless(0, 0, wide, 24, pal.raised);
            fillRoundless(0, 24, wide, 1, 'rgba(255,255,255,0.07)');
            fillRound(8, 4, wide - 16, 16, 5, pal.sunken);
            icon('lock', 13, 7.5, 9, pal.muted);
            label(view.url, 26, 12.5, 9.5, pal.text);
            // Loads again every few seconds: the sweep, then the blocks of the page one after another.
            const cycle = R.mod(time + seed * 1.7, 6);
            const loading = cycle < 1.1;
            if (loading) {
                fillRoundless(0, 23, wide, 2, 'rgba(21,93,252,0.16)');
                const sweep = R.ease.inOutSine(R.fract(cycle / 1.1));
                fillRoundless(-wide / 3 + sweep * (wide * 4 / 3), 23, wide / 3, 2, pal.accent);
            }
            fillRoundless(0, 25, wide, tall - 25, '#111114');
            const built = (at) => R.ease.outCubic(R.phase(cycle, at, 0.35));
            const blocks = [
                [0.5, 14, 38, 0.42, 9, pal.text],
                [0.65, 14, 56, 0.8, 5, pal.faint],
                [0.72, 14, 66, 0.62, 5, pal.faint],
                [0.9, 14, 84, -1, 40, pal.hover],
                [1.05, 14, 136, 0.5, 5, pal.faint],
                [1.12, 14, 146, 0.7, 5, pal.faint]
            ];
            for (const [at, x, y, frac, bh, color] of blocks) {
                const lhs = built(at);
                if (lhs <= 0 || y > tall) {
                    continue;
                }
                ctx.globalAlpha *= lhs;
                const bw = frac < 0 ? wide - 28 : (wide - 28) * frac;
                fillRound(x, y + (1 - lhs) * 4, bw, bh, frac < 0 ? 6 : 2.5, color);
                ctx.globalAlpha /= lhs;
            }
        };
        const SKETCH = [
            { at: 0.2, svg: 'M 14 36 C 30 34, 50 35, 66 35 C 67 48, 66 58, 66 70 C 50 71, 30 70, 13 71 C 12 58, 14 46, 14 36' },
            { at: 0.9, svg: 'M 104 34 C 120 33, 140 35, 156 34 C 157 48, 156 58, 157 71 C 140 72, 120 70, 103 72 C 103 58, 104 46, 104 34' },
            { at: 1.5, svg: 'M 70 53 C 80 52, 90 54, 99 53 M 93 48 L 100 53 L 93 58' },
            { at: 2.0, svg: 'M 190 40 C 190 33, 222 32, 223 40 C 224 47, 190 48, 190 40 M 190 40 C 189 55, 190 64, 191 72 C 196 79, 220 79, 223 72 C 224 62, 223 50, 223 40' },
            { at: 2.6, svg: 'M 160 53 C 168 52, 176 54, 185 53 M 179 48 L 186 53 L 179 58' }
        ];
        const sketchPaths = SKETCH.map((stroke) => new Path2D(stroke.svg));
        const drawingView = (view, wide, tall, time) => {
            dotLocal(wide, tall);
            const cycle = R.mod(time, 5);
            const fade = 1 - R.smoothstep(4.4, 5, cycle);
            ctx.save();
            ctx.translate(Math.max(4, (wide - 240) / 2), Math.max(0, (tall - 110) / 2));
            ctx.globalAlpha *= fade;
            ctx.lineWidth = 1.6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = pal.text;
            for (let k = 0; k < SKETCH.length; k++) {
                const amount = R.ease.inOutSine(R.phase(cycle, SKETCH[k].at, 0.55));
                if (amount <= 0) {
                    continue;
                }
                // A stroke draws itself: a dash that grows along the path.
                ctx.setLineDash([amount * 260, 400]);
                ctx.stroke(sketchPaths[k]);
            }
            ctx.setLineDash([]);
            const words = [[0.6, 'web', 26, 54], [1.3, 'api', 118, 54], [2.4, 'db', 200, 58], [0.1, 'signup flow', 14, 16]];
            for (const [at, word, x, y] of words) {
                const lhs = R.phase(cycle, at, 0.3);
                ctx.globalAlpha *= lhs;
                label(word, x, y, word.length > 3 ? 13 : 12, pal.text, 400, R.fonts.hand);
                ctx.globalAlpha /= Math.max(lhs, 0.001);
            }
            ctx.restore();
        };
        const dotLocal = (wide, tall) => {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            for (let y = 8; y < tall; y += 14) {
                for (let x = 8; x < wide; x += 14) {
                    ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
                }
            }
        };
        const MINI = [
            [16, 18, 60, 44, 'running'],
            [96, 12, 60, 34, 'running'],
            [96, 58, 60, 40, 'needs'],
            [176, 22, 56, 50, 'idle']
        ];
        const canvasView = (view, wide, tall, time) => {
            dotLocal(wide, tall);
            ctx.save();
            ctx.translate(Math.max(0, (wide - 248) / 2), Math.max(0, (tall - 110) / 2));
            ctx.strokeStyle = EDGE_CONTEXT;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(76, 40);
            ctx.lineTo(96, 29);
            ctx.moveTo(76, 40);
            ctx.lineTo(96, 78);
            ctx.moveTo(156, 29);
            ctx.lineTo(176, 47);
            ctx.stroke();
            for (const [x, y, w2, h2, status] of MINI) {
                fillRound(x, y, w2, h2, 4, pal.surface);
                ctx.save();
                R.roundRect(ctx, x, y, w2, h2, 4);
                ctx.clip();
                fillRoundless(x, y, w2, 9, pal.raised);
                ctx.restore();
                strokeRound(x + 0.5, y + 0.5, w2 - 1, h2 - 1, 4, 'rgba(255,255,255,0.08)', 1);
                statusDot(x + w2 - 6, y + 4.5, status, time, 2);
                fillRoundless(x + 5, y + 14, w2 * 0.6, 2, pal.faint);
                fillRoundless(x + 5, y + 20, w2 * 0.4, 2, pal.faint);
            }
            ctx.restore();
        };
        const drawView = (view, wide, tall, time, seed) => {
            if (view.kind === 'chat') {
                chatView(view, wide, tall, time, seed);
            } else if (view.kind === 'terminal' || view.kind === 'tests') {
                terminalView(view, wide, tall, time);
            } else if (view.kind === 'browser') {
                browserView(view, wide, tall, time, seed);
            } else if (view.kind === 'drawing') {
                drawingView(view, wide, tall, time);
            } else {
                canvasView(view, wide, tall, time);
            }
        };
        const glyphOf = (view, x, y, size, color) => {
            if (view.agent) {
                mark(view.agent, x, y, size, color);
            } else {
                icon(view.kind === 'tests' ? 'terminal' : view.kind, x, y, size, color);
            }
        };

        const order = [];
        return {
            draw(now) {
                env.clear();
                const time = R.mod(now, LOOP);
                const pointer = env.pointer;
                const tally = countAt(time);
                const toolbar = toolbarAt(time);

                /* The window, its sidebar and toolbar. */
                fillRound(WX, WY + 6, WW, WH, 12, 'rgba(0,0,0,0.35)');
                fillRound(WX, WY, WW, WH, 12, pal.bg);
                ctx.save();
                R.roundRect(ctx, WX, WY, WW, WH, 12);
                ctx.clip();
                fillRoundless(WX, WY, SIDE, WH, pal.surface);
                fillRoundless(WX + SIDE, WY, 1, WH, 'rgba(255,255,255,0.07)');
                fillRoundless(GX, WY, GW, BAR, pal.surface);
                fillRoundless(GX, WY + BAR, GW, 1, 'rgba(255,255,255,0.07)');
                const lights = ['#ff5f57', '#febc2e', '#28c840'];
                for (let k = 0; k < 3; k++) {
                    ctx.fillStyle = lights[k];
                    ctx.beginPath();
                    ctx.arc(WX + 16 + k * 13, WY + 16, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                }
                label('Ruimte', WX + 64, WY + 16.5, 11, pal.faint, 600, R.fonts.display);
                icon('browser', GX + 10, WY + 9, 12, pal.muted);
                fillRound(GX + 30, WY + 8, 14, 14, 3, 'rgba(245,73,0,0.2)');
                label('A', GX + 37, WY + 15.5, 9.5, '#f54900', 600, SANS, 'center');
                label('acme-web', GX + 50, WY + 15.5, 11.5, pal.text, 500);
                icon('chevronDown', GX + 106, WY + 10, 11, pal.muted);

                /* Which view has the focus: the newest, unless the pointer rests on one. */
                let focused = tally - 1;
                let hovered = -1;
                for (let i = 0; i < tally; i++) {
                    const slot = cellAt(i, time);
                    if (pointer.active > 0.3 && pointer.x > slot.x && pointer.x < slot.x + slot.wide && pointer.y > slot.y && pointer.y < slot.y + slot.tall) {
                        hovered = i;
                    }
                }
                if (hovered >= 0) {
                    focused = hovered;
                }

                /* The rows. */
                for (let i = 0; i < VIEWS.length; i++) {
                    const view = VIEWS[i];
                    const row = rowRect(i);
                    const slot = cellAt(i, time);
                    const open = slot.alpha > 0.5 && (i < tally || time < STEPS[4].at + 1);
                    const selected = i === focused && tally > 1;
                    if (selected || (i === 0 && tally === 1)) {
                        fillRound(row.x, row.y, row.wide, row.tall, 5, pal.active);
                    }
                    const color = open ? pal.text : pal.muted;
                    glyphOf(view, row.x + 7, row.y + row.tall / 2 - 6, 12, pal.muted);
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(row.x, row.y, row.wide - 16, row.tall);
                    ctx.clip();
                    label(view.name, row.x + 26, row.y + row.tall / 2 + 0.5, 11, color, 500);
                    ctx.restore();
                    if (view.agent) {
                        statusDot(row.x + row.wide - 8, row.y + row.tall / 2, 'running', time + i * 0.3, 3);
                    }
                }
                fillRoundless(WX, WY + WH - 34, SIDE, 1, 'rgba(255,255,255,0.07)');
                icon('plus', WX + 14, WY + WH - 23, 12, pal.muted);
                label('View', WX + 32, WY + WH - 16.5, 11, pal.muted);

                /* The grid: 1 px lines of the border color between cells, cells that settle one after another. */
                fillRoundless(GX, GY, GW, GH, 'rgba(255,255,255,0.07)');
                order.length = 0;
                for (let i = 0; i < VIEWS.length; i++) {
                    order.push(i);
                }
                // A cell in flight is drawn over the ones already in place.
                order.sort((lhs, rhs) => {
                    const ca = cellAt(lhs, time);
                    const fa = ca.flying ? 1 : 0;
                    const cb = cellAt(rhs, time);
                    const fb = cb.flying ? 1 : 0;
                    return fa - fb || lhs - rhs;
                });
                for (const i of order) {
                    const slot = cellAt(i, time);
                    if (slot.alpha <= 0.01 || slot.wide < 2 || slot.tall < 2) {
                        continue;
                    }
                    const view = VIEWS[i];
                    const inFlight = slot.flying;
                    ctx.save();
                    ctx.globalAlpha = slot.alpha;
                    if (inFlight) {
                        fillRound(slot.x, slot.y + 4, slot.wide, slot.tall, 8, 'rgba(0,0,0,0.4)');
                    }
                    R.roundRect(ctx, slot.x, slot.y, slot.wide, slot.tall, inFlight ? 8 : 0);
                    ctx.fillStyle = pal.bg;
                    ctx.fill();
                    ctx.clip();
                    const bar = Math.round(24 * (i === 0 ? toolbar : Math.max(toolbar, inFlight ? 1 : 0)));
                    ctx.save();
                    ctx.translate(slot.x + slot.lagX, slot.y + bar + slot.lagY);
                    ctx.beginPath();
                    ctx.rect(-slot.lagX, -slot.lagY, slot.wide, slot.tall - bar);
                    ctx.clip();
                    drawView(view, slot.wide, slot.tall - bar, time, i);
                    ctx.restore();
                    if (bar > 0) {
                        const focus = i === focused;
                        fillRoundless(slot.x, slot.y, slot.wide, bar, focus ? pal.surface : '#0e0e10');
                        fillRoundless(slot.x, slot.y + bar - 1, slot.wide, 1, 'rgba(255,255,255,0.07)');
                        glyphOf(view, slot.x + 8, slot.y + bar / 2 - 5.5, 11, pal.muted);
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(slot.x, slot.y, slot.wide - 32, bar);
                        ctx.clip();
                        label(view.name, slot.x + 24, slot.y + bar / 2 + 0.5, 10.5, focus ? pal.text : pal.muted, 500);
                        ctx.restore();
                        if (view.agent) {
                            statusDot(slot.x + slot.wide - 28, slot.y + bar / 2, 'running', time + i * 0.3, 3);
                        }
                        icon('close', slot.x + slot.wide - 17, slot.y + bar / 2 - 5, 10, pal.faint);
                    }
                    if (inFlight) {
                        strokeRound(slot.x + 0.5, slot.y + 0.5, slot.wide - 1, slot.tall - 1, 8, 'rgba(255,255,255,0.13)', 1);
                    }
                    ctx.restore();
                }
                ctx.restore();
                strokeRound(WX + 0.5, WY + 0.5, WW - 1, WH - 1, 12, 'rgba(255,255,255,0.1)', 1);
                softEdges(52, 46);
            }
        };
    }
});
