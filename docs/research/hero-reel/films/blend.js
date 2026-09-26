Film.define({
    id: 'blend',
    title: 'Sketch to Sunrise',
    duration: 60,
    // Where the one camera changes its subject: canvas, line, team, question, lid, build-box, phone, morning, grid,
    // merge, deploy, live, end card.
    cuts: [5.0, 10.35, 14.75, 17.5, 26.05, 27.45, 32.0, 38.9, 43.0, 47.35, 52.1, 54.3, 55.9],
    create(v) {
        const { R } = v;
        const main = v.ctx;
        // Swapped to the lid buffer while the laptop screen is drawn, so every helper draws wherever ctx points.
        let ctx = main;
        const pal = R.pal;
        const E = R.ease;
        const phase = R.phase;
        const clamp = R.clamp;
        const lerp = R.lerp;
        const sstep = R.smoothstep;
        const TAU = R.TAU;
        const PI = Math.PI;
        const SANS = R.fonts.sans;
        const DISPLAY = R.fonts.display;
        const MONO = R.fonts.mono;
        const HAND = R.fonts.hand;
        const glide = E.bezier(0.65, 0, 0.35, 1);
        const soft = E.bezier(0.45, 0, 0.2, 1);
        const unfold = E.bezier(0.3, 0, 0, 1);
        // Zoom runs on a log scale, so a gentle curve keeps the dolly readable at its fastest.
        const dolly = E.bezier(0.5, 0, 0.3, 1);
        const EDGE_CONTEXT = R.mix(pal.accent, pal.bg, 0.45);
        const springStep = (e, omega, zeta) => {
            if (e <= 0) {
                return 0;
            }
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * e) * (Math.cos(wd * e) + ((zeta * omega) / wd) * Math.sin(wd * e));
        };

        /* ---------- The app's glyphs: Lucide's own paths, and the two agent marks. ---------- */
        const ring = (cx, cy, rad) => `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0`;
        const box = (x, y, wide, tall, rad) =>
            `M${x + rad} ${y}h${wide - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${tall - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}h${-(wide - 2 * rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}v${-(tall - 2 * rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}z`;
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
            arrowLeft: ['m12 19-7-7 7-7', 'M19 12H5'],
            arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
            enter: ['M20 4v7a4 4 0 0 1-4 4H4', 'm9 10-5 5 5 5'],
            chevronRight: ['m9 18 6-6-6-6'],
            chevronDown: ['m6 9 6 6 6-6'],
            maximize: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'],
            close: ['M18 6 6 18', 'm6 6 12 12'],
            eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', ring(12, 12, 3)],
            edit: ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'],
            check: ['M20 6 9 17l-5-5'],
            reload: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
            plus: ['M5 12h14', 'M12 5v14'],
            minus: ['M5 12h14'],
            server: [box(2, 2, 20, 8, 2), box(2, 14, 20, 8, 2), 'M6 6h.01', 'M6 18h.01'],
            branch: ['M6 3v12', ring(18, 6, 3), ring(6, 18, 3), 'M18 9a9 9 0 0 1-9 9'],
            merge: [ring(18, 18, 3), ring(6, 6, 3), 'M6 21V9a9 9 0 0 0 9 9'],
            moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
            sun: [ring(12, 12, 4), 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
            search: [ring(11, 11, 8), 'm21 21-4.3-4.3'],
            folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
            panel: [box(3, 3, 18, 18, 2), 'M9 3v18', 'm16 15-3-3 3-3'],
            chart: ['M5 21v-6', 'M12 21V3', 'M19 21V9'],
            devices: [box(3, 8, 10, 14, 2), 'M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4', 'M8 18h.01'],
            lockOpen: [box(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 9.9-1'],
            layout: [box(3, 3, 18, 7, 1), box(3, 14, 9, 7, 1), box(16, 14, 5, 7, 1)],
            fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
            settings: [
                'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
                ring(12, 12, 3)
            ]
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

        /* ---------- Type. ---------- */
        const setFont = (size, weight = 400, family = SANS) => {
            ctx.font = weight + ' ' + size + 'px ' + family;
        };
        const widths = new Map();
        const measure = (text) => {
            const key = ctx.font + '|' + text;
            let width = widths.get(key);
            if (width === undefined) {
                width = ctx.measureText(text).width;
                widths.set(key, width);
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
        // The client's `.shine`: muted words with a light running over them every 1.6 s.
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
        const wrapCache = new Map();
        const wrapWords = (text, width, size, weight = 400) => {
            setFont(size, weight);
            const key = text + '|' + width + '|' + ctx.font;
            let layout = wrapCache.get(key);
            if (layout) {
                return layout;
            }
            const words = text.split(' ');
            const space = measure(' ');
            layout = { words, xs: [], lines: [], count: 1, maxW: 0 };
            let x = 0;
            let line = 0;
            for (const word of words) {
                const wide = measure(word);
                if (x > 0 && x + wide > width) {
                    x = 0;
                    line++;
                }
                layout.xs.push(x);
                layout.lines.push(line);
                x += wide + space;
                layout.maxW = Math.max(layout.maxW, x - space);
            }
            layout.count = line + 1;
            wrapCache.set(key, layout);
            return layout;
        };
        // Streams come in bursts: most words land close together, a few wait.
        const timesCache = new Map();
        const wordTimes = (text, start, pace) => {
            const key = text + '|' + start;
            let times = timesCache.get(key);
            if (times) {
                return times;
            }
            times = [];
            const count = text.split(' ').length;
            let at = start;
            for (let i = 0; i < count; i++) {
                times.push(at);
                at += pace * (0.55 + R.hash(start * 7 + i * 7.3) * 0.9) + (R.hash(start * 3 + i * 3.1) > 0.84 ? pace * 2 : 0);
            }
            timesCache.set(key, times);
            return times;
        };

        /* ---------- Surfaces and status. ---------- */
        const fillRound = (x, y, wide, tall, rad, color) => {
            R.roundRect(ctx, x, y, wide, tall, rad);
            ctx.fillStyle = color;
            ctx.fill();
        };
        const strokeRound = (x, y, wide, tall, rad, color, width = 1) => {
            R.roundRect(ctx, x, y, wide, tall, rad);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();
        };
        const disc = (x, y, radius, color) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, TAU);
            ctx.fillStyle = color;
            ctx.fill();
        };
        const STATUS = { running: pal.running, needs: pal.needs, idle: pal.idle, error: pal.error, paused: pal.faint };
        const STATUS_LABEL = { running: 'Running', needs: 'Needs you', idle: 'Idle', error: 'Error', paused: 'Paused' };
        const pulseOf = (status, now) => (status === 'running' ? 0.75 + 0.25 * Math.cos(now * PI) : 1);
        const statusDot = (x, y, status, now, radius = 4) => {
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * pulseOf(status, now);
            disc(x, y, radius, STATUS[status]);
            if (status === 'needs') {
                const wave = R.fract(now / 1.4);
                ctx.globalAlpha = keep * 0.5 * (1 - wave);
                ctx.beginPath();
                ctx.arc(x, y, radius + wave * radius * 2.6, 0, TAU);
                ctx.strokeStyle = pal.needs;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
            ctx.globalAlpha = keep;
        };
        const pill = (right, y, status, now, size = 12) => {
            setFont(size, 400);
            const word = STATUS_LABEL[status];
            const width = measure(word) + size * 1.95;
            const height = size * 1.62;
            fillRound(right - width, y - height / 2, width, height, height / 2, pal.sunken);
            statusDot(right - width + size * 0.72, y, status, now, size / 3.25);
            label(word, right - width + size * 1.2, y + 0.5, size, pal.muted);
            return width;
        };

        // `NodeFrame`: an 11 radius frame with a 39 tall raised header.
        const HEADER = 39;
        const nodeFrame = (x, y, wide, tall, kind, outline = 0) => {
            const ground = kind === 'note' ? pal.note : kind === 'terminal' ? pal.termBg : pal.surface;
            fillRound(x - 1, y + 1, wide + 2, tall + 3, 12, 'rgba(0,0,0,0.2)');
            fillRound(x, y + 1, wide, tall + 1, 11, 'rgba(0,0,0,0.22)');
            fillRound(x, y, wide, tall, 11, ground);
            ctx.save();
            R.roundRect(ctx, x, y, wide, tall, 11);
            ctx.clip();
            ctx.fillStyle = kind === 'note' ? pal.note : pal.raised;
            ctx.fillRect(x, y, wide, HEADER);
            ctx.fillStyle = kind === 'note' ? 'rgba(236,236,241,0.12)' : 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + HEADER - 1, wide, 1);
            ctx.restore();
            strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, 11, 'rgba(255,255,255,0.08)', 1);
            if (outline > 0.01) {
                const keep = ctx.globalAlpha;
                ctx.globalAlpha = keep * outline;
                strokeRound(x - 1, y - 1, wide + 2, tall + 2, 12, pal.accent, 2);
                ctx.globalAlpha = keep;
            }
        };
        const nodeHeader = (x, y, wide, opts, now) => {
            const mid = y + HEADER / 2;
            if (opts.agent) {
                mark(opts.agent, x + 10, mid - 7, 14, pal.muted);
            } else {
                icon(opts.kind, x + 10, mid - 7, 14, pal.muted);
            }
            let right = x + wide - 4;
            icon('close', right - 21, mid - 7, 14, pal.muted);
            icon('maximize', right - 49, mid - 7, 14, pal.muted);
            right -= 60;
            if (opts.status) {
                right -= pill(right, mid, opts.status, now, 12) + 8;
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 30, y, Math.max(0, right - x - 30), HEADER);
            ctx.clip();
            label(opts.title, x + 34, mid + 0.5, 13, pal.text, 500);
            ctx.restore();
        };

        /* ---------- Connectors, routed the way the client routes them. ---------- */
        const cornersOf = (first, second) => {
            const dx = second.x + second.w / 2 - (first.x + first.w / 2);
            const dy = second.y + second.h / 2 - (first.y + first.h / 2);
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            const ax = horizontal ? Math.sign(dx) || 1 : 0;
            const ay = horizontal ? 0 : Math.sign(dy) || 1;
            const side = (rect, sx, sy) => [
                sx === 0 ? rect.x + rect.w / 2 : sx > 0 ? rect.x + rect.w + 9 : rect.x - 9,
                sy === 0 ? rect.y + rect.h / 2 : sy > 0 ? rect.y + rect.h + 9 : rect.y - 9
            ];
            const start = side(first, ax, ay);
            const end = side(second, -ax, -ay);
            if (horizontal) {
                const rail = (start[0] + end[0]) / 2;
                return [start, [rail, start[1]], [rail, end[1]], end];
            }
            const rail = (start[1] + end[1]) / 2;
            return [start, [start[0], rail], [end[0], rail], end];
        };
        const buildPoly = (points) => {
            const pts = [points[0][0], points[0][1]];
            for (let i = 1; i < points.length - 1; i++) {
                const [px, py] = points[i - 1];
                const [cx, cy] = points[i];
                const [nx, ny] = points[i + 1];
                const inLeg = Math.hypot(cx - px, cy - py);
                const outLeg = Math.hypot(nx - cx, ny - cy);
                const radius = Math.min(15, inLeg / 2, outLeg / 2);
                if (radius < 0.5) {
                    pts.push(cx, cy);
                    continue;
                }
                const bx = cx - ((cx - px) / inLeg) * radius;
                const by = cy - ((cy - py) / inLeg) * radius;
                const ex = cx + ((nx - cx) / outLeg) * radius;
                const ey = cy + ((ny - cy) / outLeg) * radius;
                for (let k = 0; k <= 6; k++) {
                    const s = k / 6;
                    const u = 1 - s;
                    pts.push(u * u * bx + 2 * u * s * cx + s * s * ex, u * u * by + 2 * u * s * cy + s * s * ey);
                }
            }
            const last = points[points.length - 1];
            pts.push(last[0], last[1]);
            const cum = [0];
            for (let i = 2; i < pts.length; i += 2) {
                cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
            }
            return { pts, cum, total: cum[cum.length - 1] };
        };
        const routePoly = (first, second) => buildPoly(cornersOf(first, second));
        const tracePoly = (poly, upto) => {
            const { pts, cum } = poly;
            ctx.beginPath();
            ctx.moveTo(pts[0], pts[1]);
            for (let i = 1; i < cum.length; i++) {
                if (cum[i] <= upto) {
                    ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
                    continue;
                }
                const span = cum[i] - cum[i - 1];
                const k = span > 0 ? (upto - cum[i - 1]) / span : 0;
                ctx.lineTo(lerp(pts[i * 2 - 2], pts[i * 2], k), lerp(pts[i * 2 - 1], pts[i * 2 + 1], k));
                break;
            }
        };
        const spot = { x: 0, y: 0 };
        const pointAt = (poly, dist) => {
            const { pts, cum } = poly;
            const d = clamp(dist, 0, poly.total);
            for (let i = 1; i < cum.length; i++) {
                if (cum[i] >= d) {
                    const span = cum[i] - cum[i - 1];
                    const k = span > 0 ? (d - cum[i - 1]) / span : 0;
                    spot.x = lerp(pts[i * 2 - 2], pts[i * 2], k);
                    spot.y = lerp(pts[i * 2 - 1], pts[i * 2 + 1], k);
                    return spot;
                }
            }
            spot.x = pts[pts.length - 2];
            spot.y = pts[pts.length - 1];
            return spot;
        };
        const drawEdge = (poly, amount, color, width, dashed, head = true) => {
            if (amount <= 0) {
                return;
            }
            tracePoly(poly, poly.total * amount);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash(dashed ? [6, 6] : []);
            ctx.stroke();
            ctx.setLineDash([]);
            if (head && amount >= 1) {
                const end = pointAt(poly, poly.total);
                ctx.beginPath();
                ctx.arc(end.x, end.y, 5, 0, TAU);
                ctx.fillStyle = pal.bg;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        };

        // The person's own pointer: black with a white rim, tip at x, y.
        const CURSOR = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');
        const cursor = (x, y, scale, alpha, press = 0) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x - 1.5 * scale, y - 1.5 * scale);
            const squash = 1 - press * 0.12;
            ctx.scale(scale * squash, scale * squash);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.translate(0, 1.2);
            ctx.fill(CURSOR);
            ctx.translate(0, -1.2);
            ctx.fillStyle = '#000000';
            ctx.fill(CURSOR);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.lineJoin = 'round';
            ctx.stroke(CURSOR);
            ctx.restore();
        };
        const clickRing = (x, y, since, scale) => {
            if (since < 0 || since > 0.5) {
                return;
            }
            const k = since / 0.5;
            ctx.save();
            ctx.globalAlpha *= 0.55 * (1 - k);
            ctx.beginPath();
            ctx.arc(x, y, (6 + E.outCubic(k) * 16) * scale, 0, TAU);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fill();
            ctx.restore();
        };
        const keycap = (glyph, x, y, press, lit) => {
            const sink = press * 1.5;
            fillRound(x, y + 1.5, 20, 19, 5, 'rgba(0,0,0,0.5)');
            fillRound(x, y + sink, 20, 19 - sink * 0.6, 5, R.mix(pal.active, pal.hover, press));
            strokeRound(x + 0.5, y + sink + 0.5, 19, 18 - sink * 0.6, 4.5, `rgba(255,255,255,${0.1 + lit * 0.12})`, 1);
            icon(glyph, x + 4, y + 3.5 + sink * 0.8, 12, R.mix(pal.muted, pal.text, lit));
        };
        const keyPress = (now, at) => E.outQuad(phase(now, at, 0.07)) * (1 - E.inOutQuad(phase(now, at + 0.14, 0.12)));
        const toggle = (x, y, on) => {
            R.roundRect(ctx, x, y, 26, 15, 7.5);
            ctx.fillStyle = R.mix(pal.active, pal.accent, on);
            ctx.fill();
            fillRound(x + 2 + on * 11, y + 2, 11, 11, 5.5, '#ffffff');
        };

        /* ---------- The story's clock: minutes since 22:00 the night before Nachtveld opens. ---------- */
        const CLOCK = [
            [0, 0, 0],
            [4.5, 0, 0],
            [24, 38, 0],
            [26.4, 75, 0],
            [27.8, 110, 0],
            [30.7, 180, 0],
            [31.8, 200, 1],
            [32.9, 255, 0],
            [38.3, 258, 1],
            [39.9, 570, 0],
            [51.2, 590, 1],
            [52.7, 838, 0],
            [60, 840, 0]
        ];
        const minutesAt = (t) => {
            for (let i = 1; i < CLOCK.length; i++) {
                if (t <= CLOCK[i][0]) {
                    const [t0, m0, eased] = CLOCK[i - 1];
                    const [t1, m1] = CLOCK[i];
                    const k = (t - t0) / (t1 - t0);
                    return lerp(m0, m1, eased ? E.inOutSine(k) : k);
                }
            }
            return CLOCK[CLOCK.length - 1][1];
        };
        const clockText = (minutes) => {
            const total = Math.floor(22 * 60 + minutes) % 1440;
            return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
        };
        const T_LIVE = 54.3;
        const chip = { text: '', old: '', at: -10, width: 0 };
        const drawClockChip = (t, dt) => {
            const alpha = sstep(2.1, 2.8, t) * (1 - sstep(55.3, 55.9, t));
            if (alpha <= 0.001) {
                return;
            }
            const minutes = minutesAt(t);
            const left = 840 - minutes;
            let text;
            if (t >= T_LIVE) {
                text = 'Nachtveld is live';
            } else if (left > 60) {
                text = 'Nachtveld opens in ' + Math.ceil(left / 60) + ' hours';
            } else {
                text = 'Nachtveld opens in ' + Math.max(1, Math.round(left)) + ' minutes';
            }
            if (text !== chip.text) {
                chip.old = chip.text;
                chip.text = text;
                chip.at = t;
            }
            const time = clockText(minutes);
            setFont(24, 500, MONO);
            const timeW = measure('00:00');
            setFont(20, 400, DISPLAY);
            const textW = measure(chip.text);
            const live = sstep(T_LIVE, T_LIVE + 0.4, t);
            const target = 20 + 20 + 12 + timeW + 16 + 1 + 16 + (live > 0 ? 18 : 0) + textW + 22;
            chip.width = chip.width === 0 ? target : chip.width + (target - chip.width) * (1 - Math.exp(-dt * 9));
            const rise = (1 - E.outCubic(phase(t, 2.1, 0.7))) * -10;
            const height = 46;
            const x = 960 - chip.width / 2;
            const y = 22 + rise;
            ctx.save();
            ctx.globalAlpha = alpha;
            fillRound(x, y + 2, chip.width, height, height / 2, 'rgba(0,0,0,0.35)');
            fillRound(x, y, chip.width, height, height / 2, R.mix(pal.raised, pal.bg, 0.1, 0.94));
            strokeRound(x + 0.5, y + 0.5, chip.width - 1, height - 1, height / 2 - 0.5, 'rgba(255,255,255,0.1)');
            const day = sstep(470, 500, minutes);
            const iconX = x + 20;
            ctx.globalAlpha = alpha * (1 - day);
            icon('moon', iconX, y + 13, 20, pal.muted);
            ctx.globalAlpha = alpha * day;
            icon('sun', iconX, y + 13, 20, pal.needs);
            ctx.globalAlpha = alpha;
            label(time, iconX + 32, y + height / 2 + 1, 24, pal.text, 500, MONO);
            const divX = iconX + 32 + timeW + 16;
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(divX, y + 13, 1, 20);
            let textX = divX + 17;
            if (live > 0) {
                ctx.globalAlpha = alpha * live;
                disc(textX + 5, y + height / 2, 5, pal.idle);
                const wave = phase(t, T_LIVE, 1.2);
                if (wave < 1) {
                    ctx.globalAlpha = alpha * (1 - wave) * 0.6;
                    ctx.beginPath();
                    ctx.arc(textX + 5, y + height / 2, 5 + wave * 14, 0, TAU);
                    ctx.strokeStyle = pal.idle;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
                textX += 18 * live;
            }
            const swap = E.outCubic(phase(t, chip.at, 0.4));
            ctx.save();
            ctx.beginPath();
            ctx.rect(divX + 2, y, chip.width - (divX + 2 - x) - 10, height);
            ctx.clip();
            if (swap < 1 && chip.old) {
                ctx.globalAlpha = alpha * (1 - swap);
                label(chip.old, textX, y + height / 2 + 1 - swap * 12, 20, pal.muted, 400, DISPLAY);
            }
            ctx.globalAlpha = alpha * (chip.old ? swap : 1);
            label(chip.text, textX, y + height / 2 + 1 + (chip.old ? (1 - swap) * 12 : 0), 20, t >= T_LIVE ? pal.text : pal.muted, 400, DISPLAY);
            ctx.restore();
            ctx.restore();
        };

        /* ---------- Lower thirds. ---------- */
        const CAPTIONS = [
            [5.9, 9.2, 'Sketch the site on the canvas.'],
            [10.1, 13.6, 'Draw a line. The context travels.'],
            [14.9, 17.6, 'A team of agents, a worktree each.'],
            [18.6, 22.0, 'Agents ask. You decide.'],
            [25.8, 28.3, 'Close the laptop. The work goes on.'],
            [28.9, 31.7, 'Hits a limit. Resumes at the reset.'],
            [33.9, 37.4, 'Answer from your phone.'],
            [40.8, 43.2, 'Everything where you left it.'],
            [44.4, 47.1, 'Every view, side by side.'],
            [47.9, 51.3, 'Conflicts, worked out stretch by stretch.'],
            [54.2, 55.7, 'Live at 11:58.']
        ];
        const scrim = main.createLinearGradient(0, 900, 0, 1080);
        scrim.addColorStop(0, 'rgba(13,13,16,0)');
        scrim.addColorStop(0.6, 'rgba(13,13,16,0.72)');
        scrim.addColorStop(1, 'rgba(13,13,16,0.85)');
        const drawCaptions = (t) => {
            let shade = 0;
            for (const [start, end] of CAPTIONS) {
                shade = Math.max(shade, sstep(start - 0.3, start + 0.2, t) * (1 - sstep(end, end + 0.5, t)));
            }
            if (shade > 0.001) {
                ctx.save();
                ctx.globalAlpha = shade;
                ctx.fillStyle = scrim;
                ctx.fillRect(0, 900, 1920, 180);
                ctx.restore();
            }
            for (const [start, end, text] of CAPTIONS) {
                if (t < start - 0.05 || t > end + 0.4) {
                    continue;
                }
                const inn = E.outCubic(phase(t, start, 0.45));
                const out = E.inCubic(phase(t, end, 0.35));
                const alpha = inn * (1 - out);
                ctx.save();
                ctx.globalAlpha = alpha;
                setFont(30, 500, DISPLAY);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = 'rgba(0,0,0,0.85)';
                ctx.shadowBlur = 24;
                ctx.fillStyle = pal.text;
                ctx.fillText(text, 960, 1008 + (1 - inn) * 8);
                ctx.restore();
            }
        };

        /* ---------- The wordmark: Ruimte, its gaps opening to make room. ---------- */
        const WORD = ['R', 'u', 'i', 'm', 't', 'e'];
        const WSIZE = 220;
        const WFONT = '600 ' + WSIZE + 'px ' + DISPLAY;
        const W_ADV = [0, 0, 0, 0, 0, 0];
        const W_LEFT = [0, 0, 0, 0, 0, 0];
        let wordW = 0;
        let xHeight = WSIZE * 0.54;
        const tittle = { dx: 0, top: WSIZE * 0.72, w: WSIZE * 0.135, h: WSIZE * 0.13 };
        {
            main.save();
            main.font = WFONT;
            for (let i = 0; i < 6; i++) {
                W_ADV[i] = main.measureText(i === 2 ? 'ı' : WORD[i]).width;
            }
            let x = 0;
            for (let i = 0; i < 6; i++) {
                W_LEFT[i] = x;
                x += W_ADV[i];
                if (i < 5) {
                    x += main.measureText(WORD[i] + WORD[i + 1]).width - main.measureText(WORD[i]).width - main.measureText(WORD[i + 1]).width;
                }
            }
            wordW = x;
            const xm = main.measureText('x');
            if (xm.actualBoundingBoxAscent) {
                xHeight = xm.actualBoundingBoxAscent;
            }
            main.restore();
            // The tittle is what the dotted i has and the dotless one does not.
            const probe = document.createElement('canvas');
            const scale = 2;
            const pw = Math.ceil(W_ADV[2] * scale) + 8;
            const ph = Math.ceil(WSIZE * 1.1 * scale);
            probe.width = pw;
            probe.height = ph;
            const pen = probe.getContext('2d', { willReadFrequently: true });
            const base = WSIZE * 0.95 * scale;
            pen.font = '600 ' + WSIZE * scale + 'px ' + DISPLAY;
            pen.fillStyle = '#fff';
            pen.fillText('i', 4, base);
            const dotted = pen.getImageData(0, 0, pw, ph).data;
            pen.clearRect(0, 0, pw, ph);
            pen.fillText('ı', 4, base);
            const plain = pen.getImageData(0, 0, pw, ph).data;
            let x0 = pw;
            let x1 = -1;
            let y0 = ph;
            let y1 = -1;
            for (let y = 0; y < ph; y++) {
                for (let xx = 0; xx < pw; xx++) {
                    const k = (y * pw + xx) * 4 + 3;
                    if (dotted[k] > 128 && plain[k] < 64) {
                        x0 = Math.min(x0, xx);
                        x1 = Math.max(x1, xx);
                        y0 = Math.min(y0, y);
                        y1 = Math.max(y1, y);
                    }
                }
            }
            if (x1 > x0 && y1 > y0) {
                tittle.w = (x1 - x0 + 1) / scale;
                tittle.h = (y1 - y0 + 1) / scale;
                tittle.dx = ((x0 + x1 + 1) / 2 - 4) / scale - W_ADV[2] / 2;
                tittle.top = (base - y0) / scale;
            }
        }
        const wordXs = [0, 0, 0, 0, 0, 0];
        const layoutWord = (gaps) => {
            let total = 0;
            for (let i = 0; i < 5; i++) {
                total += gaps[i];
            }
            const start = 960 - (wordW + total) / 2;
            let acc = 0;
            for (let j = 0; j < 6; j++) {
                wordXs[j] = start + W_LEFT[j] + acc + W_ADV[j] / 2;
                if (j < 5) {
                    acc += gaps[j];
                }
            }
            return wordXs;
        };
        // The small pieces of the product that sit in the gaps, drawn in the letterspace take's own terms.
        const drawGapItem = (kind, x, y, scale, now) => {
            if (scale <= 0.01) {
                return;
            }
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((1 - clamp(scale)) * 0.3);
            ctx.scale(2.7 * scale, 2.7 * scale);
            ctx.lineWidth = 1;
            if (kind === 'caret') {
                ctx.strokeStyle = pal.termDim;
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(-9.5, -4);
                ctx.lineTo(-5.5, 0);
                ctx.lineTo(-9.5, 4);
                ctx.stroke();
                if (R.fract(now / 1.04) < 0.62) {
                    fillRound(-2, -8.5, 9, 17, 1.2, pal.termFg);
                }
            } else if (kind === 'amber' || kind === 'green') {
                const color = kind === 'amber' ? pal.needs : pal.idle;
                const pulse = R.fract(now / 2.08);
                ctx.beginPath();
                ctx.arc(0, 0, 5 + pulse * 10, 0, TAU);
                ctx.strokeStyle = R.rgba(color, 0.45 * (1 - pulse));
                ctx.lineWidth = 1.4 * (1 - pulse) + 0.4;
                ctx.stroke();
                disc(0, 0, 5, color);
            } else if (kind === 'bubble') {
                fillRound(-14, -10, 28, 18, 7, pal.hover);
                strokeRound(-14, -10, 28, 18, 7, 'rgba(255,255,255,0.13)');
                ctx.beginPath();
                ctx.moveTo(-8, 7.5);
                ctx.lineTo(-11, 12);
                ctx.lineTo(-3, 7.8);
                ctx.fillStyle = pal.hover;
                ctx.fill();
                for (let k = 0; k < 3; k++) {
                    const hop = Math.max(0, Math.sin((now * 1.923 - k * 0.16) * TAU)) * 2.2;
                    disc(-6 + k * 6, -1 - hop, 1.7, pal.muted);
                }
            } else if (kind === 'node') {
                fillRound(-15, -11, 30, 22, 3, pal.surface);
                ctx.fillStyle = pal.raised;
                ctx.fillRect(-14.5, -10.5, 29, 5);
                strokeRound(-15, -11, 30, 22, 3, 'rgba(255,255,255,0.16)');
                disc(10, -8, 1.2, pal.idle);
            } else if (kind === 'edge') {
                ctx.beginPath();
                ctx.moveTo(-12, 6);
                ctx.bezierCurveTo(-2, 6, 2, -6, 12, -6);
                ctx.strokeStyle = 'rgba(236,236,241,0.5)';
                ctx.lineWidth = 1.4;
                ctx.stroke();
                for (const [ex, ey] of [
                    [-12, 6],
                    [12, -6]
                ]) {
                    disc(ex, ey, 3, pal.surface);
                    ctx.strokeStyle = pal.text;
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
            }
            ctx.restore();
        };
        const drawWordmark = (xs, baseline, alpha, letterIn, now, items, itemScales) => {
            ctx.save();
            setFont(WSIZE, 600, DISPLAY);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            for (let j = 0; j < 6; j++) {
                const k = letterIn ? letterIn(j) : 1;
                if (k <= 0) {
                    continue;
                }
                ctx.globalAlpha = alpha * clamp(k * 1.4);
                ctx.fillStyle = pal.text;
                ctx.fillText(j === 2 ? 'ı' : WORD[j], xs[j] - W_ADV[j] / 2, baseline + (1 - E.outCubic(k)) * 26);
            }
            const k = letterIn ? letterIn(2) : 1;
            if (k > 0) {
                const drop = (1 - E.outBack(clamp(k), 2.2)) * -40;
                ctx.globalAlpha = alpha * clamp(k * 1.4);
                fillRound(xs[2] + tittle.dx - tittle.w / 2, baseline - tittle.top + drop, tittle.w, tittle.h, Math.min(tittle.w, tittle.h) * 0.18, pal.accent);
            }
            ctx.globalAlpha = alpha;
            const midY = baseline - xHeight / 2;
            for (let i = 0; i < 5; i++) {
                if (items[i]) {
                    drawGapItem(items[i], (xs[i] + xs[i + 1]) / 2, midY, itemScales[i], now);
                }
            }
            ctx.restore();
        };

        /* ---------- The intro: the wordmark opens, and the canvas is in its middle gap. ---------- */
        const W_BASE = 600;
        const T_SQ = 1.05;
        const T_OPEN = 1.35;
        const T_PUSH = 3.2;
        const PUSH_DUR = 2.35;
        const INTRO_GAPS = [74, 60, 150, 72, 84];
        const INTRO_ITEMS = ['caret', 'amber', null, 'bubble', 'edge'];
        const introGaps = [0, 0, 0, 0, 0];
        const introScales = [0, 0, 0, 0, 0];
        const openDelay = (i) => Math.abs(i - 2) * 0.05;
        const introLayout = (t) => {
            for (let i = 0; i < 5; i++) {
                const squeeze = -8 * E.inOutSine(phase(t, T_SQ, 0.3));
                const start = T_OPEN + openDelay(i);
                introGaps[i] = t < start ? squeeze : -8 + (INTRO_GAPS[i] + 8) * springStep(t - start, 9.5, 0.5);
                introScales[i] = springStep(t - start - 0.14, 15, 0.38);
            }
            return layoutWord(introGaps);
        };
        const letterIn = (t) => (j) => E.outCubic(phase(t, 0.15 + Math.abs(j - 2.5) * 0.07, 0.6));

        /* ---------- The canvas world: the project on build-box. ---------- */
        const NODES = {
            sketch: { x: 0, y: 0, w: 560, h: 400 },
            brief: { x: 0, y: 450, w: 560, h: 200 },
            lead: { x: 720, y: 50, w: 460, h: 560 }
        };
        const SKETCH_CENTER = { x: 280, y: 200 };
        const CHILDREN = [
            {
                title: 'Line-up page',
                task: 'Build /lineup from the sketch',
                branch: 'ruimte/line-up',
                steps: ['Read the sketch and the brief', 'Build the stage columns', 'Add the day filter'],
                done: [16.0, 20.7, 29.0],
                finish: 29.7,
                spawn: 14.75,
                rect: { x: 1330, y: -215, w: 440, h: 330 }
            },
            {
                title: 'Ticket shop',
                task: 'Build /tickets with a checkout',
                branch: 'ruimte/ticket-shop',
                steps: ['Read the sketch and the brief', 'Price the tickets', 'Wire up the checkout'],
                done: [16.4, 22.3, 31.2],
                finish: 36.0,
                spawn: 14.9,
                rect: { x: 1330, y: 145, w: 440, h: 330 }
            },
            {
                title: 'Festival map',
                task: 'Draw /map with both stages',
                branch: 'ruimte/festival-map',
                steps: ['Read the sketch and the brief', 'Place Veld and Bos', 'Add the walking routes'],
                done: [16.2, 24.4, 37.0],
                finish: 37.6,
                spawn: 15.05,
                rect: { x: 1330, y: 505, w: 440, h: 330 }
            }
        ];
        const EDGE_SKETCH = routePoly(NODES.sketch, NODES.lead);
        const EDGE_BRIEF = routePoly(NODES.brief, NODES.lead);
        const TASK_EDGES = CHILDREN.map((child) => routePoly(NODES.lead, child.rect));

        // Beats of the first half.
        const DRAG1 = [10.45, 11.3];
        const DRAG2 = [11.65, 12.2];
        const T_SEND = 12.6;
        const Q_ASK = 17.5;
        const Q_OPEN = 18.05;
        const Q_FOCUS = 18.95;
        const Q_KEYS = [
            { at: 19.45, key: 'down', to: 1 },
            { at: 20.05, key: 'up', to: 0 }
        ];
        const Q_ENTER = 20.6;
        const Q_PICK = 20.85;
        const Q_CLOSE = 21.3;
        const LIMIT = 28.7;
        const RESET = 30.7;
        const MAP_ASK = 32.25;
        const MAP_ALLOWED = 36.6;
        const DEPLOY_ASK = 52.35;
        const DEPLOY_ALLOW = 53.35;

        const childStatus = (index, t) => {
            const child = CHILDREN[index];
            if (t >= child.finish) {
                return 'idle';
            }
            if (index === 1 && t >= Q_ASK && t < Q_CLOSE) {
                return 'needs';
            }
            if (index === 2 && t >= LIMIT && t < RESET) {
                return 'paused';
            }
            if (index === 2 && t >= MAP_ASK && t < MAP_ALLOWED) {
                return 'needs';
            }
            return 'running';
        };
        const leadStatus = (t) => {
            if (t < T_SEND + 0.1) {
                return 'idle';
            }
            if (t < 14.5) {
                return 'running';
            }
            if (t < 38.8) {
                return 'idle';
            }
            if (t >= DEPLOY_ASK && t < DEPLOY_ALLOW + 0.1) {
                return 'needs';
            }
            if (t >= T_LIVE) {
                return 'idle';
            }
            return 'running';
        };

        /* ---------- The sketch, stroke by stroke, the way the drawing view paints it. ---------- */
        const rough = (seed, k) => R.hash(seed * 13.7 + k * 3.1) - 0.5;
        const roughRect = (x, y, wide, tall, seed) => {
            const corners = [
                [x + 2, y + 1],
                [x + wide, y],
                [x + wide + 1, y + tall],
                [x - 1, y + tall + 1],
                [x, y - 2],
                [x + 16, y - 1]
            ];
            const pts = [];
            for (let c = 0; c < corners.length - 1; c++) {
                const [ax, ay] = corners[c];
                const [bx, by] = corners[c + 1];
                const steps = c === corners.length - 2 ? 2 : 7;
                for (let k = c === 0 ? 0 : 1; k <= steps; k++) {
                    const s = k / steps;
                    const bow = Math.sin(s * PI) * rough(seed + c, 9) * 5;
                    const nx = -(by - ay);
                    const ny = bx - ax;
                    const len = Math.hypot(nx, ny) || 1;
                    pts.push(lerp(ax, bx, s) + (nx / len) * (bow + rough(seed + c, k) * 1.4), lerp(ay, by, s) + (ny / len) * (bow + rough(seed + c, k) * 1.4));
                }
            }
            return pts;
        };
        const roughLine = (x1, y1, x2, y2, seed) => {
            const pts = [];
            for (let k = 0; k <= 8; k++) {
                const s = k / 8;
                pts.push(lerp(x1, x2, s) + rough(seed, k) * 1.2, lerp(y1, y2, s) + Math.sin(s * PI) * rough(seed, 20) * 4 + rough(seed, k + 9) * 1.2);
            }
            return pts;
        };
        const roughCircle = (cx, cy, radius, seed) => {
            const pts = [];
            for (let k = 0; k <= 28; k++) {
                const angle = -PI * 0.6 + (k / 28) * TAU * 1.08;
                const wobble = 1 + rough(seed, k) * 0.08;
                pts.push(cx + Math.cos(angle) * radius * wobble, cy + Math.sin(angle) * radius * wobble);
            }
            return pts;
        };
        const squiggle = (seed) => {
            const pts = [];
            for (let k = 0; k <= 30; k++) {
                const s = k / 30;
                pts.push(lerp(392, 522, s) + Math.sin(s * PI * 2.2) * 16, lerp(322, 150, s) + rough(seed, k) * 1.5);
            }
            return pts;
        };
        const trees = (x, y) => [x - 16, y + 12, x - 8, y - 10, x, y + 12, x + 6, y + 12, x + 14, y - 14, x + 22, y + 12];
        const SKETCH_ITEMS = [
            { text: 'nachtveld', x: 26, y: 52, size: 36, weight: 700 },
            { pts: roughLine(24, 66, 200, 62, 1) },
            { pts: roughRect(26, 90, 156, 246, 2) },
            { text: 'line-up', x: 40, y: 120, size: 22 },
            { text: 'Veld', x: 40, y: 154, size: 17 },
            { pts: roughLine(40, 176, 92, 175, 3) },
            { pts: roughLine(40, 198, 84, 198, 4) },
            { pts: roughLine(40, 220, 94, 219, 5) },
            { text: 'Bos', x: 112, y: 154, size: 17 },
            { pts: roughLine(112, 176, 166, 176, 6) },
            { pts: roughLine(112, 198, 158, 197, 7) },
            { pts: roughLine(112, 220, 168, 220, 8) },
            { pts: roughRect(202, 90, 156, 246, 9) },
            { text: 'tickets', x: 216, y: 120, size: 22 },
            { pts: roughRect(216, 142, 54, 38, 10) },
            { text: 'day?', x: 223, y: 166, size: 17 },
            { pts: roughRect(278, 142, 68, 38, 11) },
            { text: 'weekend', x: 283, y: 166, size: 15 },
            { pts: roughRect(216, 284, 130, 40, 12) },
            { text: 'buy', x: 264, y: 309, size: 19 },
            { pts: roughRect(378, 90, 156, 246, 13) },
            { text: 'map', x: 392, y: 120, size: 22 },
            { pts: squiggle(14) },
            { pts: roughCircle(432, 206, 17, 15) },
            { text: 'Veld', x: 414, y: 246, size: 16 },
            { pts: trees(492, 262) },
            { text: 'Bos', x: 480, y: 300, size: 16 }
        ];
        const SKETCH_START = 5.25;
        const SKETCH_END = 9.25;
        {
            let clock = 0;
            for (const item of SKETCH_ITEMS) {
                if (item.text) {
                    main.font = (item.weight || 400) + ' ' + item.size + 'px ' + HAND;
                    item.width = main.measureText(item.text).width;
                    item.dur = 0.05 + item.text.length * 0.022;
                } else {
                    const cum = [0];
                    for (let i = 2; i < item.pts.length; i += 2) {
                        cum.push(cum[cum.length - 1] + Math.hypot(item.pts[i] - item.pts[i - 2], item.pts[i + 1] - item.pts[i - 1]));
                    }
                    item.cum = cum;
                    item.total = cum[cum.length - 1];
                    item.dur = Math.max(0.07, item.total / 2600);
                }
                item.t0 = clock;
                clock += item.dur;
                item.t1 = clock;
                clock += 0.035;
            }
            const span = SKETCH_END - SKETCH_START;
            for (const item of SKETCH_ITEMS) {
                item.t0 = SKETCH_START + (item.t0 / clock) * span;
                item.t1 = SKETCH_START + (item.t1 / clock) * span;
            }
        }
        const pen = { x: 0, y: 0, down: 0 };
        const penAt = (t) => {
            let prev = null;
            for (const item of SKETCH_ITEMS) {
                if (t < item.t0) {
                    if (prev) {
                        const from = endOf(prev);
                        const fx = from.x;
                        const fy = from.y;
                        const to = startOf(item);
                        const k = soft(phase(t, prev.t1, item.t0 - prev.t1));
                        pen.x = lerp(fx, to.x, k);
                        pen.y = lerp(fy, to.y, k) - Math.sin(k * PI) * 6;
                        pen.down = 0;
                    } else {
                        const to = startOf(item);
                        pen.x = to.x + 60;
                        pen.y = to.y + 50;
                        pen.down = 0;
                    }
                    return pen;
                }
                if (t <= item.t1) {
                    const k = (t - item.t0) / (item.t1 - item.t0);
                    if (item.text) {
                        pen.x = item.x + item.width * k;
                        pen.y = item.y - item.size * 0.25 + Math.sin(k * 40) * item.size * 0.12;
                    } else {
                        const d = item.total * k;
                        let i = 1;
                        while (i < item.cum.length - 1 && item.cum[i] < d) {
                            i++;
                        }
                        const span = item.cum[i] - item.cum[i - 1];
                        const s = span > 0 ? (d - item.cum[i - 1]) / span : 0;
                        pen.x = lerp(item.pts[i * 2 - 2], item.pts[i * 2], s);
                        pen.y = lerp(item.pts[i * 2 - 1], item.pts[i * 2 + 1], s);
                    }
                    pen.down = 1;
                    return pen;
                }
                prev = item;
            }
            const last = endOf(SKETCH_ITEMS[SKETCH_ITEMS.length - 1]);
            pen.x = last.x;
            pen.y = last.y;
            pen.down = 0;
            return pen;
        };
        const endpoint = { x: 0, y: 0 };
        const startOf = (item) => {
            if (item.text) {
                endpoint.x = item.x;
                endpoint.y = item.y - item.size * 0.25;
            } else {
                endpoint.x = item.pts[0];
                endpoint.y = item.pts[1];
            }
            return { x: endpoint.x, y: endpoint.y };
        };
        const endOf = (item) => {
            if (item.text) {
                return { x: item.x + item.width, y: item.y - item.size * 0.25 };
            }
            return { x: item.pts[item.pts.length - 2], y: item.pts[item.pts.length - 1] };
        };
        const drawSketchBody = (x, y, t) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.strokeStyle = pal.text;
            ctx.fillStyle = pal.text;
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const item of SKETCH_ITEMS) {
                if (t <= item.t0) {
                    break;
                }
                const k = clamp((t - item.t0) / (item.t1 - item.t0));
                if (item.text) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(item.x - 4, item.y - item.size * 1.2, (item.width + 8) * k, item.size * 1.6);
                    ctx.clip();
                    ctx.font = (item.weight || 400) + ' ' + item.size + 'px ' + HAND;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText(item.text, item.x, item.y);
                    ctx.restore();
                    continue;
                }
                const upto = item.total * k;
                ctx.beginPath();
                ctx.moveTo(item.pts[0], item.pts[1]);
                for (let i = 1; i < item.cum.length; i++) {
                    if (item.cum[i] <= upto) {
                        ctx.lineTo(item.pts[i * 2], item.pts[i * 2 + 1]);
                    } else {
                        const span = item.cum[i] - item.cum[i - 1];
                        const s = span > 0 ? (upto - item.cum[i - 1]) / span : 0;
                        ctx.lineTo(lerp(item.pts[i * 2 - 2], item.pts[i * 2], s), lerp(item.pts[i * 2 - 1], item.pts[i * 2 + 1], s));
                        break;
                    }
                }
                ctx.stroke();
            }
            ctx.restore();
        };

        /* ---------- A chat thread, as the chat body draws it. ---------- */
        const LEAD_ITEMS = [
            { type: 'user', at: T_SEND + 0.05, text: 'Build the site from the sketch. Split the work up.' },
            { type: 'tool', at: 13.0, tool: 'eye', word: 'Read', live: 13.35, detail: 'Site sketch' },
            { type: 'tool', at: 13.2, tool: 'eye', word: 'Read', live: 13.5, detail: 'Brief' },
            { type: 'text', at: 13.55, text: 'Three pages, three agents, each in a worktree of its own.' },
            { type: 'tool', at: 14.5, tool: 'terminal', word: 'Started', detail: '3 agents' },
            { type: 'faint', at: 15.4, until: 38.7, text: (t) => 'Waiting on ' + (t >= CHILDREN[0].finish ? 2 : 3) + ' tasks' },
            { type: 'text', at: 38.8, text: 'All three are in. Merging their worktrees into main.' },
            { type: 'tool', at: 39.3, tool: 'merge', word: 'Merged', detail: 'ruimte/line-up' },
            { type: 'tool', at: 39.4, tool: 'merge', word: 'Merged', detail: 'ruimte/festival-map' },
            { type: 'tool', at: 44.9, tool: 'merge', word: 'Merging', live: 45.9, detail: 'ruimte/ticket-shop' },
            { type: 'warn', at: 45.9, text: '1 conflict in src/tickets/prices.ts' },
            { type: 'ok', at: 51.25, glyph: 'merge', text: 'Merged 3 branches into main' },
            { type: 'text', at: 51.6, text: 'Tests pass on main. Deploying now.' },
            { type: 'tool', at: 53.75, tool: 'terminal', word: 'Ran', live: 54.2, detail: 'bun run deploy --prod' },
            { type: 'ok', at: T_LIVE, glyph: 'circleCheck', text: 'Deployed. Nachtveld is live.' }
        ];
        const itemHeight = (item, textW) => {
            if (item.type === 'user') {
                const layout = wrapWords(item.text, textW * 0.8 - 28, 14);
                return layout.count * 21 + 20;
            }
            if (item.type === 'text') {
                return wrapWords(item.text, textW, 14).count * 21;
            }
            if (item.type === 'tool') {
                return 28;
            }
            return 21;
        };
        const drawThread = (x, y, wide, tall, items, t) => {
            const pad = 16;
            const textW = wide - pad * 2;
            let total = pad;
            for (const item of items) {
                const grow = soft(phase(t, item.at, 0.32)) * (item.until ? 1 - soft(phase(t, item.until, 0.3)) : 1);
                item.grow = grow;
                if (grow > 0) {
                    total += (itemHeight(item, textW) + 12) * grow;
                }
            }
            const offset = Math.min(0, tall - total - 4);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, wide, tall);
            ctx.clip();
            let yy = y + pad + offset;
            const keep = ctx.globalAlpha;
            for (const item of items) {
                if (item.grow <= 0) {
                    continue;
                }
                const height = itemHeight(item, textW);
                const rise = (1 - item.grow) * 6;
                ctx.globalAlpha = keep * item.grow;
                if (item.type === 'user') {
                    const layout = wrapWords(item.text, textW * 0.8 - 28, 14);
                    const bw = layout.maxW + 28;
                    const bx = x + wide - pad - bw;
                    fillRound(bx, yy + rise, bw, height, 16, pal.active);
                    setFont(14);
                    ctx.fillStyle = pal.text;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    for (let i = 0; i < layout.words.length; i++) {
                        ctx.fillText(layout.words[i], bx + 14 + layout.xs[i], yy + rise + 20.5 + layout.lines[i] * 21);
                    }
                } else if (item.type === 'text') {
                    const layout = wrapWords(item.text, textW, 14);
                    const times = wordTimes(item.text, item.at, 0.075);
                    setFont(14);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = pal.text;
                    for (let i = 0; i < layout.words.length; i++) {
                        const k = E.outCubic(phase(t, times[i], 0.22));
                        if (k <= 0) {
                            continue;
                        }
                        ctx.globalAlpha = keep * item.grow * k;
                        ctx.fillText(layout.words[i], x + pad + layout.xs[i], yy + 10.5 + layout.lines[i] * 21 + (1 - k) * 4);
                    }
                } else if (item.type === 'tool') {
                    const live = item.live !== undefined && t < item.live;
                    icon(item.tool, x + pad, yy + rise + 8, 12, live ? pal.accent : pal.muted);
                    setFont(13);
                    const word = live && item.word === 'Read' ? 'Reading' : live && item.word === 'Ran' ? 'Running' : item.word;
                    const width = live ? shine(word, x + pad + 20, yy + rise + 14, 13, t) : measure(word);
                    if (!live) {
                        label(word, x + pad + 20, yy + rise + 14, 13, pal.muted);
                    }
                    label(item.detail, x + pad + 28 + width, yy + rise + 14.5, 12.5, pal.faint, 400, MONO);
                    icon('chevronRight', x + wide - pad - 12, yy + rise + 8, 12, pal.faint);
                } else if (item.type === 'faint') {
                    label(typeof item.text === 'function' ? item.text(t) : item.text, x + pad, yy + rise + 10.5, 13, pal.faint);
                } else if (item.type === 'warn') {
                    disc(x + pad + 4, yy + rise + 10.5, 3.5, pal.needs);
                    label(item.text, x + pad + 16, yy + rise + 10.5, 13, pal.muted);
                } else if (item.type === 'ok') {
                    icon(item.glyph, x + pad, yy + rise + 3.5, 14, pal.idle);
                    label(item.text, x + pad + 22, yy + rise + 10.5, 13, pal.idle);
                }
                yy += (height + 12) * item.grow;
            }
            ctx.globalAlpha = keep;
            ctx.restore();
        };
        const COMPOSER_H = 96;
        const drawComposer = (x, y, wide, draft, sent) => {
            fillRound(x, y + 2, wide, COMPOSER_H, 16, 'rgba(0,0,0,0.25)');
            fillRound(x, y, wide, COMPOSER_H, 16, R.mix(pal.raised, pal.bg, 0.08));
            strokeRound(x + 0.5, y + 0.5, wide - 1, COMPOSER_H - 1, 15.5, 'rgba(255,255,255,0.07)');
            const keep = ctx.globalAlpha;
            if (draft && sent < 1) {
                ctx.globalAlpha = keep * (1 - sent);
                label(draft, x + 18, y + 26 - sent * 10, 14, pal.text);
                ctx.globalAlpha = keep * sent;
            }
            if (!draft || sent > 0) {
                label('Ask anything', x + 18, y + 26, 14, pal.faint);
            }
            ctx.globalAlpha = keep;
            const row = y + 66;
            strokeRound(x + 14, row - 14, 28, 28, 14, 'rgba(255,255,255,0.1)');
            icon('plus', x + 21, row - 7, 14, pal.muted);
            setFont(13, 500);
            const modelW = measure('Opus 5.5');
            strokeRound(x + 50, row - 14, modelW + 44, 28, 14, 'rgba(255,255,255,0.1)');
            mark('claude', x + 60, row - 6, 12, pal.muted);
            label('Opus 5.5', x + 78, row + 0.5, 13, pal.text, 500);
            disc(x + wide - 32, row, 16, pal.accent);
            icon('arrowUp', x + wide - 40, row - 8, 16, '#ffffff');
        };

        /* ---------- The world's nodes. ---------- */
        const drawSketchNode = (t, pop, framePx) => {
            const n = NODES.sketch;
            ctx.save();
            if (pop < 1) {
                ctx.translate(n.x + n.w / 2, n.y + n.h / 2);
                ctx.scale(pop, pop);
                ctx.translate(-(n.x + n.w / 2), -(n.y + n.h / 2));
            }
            nodeFrame(n.x, n.y, n.w, n.h, 'drawing', 0);
            if (framePx < 0.9) {
                // Tiny in the wordmark's gap, a hairline in world units would vanish; keep one frame pixel.
                const keep = ctx.globalAlpha;
                ctx.globalAlpha = keep * (1 - sstep(0.5, 0.9, framePx));
                strokeRound(n.x, n.y, n.w, n.h, 11, 'rgba(255,255,255,0.22)', 1.3 / framePx);
                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.fillRect(n.x, n.y, n.w, HEADER);
                ctx.globalAlpha = keep;
            }
            nodeHeader(n.x, n.y, n.w, { kind: 'drawing', title: 'Site sketch' }, t);
            drawSketchBody(n.x, n.y + HEADER, t);
            ctx.restore();
        };
        const BRIEF_LINES = ['Nachtveld, 14 to 16 August.', 'Two stages: Veld and Bos.', 'Pages: /lineup, /tickets, /map.', 'Live before the gates open at noon.'];
        const drawBriefNode = (t) => {
            const n = NODES.brief;
            nodeFrame(n.x, n.y, n.w, n.h, 'note', 0);
            nodeHeader(n.x, n.y, n.w, { kind: 'note', title: 'Brief' }, t);
            for (let i = 0; i < BRIEF_LINES.length; i++) {
                label(BRIEF_LINES[i], n.x + 18, n.y + HEADER + 26 + i * 27, 15, pal.text);
            }
        };
        const drawLeadNode = (t, snap) => {
            const n = NODES.lead;
            nodeFrame(n.x, n.y, n.w, n.h, 'chat', snap);
            nodeHeader(n.x, n.y, n.w, { agent: 'claude', title: 'Launch the Nachtveld site', status: leadStatus(t) }, t);
            const composerY = n.y + n.h - 12 - COMPOSER_H;
            drawThread(n.x, n.y + HEADER, n.w, composerY - n.y - HEADER - 6, LEAD_ITEMS, t);
            drawComposer(n.x + 12, composerY, n.w - 24, 'Build the site from the sketch. Split the work up.', soft(phase(t, T_SEND, 0.3)));
        };
        const elapsedText = (t, since) => {
            const seconds = Math.max(0, Math.floor((minutesAt(t) - minutesAt(since)) * 60 + (t - since) * 7));
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            const mm = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
            return hours > 0 ? hours + ':' + mm : mm;
        };

        // The question card, grown out of the bottom of the Ticket shop.
        const Q_CHOICES = ['Day and weekend', 'Weekend only', 'Something else…'];
        const Q_ROW = 34;
        const Q_GAP = 6;
        const Q_CARD = 12 + 26 + 10 + 3 * Q_ROW + 2 * Q_GAP + 12 + 28 + 12;
        const focusAt = (t) => {
            let at = 0;
            for (const press of Q_KEYS) {
                at = lerp(at, press.to, soft(phase(t, press.at + 0.06, 0.34)));
            }
            return at;
        };
        const drawQuestionCard = (x, bottom, wide, t) => {
            const open = unfold(phase(t, Q_OPEN, 0.7)) * (1 - soft(phase(t, Q_CLOSE, 0.55)));
            if (open <= 0.001) {
                return;
            }
            const tall = Q_CARD * open;
            const y = bottom - tall;
            const outer = ctx.globalAlpha;
            ctx.globalAlpha = outer * sstep(0, 0.3, open);
            fillRound(x, y + 3, wide, tall, 15, 'rgba(0,0,0,0.35)');
            fillRound(x, y, wide, tall, 15, pal.raised);
            strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, 14.5, R.rgba(pal.needs, 0.25 + 0.15 * open));
            ctx.save();
            R.roundRect(ctx, x, y, wide, tall, 15);
            ctx.clip();
            const inner = t >= Q_CLOSE ? sstep(0.15, 0.6, open) : sstep(0.45, 0.85, open);
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * inner;
            const top = bottom - Q_CARD + 12;
            icon('question', x + 12, top + 4, 16, pal.needs);
            label('Sell day tickets, or weekend only?', x + 36, top + 12, 14, pal.text, 600);
            const rowsTop = top + 36;
            const rowX = x + 12;
            const rowW = wide - 24;
            const picked = t >= Q_PICK;
            for (let i = 0; i < 3; i++) {
                const rp = E.outCubic(phase(t, Q_OPEN + 0.3 + i * 0.075, 0.42));
                const ry = rowsTop + i * (Q_ROW + Q_GAP) + (1 - rp) * 8;
                ctx.globalAlpha = keep * inner * rp;
                const selected = picked && i === 0;
                fillRound(rowX, ry, rowW, Q_ROW, 8, selected ? R.mix(pal.surface, pal.accent, 0.16) : pal.hover);
                strokeRound(rowX + 0.5, ry + 0.5, rowW - 1, Q_ROW - 1, 7.5, selected ? pal.accent : 'rgba(255,255,255,0.07)');
                icon(selected ? 'circleCheck' : 'circle', rowX + 12, ry + 9, 16, selected ? pal.text : pal.muted);
                label(Q_CHOICES[i], rowX + 36, ry + 17.5, 13, i === 2 ? pal.muted : pal.text);
            }
            const focusIn = E.outCubic(phase(t, Q_FOCUS, 0.25)) * (1 - phase(t, Q_PICK, 0.2));
            if (focusIn > 0.001) {
                const focus = focusAt(t);
                const fy = rowsTop + focus * (Q_ROW + Q_GAP);
                const travel = Math.abs(focus - Math.round(focus));
                const stretch = Math.sin(PI * Math.min(1, travel * 2)) * 5;
                ctx.globalAlpha = keep * inner * focusIn;
                strokeRound(rowX - 2, fy - 2 - stretch / 2, rowW + 4, Q_ROW + 4 + stretch, 10, pal.accent, 2);
            }
            const burst = phase(t, Q_PICK, 0.55);
            if (burst > 0 && burst < 1) {
                const grow = E.outCubic(burst) * 10;
                ctx.globalAlpha = keep * inner * (1 - burst) * 0.7;
                strokeRound(rowX - grow, rowsTop - grow, rowW + grow * 2, Q_ROW + grow * 2, 8 + grow, pal.accent, 1.5);
            }
            const footY = rowsTop + 3 * Q_ROW + 2 * Q_GAP + 12;
            ctx.globalAlpha = keep * inner * E.outCubic(phase(t, Q_OPEN + 0.55, 0.4));
            let upPress = 0;
            let downPress = 0;
            for (const press of Q_KEYS) {
                const amount = keyPress(t, press.at);
                if (press.key === 'up') {
                    upPress = Math.max(upPress, amount);
                } else {
                    downPress = Math.max(downPress, amount);
                }
            }
            const enterDown = E.outQuad(phase(t, Q_ENTER, 0.09)) * (1 - E.inOutQuad(phase(t, Q_PICK - 0.04, 0.12)));
            keycap('arrowUp', rowX, footY + 4, upPress, upPress);
            keycap('arrowDown', rowX + 24, footY + 4, downPress, downPress);
            label('Move', rowX + 52, footY + 14, 12, pal.faint);
            keycap('enter', rowX + 90, footY + 4, enterDown, enterDown);
            label('Answer', rowX + 118, footY + 14, 12, pal.faint);
            setFont(13, 500);
            const answerW = measure('Answer');
            const bw = Math.round(14 + answerW + 6 + 14 + 12);
            const bs = 1 - enterDown * 0.05;
            ctx.save();
            ctx.translate(x + wide - 12 - bw / 2, footY + 14);
            ctx.scale(bs, bs);
            fillRound(-bw / 2, -14, bw, 28, 6, pal.text);
            label('Answer', -bw / 2 + 14, 0.5, 13, pal.bg, 500);
            icon('arrowUp', bw / 2 - 26, -7, 14, pal.bg);
            ctx.restore();
            ctx.globalAlpha = keep;
            ctx.restore();
            ctx.globalAlpha = outer;
        };

        const drawChild = (index, t, dim) => {
            const child = CHILDREN[index];
            const appear = phase(t, child.spawn, 0.6);
            if (appear <= 0) {
                return;
            }
            const rect = child.rect;
            const x = rect.x - (1 - E.outBack(appear, 1.2)) * 90;
            const y = rect.y;
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * clamp(appear * 2.2) * dim;
            const status = childStatus(index, t);
            nodeFrame(x, y, rect.w, rect.h, 'chat', 0);
            nodeHeader(x, y, rect.w, { agent: 'claude', title: child.title, status }, t);
            const by = y + HEADER;
            const px = x + 16;
            label(child.task, px, by + 24, 14, pal.text);
            setFont(12, 400, MONO);
            const branchW = measure(child.branch);
            fillRound(px, by + 42, branchW + 34, 24, 12, pal.sunken);
            icon('branch', px + 9, by + 48, 12, pal.muted);
            label(child.branch, px + 26, by + 54.5, 12, pal.muted, 400, MONO);
            let doneCount = 0;
            for (const at of child.done) {
                if (t >= at) {
                    doneCount++;
                }
            }
            label('Plan', px, by + 88, 12, pal.faint, 500);
            label(Math.min(3, doneCount + 1) + ' of 3', x + rect.w - 16, by + 88, 12, pal.faint, 400, SANS, 'right');
            for (let k = 0; k < 3; k++) {
                const sy = by + 112 + k * 27;
                const checked = E.outBack(phase(t, child.done[k], 0.35), 2);
                const current = k === doneCount && status !== 'idle';
                let text = child.steps[k];
                if (index === 1 && k === 1) {
                    const swap = soft(phase(t, Q_CLOSE + 0.35, 0.5));
                    if (swap > 0 && swap < 1) {
                        const base = ctx.globalAlpha;
                        ctx.globalAlpha = base * (1 - swap);
                        label(text, px + 24, sy - swap * 8, 13, pal.text);
                        ctx.globalAlpha = base;
                    }
                    if (swap > 0) {
                        text = 'Price day and weekend tickets';
                        const base = ctx.globalAlpha;
                        ctx.globalAlpha = base * swap;
                        if (current) {
                            shine(text, px + 24, sy + (1 - swap) * 8, 13, t);
                        } else {
                            label(text, px + 24, sy + (1 - swap) * 8, 13, checked > 0.5 ? pal.muted : pal.faint);
                        }
                        ctx.globalAlpha = base;
                        icon(checked > 0.01 ? 'circleCheck' : 'circle', px, sy - 7, 14, checked > 0.01 ? pal.idle : current ? pal.muted : pal.faint);
                        continue;
                    }
                }
                if (checked > 0.01) {
                    ctx.save();
                    ctx.translate(px + 7, sy);
                    ctx.scale(checked, checked);
                    icon('circleCheck', -7, -7, 14, pal.idle);
                    ctx.restore();
                } else {
                    icon('circle', px, sy - 7, 14, current ? pal.muted : pal.faint);
                }
                if (current) {
                    shine(text, px + 24, sy, 13, t + index * 0.4);
                } else {
                    label(text, px + 24, sy, 13, checked > 0.5 ? pal.muted : pal.faint);
                }
            }
            const lineY = by + 214;
            if (status === 'idle') {
                const k = phase(t, child.finish, 0.4);
                ctx.globalAlpha = keep * clamp(appear * 2.2) * dim * k;
                icon('circleCheck', px, lineY - 7, 14, pal.idle);
                label('Task done', px + 22, lineY, 13, pal.idle);
            } else if (status === 'paused' || (index === 2 && t >= RESET && t < RESET + 1.6)) {
                const resumed = t >= RESET;
                const cx = px + 12;
                const cy = lineY + 12;
                ctx.beginPath();
                ctx.arc(cx, cy, 11, 0, TAU);
                ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                ctx.lineWidth = 2;
                ctx.stroke();
                const startMin = minutesAt(LIMIT);
                const sweep = resumed ? 1 : clamp((minutesAt(t) - startMin) / (180 - startMin));
                ctx.beginPath();
                ctx.arc(cx, cy, 11, -PI / 2, -PI / 2 + TAU * sweep);
                ctx.strokeStyle = resumed ? pal.running : pal.text;
                ctx.stroke();
                disc(cx, cy, 3, resumed ? pal.running : pal.faint);
                const click = phase(t, RESET, 0.6);
                if (click > 0 && click < 1) {
                    ctx.globalAlpha = keep * dim * (1 - click) * 0.8;
                    ctx.beginPath();
                    ctx.arc(cx, cy, 11 + E.outCubic(click) * 14, 0, TAU);
                    ctx.strokeStyle = pal.running;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    ctx.globalAlpha = keep * dim;
                }
                if (resumed) {
                    shine('Picking up where it stopped', px + 34, lineY + 4, 13, t);
                } else {
                    label('Usage limit reached.', px + 34, lineY - 3, 13, pal.text);
                    label('resets 01:00', px + 34, lineY + 16, 12, pal.muted, 400, MONO);
                }
                toggle(px, lineY + 38, 1);
                label('Resume at reset', px + 34, lineY + 46, 12, pal.muted);
            } else if (status === 'needs') {
                statusDot(px + 4, lineY, 'needs', t);
                label(index === 1 ? 'Waiting for your answer' : 'Waiting for your approval', px + 18, lineY, 13, pal.muted);
            } else {
                statusDot(px + 4, lineY, 'running', t);
                const wide = shine('Working for', px + 18, lineY, 13, t + index * 0.5);
                label(elapsedText(t, child.spawn), px + 24 + wide, lineY, 13, pal.faint);
            }
            ctx.globalAlpha = keep * clamp(appear * 2.2) * dim;
            if (index === 1) {
                drawQuestionCard(x + 12, y + rect.h - 12, rect.w - 24, t);
            }
            ctx.globalAlpha = keep;
        };

        /* ---------- The world, and the canvas view that looks at it. ---------- */
        const dragPoly = (source, tipX, tipY) => buildPoly(cornersOf(source, { x: tipX, y: tipY, w: 0, h: 0 }));
        const PORT1 = { x: NODES.sketch.x + NODES.sketch.w + 9, y: NODES.sketch.y + NODES.sketch.h / 2 };
        const PORT2 = { x: NODES.brief.x + NODES.brief.w + 9, y: NODES.brief.y + NODES.brief.h / 2 };
        const LEAD_PORT = { x: NODES.lead.x - 9, y: NODES.lead.y + NODES.lead.h / 2 };
        const SEND = { x: NODES.lead.x + NODES.lead.w - 12 - 32, y: NODES.lead.y + NODES.lead.h - 12 - COMPOSER_H + 66 };
        // Where the person's pointer is on the canvas, in world units, through the first half.
        const worldCursor = { x: 0, y: 0, alpha: 0, press: 0 };
        const cursorAt = (t) => {
            const out = worldCursor;
            out.press = 0;
            if (t < SKETCH_END + 0.05) {
                const p = penAt(t);
                out.x = p.x + NODES.sketch.x;
                out.y = p.y + NODES.sketch.y + HEADER;
                out.alpha = sstep(SKETCH_START - 0.4, SKETCH_START, t);
                out.press = p.down;
                return out;
            }
            out.alpha = 1 - sstep(T_SEND + 0.5, T_SEND + 0.9, t);
            const last = endOf(SKETCH_ITEMS[SKETCH_ITEMS.length - 1]);
            const moves = [
                [SKETCH_END, last.x + NODES.sketch.x, last.y + NODES.sketch.y + HEADER],
                [DRAG1[0] - 0.12, PORT1.x, PORT1.y],
                [DRAG1[1], LEAD_PORT.x, LEAD_PORT.y],
                [DRAG2[0] - 0.12, PORT2.x, PORT2.y],
                [DRAG2[1], LEAD_PORT.x, LEAD_PORT.y + 4],
                [T_SEND - 0.05, SEND.x + 4, SEND.y + 4]
            ];
            const holds = [0.25, 0, 0.1, 0, 0.1];
            for (let i = 1; i < moves.length; i++) {
                if (t <= moves[i][0] || i === moves.length - 1) {
                    const start = moves[i - 1][0] + holds[i - 1];
                    const k = soft(phase(t, start, moves[i][0] - start));
                    out.x = lerp(moves[i - 1][1], moves[i][1], k);
                    out.y = lerp(moves[i - 1][2], moves[i][2], k) - Math.sin(k * PI) * (i === 2 || i === 4 ? 40 : 10);
                    out.press = (t >= DRAG1[0] && t < DRAG1[1]) || (t >= DRAG2[0] && t < DRAG2[1]) ? 1 : Math.sin(PI * phase(t, T_SEND - 0.05, 0.2));
                    return out;
                }
            }
            return out;
        };

        const drawPackets = (poly, start, t) => {
            for (let k = 0; k < 6; k++) {
                const s = phase(t, start + k * 0.1, 0.75);
                if (s <= 0 || s >= 1) {
                    continue;
                }
                const p = pointAt(poly, poly.total * E.inOutSine(s));
                const keep = ctx.globalAlpha;
                ctx.globalAlpha = keep * Math.sin(s * PI);
                fillRound(p.x - 7 - (k % 3) * 2, p.y - 3, 14 + (k % 3) * 4, 6, 3, R.mix(pal.accent, '#ffffff', 0.45));
                ctx.globalAlpha = keep;
            }
        };

        const dots = (x0, y0, x1, y1, framePitch, alpha) => {
            const vis = alpha * sstep(9, 18, framePitch);
            if (vis <= 0.01) {
                return;
            }
            const pitch = 24;
            const worldPerPx = pitch / framePitch;
            const size = 1.6 * worldPerPx;
            ctx.fillStyle = `rgba(255,255,255,${(0.075 * vis).toFixed(4)})`;
            const startX = Math.floor(x0 / pitch) * pitch;
            const startY = Math.floor(y0 / pitch) * pitch;
            for (let y = startY; y <= y1; y += pitch) {
                for (let x = startX; x <= x1; x += pitch) {
                    ctx.fillRect(x - size / 2, y - size / 2, size, size);
                }
            }
        };

        // opts: { others: alpha of every node but the sketch, pop: the sketch's own pop-in, focus: 0..1 on the Ticket shop }
        const drawWorld = (t, opts, framePx) => {
            const keep = ctx.globalAlpha;
            const others = opts.others;
            const dimOthers = 1 - 0.55 * opts.focus;
            /* Edges. */
            ctx.globalAlpha = keep * others * dimOthers;
            if (t >= DRAG1[1]) {
                drawEdge(EDGE_SKETCH, 1, EDGE_CONTEXT, 2, false);
            }
            if (t >= DRAG2[1]) {
                drawEdge(EDGE_BRIEF, 1, EDGE_CONTEXT, 2, false);
            }
            for (let i = 0; i < 3; i++) {
                const child = CHILDREN[i];
                const grow = soft(phase(t, child.spawn + 0.12, 0.5));
                const done = t >= child.finish;
                drawEdge(TASK_EDGES[i], grow, EDGE_CONTEXT, 2, !done);
            }
            /* Nodes. */
            ctx.globalAlpha = keep * dimOthers;
            drawSketchNode(t, opts.pop, framePx);
            if (others > 0.001) {
                ctx.globalAlpha = keep * others * dimOthers;
                drawBriefNode(t);
                const snap = Math.max(Math.sin(PI * phase(t, DRAG1[1], 0.6)), Math.sin(PI * phase(t, DRAG2[1], 0.6)));
                const aim = (t > DRAG1[1] - 0.25 && t < DRAG1[1]) || (t > DRAG2[1] - 0.25 && t < DRAG2[1]) ? 0.6 : 0;
                drawLeadNode(t, Math.max(snap, aim));
                drawChild(0, t, 1);
                drawChild(2, t, 1);
                ctx.globalAlpha = keep * others;
                drawChild(1, t, 1);
            }
            ctx.globalAlpha = keep;
            /* The line a person is drawing, above the nodes. */
            if (t >= DRAG1[0] && t < DRAG1[1]) {
                const c = cursorAt(t);
                drawEdge(dragPoly({ x: PORT1.x - 9, y: PORT1.y, w: 0, h: 0 }, c.x, c.y), 1, pal.accent, 2, false, false);
            }
            if (t >= DRAG2[0] && t < DRAG2[1]) {
                const c = cursorAt(t);
                drawEdge(dragPoly({ x: PORT2.x - 9, y: PORT2.y, w: 0, h: 0 }, c.x, c.y), 1, pal.accent, 2, false, false);
            }
            // The handle a line starts from.
            for (const [port, at] of [
                [PORT1, DRAG1[0]],
                [PORT2, DRAG2[0]]
            ]) {
                const show = sstep(at - 0.45, at - 0.2, t) * (1 - sstep(at + 0.1, at + 0.3, t));
                if (show > 0.01) {
                    ctx.globalAlpha = keep * show;
                    disc(port.x - 9, port.y, 6, pal.surface);
                    ctx.strokeStyle = pal.accent;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.globalAlpha = keep;
                }
            }
            drawPackets(EDGE_SKETCH, DRAG1[1] + 0.05, t);
            drawPackets(EDGE_BRIEF, DRAG2[1] + 0.05, t);
            if (t < 13.6 && t > SKETCH_START - 0.5) {
                const c = cursorAt(t);
                const scale = 1.3 / framePx;
                clickRing(c.x, c.y, t - (T_SEND - 0.05), scale);
                cursor(c.x, c.y, scale, c.alpha, c.press * 0.6);
            }
        };

        const canvasView = (vx, vy, vw, vh, camX, camY, zoom, t, outerScale, opts) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(vx, vy, vw, vh);
            ctx.clip();
            ctx.fillStyle = pal.bg;
            ctx.fillRect(vx, vy, vw, vh);
            ctx.translate(vx + vw / 2, vy + vh / 2);
            ctx.scale(zoom, zoom);
            ctx.translate(-camX, -camY);
            const halfW = vw / 2 / zoom;
            const halfH = vh / 2 / zoom;
            const framePx = zoom * outerScale;
            dots(camX - halfW, camY - halfH, camX + halfW, camY + halfH, 24 * framePx, opts.dots === undefined ? 1 : opts.dots);
            drawWorld(t, opts, framePx);
            ctx.restore();
        };

        /* ---------- The app window around it: sidebar, toolbar, dock, grid. ---------- */
        const AW = 1600;
        const AH = 900;
        const SIDE = 248;
        const TOP = 48;
        const MAIN = { x: SIDE, y: TOP, w: AW - SIDE, h: AH - TOP };
        const MAIN_CX = MAIN.x + MAIN.w / 2;
        const MAIN_CY = MAIN.y + MAIN.h / 2;
        const S0 = 1920 / MAIN.w;

        const needsRow = (t) => {
            if (t >= Q_ASK && t < Q_CLOSE) {
                return { name: 'Ticket shop', at: Q_ASK, until: Q_CLOSE };
            }
            if (t >= MAP_ASK && t < MAP_ALLOWED) {
                return { name: 'Festival map', at: MAP_ASK, until: MAP_ALLOWED };
            }
            if (t >= DEPLOY_ASK && t < DEPLOY_ALLOW + 0.2) {
                return { name: 'Launch the Nachtveld site', at: DEPLOY_ASK, until: DEPLOY_ALLOW + 0.2 };
            }
            return null;
        };
        const sidebarRow = (y, glyph, name, opts, t) => {
            if (opts.selected) {
                fillRound(8, y, SIDE - 16, 32, 6, pal.active);
            }
            const x = opts.nested ? 24 : 16;
            if (glyph === 'claude' || glyph === 'codex') {
                mark(glyph, x + 1, y + 9, 14, pal.muted);
            } else {
                icon(glyph, x + 1, y + 9, 14, pal.muted);
            }
            label(name, x + 24, y + 16.5, 14, opts.selected || opts.beside ? pal.text : pal.muted, opts.nested ? 400 : 500);
            if (opts.status) {
                statusDot(SIDE - 24, y + 16, opts.status, t);
            }
            if (opts.done) {
                icon('circleCheck', SIDE - 30, y + 10, 12, pal.idle);
            }
        };
        const drawSidebar = (t, grid) => {
            ctx.fillStyle = pal.surface;
            ctx.fillRect(0, 0, SIDE, AH);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(SIDE - 1, 0, 1, AH);
            disc(23, 24, 6, '#ff5f57');
            disc(43, 24, 6, '#febc2e');
            disc(63, 24, 6, '#28c840');
            label('Ruimte', 92, 24.5, 13, pal.faint, 600, DISPLAY);
            icon('panel', SIDE - 32, 16, 16, pal.muted);
            let y = 56;
            const waiting = needsRow(t);
            if (waiting) {
                const open = soft(phase(t, waiting.at, 0.35)) * (1 - soft(phase(t, waiting.until, 0.35)));
                const keep = ctx.globalAlpha;
                ctx.globalAlpha = keep * open;
                statusDot(24, y + 12, 'needs', t);
                label('Needs you', 36, y + 12.5, 13, pal.faint, 500);
                label('1', SIDE - 18, y + 12.5, 13, pal.faint, 500, SANS, 'right');
                sidebarRow(y + 26, 'claude', waiting.name, { status: 'needs' }, t);
                ctx.globalAlpha = keep;
                y += 72 * open;
            }
            const morning = t > 38;
            sidebarRow(y, 'canvas', 'nachtveld-web', { selected: !grid || grid < 0.5, beside: grid >= 0.5 }, t);
            y += 33;
            const rows = [
                ['drawing', 'Site sketch', null],
                ['note', 'Brief', null],
                ['claude', 'Launch the Nachtveld site', leadStatus(t)],
                ['claude', 'Line-up page', t >= CHILDREN[0].spawn ? childStatus(0, t) : null],
                ['claude', 'Ticket shop', t >= CHILDREN[1].spawn ? childStatus(1, t) : null],
                ['claude', 'Festival map', t >= CHILDREN[2].spawn ? childStatus(2, t) : null]
            ];
            for (const [glyph, name, status] of rows) {
                const done = status === 'idle' && name !== 'Launch the Nachtveld site';
                sidebarRow(y, glyph, name, { nested: true, status: done ? null : status === 'idle' ? null : status, done, beside: grid >= 0.5 && name === 'Launch the Nachtveld site' }, t);
                y += 33;
            }
            ctx.fillStyle = 'rgba(255,255,255,0.03)';
            ctx.fillRect(0, y + 11, SIDE, 1);
            y += 24;
            sidebarRow(y, 'browser', 'Nachtveld preview', { beside: grid >= 0.5 }, t);
            y += 33;
            sidebarRow(y, 'codex', 'tests', { beside: grid >= 0.5, status: morning && t < 46.4 ? 'running' : null }, t);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(0, AH - 49, SIDE, 1);
            icon('plus', 18, AH - 32, 14, pal.muted);
            label('View', 40, AH - 24.5, 14, pal.muted);
            disc(SIDE - 88, AH - 25, 4, pal.idle);
            icon('chart', SIDE - 68, AH - 33, 16, pal.muted);
            icon('settings', SIDE - 36, AH - 33, 16, pal.muted);
        };
        const drawToolbar = () => {
            ctx.fillStyle = pal.surface;
            ctx.fillRect(SIDE, 0, AW - SIDE, TOP);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(SIDE, TOP - 1, AW - SIDE, 1);
            let x = SIDE + 16;
            icon('server', x, 17, 14, pal.muted);
            x += 22;
            label('build-box', x, 24.5, 13, pal.muted);
            setFont(13);
            x += measure('build-box') + 12;
            fillRound(x, 16, 16, 16, 4, R.rgba('#f54900', 0.2));
            label('N', x + 8, 24.5, 12, '#f54900', 600, SANS, 'center');
            x += 24;
            label('nachtveld-web', x, 24.5, 14, pal.text, 500);
            setFont(14, 500);
            icon('chevronDown', x + measure('nachtveld-web') + 8, 17, 14, pal.muted);
            const right = AW - 16;
            icon('search', right - 16, 16, 16, pal.muted);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(right - 34, 16, 1, 16);
            icon('devices', right - 66, 16, 16, pal.muted);
            icon('branch', right - 98, 16, 16, pal.muted);
            icon('folder', right - 130, 16, 16, pal.muted);
            ctx.fillRect(right - 146, 16, 1, 16);
        };
        const drawDock = (t, alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * alpha;
            let working = leadStatus(t) === 'running' ? 1 : 0;
            let waiting = leadStatus(t) === 'needs' ? 1 : 0;
            let finished = 0;
            for (let i = 0; i < 3; i++) {
                if (t < CHILDREN[i].spawn) {
                    continue;
                }
                const status = childStatus(i, t);
                working += status === 'running' ? 1 : 0;
                waiting += status === 'needs' ? 1 : 0;
                finished += status === 'idle' ? 1 : 0;
            }
            const wide = 430;
            const x = MAIN_CX - wide / 2;
            const y = AH - 16 - 42;
            fillRound(x, y + 2, wide, 42, 12, 'rgba(0,0,0,0.3)');
            fillRound(x, y, wide, 42, 12, R.mix(pal.raised, pal.bg, 0.1, 0.94));
            strokeRound(x + 0.5, y + 0.5, wide - 1, 41, 11.5, 'rgba(255,255,255,0.07)');
            let cx = x + 16;
            if (waiting > 0) {
                statusDot(cx + 4, y + 21, 'needs', t);
                label(String(waiting), cx + 14, y + 21.5, 13, pal.text, 500);
                cx += 36;
            }
            statusDot(cx + 4, y + 21, 'running', t);
            label(String(working), cx + 14, y + 21.5, 13, pal.muted, 500);
            cx += 36;
            icon('circleCheck', cx, y + 15, 12, pal.idle);
            label(String(finished), cx + 18, y + 21.5, 13, pal.muted, 500);
            cx += 40;
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(cx, y + 13, 1, 16);
            icon('plus', cx + 12, y + 13, 16, pal.muted);
            ctx.fillRect(cx + 40, y + 13, 1, 16);
            icon('minus', cx + 52, y + 13, 16, pal.muted);
            label('64%', cx + 98, y + 21.5, 13, pal.muted, 400, SANS, 'center');
            icon('plus', cx + 126, y + 13, 16, pal.muted);
            icon('fit', cx + 156, y + 13, 16, pal.muted);
            ctx.fillRect(cx + 184, y + 13, 1, 16);
            icon('lockOpen', cx + 196, y + 13, 16, pal.muted);
            ctx.globalAlpha = keep;
        };

        /* The grid of views, two by two, each cell under its own toolbar. */
        const CELL_W = MAIN.w / 2;
        const CELL_H = MAIN.h / 2;
        const CELLS = [
            { x: MAIN.x, y: MAIN.y, glyph: 'canvas', name: 'nachtveld-web', row: 0 },
            { x: MAIN.x + CELL_W, y: MAIN.y, glyph: 'browser', name: 'Nachtveld preview', row: 7 },
            { x: MAIN.x, y: MAIN.y + CELL_H, glyph: 'codex', name: 'tests', row: 8 },
            { x: MAIN.x + CELL_W, y: MAIN.y + CELL_H, glyph: 'claude', name: 'Launch the Nachtveld site', row: 3 }
        ];
        const GRID_AT = 43.0;
        const cellRect = { x: 0, y: 0, w: 0, h: 0 };
        const cellAt = (index, t) => {
            const cell = CELLS[index];
            if (index === 0) {
                const k = springStep(t - GRID_AT, 11, 0.72);
                cellRect.x = MAIN.x;
                cellRect.y = MAIN.y;
                cellRect.w = lerp(MAIN.w, CELL_W, k);
                cellRect.h = lerp(MAIN.h, CELL_H, k);
                return cellRect;
            }
            const k = springStep(t - GRID_AT - 0.1 - index * 0.1, 10, 0.68);
            const rowY = cell.row <= 6 ? 56 + 33 * cell.row : 56 + 33 * cell.row + 24;
            cellRect.x = lerp(8, cell.x, k);
            cellRect.y = lerp(rowY, cell.y, k);
            cellRect.w = lerp(SIDE - 16, CELL_W, k);
            cellRect.h = lerp(32, CELL_H, k);
            return cellRect;
        };
        const cellToolbar = (x, y, wide, cell, focused, alpha) => {
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * alpha;
            ctx.fillStyle = focused ? pal.surface : '#0e0e10';
            ctx.fillRect(x, y, wide, 40);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + 39, wide, 1);
            if (cell.glyph === 'claude' || cell.glyph === 'codex') {
                mark(cell.glyph, x + 12, y + 13, 14, pal.muted);
            } else {
                icon(cell.glyph, x + 12, y + 13, 14, pal.muted);
            }
            label(cell.name, x + 34, y + 20.5, 13, focused ? pal.text : pal.muted, 500);
            icon('close', x + wide - 26, y + 13, 14, pal.muted);
            ctx.globalAlpha = keep;
        };

        const LINEUP = [
            ['Veld', [['19:30', 'Mira Holt'], ['21:00', 'The Low Tides'], ['22:30', 'Sanne Vos'], ['00:00', 'Glasshouse']]],
            ['Bos', [['20:00', 'Oak and Ember'], ['21:30', 'Lotte Kramer'], ['23:00', 'Night Swim'], ['00:30', 'Field Notes']]]
        ];
        const drawBrowser = (x, y, wide, tall, t) => {
            ctx.fillStyle = pal.raised;
            ctx.fillRect(x, y, wide, 40);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + 39, wide, 1);
            icon('arrowLeft', x + 12, y + 12, 16, pal.muted);
            icon('arrowRight', x + 40, y + 12, 16, pal.faint);
            icon('reload', x + 68, y + 12, 16, pal.muted);
            fillRound(x + 96, y + 7, wide - 108, 26, 7, pal.sunken);
            icon('browser', x + 106, y + 13, 14, pal.muted);
            setFont(13);
            label('localhost:3000', x + 128, y + 20.5, 13, pal.text);
            label('/lineup', x + 128 + measure('localhost:3000'), y + 20.5, 13, pal.muted);
            const load = phase(t, 43.9, 0.8);
            if (load > 0 && load < 1) {
                ctx.fillStyle = R.rgba(pal.accent, 0.18);
                ctx.fillRect(x, y + 38, wide, 2);
                ctx.fillStyle = pal.accent;
                ctx.fillRect(x, y + 38, wide * E.outCubic(load), 2);
            }
            const px = x;
            const py = y + 40;
            const ph = tall - 40;
            ctx.save();
            ctx.beginPath();
            ctx.rect(px, py, wide, ph);
            ctx.clip();
            ctx.fillStyle = '#111114';
            ctx.fillRect(px, py, wide, ph);
            const built = (at) => E.outCubic(phase(t, 44.1 + at, 0.4));
            const keep = ctx.globalAlpha;
            const ink = '#16161a';
            ctx.globalAlpha = keep * built(0);
            ctx.fillStyle = '#f2eee6';
            ctx.fillRect(px, py, wide, ph);
            label('NACHTVELD', px + 28, py + 30, 16, ink, 700, DISPLAY);
            label('Line-up', px + wide - 190, py + 30, 13, ink, 600, DISPLAY);
            ctx.fillStyle = ink;
            ctx.fillRect(px + wide - 190, py + 40, 46, 2);
            label('Tickets', px + wide - 130, py + 30, 13, '#6b6a66', 500, DISPLAY);
            label('Map', px + wide - 68, py + 30, 13, '#6b6a66', 500, DISPLAY);
            ctx.globalAlpha = keep * built(0.1);
            label('14 to 16 August, Veld and Bos', px + 28, py + 70, 13, '#6b6a66', 400, DISPLAY);
            label('Line-up', px + 28, py + 102, 32, ink, 700, DISPLAY);
            ctx.globalAlpha = keep * built(0.2);
            const days = ['Fri', 'Sat', 'Sun'];
            for (let i = 0; i < 3; i++) {
                const cx = px + wide - 190 + i * 56;
                fillRound(cx, py + 88, 48, 28, 14, i === 0 ? ink : 'rgba(22,22,26,0.07)');
                label(days[i], cx + 24, py + 102.5, 13, i === 0 ? '#f2eee6' : ink, 500, DISPLAY, 'center');
            }
            for (let c = 0; c < 2; c++) {
                const [stage, acts] = LINEUP[c];
                const cx = px + 28 + c * ((wide - 56) / 2 + 8);
                const cw = (wide - 56) / 2 - 8;
                ctx.globalAlpha = keep * built(0.3 + c * 0.08);
                label(stage, cx, py + 148, 15, ink, 600, DISPLAY);
                ctx.fillStyle = 'rgba(22,22,26,0.14)';
                ctx.fillRect(cx, py + 162, cw, 1);
                for (let i = 0; i < acts.length; i++) {
                    ctx.globalAlpha = keep * built(0.38 + c * 0.08 + i * 0.06);
                    const ry = py + 186 + i * 34;
                    label(acts[i][0], cx, ry, 12, '#6b6a66', 400, MONO);
                    label(acts[i][1], cx + 56, ry, 15, ink, 500, DISPLAY);
                    ctx.fillStyle = 'rgba(22,22,26,0.07)';
                    ctx.fillRect(cx, ry + 17, cw, 1);
                }
            }
            ctx.globalAlpha = keep;
            ctx.restore();
        };

        const TEST_LINES = [
            [43.95, '› Run bun test after every merge', pal.muted],
            [44.35, '• Running bun test', pal.termFg],
            [44.75, '  src/lineup.test.ts        6 pass', pal.termFg],
            [45.15, '  src/map.test.ts           5 pass', pal.termFg],
            [45.6, '  src/tickets.test.ts       9 pass', pal.termFg],
            [46.4, '  20 pass  0 fail', pal.green]
        ];
        const drawTests = (x, y, wide, tall, t) => {
            ctx.fillStyle = pal.termBg;
            ctx.fillRect(x, y, wide, tall);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, wide, tall);
            ctx.clip();
            label('codex', x + 20, y + 26, 13, pal.termDim, 400, MONO);
            label('~/nachtveld-web  main', x + 76, y + 26, 13, pal.termDim, 400, MONO);
            const keep = ctx.globalAlpha;
            for (let i = 0; i < TEST_LINES.length; i++) {
                const [at, text, color] = TEST_LINES[i];
                const k = E.outCubic(phase(t, at, 0.25));
                if (k <= 0) {
                    continue;
                }
                ctx.globalAlpha = keep * k;
                const ly = y + 62 + i * 26;
                if (i === 1 && t < 46.4) {
                    shine('• Running bun test', x + 20, ly, 13, t, 400, MONO);
                } else {
                    label(i === 1 ? '• Ran bun test' : text, x + 20, ly, 13, color, i === 5 ? 700 : 400, MONO);
                }
                if (i >= 2 && i <= 4) {
                    icon('check', x + 20, ly - 6, 12, pal.green, 2);
                }
            }
            ctx.globalAlpha = keep;
            const promptY = y + tall - 34;
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(x + 16, promptY - 20, wide - 32, 1);
            label('›', x + 20, promptY, 14, pal.termFg, 400, MONO);
            if (R.fract(t / 1.04) < 0.6) {
                ctx.fillStyle = pal.termFg;
                ctx.fillRect(x + 36, promptY - 9, 8, 17);
            }
            ctx.restore();
        };

        // The approval, grown out of the composer of the lead's chat.
        const APPROVAL_H = 176;
        const drawApproval = (x, bottom, wide, t) => {
            const open = unfold(phase(t, DEPLOY_ASK, 0.65)) * (1 - soft(phase(t, DEPLOY_ALLOW + 0.25, 0.5)));
            if (open <= 0.001) {
                return;
            }
            const tall = lerp(COMPOSER_H, APPROVAL_H, open);
            const y = bottom - tall;
            fillRound(x, y + 3, wide, tall, 16, 'rgba(0,0,0,0.35)');
            fillRound(x, y, wide, tall, 16, pal.raised);
            strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, 15.5, R.rgba(pal.needs, 0.3 * open));
            ctx.save();
            R.roundRect(ctx, x, y, wide, tall, 16);
            ctx.clip();
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * sstep(0.4, 0.85, open);
            const top = bottom - APPROVAL_H;
            icon('hand', x + 14, top + 16, 16, pal.needs);
            label('Allow deploy to production?', x + 40, top + 22, 14, pal.text, 600);
            label('1 request waiting', x + 40, top + 42, 13, pal.muted);
            fillRound(x + 12, top + 60, wide - 24, 58, 12, pal.sunken);
            label('~/nachtveld-web', x + 26, top + 78, 13, pal.muted, 400, MONO);
            label('bun run deploy --prod', x + 26, top + 99, 13, pal.text, 400, MONO);
            const by = top + 130;
            const press = Math.sin(PI * phase(t, DEPLOY_ALLOW - 0.05, 0.22));
            const bx = x + wide - 12 - 86;
            ctx.save();
            ctx.translate(bx + 43, by + 16);
            ctx.scale(1 - press * 0.05, 1 - press * 0.05);
            const chosen = sstep(DEPLOY_ALLOW + 0.05, DEPLOY_ALLOW + 0.25, t);
            fillRound(-43, -15, 86, 30, 7, R.mix(pal.text, pal.idle, chosen));
            icon('circleCheck', -32, -8, 16, pal.bg);
            label('Allow', -10, 0.5, 13, pal.bg, 500);
            ctx.restore();
            label('Deny', bx - 40, by + 16.5, 13, pal.muted, 500, SANS, 'center');
            label('Always allow', bx - 124, by + 16.5, 13, pal.muted, 500, SANS, 'center');
            ctx.globalAlpha = keep;
            ctx.restore();
        };
        const ALLOW_BTN = { x: 0, y: 0 };
        const drawChatView = (x, y, wide, tall, t) => {
            ctx.fillStyle = pal.surface;
            ctx.fillRect(x, y, wide, tall);
            const composerY = y + tall - 12 - COMPOSER_H;
            drawThread(x + 40, y, wide - 80, composerY - y - 6 - (t >= DEPLOY_ASK && t < DEPLOY_ALLOW + 0.6 ? APPROVAL_H - COMPOSER_H : 0) * soft(phase(t, DEPLOY_ASK, 0.5)) * (1 - soft(phase(t, DEPLOY_ALLOW + 0.25, 0.5))), LEAD_ITEMS, t);
            drawComposer(x + 52, composerY, wide - 104, null, 1);
            drawApproval(x + 52, composerY + COMPOSER_H, wide - 104, t);
            ALLOW_BTN.x = x + wide - 52 - 12 - 43;
            ALLOW_BTN.y = composerY + COMPOSER_H - APPROVAL_H + 146;
        };

        /* The merge overlay: three versions side by side, and the result. */
        const MERGE_AT = 47.35;
        const MERGE_ACCEPT = 49.45;
        const MERGE_FINISH = 50.5;
        const MERGE_CLOSE = 50.75;
        const DLG = { x: MAIN_CX - 520, y: MAIN_CY - 272, w: 1040, h: 544 };
        const KEYWORDS = new Set(['const', 'export', 'import', 'from', 'true']);
        const tokenize = (text) => {
            const out = [];
            const re = /('[^']*'|\d+|[A-Za-z_]+|\s+|.)/g;
            let match;
            let col = 0;
            while ((match = re.exec(text))) {
                const part = match[0];
                let color = pal.termFg;
                if (part[0] === "'") {
                    color = pal.green;
                } else if (/^\d/.test(part)) {
                    color = pal.yellow;
                } else if (KEYWORDS.has(part)) {
                    color = pal.magenta;
                } else if (/^[A-Za-z_]/.test(part) && text[re.lastIndex] === '(') {
                    color = pal.blue;
                } else if (/^[{}()=>;,.?[\]:]+$/.test(part)) {
                    color = '#8b8b96';
                }
                if (part.trim()) {
                    out.push({ part, col, color });
                }
                col += part.length;
            }
            return out;
        };
        const BASE_CODE = ["import { eur } from './money';", '', 'export const TICKETS = [', "  { id: 'weekend', price: eur(179) },", '];', 'export const ON_SALE = true;'];
        const OURS = BASE_CODE.map((line, i) => (i === 3 ? "  { id: 'weekend', price: eur(189) }," : line));
        const THEIRS = ["import { eur } from './money';", '', 'export const TICKETS = [', "  { id: 'day', price: eur(79) },", "  { id: 'weekend', price: eur(179) },", '];', 'export const ON_SALE = true;'];
        const RESULT = ["import { eur } from './money';", '', 'export const TICKETS = [', "  { id: 'day', price: eur(79) },", "  { id: 'weekend', price: eur(189) },", '];', 'export const ON_SALE = true;'];
        const TOK = { ours: OURS.map(tokenize), base: BASE_CODE.map(tokenize), theirs: THEIRS.map(tokenize), result: RESULT.map(tokenize) };
        const codeLine = (tokens, x, y, alpha) => {
            setFont(12.5, 400, MONO);
            const charW = measure('0');
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * alpha;
            for (const token of tokens) {
                ctx.fillStyle = token.color;
                ctx.fillText(token.part, x + token.col * charW, y);
            }
            ctx.globalAlpha = keep;
        };
        const ACCEPT_BTN = { x: 0, y: 0 };
        const FINISH_BTN = { x: 0, y: 0 };
        const drawMerge = (t) => {
            const open = unfold(phase(t, MERGE_AT, 0.6)) * (1 - soft(phase(t, MERGE_CLOSE, 0.45)));
            if (open <= 0.001) {
                return;
            }
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * open * 0.6;
            ctx.fillStyle = '#000000';
            ctx.fillRect(MAIN.x, MAIN.y, MAIN.w, MAIN.h);
            ctx.globalAlpha = keep * open;
            ctx.save();
            const scale = lerp(0.96, 1, open);
            ctx.translate(DLG.x + DLG.w / 2, DLG.y + DLG.h / 2 + (1 - open) * 12);
            ctx.scale(scale, scale);
            ctx.translate(-DLG.x - DLG.w / 2, -DLG.y - DLG.h / 2);
            const { x, y, w, h } = DLG;
            fillRound(x, y + 6, w, h, 14, 'rgba(0,0,0,0.45)');
            fillRound(x, y, w, h, 14, pal.surface);
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, 13.5, 'rgba(255,255,255,0.1)');
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + 48, w, 1);
            icon('merge', x + 18, y + 16, 16, pal.muted);
            label('Resolve conflicts', x + 44, y + 24.5, 15, pal.text, 600);
            setFont(15, 600);
            label('src/tickets/prices.ts', x + 56 + measure('Resolve conflicts'), y + 25, 13, pal.faint, 400, MONO);
            const accepted = sstep(MERGE_ACCEPT + 0.05, MERGE_ACCEPT + 0.3, t);
            const counter = accepted > 0.5 ? 'All resolved' : '1 conflict left';
            label(counter, x + w - 18, y + 24.5, 13, pal.muted, 400, SANS, 'right');
            setFont(13);
            disc(x + w - 30 - measure(counter), y + 24.5, 4, accepted > 0.5 ? pal.idle : pal.needs);
            const colW = (w - 36 - 24) / 3;
            const colY = y + 66;
            const lh = 21;
            const colH = 30 + 7 * lh + 10;
            const cols = [
                ['ours', 'main', TOK.ours, [3]],
                ['base', '', TOK.base, [3]],
                ['theirs', 'ruimte/ticket-shop', TOK.theirs, [3, 4]]
            ];
            for (let c = 0; c < 3; c++) {
                const cx = x + 18 + c * (colW + 12);
                const [name, branch, tokens, hot] = cols[c];
                fillRound(cx, colY, colW, colH, 9, pal.sunken);
                strokeRound(cx + 0.5, colY + 0.5, colW - 1, colH - 1, 8.5, 'rgba(255,255,255,0.07)');
                ctx.fillStyle = 'rgba(255,255,255,0.07)';
                ctx.fillRect(cx, colY + 30, colW, 1);
                label(name, cx + 12, colY + 15.5, 12, pal.muted, 500);
                if (branch) {
                    setFont(12, 500);
                    label(branch, cx + 20 + measure(name), colY + 16, 12, pal.faint, 400, MONO);
                }
                for (let i = 0; i < tokens.length; i++) {
                    const ly = colY + 30 + 8 + i * lh + lh / 2;
                    if (hot.includes(i)) {
                        ctx.fillStyle = c === 1 ? 'rgba(255,255,255,0.04)' : R.rgba(c === 0 ? pal.accent : pal.magenta, 0.12);
                        ctx.fillRect(cx + 1, ly - lh / 2, colW - 2, lh);
                        ctx.fillStyle = c === 0 ? pal.running : c === 2 ? pal.magenta : pal.faint;
                        ctx.fillRect(cx + 1, ly - lh / 2, 2, lh);
                    }
                    codeLine(tokens[i], cx + 12, ly, 1);
                }
            }
            const resY = colY + colH + 16;
            const resH = 34 + 7 * lh + 12;
            fillRound(x + 18, resY, w - 36, resH, 9, pal.sunken);
            strokeRound(x + 18.5, resY + 0.5, w - 37, resH - 1, 8.5, 'rgba(255,255,255,0.07)');
            label('result', x + 30, resY + 17, 12, pal.muted, 500);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x + 18, resY + 32, w - 36, 1);
            const propose = E.outCubic(phase(t, MERGE_AT + 0.75, 0.55));
            for (let i = 0; i < 7; i++) {
                const ly = resY + 32 + 8 + i * lh + lh / 2;
                label(String(i + 1), x + 46, ly, 12, pal.faint, 400, MONO, 'right');
                if (i === 3 || i === 4) {
                    const settled = accepted;
                    ctx.fillStyle = settled > 0 ? R.rgba(pal.idle, 0.07 * settled) : R.rgba(pal.needs, 0.06);
                    ctx.fillRect(x + 19, ly - lh / 2, w - 38, lh);
                    ctx.fillStyle = R.mix(pal.needs, pal.idle, settled);
                    ctx.fillRect(x + 19, ly - lh / 2, 2, lh);
                    if (propose < 0.02 && i === 3) {
                        label('Conflict 1, unresolved', x + 62, ly + lh / 2, 12.5, pal.needs);
                    }
                    codeLine(TOK.result[i], x + 62 + (1 - propose) * 26, ly, propose * lerp(0.55, 1, settled));
                } else {
                    codeLine(TOK.result[i], x + 62, ly, 1);
                }
            }
            const chipY = resY + 32 + 8 + 3 * lh;
            const bx = x + w - 36 - 90;
            ACCEPT_BTN.x = bx + 45;
            ACCEPT_BTN.y = chipY + lh;
            ctx.globalAlpha = keep * open * propose * (1 - accepted);
            mark('claude', bx - 196, chipY + lh - 7, 14, pal.muted);
            label('Proposed by Ticket shop', bx - 176, chipY + lh + 0.5, 12, pal.muted);
            const pressA = Math.sin(PI * phase(t, MERGE_ACCEPT - 0.05, 0.22));
            fillRound(bx + pressA * 2, chipY + lh - 14 + pressA, 90 - pressA * 4, 28, 7, pal.text);
            icon('check', bx + 14, chipY + lh - 7, 14, pal.bg, 2);
            label('Accept', bx + 34, chipY + lh + 0.5, 13, pal.bg, 500);
            ctx.globalAlpha = keep * open;
            const footY = y + h - 50;
            label('Abort merge', x + w - 190, footY + 16, 13, pal.muted, 500, SANS, 'right');
            const pressF = Math.sin(PI * phase(t, MERGE_FINISH - 0.05, 0.22));
            const ready = accepted;
            ctx.globalAlpha = keep * open * lerp(0.35, 1, ready);
            fillRound(x + w - 172 + pressF * 2, footY + pressF, 154 - pressF * 4, 32, 7, pal.text);
            icon('merge', x + w - 156, footY + 8, 16, pal.bg);
            label('Finish merge', x + w - 132, footY + 16.5, 13, pal.bg, 500);
            FINISH_BTN.x = x + w - 95;
            FINISH_BTN.y = footY + 16;
            ctx.restore();
            ctx.globalAlpha = keep;
        };

        const drawApp = (t, st) => {
            ctx.save();
            R.roundRect(ctx, 0, 0, AW, AH, 12);
            ctx.clip();
            ctx.fillStyle = pal.bg;
            ctx.fillRect(0, 0, AW, AH);
            const grid = t >= GRID_AT ? 1 : 0;
            if (!grid) {
                canvasView(MAIN.x, MAIN.y, MAIN.w, MAIN.h, st.camX, st.camY, st.zoom, t, st.S, st.world);
                drawDock(t, st.dock);
            } else {
                const toolbarIn = sstep(GRID_AT + 0.1, GRID_AT + 0.5, t);
                const kFit = springStep(t - GRID_AT, 11, 0.72);
                // Canvas cell first; its camera eases out to show the whole team in a quarter of the room.
                const r0 = cellAt(0, t);
                const camTop = TOP + 40 * toolbarIn;
                canvasView(r0.x, camTop, r0.w, r0.h - (camTop - r0.y), lerp(st.camX, 1080, kFit), lerp(st.camY, 330, kFit), lerp(st.zoom, 0.33, kFit), t, st.S, st.world);
                cellToolbar(r0.x, r0.y, r0.w, CELLS[0], false, toolbarIn);
                for (let i = 1; i < 4; i++) {
                    const r = cellAt(i, t);
                    const reveal = sstep(GRID_AT + 0.05 + i * 0.1, GRID_AT + 0.35 + i * 0.1, t);
                    if (reveal <= 0) {
                        continue;
                    }
                    const keep = ctx.globalAlpha;
                    ctx.globalAlpha = keep * reveal;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(r.x, r.y, r.w, r.h);
                    ctx.clip();
                    ctx.fillStyle = pal.bg;
                    ctx.fillRect(r.x, r.y, r.w, r.h);
                    // Content lags its frame a touch, so a cell lands before what it holds.
                    const inner = sstep(GRID_AT + 0.25 + i * 0.1, GRID_AT + 0.7 + i * 0.1, t);
                    ctx.globalAlpha = keep * reveal * inner;
                    const cw = CELL_W;
                    const ch = CELL_H - 40;
                    ctx.translate(r.x, r.y + 40);
                    ctx.scale(r.w / CELL_W, (r.h - 40 * (r.h / CELL_H)) / ch);
                    if (i === 1) {
                        drawBrowser(0, 0, cw, ch, t);
                    } else if (i === 2) {
                        drawTests(0, 0, cw, ch, t);
                    } else {
                        drawChatView(0, 0, cw, ch, t);
                        ALLOW_BTN.x += r.x;
                        ALLOW_BTN.y += r.y + 40;
                    }
                    ctx.restore();
                    ctx.globalAlpha = keep * reveal;
                    cellToolbar(r.x, r.y, r.w, CELLS[i], i === 3, 1);
                    ctx.globalAlpha = keep;
                }
                ctx.fillStyle = 'rgba(255,255,255,0.07)';
                const lines = sstep(GRID_AT + 0.3, GRID_AT + 0.7, t);
                ctx.globalAlpha = lines;
                ctx.fillRect(MAIN.x + CELL_W, MAIN.y, 1, MAIN.h);
                ctx.fillRect(MAIN.x, MAIN.y + CELL_H, MAIN.w, 1);
                ctx.globalAlpha = 1;
                drawMerge(t);
            }
            drawSidebar(t, grid ? sstep(GRID_AT, GRID_AT + 0.4, t) : 0);
            drawToolbar();
            ctx.restore();
            strokeRound(0.5, 0.5, AW - 1, AH - 1, 12, 'rgba(255,255,255,0.1)');
        };

        /* ---------- The laptop around the window. ---------- */
        const LAP = { bx: -30, by: -30, bw: 1660, bh: 960, hinge: 930, deck: 118, edge: 18 };
        const S_LAP = 0.62;
        const drawBezel = () => {
            fillRound(LAP.bx, LAP.by, LAP.bw, LAP.bh, 42, '#1a1a1f');
            strokeRound(LAP.bx + 1, LAP.by + 1, LAP.bw - 2, LAP.bh - 2, 41, 'rgba(255,255,255,0.12)', 2);
            fillRound(-6, -6, AW + 12, AH + 12, 16, '#050506');
            disc(800, -17, 4, '#0b0b0e');
        };
        const drawDeck = () => {
            const glow = ctx.createRadialGradient(800, LAP.hinge + LAP.deck + 30, 20, 800, LAP.hinge + LAP.deck + 30, 1150);
            glow.addColorStop(0, 'rgba(0,0,0,0.6)');
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save();
            ctx.translate(800, LAP.hinge + LAP.deck + 30);
            ctx.scale(1, 0.14);
            ctx.translate(-800, -(LAP.hinge + LAP.deck + 30));
            ctx.fillStyle = glow;
            ctx.fillRect(800 - 1150, LAP.hinge + LAP.deck + 30 - 1150, 2300, 2300);
            ctx.restore();
            const top = LAP.hinge;
            const front = LAP.hinge + LAP.deck;
            const half0 = LAP.bw / 2 + 6;
            const half1 = LAP.bw * 0.57;
            ctx.beginPath();
            ctx.moveTo(800 - half0, top);
            ctx.lineTo(800 + half0, top);
            ctx.lineTo(800 + half1, front);
            ctx.lineTo(800 - half1, front);
            ctx.closePath();
            ctx.fillStyle = '#1e1e23';
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(800 - half1, front);
            ctx.lineTo(800 + half1, front);
            ctx.lineTo(800 + half1 - 10, front + LAP.edge);
            ctx.lineTo(800 - half1 + 10, front + LAP.edge);
            ctx.closePath();
            ctx.fillStyle = '#131317';
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(800 - half1, front - 1, half1 * 2, 2);
            fillRound(800 - 90, front, 180, 7, 3.5, '#0c0c0f');
            ctx.beginPath();
            ctx.moveTo(800 - 190, top + 42);
            ctx.lineTo(800 + 190, top + 42);
            ctx.lineTo(800 + 210, front - 8);
            ctx.lineTo(800 - 210, front - 8);
            ctx.closePath();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 2;
            ctx.stroke();
        };
        const LID_W = Math.ceil(LAP.bw * S_LAP) + 4;
        const LID_H = Math.ceil(LAP.bh * S_LAP) + 4;
        const lidCanvas = document.createElement('canvas');
        lidCanvas.width = LID_W;
        lidCanvas.height = LID_H;
        const lidCtx = lidCanvas.getContext('2d');
        const renderLid = (t, st) => {
            lidCtx.setTransform(1, 0, 0, 1, 0, 0);
            lidCtx.clearRect(0, 0, LID_W, LID_H);
            lidCtx.setTransform(S_LAP, 0, 0, S_LAP, 2 - LAP.bx * S_LAP, 2 - LAP.by * S_LAP);
            ctx = lidCtx;
            drawBezel();
            drawApp(t, st);
            ctx = main;
        };
        // The lid turns about its hinge toward the viewer and lands on the front of the deck.
        const drawLaptop = (t, st, theta, fx, fy, dim, alpha) => {
            const S = S_LAP;
            const map = (ax, ay) => [(ax - 800) * S + fx, (ay - 450) * S + fy];
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.save();
            ctx.translate(fx - 800 * S, fy - 450 * S);
            ctx.scale(S, S);
            drawDeck();
            ctx.restore();
            renderLid(t, st);
            const hingeY = map(0, LAP.hinge)[1];
            const cx = fx;
            const lidH = LAP.bh * S;
            const depth = LAP.deck * S;
            const topY = hingeY - lidH * Math.cos(theta) + depth * Math.sin(theta);
            const grow = 1 + 0.1 * Math.sin(theta);
            if (topY < hingeY - 0.5) {
                const count = 72;
                for (let i = 0; i < count; i++) {
                    const v0 = i / count;
                    const v1 = (i + 1) / count;
                    const y0 = lerp(topY, hingeY, v0);
                    const y1 = lerp(topY, hingeY, v1);
                    const wide = LID_W * lerp(grow, 1, (v0 + v1) / 2);
                    ctx.drawImage(lidCanvas, 0, (i * LID_H) / count, LID_W, LID_H / count, cx - wide / 2, y0, wide, y1 - y0 + 0.7);
                }
                const shade = clamp(dim + Math.sin(theta) * 0.85);
                if (shade > 0.01) {
                    ctx.beginPath();
                    ctx.moveTo(cx - (LID_W * grow) / 2, topY);
                    ctx.lineTo(cx + (LID_W * grow) / 2, topY);
                    ctx.lineTo(cx + LID_W / 2, hingeY);
                    ctx.lineTo(cx - LID_W / 2, hingeY);
                    ctx.closePath();
                    ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
                    ctx.fill();
                }
            } else {
                ctx.beginPath();
                ctx.moveTo(cx - LID_W / 2, hingeY);
                ctx.lineTo(cx + LID_W / 2, hingeY);
                ctx.lineTo(cx + (LID_W * grow) / 2, topY);
                ctx.lineTo(cx - (LID_W * grow) / 2, topY);
                ctx.closePath();
                ctx.fillStyle = '#26262c';
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.14)';
                ctx.fillRect(cx - (LID_W * grow) / 2 + 8, topY - 1, LID_W * grow - 16, 2);
            }
            ctx.restore();
        };

        /* ---------- Camera plans. ---------- */
        // The world camera in net frame zoom through the first half.
        const CAM = [
            [5.55, 280, 200, 1.5],
            [9.25, 290, 206, 1.6],
            [10.35, 600, 330, 1.08],
            [13.9, 616, 330, 1.12],
            [15.4, 1250, 322, 0.8],
            [17.3, 1256, 322, 0.82],
            [18.5, 1552, 330, 1.52],
            [21.7, 1556, 330, 1.57],
            [23.5, 1070, 312, 0.86]
        ];
        const camOut = { x: 0, y: 0, z: 1 };
        const camAt = (t) => {
            if (t <= CAM[0][0]) {
                camOut.x = CAM[0][1];
                camOut.y = CAM[0][2];
                camOut.z = CAM[0][3];
                return camOut;
            }
            for (let i = 1; i < CAM.length; i++) {
                if (t <= CAM[i][0]) {
                    const a = CAM[i - 1];
                    const b = CAM[i];
                    const k = glide((t - a[0]) / (b[0] - a[0]));
                    camOut.x = lerp(a[1], b[1], k);
                    camOut.y = lerp(a[2], b[2], k);
                    camOut.z = Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), k));
                    return camOut;
                }
            }
            const last = CAM[CAM.length - 1];
            camOut.x = last[1];
            camOut.y = last[2];
            camOut.z = last[3];
            return camOut;
        };
        // How the app window sits in the frame: its point (ax, ay) lands on (fx, fy) at scale S.
        const VIEW = [
            [24.0, S0, MAIN_CX, MAIN_CY, 960, 540],
            [26.0, S_LAP, 800, 450, 960, 452],
            [41.7, S_LAP, 800, 450, 960, 452],
            [43.1, 1.2, 800, 450, 960, 540],
            [47.2, 1.2, 800, 450, 960, 540],
            [48.3, 1.42, MAIN_CX, MAIN_CY + 10, 960, 530],
            [50.9, 1.44, MAIN_CX, MAIN_CY + 10, 960, 530],
            [52.1, 1.62, 1262, 687, 960, 596],
            [53.9, 1.64, 1262, 687, 960, 596],
            [55.6, 0.9, 800, 450, 960, 520]
        ];
        const viewOut = { S: 1, ax: 0, ay: 0, fx: 0, fy: 0 };
        const viewAt = (t) => {
            let a = VIEW[0];
            let b = VIEW[0];
            let k = 0;
            if (t > VIEW[0][0]) {
                a = VIEW[VIEW.length - 1];
                b = a;
                for (let i = 1; i < VIEW.length; i++) {
                    if (t <= VIEW[i][0]) {
                        a = VIEW[i - 1];
                        b = VIEW[i];
                        k = glide((t - a[0]) / (b[0] - a[0]));
                        break;
                    }
                }
            }
            viewOut.S = Math.exp(lerp(Math.log(a[1]), Math.log(b[1]), k));
            viewOut.ax = lerp(a[2], b[2], k);
            viewOut.ay = lerp(a[3], b[3], k);
            viewOut.fx = lerp(a[4], b[4], k);
            viewOut.fy = lerp(a[5], b[5], k);
            return viewOut;
        };

        /* ---------- build-box, where the sessions keep running. ---------- */
        const PANEL = { w: 1280, h: 744 };
        const PANEL_CAM = [
            [27.6, 1180, 310, 0.52],
            [28.4, 1180, 310, 0.52],
            [29.35, 1552, 668, 1.5],
            [31.1, 1552, 670, 1.52],
            [32.2, 1250, 330, 0.5]
        ];
        const panelCam = { x: 0, y: 0, z: 1 };
        const panelCamAt = (t) => {
            let a = PANEL_CAM[0];
            let b = a;
            let k = 0;
            for (let i = 1; i < PANEL_CAM.length; i++) {
                if (t <= PANEL_CAM[i][0]) {
                    a = PANEL_CAM[i - 1];
                    b = PANEL_CAM[i];
                    k = glide(clamp((t - a[0]) / (b[0] - a[0])));
                    break;
                }
                a = PANEL_CAM[i];
                b = a;
            }
            panelCam.x = lerp(a[1], b[1], k);
            panelCam.y = lerp(a[2], b[2], k);
            panelCam.z = Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), k));
            return panelCam;
        };
        const panelPlace = { cx: 0, cy: 0, scale: 1, alpha: 1 };
        const panelAt = (t) => {
            const back = glide(phase(t, 31.9, 1.1));
            panelPlace.scale = lerp(1, 0.6, back);
            panelPlace.cx = lerp(960, 520, back);
            panelPlace.cy = lerp(520, 545, back);
            panelPlace.alpha = lerp(1, 0.6, back) * (1 - soft(phase(t, 38.0, 0.7)));
            return panelPlace;
        };
        const WORLD_ALL = { others: 1, pop: 1, focus: 0, dots: 1 };
        const drawPanel = (t) => {
            const open = soft(phase(t, 27.45, 0.85));
            if (open <= 0) {
                return;
            }
            const place = panelAt(t);
            if (place.alpha <= 0.001) {
                return;
            }
            const hingeY = (LAP.hinge - 450) * S_LAP + 452;
            ctx.save();
            ctx.globalAlpha = place.alpha;
            ctx.translate(place.cx, place.cy);
            ctx.scale(place.scale, place.scale);
            const wide = lerp(LAP.bw * S_LAP, PANEL.w, open);
            const tall = lerp(4, PANEL.h, open);
            const cy = lerp(hingeY - place.cy, 0, open);
            const x = -wide / 2;
            const y = cy - tall / 2;
            fillRound(x, y + 8, wide, tall, 16, 'rgba(0,0,0,0.5)');
            fillRound(x, y, wide, tall, 16, pal.surface);
            ctx.save();
            R.roundRect(ctx, x, y, wide, tall, 16);
            ctx.clip();
            const inner = sstep(0.45, 1, open);
            ctx.globalAlpha = place.alpha * inner;
            const cam = panelCamAt(t);
            canvasView(x, y + 60, wide, tall - 60, cam.x, cam.y, cam.z, t, place.scale, WORLD_ALL);
            ctx.fillStyle = pal.raised;
            ctx.fillRect(x, y, wide, 60);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + 59, wide, 1);
            icon('server', x + 24, y + 19, 22, pal.text);
            label('build-box', x + 58, y + 31, 20, pal.text, 600, DISPLAY);
            setFont(20, 600, DISPLAY);
            label('npx ruimte', x + 72 + measure('build-box'), y + 31.5, 15, pal.faint, 400, MONO);
            disc(x + wide - 104, y + 30, 5, pal.idle);
            label('Online', x + wide - 90, y + 31, 15, pal.muted);
            ctx.restore();
            ctx.globalAlpha = place.alpha;
            strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, 15.5, 'rgba(255,255,255,0.12)');
            ctx.restore();
        };
        // Where the Festival map node's header sits in the frame, for the line to the phone.
        const mapNodeInFrame = (t) => {
            const place = panelAt(t);
            const cam = panelCamAt(t);
            const node = CHILDREN[2].rect;
            const bodyCy = 60 / 2;
            const wx = (node.x + node.w - 60 - cam.x) * cam.z;
            const wy = (node.y + 20 - cam.y) * cam.z + bodyCy;
            return { x: place.cx + wx * place.scale, y: place.cy + wy * place.scale };
        };

        /* ---------- The phone at 02:15. ---------- */
        const PHONE = { w: 372, h: 760, r: 62 };
        const PH_X = 1260;
        const PH_Y = 548;
        const P_WAKE = 33.15;
        const P_BANNER = 33.55;
        const P_THUMB = 34.55;
        const P_HOLD = 34.95;
        const P_EXPAND = 35.25;
        const P_TAP = 36.2;
        const P_DISMISS = 36.45;
        const P_SLEEP = 37.35;
        const plane = (cx, cy, side, skew, radius) => {
            const corners = [
                [cx - side / 2 + skew, cy - side / 2],
                [cx + side / 2 + skew, cy - side / 2],
                [cx + side / 2 - skew, cy + side / 2],
                [cx - side / 2 - skew, cy + side / 2]
            ];
            ctx.beginPath();
            ctx.moveTo((corners[0][0] + corners[1][0]) / 2, corners[0][1]);
            for (let i = 1; i <= 4; i++) {
                const corner = corners[i % 4];
                const next = corners[(i + 1) % 4];
                ctx.arcTo(corner[0], corner[1], next[0], next[1], radius);
            }
            ctx.closePath();
        };
        const appIcon = (x, y, size) => {
            fillRound(x, y, size, size, size * 0.24, '#e9ecf1');
            const side = size * 0.44;
            plane(x + size * 0.42, y + size * 0.42, side, side * 0.18, side * 0.18);
            ctx.fillStyle = pal.markDark;
            ctx.fill();
            plane(x + size * 0.58, y + size * 0.58, side, side * 0.18, side * 0.18);
            ctx.fillStyle = 'rgba(160,170,186,0.95)';
            ctx.fill();
        };
        const springy = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.exp(-k * 6.5) * Math.cos(k * 9.5) * (1 - k * 0.2));
        const phoneY = (t) => PH_Y + (1 - glide(phase(t, 32.05, 1.1))) * 900 + E.inCubic(phase(t, 37.85, 0.9)) * 900;
        const ACTIONS = ['Allow', 'Always allow', 'Deny'];
        const drawPhone = (t) => {
            const cy = phoneY(t);
            if (cy > 1080 + PHONE.h / 2) {
                return;
            }
            const x = PH_X - PHONE.w / 2;
            const y = cy - PHONE.h / 2;
            fillRound(x + 10, y + 26, PHONE.w - 20, PHONE.h, PHONE.r, 'rgba(0,0,0,0.4)');
            ctx.fillStyle = '#2a2a31';
            ctx.fillRect(x - 3, y + 130, 4, 38);
            ctx.fillRect(x - 3, y + 186, 4, 64);
            ctx.fillRect(x + PHONE.w - 1, y + 176, 4, 90);
            fillRound(x, y, PHONE.w, PHONE.h, PHONE.r, '#232329');
            strokeRound(x + 0.5, y + 0.5, PHONE.w - 1, PHONE.h - 1, PHONE.r, 'rgba(255,255,255,0.14)', 1.5);
            const sx = x + 10;
            const sy = y + 10;
            const sw = PHONE.w - 20;
            const sh = PHONE.h - 20;
            ctx.save();
            R.roundRect(ctx, sx, sy, sw, sh, PHONE.r - 9);
            ctx.clip();
            ctx.fillStyle = '#000000';
            ctx.fillRect(sx, sy, sw, sh);
            const light = E.outCubic(phase(t, P_WAKE, 0.4)) * (1 - E.inOutSine(phase(t, P_SLEEP, 0.5)));
            if (light > 0.001) {
                const keep = ctx.globalAlpha;
                ctx.globalAlpha = keep * light;
                const wall = ctx.createLinearGradient(sx, sy, sx + sw * 0.7, sy + sh);
                wall.addColorStop(0, '#171b30');
                wall.addColorStop(0.55, '#0e0f18');
                wall.addColorStop(1, '#09090c');
                ctx.fillStyle = wall;
                ctx.fillRect(sx, sy, sw, sh);
                const expand = springy(phase(t, P_EXPAND, 0.7));
                const dismiss = E.inCubic(phase(t, P_DISMISS, 0.35));
                const sheet = E.outCubic(phase(t, P_EXPAND, 0.35)) * (1 - E.outCubic(phase(t, P_DISMISS + 0.05, 0.4)));
                const pcx = sx + sw / 2;
                ctx.save();
                ctx.translate(pcx, sy + 170);
                ctx.scale(1 - sheet * 0.06, 1 - sheet * 0.06);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                ctx.font = '500 18px ' + DISPLAY;
                ctx.fillStyle = R.rgba('#ffffff', 0.75 - sheet * 0.45);
                ctx.fillText('Friday, August 14', 0, -78);
                ctx.font = '600 96px ' + DISPLAY;
                ctx.fillStyle = R.rgba('#e9ecf4', 0.95 - sheet * 0.6);
                ctx.fillText('2:15', 0, 12);
                ctx.restore();
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                disc(pcx - 104, sy + sh - 66, 25, 'rgba(255,255,255,0.1)');
                disc(pcx + 104, sy + sh - 66, 25, 'rgba(255,255,255,0.1)');
                fillRound(pcx - 104 - 6, sy + sh - 75, 12, 18, 3, 'rgba(255,255,255,0.55)');
                disc(pcx + 104, sy + sh - 66, 7, 'rgba(255,255,255,0.55)');
                if (sheet > 0.01) {
                    ctx.fillStyle = `rgba(0,0,0,${(0.45 * sheet).toFixed(3)})`;
                    ctx.fillRect(sx, sy, sw, sh);
                }
                const drop = springy(phase(t, P_BANNER, 0.75));
                if (t >= P_BANNER) {
                    const alpha = clamp(drop * 3) * (1 - dismiss);
                    const bw = sw - 24;
                    const bx = sx + 12;
                    const bannerY = lerp(sy - 110, sy + 250, drop);
                    const cardY = lerp(bannerY, sy + 196, expand) - dismiss * 60;
                    const lift = Math.sin(PI * phase(t, P_HOLD, 0.35)) * 0.03;
                    ctx.save();
                    ctx.globalAlpha = keep * light * alpha;
                    ctx.translate(bx + bw / 2, cardY + 44);
                    ctx.scale(1 + lift + expand * 0.02, 1 + lift + expand * 0.02);
                    ctx.translate(-(bx + bw / 2), -(cardY + 44));
                    fillRound(bx, cardY, bw, 88, 24, R.mix('#3a3a42', '#2c2c33', expand, 0.94));
                    strokeRound(bx + 0.5, cardY + 0.5, bw - 1, 87, 23.5, 'rgba(255,255,255,0.08)');
                    appIcon(bx + 14, cardY + 22, 42);
                    label('Festival map', bx + 68, cardY + 32, 16, '#ffffff', 600, DISPLAY);
                    label('now', bx + bw - 16, cardY + 32, 14, 'rgba(255,255,255,0.45)', 400, DISPLAY, 'right');
                    label('Allow bun add maplibre-gl?', bx + 68, cardY + 58, 15, 'rgba(255,255,255,0.78)', 400, DISPLAY);
                    ctx.restore();
                    if (expand > 0.01) {
                        const menuY = cardY + 104;
                        ctx.save();
                        ctx.globalAlpha = keep * light * clamp(expand * 1.6) * (1 - dismiss);
                        const grow = lerp(0.85, 1, expand);
                        ctx.translate(bx + bw * 0.25, menuY);
                        ctx.scale(grow, grow);
                        ctx.translate(-(bx + bw * 0.25), -menuY);
                        const mw = bw * 0.72;
                        fillRound(bx, menuY, mw, 3 * 52, 18, 'rgba(44,44,50,0.96)');
                        for (let i = 0; i < 3; i++) {
                            const ry = menuY + i * 52;
                            if (i > 0) {
                                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                                ctx.fillRect(bx, ry, mw, 1);
                            }
                            if (i === 0) {
                                const hit = sstep(P_TAP - 0.05, P_TAP + 0.05, t);
                                if (hit > 0) {
                                    ctx.save();
                                    R.roundRect(ctx, bx, menuY, mw, 3 * 52, 18);
                                    ctx.clip();
                                    ctx.fillStyle = `rgba(255,255,255,${(0.12 * hit).toFixed(3)})`;
                                    ctx.fillRect(bx, ry, mw, 52);
                                    ctx.restore();
                                }
                            }
                            label(ACTIONS[i], bx + 20, ry + 26.5, 17, i === 2 ? '#ff6961' : '#ffffff', 400, DISPLAY);
                        }
                        ctx.restore();
                    }
                }
                const held = lerp(sy + 250, sy + 196, springy(phase(t, P_EXPAND, 0.7))) + 44;
                const move = soft(phase(t, P_EXPAND + 0.35, 0.5));
                thumbPos.x = lerp(sx + sw * 0.62, sx + 84, move);
                thumbPos.y = lerp(held, sy + 196 + 104 + 26, move) + Math.sin(move * PI) * -18;
                drawThumb(t, thumbPos, keep * light);
                ctx.globalAlpha = keep;
            }
            fillRound(PH_X - 58, sy + 14, 116, 34, 17, '#000000');
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            if (light > 0.01) {
                ctx.globalAlpha = light;
                fillRound(PH_X - 68, sy + sh - 14, 136, 5, 2.5, 'rgba(255,255,255,0.55)');
                ctx.globalAlpha = 1;
            }
            const glare = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh * 0.7);
            glare.addColorStop(0, 'rgba(255,255,255,0)');
            glare.addColorStop(0.45, 'rgba(255,255,255,0.035)');
            glare.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glare;
            ctx.fillRect(sx, sy, sw, sh);
            ctx.restore();
        };
        const thumbPos = { x: 0, y: 0 };
        const drawThumb = (t, target, alpha) => {
            const come = E.outCubic(phase(t, P_THUMB, 0.5));
            const leave = E.inCubic(phase(t, P_TAP + 0.2, 0.4));
            const shown = come * (1 - leave);
            if (shown <= 0.01) {
                return;
            }
            // Pressed and held to open the actions, then a tap on Allow.
            const hold = Math.sin(PI * clamp(phase(t, P_HOLD, 0.45)));
            const tap = Math.sin(PI * phase(t, P_TAP - 0.08, 0.26));
            const down = Math.max(hold * 0.8, tap);
            const hover = (1 - come) * 30 + leave * 20;
            const radius = 28 * (1 + hover / 40) * (1 - down * 0.12);
            const tx = target.x + hover * 0.6;
            const ty = target.y + hover;
            ctx.save();
            ctx.globalAlpha = alpha * shown;
            disc(tx + 3, ty + 6 + hover * 0.3, radius, `rgba(0,0,0,${(0.22 * (1 - down)).toFixed(3)})`);
            disc(tx, ty, radius, `rgba(255,255,255,${(0.2 + down * 0.16).toFixed(3)})`);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.4;
            ctx.stroke();
            const ripple = phase(t, P_TAP + 0.02, 0.5);
            if (ripple > 0 && ripple < 1) {
                ctx.strokeStyle = `rgba(255,255,255,${(0.5 * (1 - ripple)).toFixed(3)})`;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.arc(tx, ty, radius + E.outCubic(ripple) * 24, 0, TAU);
                ctx.stroke();
            }
            ctx.restore();
        };
        // The request travels from build-box to the phone, and the answer back.
        const drawSync = (t) => {
            const legs = [
                [MAP_ASK + 0.1, 1],
                [P_TAP + 0.25, -1]
            ];
            for (const [start, dir] of legs) {
                const k = phase(t, start, 0.75);
                const show = E.outCubic(phase(t, start - 0.1, 0.3)) * (1 - E.inOutSine(phase(t, start + 0.65, 0.45)));
                if (show <= 0.01) {
                    continue;
                }
                const from = mapNodeInFrame(t);
                const to = { x: PH_X - PHONE.w / 2 - 6, y: phoneY(t) - 120 };
                const cx = (from.x + to.x) / 2;
                const cy = Math.min(from.y, to.y) - 140;
                ctx.save();
                ctx.globalAlpha = 0.5 * show;
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.quadraticCurveTo(cx, cy, to.x, to.y);
                ctx.setLineDash([3, 7]);
                ctx.strokeStyle = pal.muted;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.setLineDash([]);
                const s = dir > 0 ? E.inOutSine(k) : 1 - E.inOutSine(k);
                const u = 1 - s;
                const px = u * u * from.x + 2 * u * s * cx + s * s * to.x;
                const py = u * u * from.y + 2 * u * s * cy + s * s * to.y;
                ctx.globalAlpha = show * Math.sin(PI * clamp(k * 1.02));
                disc(px, py, 6, dir > 0 ? pal.needs : pal.running);
                ctx.restore();
            }
        };

        /* ---------- The end card. ---------- */
        const END_GAPS = [96, 80, 120, 96, 104];
        const END_ITEMS = ['caret', 'green', 'node', 'bubble', 'edge'];
        const endGaps = [0, 0, 0, 0, 0];
        const endScales = [0, 0, 0, 0, 0];
        const END_AT = 55.9;
        const drawEndCard = (t) => {
            const inn = sstep(END_AT - 0.1, END_AT + 0.5, t);
            if (inn <= 0) {
                return;
            }
            for (let i = 0; i < 5; i++) {
                const close = springStep(t - (END_AT + 0.55) - Math.abs(i - 2) * 0.04, 8.5, 0.62);
                endGaps[i] = END_GAPS[i] * (1 - close);
                endScales[i] = clamp(1 - close * 1.25) * sstep(END_AT, END_AT + 0.4, t);
            }
            const xs = layoutWord(endGaps);
            const baseline = 540;
            const settle = E.outCubic(phase(t, END_AT, 1.2));
            ctx.save();
            ctx.translate(960, baseline - 60);
            const zoom = lerp(1.08, 1, settle);
            ctx.scale(zoom, zoom);
            ctx.translate(-960, -(baseline - 60));
            drawWordmark(xs, baseline, inn, null, t, END_ITEMS, endScales);
            ctx.restore();
            const tag = E.outCubic(phase(t, 57.2, 0.7));
            ctx.save();
            ctx.globalAlpha = tag;
            label('Space for AI Engineering.', 960, 652 + (1 - tag) * 10, 46, pal.text, 500, DISPLAY, 'center');
            const url = E.outCubic(phase(t, 57.65, 0.7));
            ctx.globalAlpha = url;
            label('ruimte.app', 960, 722 + (1 - url) * 8, 28, pal.muted, 400, DISPLAY, 'center');
            ctx.restore();
        };

        /* ---------- Putting it together. ---------- */
        const appState = { camX: 0, camY: 0, zoom: 1, S: 1, dock: 0, world: { others: 1, pop: 1, focus: 0, dots: 1 } };
        const worldFocus = (t) => sstep(Q_ASK - 0.1, Q_ASK + 0.8, t) * (1 - sstep(Q_CLOSE + 0.1, Q_CLOSE + 1.0, t));
        const drawAppInFrame = (t, view) => {
            ctx.save();
            ctx.translate(view.fx, view.fy);
            ctx.scale(view.S, view.S);
            ctx.translate(-view.ax, -view.ay);
            if (view.S < 1.19) {
                drawDeck();
                drawBezel();
            }
            drawApp(t, appState);
            ctx.restore();
        };
        const APP_CURSOR = { x: 0, y: 0, alpha: 0, press: 0, click: -1 };
        const appCursorAt = (t) => {
            const out = APP_CURSOR;
            out.alpha = 0;
            out.press = 0;
            out.click = -1;
            const accept = { x: ACCEPT_BTN.x + 8, y: ACCEPT_BTN.y + 4 };
            const finish = { x: FINISH_BTN.x + 8, y: FINISH_BTN.y + 4 };
            const allow = { x: ALLOW_BTN.x + 8, y: ALLOW_BTN.y + 4 };
            if (t > 48.4 && t < 51.3) {
                out.alpha = sstep(48.4, 48.7, t) * (1 - sstep(50.9, 51.3, t));
                const first = soft(phase(t, 48.55, 0.8));
                const second = soft(phase(t, MERGE_ACCEPT + 0.35, 0.6));
                const startX = MAIN_CX + 140;
                const startY = MAIN_CY + 280;
                out.x = lerp(lerp(startX, accept.x, first), finish.x, second);
                out.y = lerp(lerp(startY, accept.y, first), finish.y, second) - Math.sin(second * PI) * 30;
                out.press = Math.max(Math.sin(PI * phase(t, MERGE_ACCEPT - 0.05, 0.22)), Math.sin(PI * phase(t, MERGE_FINISH - 0.05, 0.22)));
                out.click = t >= MERGE_FINISH - 0.05 ? t - (MERGE_FINISH - 0.05) : t - (MERGE_ACCEPT - 0.05);
                return out;
            }
            if (t > 52.5 && t < 54.2) {
                out.alpha = sstep(52.5, 52.8, t) * (1 - sstep(53.8, 54.2, t));
                const k = soft(phase(t, 52.6, 0.65));
                out.x = lerp(allow.x + 180, allow.x, k);
                out.y = lerp(allow.y + 150, allow.y, k);
                out.press = Math.sin(PI * phase(t, DEPLOY_ALLOW - 0.05, 0.22));
                out.click = t - (DEPLOY_ALLOW - 0.05);
            }
            return out;
        };

        return {
            draw(t, dt) {
                ctx = main;
                /* The app, from the push through the wordmark until the lid, and again from morning. */
                const intro = t < T_PUSH + PUSH_DUR;
                const firstHalf = t < 26.05;
                const morning = t >= 41.7 && t < 56.6;
                if (firstHalf || morning) {
                    let view = viewAt(t);
                    const world = appState.world;
                    world.others = 1;
                    world.pop = 1;
                    world.focus = 0;
                    world.dots = 1;
                    if (intro) {
                        const xs = introLayout(t);
                        const gx = (xs[2] + xs[3]) / 2;
                        const gy = W_BASE - xHeight / 2;
                        const p = dolly(phase(t, T_PUSH, PUSH_DUR));
                        const z0 = 104 / NODES.sketch.w;
                        const lend = 1.5 / z0;
                        const zoom = z0 * Math.exp(Math.log(lend) * p);
                        const fx = lerp(gx, 960, p);
                        const fy = lerp(gy, 540, p);
                        appState.camX = SKETCH_CENTER.x + (960 - fx) / zoom;
                        appState.camY = SKETCH_CENTER.y + (540 - fy) / zoom;
                        appState.zoom = zoom / S0;
                        world.others = sstep(4.25, 5.1, t);
                        world.pop = introScales[2] > 0 ? Math.max(0.001, springStep(t - T_OPEN - 0.14, 15, 0.38)) : 0.001;
                    } else if (firstHalf) {
                        const cam = camAt(t);
                        appState.camX = cam.x;
                        appState.camY = cam.y;
                        appState.zoom = cam.z / S0;
                        world.focus = worldFocus(t);
                    } else {
                        const cam = camAt(24);
                        appState.camX = cam.x;
                        appState.camY = cam.y;
                        appState.zoom = cam.z / S0;
                    }
                    appState.S = view.S;
                    appState.dock = firstHalf ? sstep(24.3, 25.3, t) : 1 - sstep(GRID_AT - 0.3, GRID_AT, t);
                    if (!intro || t > T_OPEN) {
                        drawAppInFrame(t, view);
                    }
                    if (morning && t > 55.2) {
                        const fade = sstep(55.2, 56.1, t);
                        ctx.fillStyle = `rgba(13,13,16,${fade.toFixed(3)})`;
                        ctx.fillRect(0, 0, 1920, 1080);
                    }
                    /* Pointer in the app, in app units, drawn through the same view. */
                    if (morning) {
                        const c = appCursorAt(t);
                        if (c.alpha > 0.01) {
                            ctx.save();
                            ctx.translate(view.fx, view.fy);
                            ctx.scale(view.S, view.S);
                            ctx.translate(-view.ax, -view.ay);
                            clickRing(c.x, c.y, c.click, 1.3 / view.S);
                            cursor(c.x, c.y, 1.3 / view.S, c.alpha, c.press);
                            ctx.restore();
                        }
                    }
                    if (intro) {
                        const xs = introLayout(t);
                        const gx = (xs[2] + xs[3]) / 2;
                        const gy = W_BASE - xHeight / 2;
                        const p = dolly(phase(t, T_PUSH, PUSH_DUR));
                        const z0 = 104 / NODES.sketch.w;
                        const scale = Math.exp(Math.log(1.5 / z0) * p);
                        const fade = 1 - sstep(2.0, 6.5, scale);
                        if (fade > 0.001) {
                            ctx.save();
                            ctx.translate(lerp(gx, 960, p), lerp(gy, 540, p));
                            ctx.scale(scale, scale);
                            ctx.translate(-gx, -gy);
                            drawWordmark(xs, W_BASE, fade, letterIn(t), t, INTRO_ITEMS, introScales);
                            ctx.restore();
                        }
                    }
                }
                /* Night: the lid closes, the work carries on at build-box. */
                if (t >= 26.05 && t < 28.6) {
                    const close = phase(t, 26.3, 1.05);
                    let theta = (PI / 2) * E.inOutCubic(close);
                    const land = t - 27.35;
                    if (land > 0) {
                        theta = PI / 2 - 0.05 * Math.exp(-land * 9) * Math.abs(Math.sin(land * 16));
                    }
                    const sink = soft(phase(t, 27.45, 0.9));
                    const cam = camAt(24);
                    appState.camX = cam.x;
                    appState.camY = cam.y;
                    appState.zoom = cam.z / S0;
                    appState.S = S_LAP;
                    appState.dock = 1;
                    appState.world.focus = 0;
                    appState.world.others = 1;
                    appState.world.pop = 1;
                    drawLaptop(t, appState, Math.min(theta, PI / 2 - 0.0001), 960, 452 + sink * 240, 0, 1 - sink);
                }
                if (t >= 27.45 && t < 38.8) {
                    drawPanel(t);
                }
                /* 02:15. */
                if (t >= 31.8 && t < 39.2) {
                    drawSync(t);
                    drawPhone(t);
                }
                /* Morning: the laptop comes back and opens where it closed. */
                if (t >= 38.9 && t < 41.7) {
                    const rise = glide(phase(t, 38.9, 1.1));
                    const open = phase(t, 40.0, 1.25);
                    let theta = (PI / 2) * (1 - E.inOutCubic(open));
                    if (open >= 1) {
                        const since = t - 41.25;
                        theta = -0.04 * Math.exp(-since * 8) * Math.sin(since * 14);
                    }
                    const cam = camAt(24);
                    appState.camX = cam.x;
                    appState.camY = cam.y;
                    appState.zoom = cam.z / S0;
                    appState.S = S_LAP;
                    appState.dock = 1;
                    appState.world.focus = 0;
                    appState.world.others = 1;
                    appState.world.pop = 1;
                    const wake = 1 - sstep(40.6, 41.3, t);
                    drawLaptop(t, appState, Math.max(-0.2, Math.min(theta, PI / 2 - 0.0001)), 960, 452 + (1 - rise) * 320, wake * 0.9, rise);
                }
                drawEndCard(t);
                drawClockChip(t, dt);
                drawCaptions(t);
                // The software GL piles up unflushed frames otherwise; reading one pixel makes each frame finish.
                main.getImageData(0, 0, 1, 1);
            }
        };
    },
    // D major at 96 BPM: a focused, hopeful evening on the canvas, B minor through the night on build-box, and a
    // IV, I, V, vi sunrise that lands on D under the end card.
    score(kit) {
        const BEAT = 60 / 96;
        const pads = kit.bus({ gain: 0.62, send: 0.34, pan: -0.06 });
        const keys = kit.bus({ gain: 0.5, send: 0.3, pan: 0.12 });
        const bells = kit.bus({ gain: 0.5, send: 0.45, pan: 0.04 });
        const low = kit.bus({ gain: 0.5, send: 0.03 });
        const drums = kit.bus({ gain: 0.55, send: 0.05 });
        const fx = kit.bus({ gain: 0.5, send: 0.3 });
        const ui = kit.bus({ gain: 0.32, send: 0.18, pan: 0.08 });

        const chord = (time, notes, length, opts = {}) => kit.pad(pads, time, notes, length, { gain: 0.09, cutoff: 1300, attack: 0.9, release: 1.4, ...opts });
        // An eighth-note arpeggio over the chord tones; a 0 in the mask is a rest, so the line breathes.
        const arp = (from, to, notes, mask, opts = {}) => {
            let step = 0;
            for (let time = from; time < to - 0.01; time += BEAT / 2) {
                if (mask[step % mask.length]) {
                    const order = [0, 2, 1, 3, 2, 1, 3, 2];
                    kit.pluck(keys, time, notes[order[step % order.length] % notes.length], { gain: 0.1, length: 0.2, bright: 2600, ...opts });
                }
                step++;
            }
        };
        const kicks = [];
        const beat = (from, to, { hats = true, snare = false, kickGain = 0.62 } = {}) => {
            let n = 0;
            for (let time = from; time < to - 0.01; time += BEAT) {
                kit.kick(drums, time, { gain: kickGain, pitch: 50 });
                kicks.push(time);
                if (hats) {
                    kit.hat(drums, time + BEAT / 2, { gain: 0.12 });
                }
                if (snare && n % 2 === 1) {
                    kit.snare(drums, time, { gain: 0.22, tone: 200, decay: 0.12 });
                }
                n++;
            }
        };

        /* 0 to 5.5: the wordmark. A held Dadd9, a glass note on the tittle, a sparkle as the gaps open. */
        chord(0.1, ['D3', 'A3', 'E4', 'F#4'], 5.2, { gain: 0.07, cutoff: 900, attack: 1.6 });
        kit.bass(low, 0.1, 'D2', 5.0, { gain: 0.16, cutoff: 260 });
        kit.bell(bells, 0.45, 'A5', { gain: 0.2, decay: 2.4 });
        kit.bell(bells, 0.47, 'D6', { gain: 0.07, decay: 2.0 });
        kit.pluck(keys, 1.05, 'A4', { gain: 0.07, length: 0.12, bright: 1600 });
        [['D6', 1.49], ['A5', 1.54], ['E6', 1.55], ['F#5', 1.59], ['A6', 1.6]].forEach(([name, time]) => {
            kit.pluck(keys, time, name, { gain: 0.07, length: 0.16, bright: 3800 });
        });
        arp(2.5, 5.0, ['D5', 'F#5', 'A5', 'E5'], [1, 0, 0, 1, 0, 0, 1, 0], { gain: 0.06, bright: 2000 });
        kit.riser(fx, 3.3, 2.2, { gain: 0.14 });

        /* 5 to 15: 22:00 on the canvas, focused. I, vi, IV, V with the pencil in eighths. */
        chord(5.0, ['D3', 'A3', 'E4', 'F#4'], 2.5);
        chord(7.5, ['D3', 'A3', 'D4', 'F#4'], 2.5);
        chord(10.0, ['D3', 'G3', 'B3', 'F#4'], 2.5);
        chord(12.5, ['E3', 'A3', 'D4', 'E4'], 1.25);
        chord(13.75, ['E3', 'A3', 'C#4', 'E4'], 1.25);
        kit.bell(bells, 5.55, 'F#5', { gain: 0.12, decay: 1.8 });
        const sketchMask = [1, 0, 1, 1, 0, 1, 1, 0];
        arp(5.25, 7.5, ['D5', 'F#5', 'A5', 'E5'], sketchMask);
        arp(7.5, 10.0, ['D5', 'F#5', 'B5', 'A5'], sketchMask);
        arp(10.0, 12.5, ['D5', 'G5', 'B5', 'F#5'], [1, 0, 1, 0, 1, 0, 1, 1]);
        arp(12.5, 15.0, ['E5', 'A5', 'C#6', 'D5'], [1, 1, 1, 0, 1, 1, 1, 1]);
        kit.bass(low, 5.0, 'D2', 2.4, { gain: 0.2, cutoff: 320 });
        kit.bass(low, 7.5, 'B1', 2.4, { gain: 0.22, cutoff: 360 });
        kit.bass(low, 10.0, 'G1', 2.4, { gain: 0.26, cutoff: 420 });
        kit.bass(low, 12.5, 'A1', 2.4, { gain: 0.28, cutoff: 460 });
        // The line snaps onto the lead, twice, then the brief is sent.
        kit.tick(ui, 11.3, { gain: 0.14, pitch: 1800 });
        kit.tick(ui, 12.2, { gain: 0.14, pitch: 1800 });
        kit.tick(ui, 12.6, { gain: 0.16, pitch: 2400 });
        kit.pluck(keys, 12.62, 'A5', { gain: 0.1, length: 0.3, bright: 3200 });
        kit.riser(fx, 13.0, 1.75, { gain: 0.12 });

        /* 14.75 to 26: the team. Three agents appear as three rising notes; the pulse starts. */
        kit.bell(bells, 14.75, 'A5', { gain: 0.14 });
        kit.bell(bells, 14.9, 'C#6', { gain: 0.12 });
        kit.bell(bells, 15.05, 'E6', { gain: 0.12 });
        chord(15.0, ['D3', 'A3', 'E4', 'F#4'], 2.5, { cutoff: 1600 });
        chord(17.5, ['C#3', 'A3', 'C#4', 'E4'], 2.5, { cutoff: 1300 });
        chord(20.0, ['D3', 'B3', 'D4', 'F#4'], 2.5, { cutoff: 1500 });
        chord(22.5, ['D3', 'G3', 'B3', 'F#4'], 2.5, { cutoff: 1700 });
        chord(25.0, ['E3', 'A3', 'C#4', 'E4'], 1.3, { cutoff: 1500, release: 1.2 });
        kit.bass(low, 15.0, 'D2', 2.4, { gain: 0.3 });
        kit.bass(low, 17.5, 'C#2', 2.4, { gain: 0.26 });
        kit.bass(low, 20.0, 'B1', 2.4, { gain: 0.3 });
        kit.bass(low, 22.5, 'G1', 2.4, { gain: 0.3 });
        kit.bass(low, 25.0, 'A1', 1.2, { gain: 0.28 });
        beat(15.0, 17.5);
        // The question: the pulse stops while the card waits, the arrow keys and Enter tick, the pick rings.
        arp(15.0, 17.5, ['D5', 'F#5', 'A5', 'E5'], [1, 1, 1, 1, 1, 1, 1, 1]);
        arp(17.5, 21.25, ['C#5', 'E5', 'A5', 'E5'], [1, 0, 0, 0, 1, 0, 0, 0], { gain: 0.07 });
        kit.tick(ui, 19.45, { gain: 0.16, pitch: 2000 });
        kit.tick(ui, 20.05, { gain: 0.16, pitch: 2000 });
        kit.tick(ui, 20.6, { gain: 0.2, pitch: 1500 });
        kit.bell(bells, 20.85, 'F#5', { gain: 0.16, decay: 1.8 });
        kit.bell(bells, 20.86, 'A5', { gain: 0.08, decay: 1.8 });
        kit.riser(fx, 20.2, 1.05, { gain: 0.07 });
        beat(21.25, 26.2, { snare: true });
        arp(21.25, 22.5, ['D5', 'F#5', 'B5', 'A5'], [1, 1, 1, 1, 1, 1, 1, 1]);
        arp(22.5, 25.0, ['D5', 'G5', 'B5', 'F#5'], [1, 1, 1, 1, 1, 1, 1, 1]);
        arp(25.0, 26.2, ['E5', 'A5', 'C#6', 'E5'], [1, 1, 1, 1, 1, 1, 1, 1], { gain: 0.08 });
        for (const time of [16.0, 16.2, 16.4, 22.3, 24.4]) {
            kit.tick(ui, time, { gain: 0.08, pitch: 2800 });
        }

        /* 26 to 38.8: night. The lid lands, B minor on build-box, no drums, a quiet clock of plucks. */
        kit.impact(fx, 27.35, { gain: 0.32 });
        const night = chord(26.3, ['F#3', 'A3', 'C#4', 'D4'], 2.4, { gain: 0.085, cutoff: 1000, attack: 1.2 });
        night.frequency.setTargetAtTime(700, 27.4, 0.6);
        kit.bass(low, 27.35, 'B1', 1.3, { gain: 0.24, cutoff: 300 });
        const clock = (from, to) => {
            let n = 0;
            for (let time = from; time < to - 0.01; time += BEAT) {
                kit.pluck(keys, time, n % 2 === 0 ? 'F#5' : 'B4', { gain: 0.055, length: 0.1, bright: 1500, detune: 4 });
                n++;
            }
        };
        clock(27.5, 28.7);
        // The limit: everything sinks and holds a low B until the reset.
        const held = chord(28.7, ['B2', 'F#3', 'B3', 'D4'], 2.0, { gain: 0.08, cutoff: 700, attack: 0.3, release: 0.8 });
        held.frequency.setTargetAtTime(380, 28.8, 0.5);
        kit.bell(bells, 28.7, 'B3', { gain: 0.12, decay: 2.2 });
        kit.bass(low, 28.7, 'B1', 2.0, { gain: 0.22, cutoff: 220 });
        // The reset: a ring, the switch clicks, the clock picks up again on a warmer chord.
        kit.tick(ui, 30.7, { gain: 0.14, pitch: 1900 });
        kit.bell(bells, 30.72, 'F#5', { gain: 0.14 });
        kit.bell(bells, 30.9, 'B5', { gain: 0.09 });
        chord(30.7, ['D3', 'F#3', 'G3', 'B3'], 1.8, { cutoff: 1000 });
        kit.bass(low, 30.7, 'G1', 1.8, { gain: 0.24, cutoff: 300 });
        clock(30.7, 32.5);
        chord(32.5, ['D3', 'G3', 'B3', 'F#4'], 2.5, { cutoff: 900 });
        kit.bass(low, 32.5, 'E2', 2.4, { gain: 0.22, cutoff: 300 });
        // 02:15: the phone lights, the request comes in, a thumb allows it, the phone sleeps.
        kit.bell(bells, 33.15, 'B5', { gain: 0.16, decay: 2.2 });
        kit.pluck(keys, 33.55, 'D6', { gain: 0.08, length: 0.25, bright: 3600 });
        kit.pluck(keys, 33.67, 'F#6', { gain: 0.07, length: 0.25, bright: 3600 });
        kit.tick(ui, 34.95, { gain: 0.1, pitch: 1600 });
        chord(35.0, ['E3', 'F#3', 'B3', 'C#4'], 1.25, { cutoff: 1000, release: 0.6 });
        chord(36.25, ['E3', 'F#3', 'A#3', 'C#4'], 1.25, { cutoff: 1100, release: 0.8 });
        kit.bass(low, 35.0, 'F#1', 2.4, { gain: 0.24, cutoff: 300 });
        clock(35.0, 37.5);
        kit.tick(ui, 36.2, { gain: 0.18, pitch: 2200 });
        kit.bell(bells, 36.6, 'C#6', { gain: 0.14 });
        // Deceptive: F# does not go home to B minor, it goes to G, the IV of the morning.
        chord(37.5, ['D3', 'G3', 'A3', 'B3'], 2.6, { cutoff: 1100, release: 1.2 });
        kit.bass(low, 37.5, 'G1', 2.4, { gain: 0.22, cutoff: 320 });

        /* 38.3 to 40: the hours run. An accelerating climb into the sunrise. */
        kit.riser(fx, 38.3, 1.7, { gain: 0.16 });
        const climb = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6', 'A6'];
        let at = 38.4;
        let gap = 0.28;
        for (const name of climb) {
            kit.pluck(keys, at, name, { gain: 0.08, length: 0.14, bright: 3400 });
            at += gap;
            gap *= 0.84;
        }

        /* 40 to 55.9: morning. IV as the lid opens, then I, V, vi with the pulse back in the grid. */
        const sunrise = chord(40.0, ['D3', 'G3', 'B3', 'E4', 'A4'], 3.0, { gain: 0.09, cutoff: 700, attack: 1.4 });
        sunrise.frequency.setValueAtTime(700, 40.0);
        sunrise.frequency.linearRampToValueAtTime(2200, 42.8);
        kit.bass(low, 40.0, 'G1', 3.0, { gain: 0.26 });
        kit.bell(bells, 41.25, 'D6', { gain: 0.16, decay: 2.2 });
        kit.bell(bells, 41.27, 'A5', { gain: 0.08, decay: 2.2 });
        arp(41.25, 43.0, ['D5', 'G5', 'B5', 'A5'], [1, 0, 1, 0, 1, 0, 1, 1], { gain: 0.08 });
        kit.riser(fx, 41.8, 1.2, { gain: 0.1 });
        const morning = [
            [43.0, ['D3', 'A3', 'E4', 'F#4'], 'D2', ['D5', 'F#5', 'A5', 'E5']],
            [45.5, ['C#3', 'A3', 'C#4', 'E4'], 'A1', ['C#5', 'E5', 'A5', 'E5']],
            [48.0, ['D3', 'B3', 'D4', 'F#4'], 'B1', ['D5', 'F#5', 'B5', 'A5']],
            [50.5, ['D3', 'G3', 'B3', 'F#4'], 'G1', ['D5', 'G5', 'B5', 'F#5']]
        ];
        for (const [time, notes, root, tones] of morning) {
            chord(time, notes, 2.5, { cutoff: 2000 });
            kit.bass(low, time, root, 2.4, { gain: 0.3 });
            arp(time, Math.min(time + 2.5, 52.2), tones, [1, 1, 1, 1, 1, 1, 1, 1], { gain: 0.1, bright: 3000 });
        }
        kit.hat(drums, 43.0, { gain: 0.14, open: true });
        beat(43.0, 45.5);
        beat(45.5, 52.2, { snare: true });
        // The merge overlay: accept the proposed stretch, then finish the merge.
        kit.tick(ui, 49.45, { gain: 0.18, pitch: 2200 });
        kit.tick(ui, 50.5, { gain: 0.2, pitch: 1700 });
        kit.bell(bells, 50.55, 'B5', { gain: 0.12 });
        // Allow deploy to production? The pulse stops on a suspended A, Allow resolves it, and it rises to live.
        chord(52.2, ['D3', 'A3', 'D4', 'E4'], 1.15, { cutoff: 1600, release: 0.5 });
        kit.bass(low, 52.2, 'A1', 2.0, { gain: 0.26 });
        kit.tick(ui, 53.35, { gain: 0.2, pitch: 2200 });
        chord(53.35, ['C#3', 'A3', 'C#4', 'E4'], 0.9, { cutoff: 1800, attack: 0.4, release: 0.4 });
        kit.riser(fx, 53.4, 0.9, { gain: 0.16 });
        kit.bell(bells, 54.3, 'F#6', { gain: 0.16, decay: 2.0 });
        kit.bell(bells, 54.3, 'A5', { gain: 0.12, decay: 2.0 });
        kit.hat(drums, 54.3, { gain: 0.16, open: true });
        chord(54.3, ['D3', 'A3', 'E4', 'F#4', 'A4'], 1.4, { cutoff: 2400, attack: 0.15, release: 0.8 });
        kit.bass(low, 54.3, 'D2', 1.4, { gain: 0.3 });
        beat(54.3, 55.6, { hats: true });
        arp(54.3, 55.6, ['D5', 'F#5', 'A5', 'E5'], [1, 1, 1, 1, 1, 1, 1, 1], { gain: 0.09, bright: 3400 });

        /* 55.9 to 60: the end card. The wordmark shuts on a soft impact, and a Dmaj9 rings out. */
        kit.riser(fx, 55.5, 1.2, { gain: 0.08 });
        kit.impact(fx, 56.75, { gain: 0.42 });
        chord(56.0, ['D3', 'A3', 'C#4', 'E4', 'F#4'], 1.9, { gain: 0.1, cutoff: 1800, attack: 0.5, release: 1.5 });
        kit.bass(low, 56.75, 'D2', 1.6, { gain: 0.26, cutoff: 320 });
        kit.bell(bells, 56.78, 'D6', { gain: 0.16, decay: 2.2 });
        kit.bell(bells, 57.2, 'A5', { gain: 0.1, decay: 1.8 });
        kit.bell(bells, 57.65, 'F#5', { gain: 0.08, decay: 1.6 });

        pads.sidechain(kicks, 0.35, 0.3);
        keys.sidechain(kicks, 0.2, 0.2);
        // The arc of the story on the harmonic buses: a quiet opening, a build with the team, a night that drops
        // (lower still while the limit holds), the sunrise lifting it back, and everything gone before the last frame.
        const ARC = [
            [0, 0.72], [4.8, 0.72], [5.6, 0.88], [14.6, 0.9], [15.3, 1.05], [25.8, 1.05], [27.4, 0.62],
            [28.6, 0.62], [29.2, 0.44], [30.5, 0.44], [31.0, 0.62], [38.2, 0.62], [40.0, 0.86], [42.8, 0.9],
            [43.2, 1.08], [52.0, 1.08], [52.4, 0.86], [53.4, 0.9], [54.3, 1.12], [55.6, 1.0], [59.0, 1.0], [59.85, 0]
        ];
        for (const bus of [pads, keys, low]) {
            const level = bus.level.value * 1.15;
            bus.automate(ARC.map(([time, amount]) => [time, level * amount]));
        }
        for (const bus of [bells, drums, fx, ui]) {
            const level = bus.level.value * 1.15;
            bus.automate([[0, level], [59.0, level], [59.85, 0]]);
        }
    }
});
