Reel.add({
    id: 'needs-you',
    title: 'Needs You',
    line: 'Twelve agents at work. You only look at the one that waits for you.',
    principles: ['Staging', 'Anticipation'],
    tech: 'Canvas 2D, attention choreography',
    hint: 'Move to look around the canvas',
    poster: 3.3,
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

        const EPISODE = 6;
        const LOOP = EPISODE * 3;
        const push = R.ease.bezier(0.5, -0.14, 0.2, 1);
        const settle = R.ease.bezier(0.3, 0, 0.1, 1);

        /* The canvas, in the app's own units. */
        const NODES = [
            { x: -425, y: -392, wide: 250, tall: 160, kind: 'chat', agent: 'claude', title: 'Fix signup' },
            { x: -425, y: -200, wide: 250, tall: 150, kind: 'terminal', title: 'dev server' },
            { x: -410, y: -16, wide: 240, tall: 170, kind: 'chat', agent: 'codex', title: 'Sessions' },
            { x: -425, y: 196, wide: 250, tall: 150, kind: 'terminal', title: 'test suite' },
            { x: -125, y: -372, wide: 250, tall: 150, kind: 'terminal', title: 'bun test --watch' },
            { x: -133, y: -180, wide: 266, tall: 170, kind: 'chat', agent: 'claude', title: 'Saved carts' },
            { x: -125, y: 32, wide: 250, tall: 160, kind: 'chat', agent: 'claude', title: 'Speed up checkout' },
            { x: -110, y: 234, wide: 235, tall: 140, kind: 'terminal', title: 'logs' },
            { x: 175, y: -396, wide: 250, tall: 170, kind: 'chat', agent: 'codex', title: 'Flaky test' },
            { x: 175, y: -186, wide: 250, tall: 150, kind: 'terminal', title: 'build' },
            { x: 175, y: 6, wide: 250, tall: 170, kind: 'chat', agent: 'claude', title: 'Search ranking' },
            { x: 190, y: 218, wide: 235, tall: 150, kind: 'chat', agent: 'claude', title: 'Refund emails' }
        ];
        const EDGES = [
            [5, 6],
            [4, 5],
            [9, 10]
        ];
        const ASKS = [
            {
                node: 5,
                who: 'Claude',
                clock: '12:05',
                question: 'How long should we keep a saved cart?',
                choices: ['Keep for 30 days', 'Clear on sign-out', 'Something else…'],
                pick: 0
            },
            {
                node: 8,
                who: 'Codex',
                clock: '12:09',
                question: 'Quarantine the flaky checkout test?',
                choices: ['Quarantine it', 'Retry up to 3 times', 'Something else…'],
                pick: 1
            },
            {
                node: 2,
                who: 'Codex',
                clock: '12:14',
                question: 'Where should sessions live?',
                choices: ['Postgres', 'Redis', 'Something else…'],
                pick: 1
            }
        ];
        const TOOLS = [
            ['Read', 'src/SignupForm.tsx', 'Editing', 'src/SignupForm.tsx'],
            ['Read', 'db/schema.ts', 'Editing', 'auth/session.ts'],
            ['Read', 'src/cart/store.ts', 'Editing', 'src/cart/store.ts'],
            ['Ran', 'bun test checkout', 'Reading', 'checkout.trace'],
            ['Ran', 'bun test e2e', 'Editing', 'e2e/checkout.test.ts'],
            ['Read', 'search/rank.ts', 'Editing', 'search/rank.ts'],
            ['Read', 'mail/receipt.tsx', 'Editing', 'mail/refund.tsx']
        ];
        const LOGS = {
            'dev server': [
                ['12:04:31', 'GET', '/api/cart', '200'],
                ['12:04:32', 'GET', '/signup', '200'],
                ['12:04:34', 'POST', '/api/signup', '422'],
                ['12:04:35', 'POST', '/api/signup', '201'],
                ['12:04:37', 'GET', '/api/session', '200'],
                ['12:04:38', 'GET', '/dashboard', '200']
            ],
            logs: [
                ['12:05:02', 'GET', '/api/search', '200'],
                ['12:05:03', 'GET', '/api/refund', '200'],
                ['12:05:05', 'POST', '/api/refund', '201'],
                ['12:05:06', 'GET', '/api/orders', '200']
            ]
        };
        const TESTS = ['cart/total', 'cart/discount', 'checkout/address', 'checkout/payment', 'orders/list', 'orders/refund', 'auth/session', 'auth/reset'];
        const BUILD = ['transforming', 'rendering chunks', 'computing gzip size', 'dist/index.html', 'dist/assets/index.js', 'built in 1.84s'];

        // Each node's own rhythm: a period that divides the loop, so every stream is where it started at the wrap.
        let chatIndex = 0;
        for (let i = 0; i < NODES.length; i++) {
            const node = NODES[i];
            node.index = i;
            node.period = LOOP / [30, 24, 20, 36][i % 4];
            node.phase = R.hash(i + 3.7) * LOOP;
            node.cx = node.x + node.wide / 2;
            node.cy = node.y + node.tall / 2;
            if (node.kind === 'chat') {
                node.tools = TOOLS[chatIndex++ % TOOLS.length];
            }
        }
        const askOf = (node) => ASKS.findIndex((ask) => ask.node === node.index);

        /* One episode, local time u in 0..6: calm, the amber anticipation, the staging, the pick, the return. */
        const T_AMBER = 0.55;
        const T_STAGE = 1.0;
        const STAGE_DUR = 1.25;
        const T_CARD = 1.95;
        const T_CURSOR = 2.35;
        const T_PRESS = 3.55;
        const T_FOLD = 4.0;
        const T_BACK = 4.3;
        const BACK_DUR = 1.35;

        const CARD_W = 300;
        const CARD_H = 212;
        const cardRect = (node) => ({ x: node.cx - CARD_W / 2, y: node.y + node.tall + 12, wide: CARD_W, tall: CARD_H });

        const OVERVIEW = { x: 0, y: -12, zoom: 0.54 };
        const focusOf = (node) => ({ x: node.cx, y: (node.y + node.y + node.tall + 12 + CARD_H) / 2, zoom: 1.02 });
        const camera = { x: 0, y: 0, zoom: 0.5 };
        const episodeAt = (time) => {
            const index = Math.floor(time / EPISODE);
            return { index, local: time - index * EPISODE, ask: ASKS[index] };
        };
        const cameraAt = (time) => {
            const { local, ask } = episodeAt(time);
            const focus = focusOf(NODES[ask.node]);
            const inward = push(R.phase(local, T_STAGE, STAGE_DUR));
            const outward = settle(R.phase(local, T_BACK, BACK_DUR));
            const amount = inward * (1 - outward);
            camera.x = R.lerp(OVERVIEW.x, focus.x, amount);
            camera.y = R.lerp(OVERVIEW.y, focus.y, amount);
            camera.zoom = Math.exp(R.lerp(Math.log(OVERVIEW.zoom), Math.log(focus.zoom), amount));
            return amount;
        };

        const statusOf = (node, time) => {
            const { local, ask } = episodeAt(time);
            if (ask.node === node.index && local >= T_AMBER && local < T_FOLD + 0.15) {
                return 'needs';
            }
            return 'running';
        };

        /* Bodies. */
        const chatBody = (node, x, y, time, asking, local) => {
            const tools = node.tools;
            const left = x + 14;
            let row = y + HEADER + 14;
            if (asking) {
                icon('eye', left, row + 1, 12, pal.muted);
                label(tools[0], left + 20, row + 7, 13, pal.muted);
                setFont(13);
                label(tools[1], left + 26 + measure(tools[0]), row + 7.5, 11, pal.faint, 400, MONO);
                row += 30;
                const ask = ASKS[askOf(node)];
                label('I need your decision before I go on.', left, row + 7, 13, pal.text);
                row += 30;
                icon('question', left, row + 1, 12, pal.needs);
                label('Waiting for you', left + 20, row + 7, 13, pal.muted);
                return ask;
            }
            icon('eye', left, row + 1, 12, pal.muted);
            label(tools[0], left + 20, row + 7, 13, pal.muted);
            setFont(13);
            label(tools[1], left + 26 + measure(tools[0]), row + 7.5, 11, pal.faint, 400, MONO);
            row += 28;
            icon('edit', left, row + 1, 12, pal.accent);
            const wide = shine(tools[2], left + 20, row + 7, 13, time + node.phase);
            label(tools[3], left + 26 + wide, row + 7.5, 11, pal.faint, 400, MONO);
            row += 32;
            statusDot(left + 4, row + 7, 'running', time + node.phase);
            const ww = shine('Working for', left + 16, row + 7, 13, time + node.phase * 0.7);
            const seconds = Math.floor(R.mod(time - node.phase, LOOP)) + 4;
            label(`00:${String(seconds).padStart(2, '0')}`, left + 22 + ww, row + 7, 13, pal.faint);
            return null;
        };
        const terminalBody = (node, x, y, wide, tall, time) => {
            const top = y + HEADER;
            const rows = Math.floor((tall - HEADER - 10) / 16);
            const step = (time + node.phase) / node.period;
            const count = Math.floor(step);
            const scroll = R.ease.outCubic(R.clamp((step - count) * 5)) * 16;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, top, wide, tall - HEADER - 4);
            ctx.clip();
            setFont(11, 400, MONO);
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            for (let k = 0; k <= rows; k++) {
                const line = count - rows + k;
                const ly = top + 14 + k * 16 + 16 - scroll;
                const lx = x + 10;
                if (node.title === 'dev server' || node.title === 'logs') {
                    const list = LOGS[node.title];
                    const entry = list[R.mod(line, list.length)];
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText(entry[0], lx, ly);
                    ctx.fillStyle = pal.blue;
                    ctx.fillText(entry[1], lx + 60, ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(entry[2], lx + 96, ly);
                    ctx.fillStyle = entry[3][0] === '4' ? pal.yellow : pal.green;
                    ctx.fillText(entry[3], lx + 196, ly);
                } else if (node.title === 'build') {
                    ctx.fillStyle = pal.cyan;
                    ctx.fillText('vite', lx, ly);
                    ctx.fillStyle = R.mod(line, BUILD.length) === BUILD.length - 1 ? pal.green : pal.termFg;
                    ctx.fillText(BUILD[R.mod(line, BUILD.length)], lx + 36, ly);
                } else {
                    ctx.fillStyle = pal.green;
                    ctx.fillText('pass', lx, ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(`src/${TESTS[R.mod(line, TESTS.length)]}.test.ts`, lx + 36, ly);
                }
            }
            ctx.restore();
        };

        const drawCard = (ask, rect, open, local, hair) => {
            const node = NODES[ask.node];
            // It grows out of the node's lower edge: narrow and short first, then the full card.
            const grown = R.ease.outBack(open, 1.3);
            const wide = R.lerp(node.wide * 0.7, rect.wide, R.ease.outCubic(open));
            const tall = Math.max(0, R.lerp(0, rect.tall, grown));
            const x = node.cx - wide / 2;
            const y = R.lerp(node.y + node.tall - 20, rect.y, R.ease.outCubic(open));
            ctx.save();
            ctx.globalAlpha = R.smoothstep(0, 0.25, open);
            fillRound(x, y + 3, wide, tall, 15, 'rgba(0,0,0,0.3)');
            fillRound(x, y, wide, tall, 15, pal.raised);
            strokeRound(x + hair / 2, y + hair / 2, wide - hair, tall - hair, 15, 'rgba(255,255,255,0.1)', hair);
            R.roundRect(ctx, x, y, wide, tall, 15);
            ctx.clip();
            ctx.globalAlpha = R.smoothstep(0.45, 0.9, open);
            const mid = y + 15;
            statusDot(x + 16, mid, 'needs', 0);
            label(node.title, x + 26, mid + 0.5, 12, pal.text, 500);
            setFont(12, 500);
            label(`${ask.who} · chat · ${ask.clock}`, x + 34 + measure(node.title), mid + 0.5, 12, pal.muted);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = hair;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, y + 30);
            ctx.lineTo(x + wide, y + 30);
            ctx.stroke();
            ctx.setLineDash([]);
            const qy = y + 44;
            icon('question', x + 12, qy - 7, 14, pal.needs);
            label(ask.question, x + 32, qy + 0.5, 13, pal.text, 600);
            const picked = local >= T_PRESS + 0.05;
            for (let i = 0; i < 3; i++) {
                const ry = y + 62 + i * 36;
                const rp = R.ease.outCubic(R.phase(local, T_CARD + 0.18 + i * 0.07, 0.35));
                ctx.globalAlpha = R.smoothstep(0.45, 0.9, open) * rp;
                const chosen = picked && i === ask.pick;
                const hover = !picked && i === ask.pick && local > T_PRESS - 0.35;
                fillRound(x + 12, ry + (1 - rp) * 6, wide - 24, 30, 8, chosen ? R.mix(pal.surface, pal.accent, 0.16) : hover ? pal.active : pal.hover);
                strokeRound(x + 12 + hair / 2, ry + (1 - rp) * 6 + hair / 2, wide - 24 - hair, 30 - hair, 8, chosen ? pal.accent : 'rgba(255,255,255,0.07)', hair);
                icon(chosen ? 'circleCheck' : 'circle', x + 22, ry + 8 + (1 - rp) * 6, 14, chosen ? pal.text : pal.muted);
                label(ask.choices[i], x + 44, ry + 15.5 + (1 - rp) * 6, 12, i === 2 ? pal.muted : pal.text);
            }
            ctx.globalAlpha = R.smoothstep(0.45, 0.9, open) * R.phase(local, T_CARD + 0.4, 0.3);
            const pressed = Math.sin(Math.PI * R.phase(local, T_PRESS + 0.15, 0.2));
            ctx.save();
            ctx.translate(x + wide - 50, y + tall - 25);
            ctx.scale(1 - pressed * 0.05, 1 - pressed * 0.05);
            fillRound(-38, -13, 76, 26, 6, pal.text);
            label('Answer', -28, 0.5, 12, pal.bg, 500);
            icon('arrowUp', 16, -7, 14, pal.bg);
            ctx.restore();
            ctx.restore();
            return { x, y, wide, tall };
        };

        const dimOf = (node, focusNode, local, dimIn) => {
            // Coming back, the nearest light up first and the farthest last.
            const distance = Math.hypot(node.cx - focusNode.cx, node.cy - focusNode.cy) / 700;
            const back = settle(R.phase(local, T_BACK + 0.1 + distance * 0.45, 0.7));
            return dimIn * (1 - back);
        };

        return {
            draw(now) {
                env.clear();
                const time = R.mod(now, LOOP);
                const { local, ask } = episodeAt(time);
                const focusNode = NODES[ask.node];
                const staged = cameraAt(time);
                const pointer = env.pointer;
                const panX = -pointer.nx * pointer.active * 14 * (1 - staged);
                const panY = -pointer.ny * pointer.active * 12 * (1 - staged);
                const zoom = camera.zoom;
                const sx = (wx) => (wx - camera.x) * zoom + 280 + panX;
                const sy = (wy) => (wy - camera.y) * zoom + 250 + panY;
                const pitch = 24 * zoom;
                dotGrid(pitch, sx(0), sy(0), R.smoothstep(6, 14, pitch) * (1 - 0.35 * staged), R.clamp(1.4 * zoom + 0.3, 0.9, 1.5));

                // The others dim and settle back while the one that asks is staged; they come back from near to far.
                const dimIn = settle(R.phase(local, T_STAGE - 0.1, 0.8));
                const hair = 1 / zoom;
                const wx = (pointer.x - 280 - panX) / zoom + camera.x;
                const wy = (pointer.y - 250 - panY) / zoom + camera.y;

                ctx.save();
                ctx.translate(280 + panX, 250 + panY);
                ctx.scale(zoom, zoom);
                ctx.translate(-camera.x, -camera.y);

                for (const [first, second] of EDGES) {
                    const dim = Math.max(dimOf(NODES[first], focusNode, local, dimIn), dimOf(NODES[second], focusNode, local, dimIn));
                    ctx.globalAlpha = 1 - dim * 0.75;
                    edge(NODES[first], NODES[second], EDGE_CONTEXT, 2);
                }
                ctx.globalAlpha = 1;

                for (const node of NODES) {
                    const focus = node === focusNode;
                    const dim = focus ? 0 : dimOf(node, focusNode, local, dimIn);
                    const status = statusOf(node, time);
                    const asking = focus && local >= T_AMBER && local < T_FOLD + 0.15;
                    // Anticipation: the node draws in a touch before the amber pulse pushes it out.
                    let scale = 1 - dim * 0.03;
                    if (focus) {
                        const gather = Math.sin(Math.PI * R.phase(local, T_AMBER - 0.25, 0.25));
                        const release = R.phase(local, T_AMBER, 0.6);
                        scale = 1 - gather * 0.025 + Math.sin(Math.PI * release) * Math.exp(-release * 2) * 0.03;
                        const lift = Math.sin(Math.PI * R.phase(local, T_FOLD + 0.1, 0.5));
                        scale += lift * 0.012;
                    }
                    ctx.save();
                    ctx.translate(node.cx, node.cy);
                    ctx.scale(scale, scale);
                    ctx.translate(-node.cx, -node.cy);
                    const hovered = !focus && pointer.active > 0.05 && staged < 0.2 && wx > node.x && wx < node.x + node.wide && wy > node.y && wy < node.y + node.tall;
                    nodeFrame(node.x, node.y, node.wide, node.tall, { kind: node.kind, hair, border: hovered ? `rgba(255,255,255,${0.08 + 0.1 * pointer.active})` : null });
                    const flash = focus ? Math.sin(Math.PI * R.phase(local, T_AMBER, 0.4)) : 0;
                    const color = status === 'needs' ? R.mix(pal.needs, '#ffffff', flash * 0.4) : null;
                    nodeHeader(node.x, node.y, node.wide, { kind: node.kind, agent: node.agent, title: node.title, status, statusColor: color }, time + node.phase);
                    ctx.save();
                    R.roundRect(ctx, node.x, node.y, node.wide, node.tall, 11);
                    ctx.clip();
                    if (node.kind === 'chat') {
                        chatBody(node, node.x, node.y, time, asking, local);
                    } else {
                        terminalBody(node, node.x, node.y, node.wide, node.tall, time);
                    }
                    ctx.restore();
                    if (focus) {
                        // The amber ring: one breath outward when the node starts to wait.
                        const ringP = R.phase(local, T_AMBER, 0.9);
                        if (ringP > 0 && ringP < 1) {
                            const grow = R.ease.outCubic(ringP) * 18;
                            ctx.globalAlpha = (1 - ringP) * 0.8;
                            strokeRound(node.x - grow, node.y - grow, node.wide + grow * 2, node.tall + grow * 2, 11 + grow, pal.needs, 2 * hair + 1);
                            ctx.globalAlpha = 1;
                        }
                        const hold = R.smoothstep(T_AMBER + 0.3, T_AMBER + 0.8, local) * (1 - R.smoothstep(T_FOLD, T_FOLD + 0.3, local));
                        if (hold > 0) {
                            ctx.globalAlpha = hold * 0.55;
                            strokeRound(node.x - 3, node.y - 3, node.wide + 6, node.tall + 6, 13, pal.needs, 1.5);
                            ctx.globalAlpha = 1;
                        }
                    }
                    if (dim > 0.001) {
                        R.roundRect(ctx, node.x - 1, node.y - 1, node.wide + 2, node.tall + 4, 12);
                        ctx.fillStyle = `rgba(10,10,13,${dim * 0.7})`;
                        ctx.fill();
                    }
                    ctx.restore();
                }

                /* The card grows out of the node, is answered, and folds back in. */
                const open = R.phase(local, T_CARD, 0.55) * (1 - R.ease.inCubic(R.phase(local, T_FOLD, 0.34)));
                let pickX = 0;
                let pickY = 0;
                if (open > 0.001) {
                    const target = cardRect(focusNode);
                    const card = drawCard(ask, target, local < T_FOLD ? R.ease.outCubic(open) : open, local, hair);
                    pickX = card.x + 150;
                    pickY = card.y + 62 + ask.pick * 36 + 17;
                } else {
                    const target = cardRect(focusNode);
                    pickX = target.x + 150;
                    pickY = target.y + 62 + ask.pick * 36 + 17;
                }
                ctx.restore();

                /* The person's pointer: an arc in, a press, away. */
                const arrive = R.ease.inOutCubic(R.phase(local, T_CURSOR, 1.0));
                const leave = R.ease.inCubic(R.phase(local, T_PRESS + 0.35, 0.7));
                const alpha = R.smoothstep(T_CURSOR, T_CURSOR + 0.3, local) * (1 - leave);
                if (alpha > 0.01) {
                    const tx = sx(pickX);
                    const ty = sy(pickY);
                    const fromX = 470;
                    const fromY = 470;
                    const cx = R.lerp(fromX, tx, arrive) + Math.sin(Math.PI * arrive) * 40;
                    const cy = R.lerp(fromY, ty, arrive) + Math.sin(Math.PI * arrive) * 10;
                    const ox = cx + leave * 90;
                    const oy = cy + leave * 70;
                    const press = Math.sin(Math.PI * R.phase(local, T_PRESS, 0.22));
                    const ripple = R.phase(local, T_PRESS + 0.05, 0.45);
                    if (ripple > 0 && ripple < 1) {
                        ctx.globalAlpha = (1 - ripple) * 0.5;
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath();
                        ctx.arc(tx, ty, 4 + ripple * 14, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }
                    cursor(ox, oy, 1 - press * 0.12, alpha);
                }
                softEdges(64, 56);
            }
        };

    }
});
