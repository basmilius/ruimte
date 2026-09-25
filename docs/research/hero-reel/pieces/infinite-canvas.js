Reel.add({
    id: 'infinite-canvas',
    title: 'Pan and Zoom',
    line: 'One canvas for the whole project. Zoom out to see it, zoom in to work.',
    principles: ['Slow in and slow out', 'Staging'],
    tech: 'Canvas 2D, camera choreography',
    hint: 'Move to drift the camera',
    poster: 5.3,
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

        const LOOP = 16;

        /* The project, in the app's own units: four clusters and the labels a person wrote over them. */
        const place = (x, y, wide, tall, kind, title, extra = {}) => Object.assign({ x, y, wide, tall, kind, title }, extra);
        const LEAD = place(-170, -130, 340, 330, 'chat', 'Speed up checkout', { agent: 'claude', lead: true });
        const TRACE = place(250, -250, 272, 140, 'chat', 'Trace requests', { agent: 'claude', tool: ['Reading', 'checkout.trace'] });
        const QUERIES = place(250, -60, 272, 140, 'chat', 'Check queries', { agent: 'claude', tool: ['Counting', 'queries.log'], doneAt: 8.2, againAt: 14.6 });
        const BUNDLE = place(250, 130, 272, 140, 'chat', 'Bundle size', { agent: 'codex', tool: ['Running', 'bun run analyze'] });
        const DEV = place(-1130, -690, 300, 190, 'terminal', 'dev server');
        const NOTE = place(-1130, -440, 260, 120, 'note', 'Note', { text: ['A failed signup clears', 'the email field.'] });
        const SIGNUP = place(-780, -720, 300, 360, 'chat', 'Fix signup', { agent: 'claude', tool: ['Editing', 'SignupForm.tsx'], askAt: 13.9, answerAt: 17.2 });
        const PAGE = place(-420, -660, 240, 300, 'browser', 'Sign up', { url: 'localhost:5173/signup' });
        const SKETCH = place(620, 360, 440, 290, 'drawing', 'Architecture');
        const FILE = place(1120, 380, 300, 270, 'file', 'cart.ts');
        const DOCS = place(-1060, 360, 280, 250, 'browser', 'Docs', { url: 'docs.acme.dev/cart' });
        const TESTS = place(-720, 400, 300, 200, 'terminal', 'test suite');
        const SAVED = place(700, -700, 280, 180, 'chat', 'Saved carts', { agent: 'codex', tool: ['Editing', 'cart/store.ts'] });
        const BRIEF = place(1030, -690, 250, 130, 'note', 'Note', { text: ['Saved carts: 30 days.', 'Keep the old API.'] });
        const NODES = [LEAD, TRACE, QUERIES, BUNDLE, DEV, NOTE, SIGNUP, PAGE, SKETCH, FILE, DOCS, TESTS, SAVED, BRIEF];
        const EDGES = [
            [LEAD, TRACE, 'task'],
            [LEAD, QUERIES, 'task'],
            [LEAD, BUNDLE, 'task'],
            [DEV, SIGNUP, 'context'],
            [NOTE, SIGNUP, 'context'],
            [SIGNUP, PAGE, 'context'],
            [SKETCH, FILE, 'context'],
            [BRIEF, SAVED, 'context']
        ];
        const LABELS = [
            ['Checkout', -170, -330],
            ['Signup', -1130, -800],
            ['Architecture', 620, 270],
            ['Tests', -1060, 270],
            ['Saved carts', 700, -800]
        ];
        for (let i = 0; i < NODES.length; i++) {
            NODES[i].seed = R.hash(i * 1.37 + 0.5) * 10;
        }

        /* The tour: rest on the whole project, glide along an arc to the team, push in on the lead, hold, pull out. */
        const OVERVIEW = { x: 140, y: -20, zoom: 0.215 };
        const TEAM = { x: 110, y: 10, zoom: 0.62 };
        const CLOSE = { x: 0, y: 40, zoom: 1.34 };
        const camera = { x: 0, y: 0, zoom: 1 };
        const T_IN = 2.0;
        const T_CLOSE = 6.9;
        const T_OUT = 10.3;
        const T_HOME = 13.6;
        const logLerp = (first, second, amount) => Math.exp(R.lerp(Math.log(first), Math.log(second), amount));
        const cameraAt = (time) => {
            if (time < T_IN || time >= T_HOME) {
                camera.x = OVERVIEW.x;
                camera.y = OVERVIEW.y;
                camera.zoom = OVERVIEW.zoom;
            } else if (time < T_OUT) {
                // In: the pan leads and the zoom follows, both easing in and out; a sideways arc bends the glide.
                const glide = R.ease.inOutCubic(R.phase(time, T_IN, 3.4));
                const push = R.ease.inOutCubic(R.phase(time, T_IN + 0.5, 3.2));
                const close = R.ease.inOutQuart(R.phase(time, T_IN + 3.3, T_CLOSE - T_IN - 3.3));
                const bend = Math.sin(Math.PI * glide) * 220;
                camera.x = R.lerp(R.lerp(OVERVIEW.x, TEAM.x, glide), CLOSE.x, close) + bend * 0.35;
                camera.y = R.lerp(R.lerp(OVERVIEW.y, TEAM.y, glide), CLOSE.y, close) - bend;
                camera.zoom = logLerp(logLerp(OVERVIEW.zoom, TEAM.zoom, push), CLOSE.zoom, close);
            } else {
                // Out: the zoom leads this time, and the arc bends the other way, so the loop is a closed curve.
                const pull = R.ease.inOutCubic(R.phase(time, T_OUT, 2.9));
                const glide = R.ease.inOutCubic(R.phase(time, T_OUT + 0.4, T_HOME - T_OUT - 0.4));
                const bend = Math.sin(Math.PI * glide) * 260;
                camera.x = R.lerp(CLOSE.x, OVERVIEW.x, glide) - bend * 0.5;
                camera.y = R.lerp(CLOSE.y, OVERVIEW.y, glide) + bend * 0.7;
                camera.zoom = logLerp(CLOSE.zoom, OVERVIEW.zoom, pull);
            }
            return camera;
        };

        /* Status over the loop, so the far view changes too. */
        const statusOf = (node, time) => {
            if (node.kind !== 'chat') {
                return null;
            }
            if (node.doneAt !== undefined && time >= node.doneAt && time < node.againAt) {
                return 'idle';
            }
            if (node.askAt !== undefined && (time >= node.askAt || time < node.answerAt - LOOP)) {
                return 'needs';
            }
            return 'running';
        };

        /* Bodies at full detail. */
        const LEAD_REPLY = 'Two findings so far: the cart loads 12 times per request, and shipping is fetched once per item. Batching both.';
        const replyWords = LEAD_REPLY.split(' ');
        const wrapCache = new Map();
        const wrapLines = (text, width) => {
            const key = text + '|' + width + '|' + ctx.font;
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
        const leadBody = (node, time) => {
            const x = node.x + 16;
            const wide = node.wide - 32;
            let y = node.y + HEADER + 16;
            setFont(14);
            const ask = 'Checkout takes 4 seconds. Find out why.';
            const bw = measure(ask) + 28;
            fillRound(node.x + node.wide - 16 - bw, y, bw, 41, 16, pal.active);
            label(ask, node.x + node.wide - 2 - bw, y + 21, 14, pal.text);
            y += 55;
            const rows = [['terminal', 'Started', '3 agents'], ['eye', 'Read', 'src/checkout/load.ts']];
            for (const [glyph, word, detail] of rows) {
                icon(glyph, x, y + 1, 12, pal.muted);
                label(word, x + 20, y + 7, 13, pal.muted);
                setFont(13);
                label(detail, x + 26 + measure(word), y + 7.5, 12, pal.faint, 400, MONO);
                y += 26;
            }
            y += 8;
            // The reply streams while the camera holds on it.
            setFont(14);
            const lines = wrapLines(LEAD_REPLY, wide);
            const shown = R.clamp((time - (T_CLOSE - 0.4)) / 2.6) * replyWords.length;
            let index = 0;
            for (const line of lines) {
                let lx = x;
                for (const word of line.split(' ')) {
                    const first = R.ease.outCubic(R.clamp(shown - index));
                    if (first > 0) {
                        ctx.globalAlpha = first;
                        label(word, lx, y + 10 + (1 - first) * 3, 14, pal.text);
                    }
                    lx += measure(word + ' ');
                    index++;
                }
                y += 21;
            }
            ctx.globalAlpha = 1;
            y += 10;
            statusDot(x + 4, y + 8, 'running', time);
            const ww = shine('Working for', x + 16, y + 8, 13, time);
            label(`00:${String(Math.floor(R.mod(time, LOOP)) + 31).padStart(2, '0')}`, x + 22 + ww, y + 8, 13, pal.faint);
            const cy = node.y + node.tall - 58;
            fillRound(node.x + 12, cy, node.wide - 24, 46, 15, pal.raised);
            strokeRound(node.x + 12.5, cy + 0.5, node.wide - 25, 45, 14.5, 'rgba(255,255,255,0.07)', 1);
            label('Ask anything', node.x + 30, cy + 23, 14, pal.faint);
            fillRound(node.x + node.wide - 52, cy + 8, 30, 30, 15, pal.accent);
            icon('arrowUp', node.x + node.wide - 45, cy + 15, 16, '#ffffff');
        };
        const chatBody = (node, time, status) => {
            const x = node.x + 14;
            let y = node.y + HEADER + 16;
            if (status === 'idle') {
                icon('circleCheck', x, y + 1, 12, pal.idle);
                label('Done', x + 20, y + 7, 13, pal.idle);
                y += 28;
                label('Same cart loaded 12 times.', x, y + 7, 13, pal.text);
                return;
            }
            if (status === 'needs') {
                icon('question', x, y + 1, 12, pal.needs);
                label('Waiting for you', x + 20, y + 7, 13, pal.muted);
                return;
            }
            icon('edit', x, y + 1, 12, pal.accent);
            const wide = shine(node.tool[0], x + 20, y + 7, 13, time + node.seed);
            label(node.tool[1], x + 26 + wide, y + 7.5, 12, pal.faint, 400, MONO);
            y += 30;
            statusDot(x + 4, y + 7, 'running', time + node.seed);
            shine('Working', x + 16, y + 7, 13, time + node.seed * 0.5);
        };
        const LOG = [['GET', '/signup', '200'], ['POST', '/api/signup', '422'], ['POST', '/api/signup', '201'], ['GET', '/api/session', '200']];
        const TEST_LINES = ['cart/total', 'cart/discount', 'checkout/address', 'checkout/payment', 'orders/refund', 'auth/session', 'auth/reset', 'search/rank'];
        const terminalBody = (node, time) => {
            const top = node.y + HEADER;
            const rows = Math.floor((node.tall - HEADER - 12) / 17);
            // 0.5 s a line: 32 lines a loop, a multiple of both logs, so the scroll is where it began at the wrap.
            const step = time / 0.5;
            const count = Math.floor(step);
            const scroll = R.ease.outCubic(R.clamp((step - count) * 4)) * 17;
            ctx.save();
            ctx.beginPath();
            ctx.rect(node.x, top, node.wide, node.tall - HEADER - 3);
            ctx.clip();
            setFont(12, 400, MONO);
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            for (let k = 0; k <= rows; k++) {
                const line = count - rows + k;
                const ly = top + 16 + k * 17 + 17 - scroll;
                if (node.title === 'dev server') {
                    const entry = LOG[R.mod(line, LOG.length)];
                    ctx.fillStyle = pal.blue;
                    ctx.fillText(entry[0], node.x + 10, ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(entry[1], node.x + 50, ly);
                    ctx.fillStyle = entry[2][0] === '4' ? pal.yellow : pal.green;
                    ctx.fillText(entry[2], node.x + 170, ly);
                } else {
                    ctx.fillStyle = pal.green;
                    ctx.fillText('pass', node.x + 10, ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(`${TEST_LINES[R.mod(line, TEST_LINES.length)]}.test.ts`, node.x + 50, ly);
                }
            }
            ctx.restore();
        };
        const browserBody = (node, time) => {
            const top = node.y + HEADER;
            ctx.fillStyle = pal.raised;
            ctx.fillRect(node.x, top, node.wide, 36);
            fillRound(node.x + 10, top + 6, node.wide - 20, 24, 6, pal.sunken);
            icon('lock', node.x + 18, top + 12, 12, pal.muted);
            label(node.url, node.x + 36, top + 18.5, 12, pal.text);
            ctx.fillStyle = '#111114';
            ctx.fillRect(node.x, top + 37, node.wide, node.tall - HEADER - 37);
            const px = node.x + 18;
            fillRound(px, top + 56, node.wide * 0.5, 12, 3, pal.text);
            fillRound(px, top + 78, node.wide * 0.7, 6, 3, pal.faint);
            fillRound(px, top + 90, node.wide * 0.55, 6, 3, pal.faint);
            fillRound(px, top + 110, node.wide - 36, 30, 6, pal.hover);
            fillRound(px, top + 150, node.wide - 36, 30, 6, pal.hover);
            fillRound(px, top + 196, node.wide - 36, 30, 6, pal.text);
        };
        const CODE = [
            [['export ', pal.magenta], ['async function ', pal.magenta], ['loadCart', pal.blue], ['(id) {', pal.termFg]],
            [['  const ', pal.magenta], ['cached', pal.termFg], [' = carts.', pal.termFg], ['get', pal.blue], ['(id);', pal.termFg]],
            [['  if ', pal.magenta], ['(cached) ', pal.termFg], ['return ', pal.magenta], ['cached;', pal.termFg]],
            [['  const ', pal.magenta], ['cart', pal.termFg], [' = ', pal.termFg], ['await ', pal.magenta], ['db.', pal.termFg], ['cart', pal.blue], ['(id);', pal.termFg]],
            [['  carts.', pal.termFg], ['set', pal.blue], ['(id, cart);', pal.termFg]],
            [['  return ', pal.magenta], ['cart;', pal.termFg]],
            [['}', pal.termFg]]
        ];
        const fileBody = (node) => {
            setFont(12, 400, MONO);
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            for (let k = 0; k < CODE.length; k++) {
                const ly = node.y + HEADER + 20 + k * 19;
                ctx.fillStyle = pal.faint;
                ctx.fillText(String(k + 12), node.x + 12, ly);
                let lx = node.x + 40;
                for (const [text, color] of CODE[k]) {
                    ctx.fillStyle = color;
                    ctx.fillText(text, lx, ly);
                    lx += measure(text);
                }
            }
        };
        const STROKES = [
            'M 40 90 C 80 86, 120 89, 160 88 C 162 118, 160 140, 159 166 C 120 168, 80 166, 38 167 C 37 140, 40 114, 40 90',
            'M 230 88 C 270 85, 318 89, 356 87 C 358 116, 356 142, 357 168 C 318 170, 274 166, 229 168 C 228 142, 230 114, 230 88',
            'M 166 128 C 184 126, 204 129, 222 127 M 210 118 L 223 127 L 211 137',
            'M 300 196 C 300 186, 356 184, 358 196 C 360 206, 300 208, 300 196 M 300 196 C 298 220, 299 236, 301 250 C 312 262, 350 262, 358 250 C 360 234, 359 214, 358 196',
            'M 300 170 C 301 176, 300 182, 302 190'
        ];
        const strokePaths = STROKES.map((svg) => new Path2D(svg));
        const drawingBody = (node) => {
            ctx.save();
            ctx.translate(node.x, node.y + HEADER - 40);
            ctx.strokeStyle = pal.text;
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const path of strokePaths) {
                ctx.stroke(path);
            }
            label('web', 76, 130, 22, pal.text, 400, R.fonts.hand);
            label('api', 272, 130, 22, pal.text, 400, R.fonts.hand);
            label('db', 318, 228, 20, pal.text, 400, R.fonts.hand);
            label('cache the cart?', 40, 222, 20, pal.needs, 400, R.fonts.hand);
            ctx.restore();
        };
        const noteBody = (node) => {
            for (let k = 0; k < node.text.length; k++) {
                label(node.text[k], node.x + 14, node.y + HEADER + 20 + k * 21, 14, pal.text);
            }
        };

        /* Far away a node is a block: its frame, its header band, a few bars, its status as a dot. */
        const block = (node, status, time, zoom) => {
            const ground = node.kind === 'note' ? pal.note : node.kind === 'terminal' ? pal.termBg : pal.surface;
            fillRound(node.x, node.y, node.wide, node.tall, 11, ground);
            ctx.save();
            R.roundRect(ctx, node.x, node.y, node.wide, node.tall, 11);
            ctx.clip();
            ctx.fillStyle = node.kind === 'note' ? pal.note : pal.raised;
            ctx.fillRect(node.x, node.y, node.wide, HEADER);
            ctx.fillStyle = node.kind === 'terminal' ? 'rgba(214,214,222,0.16)' : 'rgba(236,236,241,0.1)';
            const lines = Math.min(6, Math.floor((node.tall - HEADER - 20) / 28));
            for (let k = 0; k < lines; k++) {
                const width = (0.4 + 0.5 * R.hash(node.seed + k)) * (node.wide - 40);
                fillRound(node.x + 20, node.y + HEADER + 20 + k * 28, width, 10, 5, ctx.fillStyle);
            }
            ctx.restore();
            strokeRound(node.x, node.y, node.wide, node.tall, 11, 'rgba(255,255,255,0.1)', 1 / zoom);
            if (status) {
                // Kept at a size the eye can find from far away.
                const radius = Math.max(4, 3 / zoom);
                statusDot(node.x + node.wide - 22 - radius, node.y + HEADER / 2, status, time, radius);
            }
        };
        const detailed = (node, status, time) => {
            nodeFrame(node.x, node.y, node.wide, node.tall, { kind: node.kind, hair: 1 / camera.zoom });
            nodeHeader(node.x, node.y, node.wide, { kind: node.kind, agent: node.agent, title: node.title, status }, time + (node.seed || 0));
            ctx.save();
            R.roundRect(ctx, node.x, node.y, node.wide, node.tall, 11);
            ctx.clip();
            if (node.lead) {
                leadBody(node, time);
            } else if (node.kind === 'chat') {
                chatBody(node, time, status);
            } else if (node.kind === 'terminal') {
                terminalBody(node, time);
            } else if (node.kind === 'browser') {
                browserBody(node, time);
            } else if (node.kind === 'file') {
                fileBody(node);
            } else if (node.kind === 'drawing') {
                drawingBody(node);
            } else if (node.kind === 'note') {
                noteBody(node);
            }
            ctx.restore();
        };

        return {
            draw(now) {
                env.clear();
                const time = R.mod(now, LOOP);
                cameraAt(time);
                const pointer = env.pointer;
                const zoom = camera.zoom;
                const panX = -pointer.nx * pointer.active * 16;
                const panY = -pointer.ny * pointer.active * 12;
                const ox = 280 + panX - camera.x * zoom;
                const oy = 250 + panY - camera.y * zoom;

                // The ground: a fine lattice that fades out as it gets dense, and a coarse one that holds.
                const fine = R.smoothstep(7, 15, 24 * zoom);
                const size = R.clamp(1.1 * zoom + 0.5, 0.9, 1.6);
                dotGrid(24 * zoom, ox, oy, fine, size);
                dotGrid(96 * zoom, ox, oy, R.smoothstep(6, 14, 96 * zoom) * (1 - fine), size);

                ctx.save();
                ctx.translate(ox, oy);
                ctx.scale(zoom, zoom);
                const detail = R.smoothstep(0.3, 0.5, zoom);

                for (const [first, second, look] of EDGES) {
                    const done = second.doneAt !== undefined && time >= second.doneAt && time < second.againAt;
                    ctx.globalAlpha = 0.9;
                    edge(first, second, EDGE_CONTEXT, Math.max(2, 1.4 / zoom), look === 'task' && !done);
                }
                ctx.globalAlpha = 1;

                const left = (0 - ox) / zoom;
                const top = (0 - oy) / zoom;
                const right = (560 - ox) / zoom;
                const bottom = (500 - oy) / zoom;
                for (const node of NODES) {
                    if (node.x > right || node.x + node.wide < left || node.y > bottom || node.y + node.tall < top) {
                        continue;
                    }
                    const status = statusOf(node, time);
                    if (detail < 1) {
                        block(node, status, time, zoom);
                    }
                    if (detail > 0) {
                        ctx.globalAlpha = detail;
                        detailed(node, status, time);
                        ctx.globalAlpha = 1;
                    }
                }

                // Free text a person wrote on the canvas: large, so it reads from far away.
                for (const [text, x, y] of LABELS) {
                    label(text, x, y, 56, R.mix(pal.muted, pal.bg, 0.2), 600, R.fonts.display);
                }
                ctx.restore();
                softEdges(60, 54);
            }
        };
    }
});
