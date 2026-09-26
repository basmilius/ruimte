/* From Sketch to Line-up: one continuous camera over the canvas while the Nachtveld site is built, from the
   first stroke of a sketch to the site going live. The canvas turns out to be one view in the window at the end. */
Film.define({
    id: 'sketch-to-lineup',
    title: 'From Sketch to Line-up',
    duration: 60,
    // Where the film changes what it is about: the canvas lands, the lines, the team, the question, the browser,
    // the merge, the window, the end card.
    cuts: [4.5, 9.5, 17, 26.2, 31.2, 40.8, 48.3, 55.6],
    create(v) {
        const { ctx, R } = v;
        const pal = R.pal;
        const ease = R.ease;
        const phase = R.phase;
        const clamp = R.clamp;
        const lerp = R.lerp;
        const TAU = R.TAU;
        const SANS = R.fonts.display;
        const MONO = R.fonts.mono;
        const HAND = R.fonts.hand;
        const SW = 1920;
        const SH = 1080;
        const glide = ease.bezier(0.45, 0, 0.2, 1);
        const settle = ease.bezier(0.3, 0, 0, 1);

        if (document.fonts) {
            for (const face of ['400 13px "JetBrains Mono"', '500 13px "JetBrains Mono"', '400 14px Geist', '500 14px Geist', '600 14px Geist', '700 14px Geist', '400 20px Kalam']) {
                document.fonts.load(face).catch(() => null);
            }
        }

        /* ---------- Icons: Lucide's own paths in a 24 box ---------- */
        const ring = (cx, cy, rad) => `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0`;
        const box = (x, y, wide, tall, rad) =>
            `M${x + rad} ${y}h${wide - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${tall - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}h${-(wide - 2 * rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}v${-(tall - 2 * rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}z`;
        const ICONS = {
            terminal: ['M12 19h8', 'm4 17 6-6-6-6'],
            chat: ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'],
            globe: [ring(12, 12, 10), 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
            pen: [
                'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
                'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
                'm2.3 2.3 7.286 7.286',
                ring(11, 11, 2)
            ],
            note: ['M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z', 'M15 3v5a1 1 0 0 0 1 1h5'],
            frame: ['M22 6H2', 'M22 18H2', 'M6 2v20', 'M18 2v20'],
            circle: [ring(12, 12, 10)],
            circleCheck: [ring(12, 12, 10), 'm9 12 2 2 4-4'],
            loader: ['M21 12a9 9 0 1 1-6.219-8.56'],
            question: [
                'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
                'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3',
                'M12 17h.01'
            ],
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
            chevronUp: ['m18 15-6-6-6 6'],
            maximize: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'],
            close: ['M18 6 6 18', 'm6 6 12 12'],
            eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', ring(12, 12, 3)],
            edit: ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'],
            check: ['M20 6 9 17l-5-5'],
            lock: [box(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 10 0v4'],
            reload: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
            external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
            plus: ['M5 12h14', 'M12 5v14'],
            gitBranch: ['M6 3v12', ring(18, 6, 3), ring(6, 18, 3), 'M18 9a9 9 0 0 1-9 9'],
            gitMerge: [ring(18, 18, 3), ring(6, 6, 3), 'M6 21V9a9 9 0 0 0 9 9'],
            fileWarning: ['M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z', 'M12 9v4', 'M12 17h.01'],
            wand: [
                'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72',
                'm14 7 3 3',
                'M5 6v4',
                'M19 14v4',
                'M10 2v2',
                'M7 8H3',
                'M21 16h-4',
                'M11 3H9'
            ],
            sparkles: [
                'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
                'M20 3v4',
                'M22 5h-4'
            ],
            ban: [ring(12, 12, 10), 'm4.9 4.9 14.2 14.2'],
            laptop: ['M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16'],
            folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
            tablet: [box(3, 8, 10, 14, 2), 'M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4', 'M8 18h.01'],
            search: [ring(11, 11, 8), 'm21 21-4.3-4.3'],
            chart: ['M5 21v-6', 'M12 21V3', 'M19 21V9'],
            settings: [
                'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
                ring(12, 12, 3)
            ],
            panelClose: [box(3, 3, 18, 18, 2), 'M9 3v18', 'm16 15-3-3 3-3'],
            image: [box(3, 3, 18, 18, 2), ring(9, 9, 2), 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'],
            bothWays: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16']
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
        const CURSOR = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');

        const icon = (name, x, y, size, color, weight = 1.75, spin = 0) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(size / 24, size / 24);
            if (spin) {
                ctx.translate(12, 12);
                ctx.rotate(spin);
                ctx.translate(-12, -12);
            }
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
        const glyph = (name, x, y, size, color) => {
            if (name === 'claude' || name === 'codex') {
                mark(name, x, y, size, color);
            } else {
                icon(name, x, y, size, color);
            }
        };

        /* ---------- Text ---------- */
        const setFont = (size, weight = 400, family = SANS) => {
            ctx.font = `${weight} ${size}px ${family}`;
        };
        const widths = new Map();
        const measure = (str) => {
            const key = ctx.font + '|' + str;
            let width = widths.get(key);
            if (width === undefined) {
                width = ctx.measureText(str).width;
                if (!document.fonts || document.fonts.status === 'loaded') {
                    widths.set(key, width);
                }
            }
            return width;
        };
        const label = (str, x, y, size, color, weight = 400, family = SANS, align = 'left') => {
            setFont(size, weight, family);
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(str, x, y);
        };
        // The client's `.shine`: muted words with a light running over them every 1.6 s.
        const shine = (str, x, y, size, t, weight = 400, family = SANS) => {
            setFont(size, weight, family);
            const width = measure(str);
            const sweep = R.fract(t / 1.6);
            const center = x + width * (1.7 - 2.4 * sweep);
            const band = Math.max(16, width * 0.34);
            const gradient = ctx.createLinearGradient(center - band, 0, center + band, 0);
            gradient.addColorStop(0, pal.muted);
            gradient.addColorStop(0.5, pal.text);
            gradient.addColorStop(1, pal.muted);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = gradient;
            ctx.fillText(str, x, y);
            return width;
        };
        const wraps = new Map();
        // Word positions of a text wrapped to a width, kept once the fonts are in.
        const wrap = (str, width, size, weight = 400) => {
            setFont(size, weight);
            const key = str + '|' + width + '|' + ctx.font;
            let layout = wraps.get(key);
            if (layout) {
                return layout;
            }
            const words = str.split(' ');
            const space = measure(' ');
            layout = { words: [], lines: 1, widest: 0 };
            let x = 0;
            let line = 0;
            for (const word of words) {
                const wide = measure(word);
                if (x > 0 && x + wide > width) {
                    x = 0;
                    line++;
                }
                layout.words.push({ word, x, line });
                layout.widest = Math.max(layout.widest, x + wide);
                x += wide + space;
            }
            layout.lines = line + 1;
            if (!document.fonts || document.fonts.status === 'loaded') {
                wraps.set(key, layout);
            }
            return layout;
        };
        // Streams word by word from `at`, in small bursts.
        const streamText = (str, x, y, width, t, at, alpha, size = 14, lineH = 21, color = pal.text, pace = 0.055) => {
            const layout = wrap(str, width, size);
            setFont(size);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            const base = ctx.globalAlpha;
            let when = at;
            for (let i = 0; i < layout.words.length; i++) {
                const amount = ease.outCubic(phase(t, when, 0.22));
                when += pace * (0.6 + R.hash(i * 7.3 + str.length) * 0.8);
                if (amount <= 0) {
                    break;
                }
                const word = layout.words[i];
                ctx.globalAlpha = base * alpha * amount;
                ctx.fillText(word.word, x + word.x, y + word.line * lineH + lineH / 2 + (1 - amount) * 3);
            }
            ctx.globalAlpha = base;
            return layout.lines * lineH;
        };

        /* ---------- Shapes and chrome ---------- */
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
        const STATUS = { running: pal.running, needs: pal.needs, idle: pal.idle, error: pal.error };
        const STATUS_LABEL = { running: 'Running', needs: 'Needs you', idle: 'Idle', error: 'Error' };
        const statusDot = (x, y, status, t, radius = 4) => {
            const pulse = status === 'running' ? 0.75 + 0.25 * Math.cos(t * Math.PI) : 1;
            ctx.globalAlpha *= pulse;
            ctx.fillStyle = STATUS[status];
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, TAU);
            ctx.fill();
            ctx.globalAlpha /= pulse;
        };
        const pill = (right, y, status, t, pop = 0) => {
            setFont(12);
            const word = STATUS_LABEL[status];
            const width = measure(word) + 24;
            fillRound(right - width, y - 10, width, 20, 10, pal.sunken);
            if (pop > 0.001) {
                ctx.save();
                ctx.globalAlpha *= pop;
                ctx.beginPath();
                ctx.arc(right - width + 9, y, 4 + (1 - pop) * 9, 0, TAU);
                ctx.strokeStyle = STATUS[status];
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.restore();
            }
            statusDot(right - width + 9, y, status, t, 3.7);
            label(word, right - width + 17, y + 0.5, 12, pal.muted);
            return width;
        };
        const HEADER = 39;
        const nodeFrame = (x, y, wide, tall, kind) => {
            const ground = kind === 'note' ? pal.note : kind === 'terminal' ? pal.termBg : pal.surface;
            fillRound(x - 2, y + 4, wide + 4, tall + 6, 14, 'rgba(0,0,0,0.22)');
            fillRound(x, y + 1, wide, tall + 1, 11, 'rgba(0,0,0,0.3)');
            fillRound(x, y, wide, tall, 11, ground);
        };
        const nodeChrome = (x, y, wide, tall, kind, alpha = 1) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            R.roundRect(ctx, x, y, wide, tall, 11);
            ctx.clip();
            ctx.fillStyle = kind === 'note' ? pal.note : pal.raised;
            ctx.fillRect(x, y, wide, HEADER);
            ctx.fillStyle = kind === 'note' ? 'rgba(236,236,241,0.12)' : 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + HEADER - 1, wide, 1);
            ctx.restore();
        };
        const nodeBorder = (x, y, wide, tall, color = 'rgba(255,255,255,0.09)') => {
            strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, 10.5, color, 1);
        };
        const nodeHeader = (x, y, wide, opts, t, alpha = 1) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            const mid = y + HEADER / 2;
            glyph(opts.glyph, x + 11, mid - 7, 14, pal.muted);
            let right = x + wide - 4;
            icon('close', right - 21, mid - 7, 14, pal.muted);
            icon('maximize', right - 49, mid - 7, 14, pal.muted);
            right -= 62;
            if (opts.status) {
                right -= pill(right, mid, opts.status, t, opts.pop || 0) + 8;
            }
            ctx.beginPath();
            ctx.rect(x + 30, y, Math.max(0, right - x - 30), HEADER);
            ctx.clip();
            label(opts.title, x + 34, mid + 0.5, 13, pal.text, 500);
            ctx.restore();
        };
        const button = (x, y, wide, tall, text, variant, alpha = 1, press = 0, iconName = null) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x + wide / 2, y + tall / 2);
            const squash = 1 - press * 0.05;
            ctx.scale(squash, squash);
            const left = -wide / 2;
            const top = -tall / 2;
            let color = pal.muted;
            if (variant === 'secondary') {
                fillRound(left, top, wide, tall, 6, pal.raised);
                strokeRound(left + 0.5, top + 0.5, wide - 1, tall - 1, 5.5, 'rgba(255,255,255,0.1)');
                color = pal.text;
            } else if (variant === 'primary') {
                fillRound(left, top, wide, tall, 6, pal.accent);
                color = '#ffffff';
            } else if (variant === 'inverse') {
                fillRound(left, top, wide, tall, 6, pal.text);
                color = pal.bg;
            }
            setFont(13, 500);
            const textW = measure(text) + (iconName ? 20 : 0);
            let tx = -textW / 2;
            if (iconName) {
                icon(iconName, tx, -7, 14, color);
                tx += 20;
            }
            label(text, tx, 0.5, 13, color, 500);
            ctx.restore();
        };
        const cursor = (x, y, alpha = 1, press = 0) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            if (press > 0.01) {
                ctx.beginPath();
                ctx.arc(x, y, 6 + press * 12, 0, TAU);
                ctx.fillStyle = `rgba(255,255,255,${(0.35 * (1 - press)).toFixed(3)})`;
                ctx.fill();
            }
            const scale = 1.25;
            ctx.translate(x - 1.5 * scale, y - 1.5 * scale);
            ctx.scale(scale, scale);
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
        const keycap = (glyphName, x, y, press, lit) => {
            const sink = press * 1.5;
            fillRound(x, y + 1.5, 22, 21, 5, 'rgba(0,0,0,0.5)');
            fillRound(x, y + sink, 22, 21 - sink * 0.6, 5, R.mix(pal.active, pal.hover, press));
            strokeRound(x + 0.5, y + sink + 0.5, 21, 20 - sink * 0.6, 4.5, `rgba(255,255,255,${0.1 + lit * 0.14})`, 1);
            icon(glyphName, x + 4.5, y + 4 + sink * 0.8, 13, R.mix(pal.muted, pal.text, lit));
        };

        /* ---------- The world: every node of the project, in canvas units ---------- */
        const D = { x: -1060, y: -300, w: 700, h: 440 };
        const N = { x: -1060, y: 200, w: 330, h: 170 };
        const L = { x: -120, y: -400, w: 460, h: 640 };
        const T = { x: -120, y: 300, w: 460, h: 230 };
        const C = [
            { x: 580, y: -670, w: 440, h: 440 },
            { x: 580, y: -195, w: 440, h: 340 },
            { x: 580, y: 180, w: 440, h: 280 }
        ];
        const B = { x: 1120, y: -680, w: 640, h: 460 };
        const centerOf = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

        /* ---------- Camera ---------- */
        const frame = (rect, z) => ({ x: rect.x, y: rect.y, z });
        const CAM_WORD = { x: 110, y: -80, z: 1.0 };
        const CAM_ALL = { x: 350, y: -75, z: 0.61 };
        const MOVES = [
            { t0: 2.1, t1: 3.75, to: CAM_ALL, mode: 'wijk', rho: 1.1 },
            { t0: 3.75, t1: 5.25, to: frame({ x: -710, y: -82 }, 1.42), mode: 'wijk', rho: 1.0 },
            { t0: 9.3, t1: 10.9, to: frame({ x: -360, y: -15 }, 1.15), mode: 'lerp' },
            { t0: 17.2, t1: 19.2, to: frame({ x: 410, y: -80 }, 0.84), mode: 'wijk', rho: 1.0 },
            { t0: 25.7, t1: 27.3, to: frame({ x: 800, y: -27 }, 1.84), mode: 'wijk', rho: 1.0 },
            { t0: 31.2, t1: 32.9, to: frame({ x: 1170, y: -450 }, 1.4), mode: 'wijk', rho: 1.0 },
            { t0: 40.8, t1: 42.8, to: CAM_ALL, mode: 'wijk', rho: 1.2 }
        ];
        const makePath = (a, b, mode, rho) => {
            if (mode === 'lerp') {
                return (p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), p)) });
            }
            // Van Wijk and Nuij's smooth pan and zoom: far moves rise out and come back down.
            const w0 = SW / a.z;
            const w1 = SW / b.z;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const u1 = Math.hypot(dx, dy);
            const r2 = rho * rho;
            if (u1 < 1) {
                return (p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), p)) });
            }
            const b0 = (w1 * w1 - w0 * w0 + r2 * r2 * u1 * u1) / (2 * w0 * r2 * u1);
            const b1 = (w1 * w1 - w0 * w0 - r2 * r2 * u1 * u1) / (2 * w1 * r2 * u1);
            const r0 = Math.log(-b0 + Math.sqrt(b0 * b0 + 1));
            const r1 = Math.log(-b1 + Math.sqrt(b1 * b1 + 1));
            const S = (r1 - r0) / rho;
            return (p) => {
                const s = p * S;
                const u = (w0 / r2) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
                const w = (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0);
                return { x: a.x + (dx * u) / u1, y: a.y + (dy * u) / u1, z: SW / w };
            };
        };
        // A slow push while the camera holds, so a still moment still breathes.
        const drift = (pose, since) => ({ x: pose.x, y: pose.y, z: pose.z * (1 + 0.012 * Math.min(since, 7)) });
        {
            let pose = CAM_WORD;
            let last = 0;
            for (const move of MOVES) {
                move.from = drift(pose, move.t0 - last);
                move.path = makePath(move.from, move.to, move.mode, move.rho || 1.2);
                pose = move.to;
                last = move.t1;
            }
        }
        const camAt = (t) => {
            let pose = CAM_WORD;
            let last = 0;
            for (const move of MOVES) {
                if (t < move.t0) {
                    return drift(pose, t - last);
                }
                if (t < move.t1) {
                    return move.path(ease.inOutCubic((t - move.t0) / (move.t1 - move.t0)));
                }
                pose = move.to;
                last = move.t1;
            }
            return drift(pose, t - last);
        };

        /* The view: how the virtual 1920 x 1080 screen of the canvas lands on the real frame. */
        const view = { s: 1, x: 0, y: 0 };
        let cam = CAM_WORD;
        const setWorld = () => {
            const k = view.s * cam.z;
            ctx.setTransform(k, 0, 0, k, view.x + view.s * (SW / 2 - cam.x * cam.z), view.y + view.s * (SH / 2 - cam.y * cam.z));
        };
        const setVirtual = () => {
            ctx.setTransform(view.s, 0, 0, view.s, view.x, view.y);
        };
        const toScreen = (x, y) => [(x - cam.x) * cam.z + SW / 2, (y - cam.y) * cam.z + SH / 2];

        /* ---------- Dot grid ---------- */
        const dotGrid = (alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            setVirtual();
            for (const pitchWorld of [24, 48]) {
                const pitch = pitchWorld * cam.z * view.s;
                const fine = pitchWorld === 24;
                const levelAlpha = fine ? R.smoothstep(12, 20, pitch) : 1 - R.smoothstep(12, 20, pitch / 2);
                if (levelAlpha <= 0.01 || pitch < 5) {
                    continue;
                }
                const step = pitchWorld * cam.z;
                const ox = R.mod(SW / 2 - cam.x * cam.z, step);
                const oy = R.mod(SH / 2 - cam.y * cam.z, step);
                const size = clamp(1.1 + cam.z * 0.8, 1.3, 2.4) / view.s;
                ctx.fillStyle = `rgba(255,255,255,${(0.11 * alpha * levelAlpha).toFixed(3)})`;
                ctx.beginPath();
                for (let y = oy; y < SH; y += step) {
                    for (let x = ox; x < SW; x += step) {
                        ctx.rect(x - size / 2, y - size / 2, size, size);
                    }
                }
                ctx.fill();
            }
        };

        /* ---------- Edges, routed as the client routes them ---------- */
        const EDGE_CONTEXT = R.mix(pal.accent, pal.bg, 0.45);
        const routeBetween = (first, second) => {
            const dx = second.x + second.w / 2 - (first.x + first.w / 2);
            const dy = second.y + second.h / 2 - (first.y + first.h / 2);
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            const along = horizontal ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
            const side = (rect, ax, ay) => [
                ax === 0 ? rect.x + rect.w / 2 : ax > 0 ? rect.x + rect.w + 9 : rect.x - 9,
                ay === 0 ? rect.y + rect.h / 2 : ay > 0 ? rect.y + rect.h + 9 : rect.y - 9
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
        // A route as a dense polyline, so a line can be drawn partway and a spark can ride it.
        const sampleRoute = (points) => {
            const out = [];
            for (let i = 0; i < points.length - 1; i++) {
                const [ax, ay] = points[i];
                const [bx, by] = points[i + 1];
                const count = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 12));
                for (let k = 0; k < count; k++) {
                    out.push([lerp(ax, bx, k / count), lerp(ay, by, k / count)]);
                }
            }
            out.push(points[points.length - 1]);
            // Round the corners a little, as the client's connectors are.
            for (let pass = 0; pass < 3; pass++) {
                for (let i = 1; i < out.length - 1; i++) {
                    out[i] = [(out[i - 1][0] + out[i][0] * 2 + out[i + 1][0]) / 4, (out[i - 1][1] + out[i][1] * 2 + out[i + 1][1]) / 4];
                }
            }
            let total = 0;
            out.lengths = [0];
            for (let i = 1; i < out.length; i++) {
                total += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
                out.lengths.push(total);
            }
            out.total = total;
            return out;
        };
        const pointAlong = (poly, frac) => {
            const target = clamp(frac) * poly.total;
            let i = 1;
            while (i < poly.length - 1 && poly.lengths[i] < target) {
                i++;
            }
            const span = poly.lengths[i] - poly.lengths[i - 1] || 1;
            const k = (target - poly.lengths[i - 1]) / span;
            return [lerp(poly[i - 1][0], poly[i][0], k), lerp(poly[i - 1][1], poly[i][1], k)];
        };
        const strokePoly = (poly, from, to) => {
            const a = clamp(from) * poly.total;
            const b = clamp(to) * poly.total;
            if (b - a < 1) {
                return;
            }
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < poly.length; i++) {
                const length = poly.lengths[i];
                if (length < a) {
                    continue;
                }
                if (!started) {
                    const p = pointAlong(poly, a / poly.total);
                    ctx.moveTo(p[0], p[1]);
                    started = true;
                }
                if (length > b) {
                    const p = pointAlong(poly, b / poly.total);
                    ctx.lineTo(p[0], p[1]);
                    break;
                }
                ctx.lineTo(poly[i][0], poly[i][1]);
            }
            ctx.stroke();
        };
        const edgeEnd = (point, color) => {
            ctx.beginPath();
            ctx.arc(point[0], point[1], 5, 0, TAU);
            ctx.fillStyle = pal.bg;
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.stroke();
        };
        const ROUTES = {
            drawing: sampleRoute(routeBetween(D, L)),
            // The brief's line keeps clear of the sketch: out to the right, up the gap between the two nodes.
            note: sampleRoute([
                [N.x + N.w + 9, N.y + N.h / 2],
                [-245, N.y + N.h / 2],
                [-245, L.y + L.h / 2],
                [L.x - 9, L.y + L.h / 2]
            ]),
            task: C.map((child) => sampleRoute(routeBetween(L, child))),
            browser: sampleRoute(routeBetween(C[0], B))
        };
        const spark = (poly, frac, alpha, radius = 3.2, color = '147,197,253') => {
            if (alpha <= 0.01) {
                return;
            }
            const [x, y] = pointAlong(poly, frac);
            const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 4);
            glow.addColorStop(0, `rgba(${color},${(0.45 * alpha).toFixed(3)})`);
            glow.addColorStop(1, `rgba(${color},0)`);
            ctx.fillStyle = glow;
            ctx.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8);
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, TAU);
            ctx.fillStyle = `rgba(${color},${alpha.toFixed(3)})`;
            ctx.fill();
        };

        /* ---------- Timeline ---------- */
        const T_WORD_IN = 0.05;
        const T_SQUEEZE = 0.5;
        const T_OPEN = 0.82;
        const T_LEAVE = 2.0;
        const LEAVE_DUR = 1.5;
        // When the agent reads each box of the sketch, in the order the arrows give.
        const RS = [13.9, 14.7, 15.5];
        const T_SEND = 13.2;
        const T_ASKED = 26.2;
        const T_ANSWERED = 30.55;
        const T_OVERLAY = 42.55;
        const T_OVERLAY_OUT = 46.45;
        const T_APPROVAL = 48.0;
        const T_DESK = 48.3;
        const T_ALLOW = 52.5;
        const T_LIVE = 53.8;
        const T_END = 55.6;

        const CAPTIONS = [
            { t0: 5.3, t1: 8.8, text: 'Sketch what you mean.' },
            { t0: 10.3, t1: 13.3, text: 'Draw a line. Share the context.' },
            { t0: 14.0, t1: 16.9, text: 'It reads the sketch in order.' },
            { t0: 19.1, t1: 21.9, text: 'It hands the work to a team.' },
            { t0: 22.3, t1: 25.3, text: 'Own worktree. Own plan.' },
            { t0: 27.0, t1: 30.2, text: 'Agents ask. You decide.' },
            { t0: 34.6, t1: 38.3, text: 'It sees the page, and fixes it.' },
            { t0: 43.2, t1: 46.3, text: 'Conflicts, worked out stretch by stretch.' },
            { t0: 48.9, t1: 50.9, text: 'Every view, side by side.' },
            { t0: 51.15, t1: 53.6, text: 'Approve from your phone.' },
            { t0: 54.0, t1: 55.6, text: 'The site is live.' }
        ];

        /* ---------- The opening: the wordmark makes room for the product ---------- */
        const WORD = [...'Ruimte'];
        const DOT_AT = 2;
        const SIZE = 190;
        const WORD_FONT = `600 ${SIZE}px ${SANS}`;
        const GAP = 120;
        const TILE = 82;
        const adv = new Array(WORD.length).fill(SIZE * 0.5);
        const left = new Array(WORD.length).fill(0);
        let wordW = 0;
        let xHeight = SIZE * 0.54;
        const tittle = { dx: 0, top: SIZE * 0.72, w: SIZE * 0.135, h: SIZE * 0.13 };
        let measured = false;
        const measureWord = () => {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.font = WORD_FONT;
            for (let i = 0; i < WORD.length; i++) {
                adv[i] = ctx.measureText(i === DOT_AT ? 'ı' : WORD[i]).width;
            }
            let x = 0;
            for (let i = 0; i < WORD.length; i++) {
                left[i] = x;
                x += adv[i];
                if (i < WORD.length - 1) {
                    const pair = WORD[i] + (i + 1 === DOT_AT ? 'ı' : WORD[i + 1]);
                    x += ctx.measureText(pair).width - adv[i] - adv[i + 1];
                }
            }
            wordW = x;
            const xm = ctx.measureText('x');
            if (xm.actualBoundingBoxAscent) {
                xHeight = xm.actualBoundingBoxAscent;
            }
            ctx.restore();
            // The tittle is what the dotted i has and the dotless one does not.
            const probe = document.createElement('canvas');
            const pw = Math.ceil(adv[DOT_AT]) + 8;
            const ph = Math.ceil(SIZE * 1.1);
            probe.width = pw;
            probe.height = ph;
            const pen = probe.getContext('2d', { willReadFrequently: true });
            const base = SIZE * 0.95;
            pen.font = WORD_FONT;
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
                for (let x2 = 0; x2 < pw; x2++) {
                    const k = (y * pw + x2) * 4 + 3;
                    if (dotted[k] > 128 && plain[k] < 64) {
                        x0 = Math.min(x0, x2);
                        x1 = Math.max(x1, x2);
                        y0 = Math.min(y0, y);
                        y1 = Math.max(y1, y);
                    }
                }
            }
            if (x1 > x0 && y1 > y0) {
                tittle.w = x1 - x0 + 1;
                tittle.h = y1 - y0 + 1;
                tittle.dx = (x0 + x1 + 1) / 2 - 4 - adv[DOT_AT] / 2;
                tittle.top = base - y0;
            }
        };
        const springStep = (e, omega, zeta) => {
            if (e <= 0) {
                return 0;
            }
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * e) * (Math.cos(wd * e) + ((zeta * omega) / wd) * Math.sin(wd * e));
        };
        const openDelay = (i) => Math.abs(i - 2) * 0.05;
        const leaveAt = (i) => T_LEAVE + [0.0, 0.06, 0.4, 0.1, 0.03][i];
        const gapAt = (i, t) => {
            const squeeze = -7 * ease.inOutSine(phase(t, T_SQUEEZE, 0.3));
            if (t < T_OPEN + openDelay(i)) {
                return squeeze;
            }
            const open = -7 + (GAP + 7) * springStep(t - T_OPEN - openDelay(i), 9.5, 0.52);
            const closeStart = leaveAt(i) + 0.3;
            if (t < closeStart) {
                return open;
            }
            return open * (1 - springStep(t - closeStart, 8.5, 0.62));
        };
        const tileScale = (i, t) => springStep(t - (T_OPEN + openDelay(i) + 0.12), 14, 0.42);
        const WORD_X = 110;
        const WORD_MID = -80;
        const gx = new Array(WORD.length).fill(0);
        const gapMid = new Array(5).fill(0);
        const layoutWord = (t) => {
            let total = 0;
            const gaps = [];
            for (let i = 0; i < 5; i++) {
                gaps.push(gapAt(i, t));
                total += gaps[i];
            }
            const start = WORD_X - (wordW + total) / 2;
            let acc = 0;
            for (let j = 0; j < WORD.length; j++) {
                gx[j] = start + left[j] + acc;
                if (j < 5) {
                    acc += gaps[j];
                    gapMid[j] = start + left[j] + adv[j] + acc - gaps[j] / 2 + (left[j + 1] - left[j] - adv[j]) / 2;
                }
            }
        };
        const PIECES = [
            { glyph: 'pen', to: D, kind: 'drawing' },
            { glyph: 'note', to: N, kind: 'note' },
            { glyph: 'claude', to: L, kind: 'chat' },
            { glyph: 'terminal', to: T, kind: 'terminal' },
            { glyph: 'globe', to: B, kind: 'browser' }
        ];
        // How far each piece has come on its way to becoming a node, 0 in the gap, 1 a node.
        const morphOf = (i, t) => phase(t, leaveAt(i), LEAVE_DUR);
        const drawTile = (i, cx, cy, scale, t) => {
            if (scale <= 0.01) {
                return;
            }
            const piece = PIECES[i];
            const bob = Math.sin(t * 2.2 + i * 1.3) * 3 * R.smoothstep(1.4, 2, t);
            ctx.save();
            ctx.translate(cx, cy + bob);
            ctx.rotate((1 - clamp(scale)) * (i % 2 ? 0.3 : -0.3));
            ctx.scale(scale, scale);
            const half = TILE / 2;
            fillRound(-half, -half + 3, TILE, TILE, 16, 'rgba(0,0,0,0.35)');
            fillRound(-half, -half, TILE, TILE, 16, piece.kind === 'note' ? pal.note : piece.kind === 'terminal' ? pal.termBg : pal.raised);
            strokeRound(-half + 0.5, -half + 0.5, TILE - 1, TILE - 1, 15.5, 'rgba(255,255,255,0.14)');
            drawTileGlyph(i, 0, 0, 36, t, 1);
            ctx.restore();
        };
        const drawTileGlyph = (i, cx, cy, size, t, alpha) => {
            const piece = PIECES[i];
            ctx.save();
            ctx.globalAlpha *= alpha;
            const color = pal.text;
            if (piece.glyph === 'terminal') {
                icon('terminal', cx - size / 2 - size * 0.12, cy - size / 2, size, pal.termFg);
                if (R.fract(t / 1.04) < 0.6) {
                    ctx.fillStyle = pal.termFg;
                    ctx.fillRect(cx + size * 0.18, cy - size * 0.16, size * 0.22, size * 0.42);
                }
            } else {
                glyph(piece.glyph, cx - size / 2, cy - size / 2, size, color);
            }
            ctx.restore();
        };
        const drawWord = (t) => {
            if (!measured) {
                measureWord();
                measured = true;
            }
            const alpha = ease.outCubic(phase(t, T_WORD_IN, 0.6)) * (1 - ease.inOutSine(phase(t, 2.5, 0.5)));
            layoutWord(t);
            const baseline = WORD_MID + xHeight / 2;
            const lift = (1 - ease.outCubic(phase(t, T_WORD_IN, 0.8))) * 14;
            if (alpha > 0.005) {
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.font = WORD_FONT;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = pal.text;
                const squeeze = ease.inOutSine(phase(t, T_SQUEEZE, 0.3)) * (1 - R.smoothstep(T_OPEN, T_OPEN + 0.12, t));
                for (let j = 0; j < WORD.length; j++) {
                    ctx.save();
                    ctx.translate(gx[j] + adv[j] / 2, baseline + lift);
                    ctx.scale(1 - 0.04 * squeeze, 1 + 0.03 * squeeze);
                    ctx.fillText(j === DOT_AT ? 'ı' : WORD[j], -adv[j] / 2, 0);
                    ctx.restore();
                }
                const tx = gx[DOT_AT] + adv[DOT_AT] / 2 + tittle.dx;
                const ty = baseline + lift - (tittle.top - tittle.h / 2);
                R.roundRect(ctx, tx - tittle.w / 2, ty - tittle.h / 2, tittle.w, tittle.h, Math.min(tittle.w, tittle.h) * 0.3);
                ctx.fillStyle = pal.accent;
                ctx.fill();
                ctx.restore();
            }
            // Tiles still in their gaps (before they leave).
            for (let i = 0; i < 5; i++) {
                if (t < leaveAt(i)) {
                    drawTile(i, gapMid[i], WORD_MID + lift, tileScale(i, t), t);
                }
            }
        };
        // Where a tile left from, frozen at its leave time, so its flight starts in its gap.
        const leaveFrom = PIECES.map(() => null);
        const morphRect = (i, t) => {
            const piece = PIECES[i];
            if (!leaveFrom[i]) {
                layoutWord(leaveAt(i));
                leaveFrom[i] = { x: gapMid[i], y: WORD_MID };
                layoutWord(t);
            }
            const p = morphOf(i, t);
            const from = leaveFrom[i];
            const to = centerOf(piece.to);
            const move = ease.inOutSine(clamp(p * 1.08));
            const grow = settle(clamp((p - 0.42) / 0.58));
            // Out of the gap first, up and away from the letters, then on an arc to where the node lives.
            const ctrlX = from.x + (to.x - from.x) * 0.15;
            const ctrlY = i === 2 ? from.y - 150 : from.y - 260;
            const inv = 1 - move;
            const cx = inv * inv * from.x + 2 * inv * move * ctrlX + move * move * to.x;
            const cy = inv * inv * from.y + 2 * inv * move * ctrlY + move * move * to.y;
            const w = lerp(TILE, piece.to.w, grow);
            const h = lerp(TILE, piece.to.h, grow);
            return { x: cx - w / 2, y: cy - h / 2, w, h, p, grow };
        };

        /* ---------- The sketch ---------- */
        const catmull = (pts, per) => {
            const out = [];
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[Math.max(0, i - 1)];
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const p3 = pts[Math.min(pts.length - 1, i + 2)];
                for (let k = 0; k < per; k++) {
                    const s = k / per;
                    const s2 = s * s;
                    const s3 = s2 * s;
                    out.push([
                        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
                        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3)
                    ]);
                }
            }
            out.push(pts[pts.length - 1]);
            let total = 0;
            out.lengths = [0];
            for (let i = 1; i < out.length; i++) {
                total += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
                out.lengths.push(total);
            }
            out.total = total;
            return out;
        };
        const roughBox = (cx, cy, w, h, seed) => {
            const j = (k) => (R.hash(seed + k * 7.13) - 0.5) * 7;
            const x0 = cx - w / 2;
            const x1 = cx + w / 2;
            const y0 = cy - h / 2;
            const y1 = cy + h / 2;
            return catmull(
                [
                    [x0 + 6 + j(1), y0 + 2 + j(2)],
                    [cx + j(3), y0 - 2 + j(4)],
                    [x1 - 3 + j(5), y0 + 1 + j(6)],
                    [x1 + 2 + j(7), y0 + 8],
                    [x1 + 1 + j(8), cy + j(9)],
                    [x1 - 2 + j(10), y1 + j(11)],
                    [cx + j(12), y1 + 3 + j(13)],
                    [x0 + 2 + j(14), y1 + j(15)],
                    [x0 - 2 + j(16), cy + j(17)],
                    [x0 + 1 + j(18), y0 + 10 + j(19)],
                    [x0 + 22 + j(20), y0 - 2 + j(21)]
                ],
                7
            );
        };
        const BOXES = [
            { cx: 130, cy: 222, word: 'line-up' },
            { cx: 350, cy: 222, word: 'tickets' },
            { cx: 570, cy: 222, word: 'map' }
        ];
        const arrowShaft = (x0, x1, y, seed) =>
            catmull(
                [
                    [x0, y + 2],
                    [(x0 + x1) / 2, y - 3 + (R.hash(seed) - 0.5) * 4],
                    [x1, y]
                ],
                10
            );
        const arrowHead = (x, y) =>
            catmull(
                [
                    [x - 13, y - 11],
                    [x, y],
                    [x - 13, y + 11]
                ],
                6
            );
        const SKETCH = [
            { kind: 'text', text: 'nachtveld', x: 44, y: 74, size: 40, t0: 5.0, t1: 5.6 },
            { kind: 'stroke', poly: roughBox(130, 222, 164, 104, 3), t0: 5.7, t1: 6.25 },
            { kind: 'text', text: 'line-up', x: 130, y: 232, size: 30, align: 'center', t0: 6.3, t1: 6.65 },
            { kind: 'stroke', poly: arrowShaft(218, 262, 222, 1), t0: 6.75, t1: 6.95 },
            { kind: 'stroke', poly: arrowHead(264, 222), t0: 6.97, t1: 7.1 },
            { kind: 'stroke', poly: roughBox(350, 222, 164, 104, 11), t0: 7.2, t1: 7.72 },
            { kind: 'text', text: 'tickets', x: 350, y: 232, size: 30, align: 'center', t0: 7.78, t1: 8.12 },
            { kind: 'stroke', poly: arrowShaft(438, 482, 222, 2), t0: 8.2, t1: 8.4 },
            { kind: 'stroke', poly: arrowHead(484, 222), t0: 8.42, t1: 8.55 },
            { kind: 'stroke', poly: roughBox(570, 222, 164, 104, 23), t0: 8.65, t1: 9.15 },
            { kind: 'text', text: 'map', x: 570, y: 232, size: 30, align: 'center', t0: 9.2, t1: 9.42 }
        ];
        // Which sketch item a box or arrow belongs to, for the staging while the agent reads.
        const SKETCH_GROUP = [-1, 0, 0, 0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2];
        const INK = '#e6e6ec';
        const textWidthCache = new Map();
        const handWidth = (item) => {
            let width = textWidthCache.get(item.text);
            if (width === undefined) {
                setFont(item.size, 400, HAND);
                width = measure(item.text);
                if (!document.fonts || document.fonts.status === 'loaded') {
                    textWidthCache.set(item.text, width);
                }
            }
            return width;
        };
        // The pen's position in the drawing body at t, or null when the person is not drawing.
        const penAt = (t) => {
            for (let i = 0; i < SKETCH.length; i++) {
                const item = SKETCH[i];
                const next = SKETCH[i + 1];
                if (t >= item.t0 && t <= item.t1) {
                    const k = (t - item.t0) / (item.t1 - item.t0);
                    if (item.kind === 'stroke') {
                        return pointAlong(item.poly, ease.inOutSine(k));
                    }
                    const width = handWidth(item);
                    const x0 = item.align === 'center' ? item.x - width / 2 : item.x;
                    return [x0 + width * k, item.y - item.size * 0.25 + Math.sin(k * 30) * 4];
                }
                if (next && t > item.t1 && t < next.t0) {
                    const a = penEnd(item);
                    const b = penStart(next);
                    const k = ease.inOutSine((t - item.t1) / (next.t0 - item.t1));
                    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k) - Math.sin(Math.PI * k) * 14];
                }
            }
            return null;
        };
        const penStart = (item) => {
            if (item.kind === 'stroke') {
                return item.poly[0];
            }
            const width = handWidth(item);
            return [item.align === 'center' ? item.x - width / 2 : item.x, item.y - item.size * 0.25];
        };
        const penEnd = (item) => {
            if (item.kind === 'stroke') {
                return item.poly[item.poly.length - 1];
            }
            const width = handWidth(item);
            return [(item.align === 'center' ? item.x - width / 2 : item.x) + width, item.y - item.size * 0.25];
        };

        /* ---------- Node contents ---------- */
        const readingFocus = (t) => {
            // Which box the agent is on, as a float that travels along the arrows.
            if (t < RS[0] - 0.3 || t > RS[2] + 1.2) {
                return { at: -1, on: 0 };
            }
            let at = 0;
            for (let k = 1; k < 3; k++) {
                at += ease.inOutSine(phase(t, RS[k] - 0.4, 0.4));
            }
            const on = R.smoothstep(RS[0] - 0.3, RS[0], t) * (1 - R.smoothstep(RS[2] + 0.7, RS[2] + 1.2, t));
            return { at, on };
        };
        const badge = (x, y, number, scale, radius = 13) => {
            if (scale <= 0.001) {
                return;
            }
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            ctx.fillStyle = pal.accent;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, TAU);
            ctx.fill();
            ctx.strokeStyle = 'rgba(13,13,16,0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
            label(String(number), 0, 0.5, radius * 1.05, '#ffffff', 600, SANS, 'center');
            ctx.restore();
        };
        const drawSketchBody = (x, y, t) => {
            const bx = x;
            const by = y + HEADER;
            const focus = readingFocus(t);
            ctx.save();
            ctx.beginPath();
            ctx.rect(bx, by, D.w, D.h - HEADER);
            ctx.clip();
            if (focus.on > 0.01) {
                const at = focus.at;
                const k = Math.floor(Math.min(at, 1.999));
                const frac = at - k;
                const gx0 = lerp(BOXES[k].cx, BOXES[Math.min(2, k + 1)].cx, frac);
                const cx = bx + gx0;
                const cy = by + BOXES[0].cy - Math.sin(Math.PI * frac) * 16;
                const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 120);
                glow.addColorStop(0, `rgba(96,165,250,${(0.2 * focus.on).toFixed(3)})`);
                glow.addColorStop(0.5, `rgba(96,165,250,${(0.07 * focus.on).toFixed(3)})`);
                glow.addColorStop(1, 'rgba(96,165,250,0)');
                ctx.fillStyle = glow;
                ctx.fillRect(cx - 120, cy - 120, 240, 240);
            }
            ctx.translate(bx, by);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (let i = 0; i < SKETCH.length; i++) {
                const item = SKETCH[i];
                const k = phase(t, item.t0, item.t1 - item.t0);
                if (k <= 0) {
                    continue;
                }
                // Staging: while one page is read, the rest of the sketch steps back.
                let bright = 1;
                if (focus.on > 0.01) {
                    const group = SKETCH_GROUP[i];
                    const near = group < 0 ? 0 : 1 - clamp(Math.abs(group - focus.at) / 0.7);
                    bright = lerp(1, lerp(0.4, 1, near), focus.on);
                }
                ctx.globalAlpha = bright;
                ctx.strokeStyle = INK;
                ctx.fillStyle = INK;
                if (item.kind === 'stroke') {
                    ctx.lineWidth = 2.6;
                    strokePoly(item.poly, 0, ease.inOutSine(k));
                } else {
                    const width = handWidth(item);
                    const x0 = item.align === 'center' ? item.x - width / 2 : item.x;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x0 - 6, item.y - item.size * 1.2, (width + 12) * k, item.size * 1.8);
                    ctx.clip();
                    setFont(item.size, 400, HAND);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText(item.text, x0, item.y);
                    ctx.restore();
                }
            }
            ctx.globalAlpha = 1;
            for (let k = 0; k < 3; k++) {
                const pop = ease.outBack(phase(t, RS[k] + 0.2, 0.4), 2.4);
                badge(BOXES[k].cx - 82, BOXES[k].cy - 52, k + 1, pop);
            }
            ctx.restore();
        };

        /* A thread, anchored to its bottom, newest last. */
        const threadHeight = (item, w) => {
            if (item.kind === 'user') {
                return wrap(item.text, w * 0.8 - 28, 14).lines * 21 + 20;
            }
            if (item.kind === 'text') {
                return wrap(item.text, w, 14).lines * 21;
            }
            if (item.kind === 'thumb') {
                return 152;
            }
            if (item.kind === 'order') {
                return 24;
            }
            return 28;
        };
        const drawToolRow = (item, x, y, w, t) => {
            const live = item.live && t >= item.live[0] && t < item.live[1];
            const cy = y + 14;
            icon(item.icon, x, cy - 6, 12, live ? pal.accent : pal.muted);
            const word = live ? item.label : item.done || item.label;
            let wide;
            if (live) {
                wide = shine(word, x + 20, cy, 13, t);
            } else {
                label(word, x + 20, cy, 13, pal.muted);
                setFont(13);
                wide = measure(word);
            }
            label(item.detail, x + 28 + wide, cy + 0.5, 12, pal.faint, 400, MONO);
            if (item.diff) {
                setFont(12, 400, MONO);
                const dx = x + 36 + wide + measure(item.detail);
                label('+4', dx, cy + 0.5, 12, pal.green, 400, MONO);
                label('-2', dx + 24, cy + 0.5, 12, pal.red, 400, MONO);
            }
            icon('chevronRight', x + w - 14, cy - 6, 12, pal.faint);
        };
        const drawThreadItem = (item, x, y, w, t, alpha) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            if (item.kind === 'user') {
                const layout = wrap(item.text, w * 0.8 - 28, 14);
                const bw = layout.widest + 28;
                const bh = layout.lines * 21 + 20;
                fillRound(x + w - bw, y, bw, bh, 16, pal.active);
                setFont(14);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = pal.text;
                for (const word of layout.words) {
                    ctx.fillText(word.word, x + w - bw + 14 + word.x, y + 10 + word.line * 21 + 10.5);
                }
            } else if (item.kind === 'text') {
                streamText(item.text, x, y, w, t, item.at, 1);
            } else if (item.kind === 'tool') {
                drawToolRow(item, x, y, w, t);
            } else if (item.kind === 'order') {
                badge(x + 8, y + 12, item.n, ease.outBack(phase(t, item.at, 0.35), 2), 8);
                const count = Math.floor(clamp((t - item.at - 0.05) / 0.45) * item.text.length);
                label(item.text.slice(0, count), x + 24, y + 12.5, 12.5, pal.termFg, 400, MONO);
            } else if (item.kind === 'waiting') {
                const open = openTasks(t);
                label(open === 1 ? 'Waiting on 1 task' : `Waiting on ${open} tasks`, x, y + 14, 13, pal.faint);
            } else if (item.kind === 'green') {
                icon(item.icon, x, y + 7, 14, pal.idle);
                label(item.text, x + 22, y + 14, 13, pal.idle);
            } else if (item.kind === 'thumb') {
                if (t >= item.lands) {
                    drawThumb(item.variant, x, y + 4, 220, 1);
                }
            }
            ctx.restore();
        };
        const thumbSlots = {};
        const drawThread = (items, x, top, w, bottom, t, key, ground = pal.surface) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x - 8, top, w + 16, bottom - top);
            ctx.clip();
            // A short thread reads from the top, as a chat does; a long one keeps its newest line in view.
            let total = 0;
            for (const item of items) {
                const grow = ease.inOutCubic(phase(t, item.at, 0.38)) * (1 - (item.until ? ease.inOutCubic(phase(t, item.until, 0.35)) : 0));
                if (grow > 0.001) {
                    total += (threadHeight(item, w) + 12) * grow;
                }
            }
            let y = Math.min(bottom, top + Math.max(0, total - 12));
            const end = y;
            for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
                const appear = ease.inOutCubic(phase(t, item.at, 0.38));
                const gone = item.until ? ease.inOutCubic(phase(t, item.until, 0.35)) : 0;
                const grow = appear * (1 - gone);
                if (grow <= 0.001) {
                    continue;
                }
                const h = threadHeight(item, w);
                y -= h * grow;
                if (y + h > top) {
                    // A line scrolling out under the top edge fades rather than being cut in half.
                    const alpha = ease.outCubic(phase(t, item.at + 0.08, 0.3)) * (1 - gone) * R.smoothstep(0.45, 0.85, (y + h - top) / h);
                    drawThreadItem(item, x, y + (1 - appear) * 6, w, t, alpha);
                    if (item.kind === 'thumb' && key) {
                        thumbSlots[key + item.variant] = { x, y: y + 4, w: 220 };
                    }
                }
                y -= 12 * grow;
                if (y < top - 40) {
                    break;
                }
            }
            // What scrolls out under the top edge dissolves into the node instead of being cut.
            if (total - 12 > bottom - top) {
                const veil = ctx.createLinearGradient(0, top, 0, top + 26);
                veil.addColorStop(0, R.rgba(ground, 1));
                veil.addColorStop(1, R.rgba(ground, 0));
                ctx.fillStyle = veil;
                ctx.fillRect(x - 8, top, w + 16, 26);
            }
            ctx.restore();
            return end;
        };

        /* The lead chat. */
        const L_ITEMS = [
            { at: T_SEND, kind: 'user', text: 'Build the site from this sketch.' },
            { at: 13.55, kind: 'tool', icon: 'eye', label: 'Read', detail: 'Festival site', live: [13.55, 16.2] },
            { at: RS[0] + 0.55, kind: 'order', n: 1, text: 'line-up   /lineup' },
            { at: RS[1] + 0.55, kind: 'order', n: 2, text: 'tickets   /tickets' },
            { at: RS[2] + 0.55, kind: 'order', n: 3, text: 'map       /map' },
            { at: 16.25, kind: 'tool', icon: 'eye', label: 'Read', detail: 'Brief', live: [16.25, 16.55] },
            { at: 16.6, kind: 'text', text: 'Three pages for Nachtveld, 14 to 16 August. One agent each, in a worktree of its own.' },
            { at: 17.95, kind: 'tool', icon: 'terminal', label: 'Starting', done: 'Started', detail: '3 agents', live: [17.95, 18.5] },
            { at: 19.0, kind: 'waiting', until: 41.0 },
            { at: 41.25, kind: 'text', text: 'All three are in. Merging their worktrees into main.' },
            { at: 42.1, kind: 'tool', icon: 'gitMerge', label: 'Merging', done: 'Conflict', detail: 'ruimte/lineup-page', live: [42.1, 42.5] },
            { at: 46.9, kind: 'green', icon: 'gitMerge', text: 'Merged 3 branches, 41 files' },
            { at: 52.95, kind: 'tool', icon: 'terminal', label: 'Running', done: 'Ran', detail: 'bun run deploy --prod', live: [52.95, 53.7] },
            { at: T_LIVE, kind: 'text', text: 'Live at nachtveld.app.' }
        ];
        const CHILD_DONE = [40.95, 34.6, 24.8];
        const openTasks = (t) => CHILD_DONE.filter((at) => t < at).length;
        const leadStatus = (t) => {
            if (t < T_SEND + 0.2) {
                return 'idle';
            }
            if (t < 19.0) {
                return 'running';
            }
            // A finished task wakes the chat that delegated it, once.
            for (const at of CHILD_DONE) {
                if (t >= at + 0.55 && t < at + 1.5 && at < 40) {
                    return 'running';
                }
            }
            if (t < 41.05) {
                return 'idle';
            }
            if (t < T_APPROVAL) {
                return 'running';
            }
            if (t < T_ALLOW + 0.4) {
                return 'needs';
            }
            if (t < T_LIVE) {
                return 'running';
            }
            return 'idle';
        };
        const DRAFT = 'Build the site from this sketch.';
        const T_TYPE = 11.95;
        const drawComposer = (x, y, w, t, alpha = 1) => {
            const h = 104;
            ctx.save();
            ctx.globalAlpha *= alpha;
            fillRound(x, y, w, h, 16, R.mix(pal.raised, pal.bg, 0.08));
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, 15.5, 'rgba(255,255,255,0.08)');
            const typed = Math.floor(clamp((t - T_TYPE) / 1.05) * DRAFT.length);
            if (t >= T_TYPE && t < T_SEND) {
                label(DRAFT.slice(0, typed), x + 20, y + 29, 14, pal.text);
                setFont(14);
                if (R.fract(t * 1.6) < 0.6 || typed < DRAFT.length) {
                    ctx.fillStyle = pal.text;
                    ctx.fillRect(x + 21 + measure(DRAFT.slice(0, typed)), y + 20, 1.5, 18);
                }
            } else {
                label('Ask anything', x + 20, y + 29, 14, pal.faint);
            }
            const row = y + h - 30;
            ctx.beginPath();
            ctx.arc(x + 36, row, 16, 0, TAU);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.stroke();
            icon('plus', x + 28, row - 8, 16, pal.muted);
            strokeRound(x + 60.5, row - 15.5, 176, 31, 15.5, 'rgba(255,255,255,0.08)');
            mark('claude', x + 72, row - 7, 14, pal.muted);
            label('Opus 5.5', x + 94, row + 0.5, 13, pal.text, 500);
            icon('edit', x + 158, row - 6, 12, pal.muted);
            label('Edits', x + 174, row + 0.5, 13, pal.muted);
            icon('chevronDown', x + 212, row - 6, 12, pal.muted);
            const press = Math.sin(Math.PI * phase(t, T_SEND - 0.08, 0.2));
            ctx.beginPath();
            ctx.arc(x + w - 32, row, 18 * (1 - press * 0.08), 0, TAU);
            ctx.fillStyle = pal.accent;
            ctx.fill();
            icon('arrowUp', x + w - 40, row - 8, 16, '#ffffff');
            ctx.restore();
            return h;
        };
        const APPROVAL_H = 172;
        const drawApproval = (x, y, w, h, t, alpha) => {
            ctx.save();
            fillRound(x, y, w, h, 16, R.mix(pal.raised, pal.bg, 0.08));
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, 15.5, 'rgba(255,255,255,0.1)');
            R.roundRect(ctx, x, y, w, h, 16);
            ctx.clip();
            ctx.globalAlpha *= alpha;
            const top = y + h - APPROVAL_H;
            icon('hand', x + 14, top + 16, 16, pal.needs);
            label('Run command', x + 40, top + 24, 14, pal.text, 600);
            label('1 request waiting', x + 40, top + 44, 13, pal.muted);
            fillRound(x + 12, top + 62, w - 24, 52, 12, pal.sunken);
            label('~/nachtveld-web', x + 24, top + 78, 13, pal.muted, 400, MONO);
            label('bun run deploy --prod', x + 24, top + 98, 13, pal.text, 400, MONO);
            const allowed = t >= T_ALLOW;
            button(x + w - 88, top + 128, 76, 30, allowed ? 'Allowed' : 'Allow', 'inverse', 1, Math.sin(Math.PI * phase(t, T_ALLOW, 0.2)));
            button(x + w - 158, top + 128, 62, 30, 'Deny', 'ghost');
            button(x + w - 272, top + 128, 106, 30, 'Always allow', 'ghost');
            ctx.restore();
        };
        const approvalOpen = (t) => settle(phase(t, T_APPROVAL, 0.6)) * (1 - glide(phase(t, T_ALLOW + 0.3, 0.55)));
        const drawChatBottom = (x, w, bottom, t) => {
            const open = approvalOpen(t);
            const h = lerp(104, APPROVAL_H, open);
            const y = bottom - h;
            if (open > 0.01) {
                drawApproval(x, y, w, h, t, R.smoothstep(0.4, 1, open));
                if (open < 0.4) {
                    ctx.save();
                    ctx.globalAlpha *= 1 - open / 0.4;
                    drawComposer(x, y, w, t);
                    ctx.restore();
                }
            } else {
                drawComposer(x, y, w, t);
            }
            return h;
        };
        const drawLead = (x, y, w, h, t, alpha) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            const status = leadStatus(t);
            const pop = Math.max(Math.sin(Math.PI * phase(t, T_APPROVAL, 0.5)), 0);
            nodeHeader(x, y, w, { glyph: 'claude', title: 'Launch the Nachtveld site', status: t > T_SEND ? status : null, pop }, t);
            const bottom = y + h - 12;
            const composerH = drawChatBottom(x + 12, w - 24, bottom, t);
            drawThread(L_ITEMS, x + 18, y + HEADER + 10, w - 36, bottom - composerH - 14, t, 'lead');
            ctx.restore();
        };

        /* The three agents the lead starts. */
        const SPAWN = [18.3, 18.45, 18.6];
        const CHILDREN = [
            {
                title: 'Line-up page',
                task: 'Build /lineup from the sketch',
                branch: 'ruimte/lineup-page',
                steps: ['Line-up data for Veld and Bos', 'Grid by day, 14 to 16 August', 'Check it in the browser'],
                stepsDone: [20.7, 23.1, 40.7],
                collapse: 33.0,
                items: [
                    { at: 19.9, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/data/lineup.ts', live: [19.9, 20.6] },
                    { at: 22.1, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/app/lineup/page.tsx', live: [22.1, 23.0] },
                    { at: 33.5, kind: 'tool', icon: 'globe', label: 'Open', done: 'Opened', detail: 'localhost:3000/lineup', live: [33.5, 35.5] },
                    { at: 35.9, kind: 'thumb', variant: 'bug', lands: 36.75 },
                    { at: 36.9, kind: 'text', text: 'The Bos column runs off the page.' },
                    { at: 37.65, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'LineupGrid.tsx', diff: true, live: [37.65, 38.35] },
                    { at: 38.45, kind: 'tool', icon: 'reload', label: 'Reload', done: 'Reloaded', detail: '/lineup', live: [38.45, 39.35] },
                    { at: 39.75, kind: 'thumb', variant: 'fixed', lands: 40.55 },
                    { at: 40.6, kind: 'text', text: 'Both stages fit now.' },
                    { at: 40.95, kind: 'green', icon: 'circleCheck', text: 'Task done' }
                ]
            },
            {
                title: 'Ticket shop',
                task: 'Build /tickets from the sketch',
                branch: 'ruimte/ticket-shop',
                steps: ['Ticket page', 'Checkout', 'Prices and passes'],
                stepsDone: [21.3, 25.3, 34.3],
                collapse: 99,
                items: [
                    { at: 20.3, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/app/tickets/page.tsx', live: [20.3, 21.2] },
                    { at: 22.9, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/lib/checkout.ts', live: [22.9, 24.9] },
                    { at: 31.1, kind: 'user', text: 'Day and weekend' },
                    { at: 31.9, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/data/passes.ts', live: [31.9, 33.9] },
                    { at: 34.6, kind: 'green', icon: 'circleCheck', text: 'Task done' }
                ]
            },
            {
                title: 'Festival map',
                task: 'Build /map from the sketch',
                branch: 'ruimte/festival-map',
                steps: ['Site plan', 'Stages and paths', 'Legend'],
                stepsDone: [20.4, 22.4, 24.6],
                collapse: 99,
                items: [
                    { at: 19.8, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/app/map/page.tsx', live: [19.8, 20.3] },
                    { at: 21.6, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/components/SiteMap.tsx', live: [21.6, 22.3] },
                    { at: 23.5, kind: 'tool', icon: 'edit', label: 'Edit', done: 'Edited', detail: 'src/data/stages.ts', live: [23.5, 24.5] },
                    { at: 24.8, kind: 'green', icon: 'circleCheck', text: 'Task done' }
                ]
            }
        ];
        const childStatus = (i, t) => {
            if (i === 1 && t >= T_ASKED && t < T_PICK + 0.2) {
                return 'needs';
            }
            return t >= CHILD_DONE[i] ? 'idle' : 'running';
        };

        /* The question card, grown out of the Ticket shop's lower edge. */
        const CHOICES = ['Day and weekend', 'Weekend only'];
        const DETAILS = ['Friday, Saturday or Sunday', 'One pass for three days'];
        const ROW_H = 36;
        const ROW_GAP = 6;
        const CARD_H = 14 + 24 + 10 + 3 * ROW_H + 2 * ROW_GAP + 12 + 30 + 14;
        const KEYS = [
            { at: 28.45, key: 'down', to: 1 },
            { at: 29.1, key: 'up', to: 0 }
        ];
        const T_ENTER = 29.75;
        const T_PICK = 30.0;
        const focusAt = (t) => {
            let at = 0;
            for (const press of KEYS) {
                at = lerp(at, press.to, glide(phase(t, press.at + 0.06, 0.34)));
            }
            return at;
        };
        const keyPress = (t, at) => ease.outQuad(phase(t, at, 0.07)) * (1 - ease.inOutQuad(phase(t, at + 0.14, 0.12)));
        const cardOpen = (t) => settle(phase(t, T_ASKED + 0.15, 0.7)) * (1 - glide(phase(t, T_ANSWERED, 0.7)));
        const drawQuestion = (x, y, w, h, t) => {
            const open = cardOpen(t);
            if (open <= 0.001) {
                return;
            }
            const cardH = CARD_H * open;
            const cx = x + 12;
            const cw = w - 24;
            const cy = y + h - 12 - cardH;
            fillRound(cx, cy + 3, cw, cardH, 15, 'rgba(0,0,0,0.35)');
            fillRound(cx, cy, cw, cardH, 15, pal.raised);
            strokeRound(cx + 0.5, cy + 0.5, cw - 1, cardH - 1, 14.5, 'rgba(255,255,255,0.11)');
            ctx.save();
            R.roundRect(ctx, cx, cy, cw, cardH, 15);
            ctx.clip();
            const top = y + h - 12 - CARD_H + 14;
            const inner = t < T_ANSWERED ? R.smoothstep(0.35, 0.75, open) : 1 - R.smoothstep(T_ANSWERED + 0.15, T_ANSWERED + 0.45, t);
            const qa = ease.outCubic(phase(t, T_ASKED + 0.4, 0.4));
            ctx.globalAlpha = inner * qa;
            icon('question', cx + 14, top + 2, 17, pal.needs);
            label('Sell day tickets, or weekend only?', cx + 40, top + 11 + (1 - qa) * 5, 14, pal.text, 600);
            const rowsTop = top + 34;
            const rowX = cx + 12;
            const rowW = cw - 24;
            const picked = t >= T_PICK;
            for (let i = 0; i < 3; i++) {
                const rp = ease.outCubic(phase(t, T_ASKED + 0.5 + i * 0.08, 0.42));
                const ry = rowsTop + i * (ROW_H + ROW_GAP) + (1 - rp) * 8;
                ctx.globalAlpha = inner * rp;
                const selected = picked && i === 0;
                fillRound(rowX, ry, rowW, ROW_H, 8, selected ? R.mix(pal.surface, pal.accent, 0.16) : pal.hover);
                strokeRound(rowX + 0.5, ry + 0.5, rowW - 1, ROW_H - 1, 7.5, selected ? pal.accent : 'rgba(255,255,255,0.07)');
                icon(selected ? 'circleCheck' : 'circle', rowX + 12, ry + 10, 16, selected ? pal.text : pal.muted);
                if (i < 2) {
                    label(CHOICES[i], rowX + 38, ry + 18.5, 13, pal.text);
                    setFont(13);
                    label(DETAILS[i], rowX + 46 + measure(CHOICES[i]), ry + 18.5, 13, pal.muted);
                } else {
                    label('Something else…', rowX + 38, ry + 18.5, 13, pal.muted);
                }
            }
            const focusIn = ease.outCubic(phase(t, 27.9, 0.25)) * (1 - phase(t, T_PICK, 0.2));
            if (focusIn > 0.001) {
                const focus = focusAt(t);
                const fy = rowsTop + focus * (ROW_H + ROW_GAP);
                const travel = Math.abs(focus - Math.round(focus));
                const stretch = Math.sin(Math.PI * Math.min(1, travel * 2)) * 5;
                ctx.globalAlpha = inner * focusIn;
                strokeRound(rowX - 2, fy - 2 - stretch / 2, rowW + 4, ROW_H + 4 + stretch, 10, pal.accent, 2);
            }
            const burst = phase(t, T_PICK, 0.55);
            if (burst > 0 && burst < 1) {
                const grow = ease.outCubic(burst) * 10;
                ctx.globalAlpha = inner * (1 - burst) * 0.7;
                strokeRound(rowX - grow, rowsTop - grow, rowW + grow * 2, ROW_H + grow * 2, 8 + grow, pal.accent, 1.5);
            }
            const footY = rowsTop + 3 * ROW_H + 2 * ROW_GAP + 12;
            ctx.globalAlpha = inner * ease.outCubic(phase(t, T_ASKED + 0.8, 0.4));
            let up = 0;
            let down = 0;
            for (const press of KEYS) {
                const amount = keyPress(t, press.at);
                if (press.key === 'up') {
                    up = Math.max(up, amount);
                } else {
                    down = Math.max(down, amount);
                }
            }
            const enter = ease.outQuad(phase(t, T_ENTER, 0.09)) * (1 - ease.inOutQuad(phase(t, T_PICK - 0.04, 0.12)));
            keycap('arrowUp', rowX, footY + 4, up, up);
            keycap('arrowDown', rowX + 26, footY + 4, down, down);
            label('Move', rowX + 56, footY + 15, 12, pal.faint);
            keycap('enter', rowX + 96, footY + 4, enter, enter);
            label('Answer', rowX + 126, footY + 15, 12, pal.faint);
            button(cx + cw - 12 - 92, footY + 1, 92, 28, 'Answer', 'inverse', 1, enter);
            ctx.restore();
        };

        const drawChild = (i, x, y, w, h, t, alpha) => {
            const child = CHILDREN[i];
            ctx.save();
            ctx.globalAlpha *= alpha;
            const status = childStatus(i, t);
            const pop = i === 1 ? Math.max(Math.sin(Math.PI * phase(t, T_ASKED, 0.5)), 0) : 0;
            nodeHeader(x, y, w, { glyph: 'claude', title: child.title, status, pop }, t);
            const by = y + HEADER;
            label(child.task, x + 16, by + 22, 14, pal.text);
            // The worktree chip, as the site draws it.
            setFont(12, 400, MONO);
            const chipW = measure(child.branch) + 34;
            fillRound(x + 16, by + 38, chipW, 24, 12, pal.sunken);
            icon('gitBranch', x + 24, by + 44, 12, pal.muted);
            label(child.branch, x + 42, by + 50.5, 12, pal.muted, 400, MONO);
            // The plan: its steps, the one in hand marked, a bar for what is done.
            const done = child.stepsDone.filter((at) => t >= at).length;
            const doneSmooth = child.stepsDone.reduce((sum, at) => sum + ease.inOutCubic(phase(t, at, 0.5)), 0);
            const py = by + 76;
            label('Plan', x + 16, py + 10, 13, pal.muted, 500);
            label(`${done}/3 done`, x + 52, py + 10, 13, pal.faint);
            const barX = x + w - 16 - 120;
            fillRound(barX, py + 7, 120, 6, 3, pal.sunken);
            if (doneSmooth > 0.01) {
                fillRound(barX, py + 7, (120 * doneSmooth) / 3, 6, 3, pal.idle);
            }
            const collapse = glide(phase(t, child.collapse, 0.5));
            const rowsH = 3 * 26 * (1 - collapse);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, py + 20, w, rowsH + 2);
            ctx.clip();
            for (let k = 0; k < 3; k++) {
                const ry = py + 22 + k * 26 - collapse * 20;
                const complete = t >= child.stepsDone[k];
                const active = !complete && (k === 0 || t >= child.stepsDone[k - 1]);
                ctx.globalAlpha = alpha * (1 - collapse);
                if (active) {
                    fillRound(x + 8, ry, w - 16, 24, 6, R.rgba(pal.accent, 0.12));
                }
                const check = ease.outBack(phase(t, child.stepsDone[k], 0.35), 2.2);
                if (complete) {
                    ctx.save();
                    ctx.translate(x + 28, ry + 12);
                    ctx.scale(check, check);
                    icon('circleCheck', -7, -7, 14, pal.idle);
                    ctx.restore();
                } else if (active) {
                    icon('loader', x + 21, ry + 5, 14, pal.accent, 1.75, t * 5);
                } else {
                    icon('circle', x + 21, ry + 5, 14, pal.faint);
                }
                label(child.steps[k], x + 44, ry + 12.5, 13, complete ? pal.muted : active ? pal.text : pal.muted);
            }
            ctx.restore();
            ctx.globalAlpha = alpha;
            // The working line at the bottom while the agent runs, the thread above it.
            const running = status === 'running' && t >= SPAWN[i];
            const workShown = R.smoothstep(SPAWN[i] + 0.4, SPAWN[i] + 0.8, t) * (1 - R.smoothstep(CHILD_DONE[i] - 0.3, CHILD_DONE[i], t));
            const threadTop = py + 24 + rowsH;
            const end = drawThread(child.items, x + 16, threadTop, w - 32, y + h - 14 - 30 * workShown, t, 'child' + i);
            if (workShown > 0.01) {
                const wy = end + (end > threadTop + 1 ? 10 : 2) + 10;
                ctx.save();
                ctx.globalAlpha *= workShown;
                statusDot(x + 20, wy, running ? 'running' : 'needs', t);
                const wide = running ? shine('Working for', x + 32, wy, 13, t) : (label('Waiting for you', x + 32, wy, 13, pal.muted), 96);
                if (running) {
                    const seconds = Math.floor(t - SPAWN[i] + 3 + i * 2);
                    label(`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, x + 38 + wide, wy, 13, pal.faint);
                }
                ctx.restore();
            }
            if (i === 1) {
                drawQuestion(x, y, w, h, t);
            }
            ctx.restore();
        };

        /* The Codex terminal that runs the tests. */
        const T_LINES = [
            { at: 0, parts: [['~/nachtveld-web', pal.cyan], [' $ ', pal.termDim], ['codex', pal.termFg]] },
            { at: 0, parts: [['', pal.termFg]] },
            { at: 0, parts: [['› ', pal.termDim], ['Run bun test after each merge into main.', pal.termFg]] },
            { at: 0, parts: [['• ', pal.termDim], ['Waiting for a merge into main', pal.termDim]] },
            { at: 46.95, parts: [['• ', pal.termDim], ['main moved: 3 branches merged', pal.termFg]] },
            { at: 47.15, parts: [['• ', pal.termDim], ['Ran bun test', pal.termFg]] },
            { at: 47.7, parts: [['  42 pass', pal.green]] },
            { at: 47.8, parts: [['  0 fail', pal.termDim]] }
        ];
        const drawTerminal = (x, y, w, h, t, alpha) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            const running = t >= 46.95 && t < 47.8;
            nodeHeader(x, y, w, { glyph: 'codex', title: 'tests', status: running ? 'running' : 'idle' }, t);
            ctx.beginPath();
            ctx.rect(x, y + HEADER, w, h - HEADER);
            ctx.clip();
            const shown = T_LINES.filter((line) => t >= line.at);
            let ly = y + h - 14 - shown.length * 20 + 10;
            for (const line of shown) {
                let lx = x + 14;
                const a = ease.outCubic(phase(t, line.at, 0.2));
                ctx.globalAlpha = alpha * (line.at === 0 ? 1 : a);
                for (const [str, color] of line.parts) {
                    label(str, lx, ly, 13, color, 400, MONO);
                    setFont(13, 400, MONO);
                    lx += measure(str);
                }
                ly += 20;
            }
            ctx.restore();
        };

        const drawNote = (x, y, w, h, t, alpha) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            nodeHeader(x, y, w, { glyph: 'note', title: 'Brief' }, t);
            const lines = ['Nachtveld, a three-day summer festival.', '14 to 16 August.', 'Two stages: Veld and Bos.'];
            for (let i = 0; i < lines.length; i++) {
                label(lines[i], x + 16, y + HEADER + 26 + i * 24, 14, pal.text);
            }
            ctx.restore();
        };

        /* ---------- The Nachtveld site, as the browser shows it ---------- */
        const SITE = { bg: '#0b0c14', text: '#f4f1ea', muted: '#8d8fa3', coral: '#b9a3ff', card: '#151726' };
        const ARTISTS = [
            [
                ['Mara Veil', '19:30', '#5b4bd6'],
                ['Hollow Pines', '21:00', '#0f766e'],
                ['Lune Parade', '22:30', '#c2410c']
            ],
            [
                ['Fen Lights', '19:45', '#be185d'],
                ['Otter and Oak', '21:15', '#4d7c0f'],
                ['Night Swim', '23:00', '#7c3aed']
            ]
        ];
        const PAGE_W = 640;
        // The page in its own 640 wide coordinates; `reveal` builds it block by block.
        const drawPage = (variant, height, reveal) => {
            const base = ctx.globalAlpha;
            const block = (i) => ease.outCubic(clamp(reveal * 8 - i));
            const rise = (i) => (1 - block(i)) * 6;
            ctx.fillStyle = SITE.bg;
            ctx.fillRect(0, 0, PAGE_W, height);
            ctx.globalAlpha = base * block(0);
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(0, 44, PAGE_W, 1);
            setFont(14, 700);
            ctx.letterSpacing = '3px';
            label('NACHTVELD', 24, 23, 14, SITE.text, 700);
            ctx.letterSpacing = '0px';
            const links = ['Line-up', 'Tickets', 'Map'];
            let lx = PAGE_W - 24;
            for (let i = links.length - 1; i >= 0; i--) {
                setFont(13, 500);
                const lw = measure(links[i]);
                lx -= lw;
                const on = variant !== 'soon' && i === 0;
                label(links[i], lx, 23, 13, on ? SITE.text : SITE.muted, 500);
                if (on) {
                    ctx.fillStyle = SITE.coral;
                    ctx.fillRect(lx, 36, lw, 2);
                }
                lx -= 22;
            }
            if (variant === 'soon') {
                ctx.globalAlpha = base * block(1);
                label('Nachtveld', PAGE_W / 2, 150 + rise(1), 46, SITE.text, 700, SANS, 'center');
                ctx.globalAlpha = base * block(2);
                label('14 to 16 August', PAGE_W / 2, 196 + rise(2), 16, SITE.muted, 400, SANS, 'center');
                ctx.globalAlpha = base * block(3);
                label('Coming soon', PAGE_W / 2, 236 + rise(3), 13, SITE.coral, 600, SANS, 'center');
                ctx.globalAlpha = base;
                return;
            }
            ctx.globalAlpha = base * block(1);
            label('Line-up', 24, 84 + rise(1), 30, SITE.text, 700);
            label('14 to 16 August', 150, 88 + rise(1), 14, SITE.muted);
            ctx.globalAlpha = base * block(2);
            const tabs = ['Fri 14', 'Sat 15', 'Sun 16'];
            for (let i = 0; i < 3; i++) {
                const tx = 24 + i * 80;
                if (i === 0) {
                    fillRound(tx, 112 + rise(2), 70, 28, 14, SITE.coral);
                } else {
                    strokeRound(tx + 0.5, 112.5 + rise(2), 69, 27, 13.5, 'rgba(255,255,255,0.16)');
                }
                label(tabs[i], tx + 35, 126.5 + rise(2), 13, i === 0 ? SITE.bg : SITE.muted, 600, SANS, 'center');
            }
            const fixed = variant !== 'bug';
            const colW = 288;
            const colX = [24, fixed ? 328 : 470];
            const stages = ['Veld', 'Bos'];
            for (let c = 0; c < 2; c++) {
                ctx.globalAlpha = base * block(3 + c);
                const cx = colX[c];
                label(stages[c], cx, 168 + rise(3 + c), 13, SITE.muted, 600);
                for (let k = 0; k < 3; k++) {
                    const cy = 184 + k * 56 + rise(3 + c);
                    fillRound(cx, cy, colW, 48, 8, SITE.card);
                    const [name, time, color] = ARTISTS[c][k];
                    fillRound(cx + 10, cy + 10, 28, 28, 6, color);
                    label(name, cx + 50, cy + 24.5, 14, SITE.text, 600);
                    label(time, cx + colW - 14, cy + 24.5, 12, SITE.muted, 400, MONO, 'right');
                }
            }
            ctx.globalAlpha = base;
        };
        const drawThumb = (variant, x, y, width, alpha) => {
            const height = Math.round(width * 0.652);
            const scale = width / PAGE_W;
            ctx.save();
            ctx.globalAlpha *= alpha;
            fillRound(x, y + 3, width, height, 7, 'rgba(0,0,0,0.35)');
            R.roundRect(ctx, x, y, width, height, 7);
            ctx.save();
            ctx.clip();
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            drawPage(variant, height / scale, 1);
            ctx.restore();
            strokeRound(x + 0.5, y + 0.5, width - 1, height - 1, 6.5, 'rgba(255,255,255,0.14)');
            ctx.restore();
        };

        /* The browser node: address bar over the page. */
        const HOST = 'localhost:3000';
        const urlOf = (t) => {
            if (t < 33.6) {
                return { text: HOST, typed: HOST.length };
            }
            const full = HOST + '/lineup';
            return { text: full, typed: HOST.length + Math.floor(clamp((t - 33.6) / 0.55) * 7) };
        };
        const pageOf = (t) => {
            if (t < 34.55) {
                return { variant: 'soon', reveal: 1, loading: t > 34.15 ? phase(t, 34.15, 0.4) : 0 };
            }
            if (t < 38.55) {
                return { variant: 'bug', reveal: phase(t, 34.55, 0.8), loading: 0 };
            }
            if (t < 38.75) {
                return { variant: 'bug', reveal: 1 - phase(t, 38.55, 0.2), loading: phase(t, 38.5, 0.25) };
            }
            return { variant: 'fixed', reveal: phase(t, 38.75, 0.8), loading: 0 };
        };
        const SHOTS = [35.6, 39.45];
        const drawAddressBar = (x, y, w, url, typed, loading) => {
            fillRound(x, y, w, 37, 0, pal.raised);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + 36, w, 1);
            icon('arrowLeft', x + 11, y + 11, 14, pal.muted);
            icon('arrowRight', x + 39, y + 11, 14, pal.muted);
            icon('reload', x + 67, y + 11, 14, pal.muted);
            const fx = x + 92;
            const fw = w - 92 - 40;
            fillRound(fx, y + 5, fw, 27, 6, pal.sunken);
            strokeRound(fx + 0.5, y + 5.5, fw - 1, 26, 5.5, 'rgba(255,255,255,0.05)');
            icon('lock', fx + 10, y + 12.5, 12, pal.muted);
            label(url.slice(0, typed), fx + 30, y + 19, 14, pal.text);
            icon('external', x + w - 29, y + 11, 14, pal.muted);
            if (loading > 0 && loading < 1) {
                ctx.fillStyle = 'rgba(21,93,252,0.16)';
                ctx.fillRect(x, y + 35, w, 2);
                ctx.fillStyle = pal.accent;
                ctx.fillRect(x + w * clamp(loading * 1.2 - 0.3), y + 35, w * 0.3, 2);
            }
        };
        const drawBrowser = (x, y, w, h, t, alpha) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            nodeHeader(x, y, w, { glyph: 'globe', title: 'Nachtveld' }, t);
            const url = urlOf(t);
            const page = pageOf(t);
            drawAddressBar(x, y + HEADER, w, url.text, url.typed, page.loading);
            const py = y + HEADER + 37;
            const ph = h - HEADER - 37;
            ctx.save();
            R.roundRect(ctx, x, y, w, h, 11);
            ctx.clip();
            ctx.beginPath();
            ctx.rect(x, py, w, ph);
            ctx.clip();
            ctx.translate(x, py);
            ctx.scale(w / PAGE_W, w / PAGE_W);
            drawPage(page.variant, ph, page.reveal);
            ctx.restore();
            // The picture: brackets breathe out, snap in, a flash.
            for (const shot of SHOTS) {
                const local = t - shot;
                if (local < -0.25 || local > 0.6) {
                    continue;
                }
                const out = ease.outCubic(phase(local, -0.25, 0.2));
                const snap = ease.inCubic(phase(local, -0.03, 0.15));
                const gone = 1 - phase(local, 0.25, 0.3);
                const inset = 18 - out * 8 + snap * 14;
                const arm = 26;
                ctx.strokeStyle = R.rgba('#ffffff', 0.9 * out * gone);
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';
                const x0 = x + inset;
                const y0 = py + inset;
                const x1 = x + w - inset;
                const y1 = py + ph - inset;
                ctx.beginPath();
                ctx.moveTo(x0, y0 + arm);
                ctx.lineTo(x0, y0);
                ctx.lineTo(x0 + arm, y0);
                ctx.moveTo(x1 - arm, y0);
                ctx.lineTo(x1, y0);
                ctx.lineTo(x1, y0 + arm);
                ctx.moveTo(x1, y1 - arm);
                ctx.lineTo(x1, y1);
                ctx.lineTo(x1 - arm, y1);
                ctx.moveTo(x0 + arm, y1);
                ctx.lineTo(x0, y1);
                ctx.lineTo(x0, y1 - arm);
                ctx.stroke();
                const flash = local > 0.12 ? 1 - ease.outCubic(phase(local, 0.12, 0.35)) : 0;
                if (flash > 0) {
                    ctx.fillStyle = R.rgba('#ffffff', 0.25 * flash);
                    ctx.fillRect(x, py, w, ph);
                }
            }
            ctx.restore();
        };
        // The picture flies along the line into the agent that asked for it.
        const drawFlights = (t) => {
            const flights = [
                { at: SHOTS[0] + 0.3, lands: 36.75, variant: 'bug' },
                { at: SHOTS[1] + 0.3, lands: 40.55, variant: 'fixed' }
            ];
            for (const flight of flights) {
                if (t < flight.at || t >= flight.lands) {
                    continue;
                }
                const k = glide(phase(t, flight.at, flight.lands - flight.at));
                const slot = thumbSlots['child0' + flight.variant] || { x: C[0].x + 16, y: C[0].y + C[0].h - 210, w: 220 };
                const fromW = B.w - 80;
                const fromX = B.x + 40;
                const fromY = B.y + HEADER + 37 + 30;
                const w = lerp(fromW, slot.w, k);
                const x = lerp(fromX, slot.x, k);
                const y = lerp(fromY, slot.y, k) - Math.sin(Math.PI * k) * 80;
                drawThumb(flight.variant, x, y, w, R.smoothstep(0, 0.1, k));
            }
        };

        /* ---------- Edges, as they appear ---------- */
        const T_DRAG = [
            { from: 'drawing', t0: 10.2, t1: 10.95 },
            { from: 'note', t0: 11.15, t1: 11.8 },
            { from: 'browser', t0: 32.75, t1: 33.35 }
        ];
        const dragOf = (key) => T_DRAG.find((drag) => drag.from === key);
        const edgeProgress = (key, t) => {
            const drag = dragOf(key);
            return ease.inOutSine(phase(t, drag.t0, drag.t1 - drag.t0));
        };
        const drawEdges = (t) => {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const key of ['drawing', 'note', 'browser']) {
                const poly = ROUTES[key];
                const k = edgeProgress(key, t);
                if (k <= 0) {
                    continue;
                }
                const snapped = k >= 1;
                const flash = snapped ? 1 - phase(t, dragOf(key).t1, 0.6) : 0;
                ctx.strokeStyle = snapped ? R.mix(pal.accent, pal.bg, 0.45 * (1 - flash)) : 'rgba(236,236,241,0.55)';
                ctx.lineWidth = 2 + flash;
                ctx.setLineDash([]);
                strokePoly(poly, 0, k);
                if (snapped) {
                    edgeEnd(poly[poly.length - 1], ctx.strokeStyle);
                }
            }
            // Task lines out of the lead: dashed while the task is open, solid once it is done.
            for (let i = 0; i < 3; i++) {
                const poly = ROUTES.task[i];
                const k = ease.inOutCubic(phase(t, SPAWN[i] - 0.2, 0.55));
                if (k <= 0) {
                    continue;
                }
                const done = t >= CHILD_DONE[i];
                ctx.strokeStyle = EDGE_CONTEXT;
                ctx.lineWidth = 2;
                ctx.setLineDash(done ? [] : [7, 7]);
                ctx.lineDashOffset = done ? 0 : -t * 14;
                strokePoly(poly, 0, k);
                ctx.setLineDash([]);
                if (k >= 1) {
                    edgeEnd(poly[poly.length - 1], EDGE_CONTEXT);
                }
                // The finished task travels home to the lead.
                const home = phase(t, CHILD_DONE[i] + 0.05, 0.55);
                if (home > 0 && home < 1) {
                    spark(poly, 1 - ease.inOutSine(home), Math.sin(Math.PI * home), 4, '74,222,128');
                }
            }
            // Context travels along the line from the sketch as it is read, then from the brief.
            for (let k = 0; k < 3; k++) {
                const p = phase(t, RS[k] + 0.2, 0.5);
                if (p > 0 && p < 1) {
                    spark(ROUTES.drawing, ease.inOutSine(p), Math.sin(Math.PI * p));
                }
            }
            const brief = phase(t, 16.05, 0.45);
            if (brief > 0 && brief < 1) {
                spark(ROUTES.note, ease.inOutSine(brief), Math.sin(Math.PI * brief));
            }
        };
        // A line being dragged: from its start to the cursor, before it snaps.
        const dragPoint = (key, t) => {
            const poly = ROUTES[key];
            return pointAlong(poly, edgeProgress(key, t));
        };

        /* ---------- Every node, spawned or morphed ---------- */
        const lean = (key, t) => {
            // The node a line lands on gives a little, then settles.
            let offset = 0;
            for (const drag of T_DRAG) {
                const target = drag.from === 'browser' ? 'B' : 'L';
                if (target === key) {
                    const since = t - drag.t1;
                    if (since > 0 && since < 1) {
                        offset += Math.exp(-since * 7) * Math.sin(since * 22) * 4;
                    }
                }
            }
            return offset;
        };
        const drawNodes = (t) => {
            // The five nodes born from the wordmark.
            const draws = [
                (x, y, w, h, a) => {
                    nodeHeader(x, y, w, { glyph: 'pen', title: 'Festival site' }, t, a);
                    if (a > 0.99) {
                        drawSketchBody(x, y, t);
                    }
                },
                (x, y, w, h, a) => drawNote(x, y, w, h, t, a),
                (x, y, w, h, a) => drawLead(x, y, w, h, t, a),
                (x, y, w, h, a) => drawTerminal(x, y, w, h, t, a),
                (x, y, w, h, a) => drawBrowser(x, y, w, h, t, a)
            ];
            const order = [0, 1, 3, 2, 4];
            for (const i of order) {
                if (t < leaveAt(i)) {
                    continue;
                }
                const piece = PIECES[i];
                const rect = morphRect(i, t);
                const dx = i === 2 ? -lean('L', t) : i === 4 ? -lean('B', t) : 0;
                const x = rect.x + dx;
                nodeFrame(x, rect.y, rect.w, rect.h, piece.kind);
                const content = R.smoothstep(0.55, 0.95, rect.p);
                if (content > 0.01) {
                    nodeChrome(x, rect.y, rect.w, rect.h, piece.kind, content);
                    ctx.save();
                    R.roundRect(ctx, x, rect.y, rect.w, rect.h, 11);
                    ctx.clip();
                    draws[i](x, rect.y, rect.w, rect.h, content);
                    ctx.restore();
                }
                nodeBorder(x, rect.y, rect.w, rect.h, R.rgba('#ffffff', lerp(0.14, 0.09, rect.p)));
                // The tile's glyph glides to where the header keeps it.
                const glyphFade = 1 - R.smoothstep(0.55, 0.85, rect.p);
                if (glyphFade > 0.01) {
                    const size = lerp(36, 14, R.smoothstep(0.1, 0.8, rect.p));
                    const gx0 = lerp(rect.x + rect.w / 2, x + 11 + 7, R.smoothstep(0.1, 0.8, rect.p));
                    const gy0 = lerp(rect.y + rect.h / 2, rect.y + HEADER / 2, R.smoothstep(0.1, 0.8, rect.p));
                    drawTileGlyph(i, gx0, gy0, size, t, glyphFade);
                }
            }
            // The team, sliding out along their task lines.
            for (let i = 2; i >= 0; i--) {
                const s = settle(phase(t, SPAWN[i], 0.75));
                if (s <= 0) {
                    continue;
                }
                const rect = C[i];
                const fromX = L.x + L.w - rect.w * 0.5;
                const fromY = L.y + L.h / 2 - rect.h / 2;
                const x = lerp(fromX, rect.x, s);
                const y = lerp(fromY, rect.y, s);
                const scale = lerp(0.85, 1, s);
                ctx.save();
                ctx.translate(x + rect.w / 2, y + rect.h / 2);
                ctx.scale(scale, scale);
                ctx.translate(-rect.w / 2, -rect.h / 2);
                ctx.globalAlpha = R.smoothstep(0, 0.4, s);
                nodeFrame(0, 0, rect.w, rect.h, 'chat');
                nodeChrome(0, 0, rect.w, rect.h, 'chat');
                ctx.save();
                R.roundRect(ctx, 0, 0, rect.w, rect.h, 11);
                ctx.clip();
                // Children are drawn in their own place so the thread slots stay true for the flights.
                ctx.translate(-rect.x, -rect.y);
                drawChild(i, rect.x, rect.y, rect.w, rect.h, t, 1);
                ctx.restore();
                const asking = i === 1 && childStatus(1, t) === 'needs';
                nodeBorder(0, 0, rect.w, rect.h, asking ? R.rgba(pal.needs, 0.45) : 'rgba(255,255,255,0.09)');
                ctx.restore();
            }
        };

        /* ---------- The person's pointer ---------- */
        const cursorAt = (t) => {
            // Sketching: the pen tip in the drawing's body.
            const pen = penAt(t);
            const inWorld = (x, y) => toScreen(x, y);
            if (t >= 4.5 && t < 10.2) {
                let pos;
                let alpha = 1;
                if (pen) {
                    pos = inWorld(D.x + pen[0], D.y + HEADER + pen[1]);
                } else if (t < SKETCH[0].t0) {
                    const start = penStart(SKETCH[0]);
                    const k = ease.outCubic(phase(t, 4.5, SKETCH[0].t0 - 4.5));
                    pos = inWorld(D.x + lerp(start[0] + 260, start[0], k), D.y + HEADER + lerp(start[1] + 300, start[1], k));
                    alpha = k;
                } else {
                    const end = penEnd(SKETCH[SKETCH.length - 1]);
                    const port = ROUTES.drawing[0];
                    const k = ease.inOutCubic(phase(t, 9.5, 0.65));
                    pos = inWorld(lerp(D.x + end[0], port[0], k), lerp(D.y + HEADER + end[1], port[1], k));
                }
                return { x: pos[0], y: pos[1], alpha, press: 0 };
            }
            for (const drag of T_DRAG) {
                if (t >= drag.t0 - 0.02 && t < drag.t1 + 0.2) {
                    const p = dragPoint(drag.from, Math.min(t, drag.t1));
                    const pos = inWorld(p[0], p[1]);
                    const alpha = drag.from === 'browser' ? R.smoothstep(drag.t0 - 0.35, drag.t0, t) : 1;
                    return { x: pos[0], y: pos[1], alpha, press: t > drag.t1 ? phase(t, drag.t1, 0.25) : 0 };
                }
            }
            if (t >= 10.95 && t < 11.15) {
                const a = inWorld(...ROUTES.drawing[ROUTES.drawing.length - 1]);
                const b = inWorld(...ROUTES.note[0]);
                const k = ease.inOutCubic(phase(t, 10.95, 0.2));
                return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), alpha: 1, press: 0 };
            }
            if (t >= 11.8 && t < 14.0) {
                const a = inWorld(...ROUTES.note[ROUTES.note.length - 1]);
                const b = inWorld(L.x + L.w - 44, L.y + L.h - 42);
                const k = ease.inOutCubic(phase(t, 11.85, 0.9));
                const rest = inWorld(L.x + L.w - 44, L.y + L.h - 42);
                const gone = phase(t, 13.4, 0.5);
                const x = lerp(a[0], b[0], k) + gone * 40;
                const y = lerp(a[1], b[1], k) + gone * 30;
                return { x: t > 12.8 ? rest[0] + gone * 40 : x, y: t > 12.8 ? rest[1] + gone * 30 : y, alpha: 1 - gone, press: Math.sin(Math.PI * phase(t, T_SEND - 0.08, 0.25)) };
            }
            if (t >= 33.35 && t < 34.0) {
                const p = inWorld(...ROUTES.browser[ROUTES.browser.length - 1]);
                const gone = phase(t, 33.45, 0.5);
                return { x: p[0] + gone * 50, y: p[1] + gone * 40, alpha: 1 - gone, press: 0 };
            }
            return null;
        };

        /* ---------- The merge overlay ---------- */
        const DS = 1.14;
        const DW = 1040;
        const DH = 620;
        const DX = (SW - DW * DS) / 2;
        const DY = (SH - DH * DS) / 2 - 36;
        const NAV = [
            '    return (',
            '        <nav className={STRETCH1}>',
            '            <Link href="/">Nachtveld</Link>',
            'STRETCH2',
            '        </nav>',
            '    );',
            '}'
        ];
        const ANSWERS = [
            { at: 44.05, work: 43.6, open: ['"site-nav"'], answer: ['"site-nav sticky"'] },
            {
                at: 44.8,
                work: 44.2,
                open: ['            <Link href="/tickets">Tickets</Link>', '            <Link href="/map">Map</Link>'],
                answer: ['            <Link href="/lineup">Line-up</Link>', '            <Link href="/tickets">Tickets</Link>', '            <Link href="/map">Map</Link>']
            }
        ];
        const T_ASK_AI = 43.45;
        const T_LAYOUT_DONE = 45.1;
        const T_MARK = 45.65;
        const T_FINISH = 46.2;
        const dialogCursor = (t) => {
            // In dialog units.
            const keys = [
                { t: 42.9, x: 640, y: 470 },
                { t: 43.4, x: DW - 104, y: 22 },
                { t: 45.2, x: DW - 104, y: 22 },
                { t: 45.6, x: DW - 262, y: DH - 24 },
                { t: 45.8, x: DW - 262, y: DH - 24 },
                { t: 46.15, x: DW - 70, y: DH - 24 },
                { t: 46.9, x: DW - 30, y: DH + 20 }
            ];
            if (t < keys[0].t - 0.3 || t > keys[keys.length - 1].t) {
                return null;
            }
            let x = keys[0].x;
            let y = keys[0].y;
            for (let i = 1; i < keys.length; i++) {
                const k = ease.inOutCubic(phase(t, keys[i - 1].t, keys[i].t - keys[i - 1].t));
                x = lerp(x, keys[i].x, k);
                y = lerp(y, keys[i].y, k);
            }
            let press = 0;
            for (const at of [T_ASK_AI, T_MARK, T_FINISH]) {
                press = Math.max(press, Math.sin(Math.PI * phase(t, at - 0.05, 0.3)));
            }
            const alpha = R.smoothstep(keys[0].t - 0.3, keys[0].t, t) * (1 - R.smoothstep(46.5, 46.9, t));
            return { x, y, press, alpha };
        };
        const drawDialog = (t) => {
            const open = settle(phase(t, T_OVERLAY, 0.5));
            const close = ease.inCubic(phase(t, T_OVERLAY_OUT, 0.4));
            const shown = open * (1 - close);
            if (shown <= 0.001) {
                return;
            }
            setVirtual();
            ctx.fillStyle = `rgba(0,0,0,${(0.55 * shown).toFixed(3)})`;
            ctx.fillRect(0, 0, SW, SH);
            ctx.save();
            ctx.globalAlpha = shown;
            const scale = DS * lerp(0.965, 1, open) * lerp(1, 0.975, close);
            ctx.translate(SW / 2, SH / 2 - 36 + (1 - open) * 14);
            ctx.scale(scale, scale);
            ctx.translate(-DW / 2, -DH / 2);
            fillRound(-2, 10, DW + 4, DH + 8, 16, 'rgba(0,0,0,0.45)');
            fillRound(0, 0, DW, DH, 14, pal.surface);
            ctx.save();
            R.roundRect(ctx, 0, 0, DW, DH, 14);
            ctx.clip();
            const line = (x, y, w, h) => {
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fillRect(x, y, w, h);
            };
            // Header.
            label('Resolve the merge', 16, 22, 16, pal.text, 600);
            setFont(16, 600);
            label('main against ruimte/lineup-page', 26 + measure('Resolve the merge'), 23, 12, pal.muted);
            const running = t >= T_ASK_AI + 0.1 && t < T_LAYOUT_DONE + 0.1;
            button(DW - 164, 8, 120, 28, 'Ask AI for all 2', 'secondary', 1, Math.sin(Math.PI * phase(t, T_ASK_AI - 0.05, 0.25)));
            icon('close', DW - 30, 15, 14, pal.muted);
            icon('sparkles', DW - 196, 15, 14, pal.muted);
            icon('wand', DW - 224, 15, 14, pal.muted);
            icon('chevronDown', DW - 254, 15, 14, pal.muted);
            icon('chevronUp', DW - 280, 15, 14, pal.muted);
            if (running) {
                const which = t < ANSWERS[1].at ? 'Nav.tsx, ' + (t < ANSWERS[0].at ? 1 : 2) + ' of 2' : 'layout.tsx, 1 of 1';
                icon('loader', DW - 470, 15, 13, pal.muted, 1.75, t * 6);
                label(which, DW - 452, 22, 12, pal.muted);
            }
            line(0, 44, DW, 1);
            // Footer.
            const marked = t >= T_MARK;
            line(0, DH - 48, DW, 1);
            label(marked ? 'Every file is resolved' : '2 files left', 16, DH - 24, 12, pal.muted);
            const ready = t >= T_LAYOUT_DONE;
            button(DW - 116, DH - 38, 104, 28, 'Finish merge', 'primary', marked ? 1 : 0.45, Math.sin(Math.PI * phase(t, T_FINISH - 0.05, 0.25)));
            if (ready && !marked) {
                button(DW - 262 - 60, DH - 38, 134, 28, 'Mark 2 resolved', 'secondary', ease.outCubic(phase(t, T_LAYOUT_DONE, 0.3)), Math.sin(Math.PI * phase(t, T_MARK - 0.05, 0.25)));
            }
            button(DW - 262 - 60 - 136, DH - 38, 126, 28, 'Abort merge', 'ghost', 1, 0, 'ban');
            // Files.
            const bodyTop = 45;
            const bodyBottom = DH - 49;
            line(256, bodyTop, 1, bodyBottom - bodyTop);
            if (!marked) {
                const files = [
                    { name: 'Nav.tsx', path: 'src/components/Nav.tsx', left: t < ANSWERS[0].at ? 2 : t < ANSWERS[1].at ? 1 : 0, active: true },
                    { name: 'layout.tsx', path: 'src/app/layout.tsx', left: t < T_LAYOUT_DONE ? 1 : 0, active: false }
                ];
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fy = bodyTop + 4 + i * 44;
                    if (file.active) {
                        fillRound(0, fy, 256, 42, 0, pal.active);
                    }
                    icon(file.left === 0 ? 'check' : 'fileWarning', 12, fy + 14, 14, file.left === 0 ? pal.idle : pal.needs);
                    label(file.name, 34, fy + 13, 12, pal.text);
                    label(file.path, 34, fy + 29, 12, pal.faint);
                    if (file.left > 0) {
                        label(String(file.left), 240, fy + 21, 12, pal.faint, 400, SANS, 'right');
                    }
                }
            } else {
                label('No files conflict.', 128, bodyTop + 30, 12, pal.faint, 400, SANS, 'center');
            }
            // The file.
            const mx = 257;
            const mw = DW - mx;
            if (marked) {
                const k = ease.outCubic(phase(t, T_MARK, 0.4));
                ctx.globalAlpha = shown * k;
                icon('check', mx + mw / 2 - 10, 230 - (1 - k) * 6, 20, pal.idle);
                label('Nothing conflicts any more', mx + mw / 2, 272, 14, pal.text, 500, SANS, 'center');
                label('Everything is resolved. Finish the merge below.', mx + mw / 2, 296, 12, pal.muted, 400, SANS, 'center');
                ctx.globalAlpha = shown;
            } else {
                label('src/components/Nav.tsx', mx + 12, bodyTop + 16, 12, pal.muted);
                const openHere = t < ANSWERS[0].at ? 2 : t < ANSWERS[1].at ? 1 : 0;
                label(`${openHere} of 2 open`, DW - 12, bodyTop + 16, 12, pal.faint, 400, SANS, 'right');
                line(mx, bodyTop + 32, mw, 1);
                const sidesTop = bodyBottom - 208;
                line(mx, sidesTop, mw, 1);
                // The merged file with its stretches.
                const lines = [
                    { text: "import Link from 'next/link';" },
                    { text: '' },
                    { text: 'export function Nav() {' }
                ];
                for (const row of NAV) {
                    if (row === 'STRETCH2') {
                        const answer = ANSWERS[1];
                        const rows = t >= answer.at ? answer.answer : answer.open;
                        rows.forEach((text) => lines.push({ text, stretch: 1 }));
                    } else if (row.includes('STRETCH1')) {
                        const answer = ANSWERS[0];
                        lines.push({ text: row.replace('{STRETCH1}', t >= answer.at ? answer.answer[0] : answer.open[0]), stretch: 0 });
                    } else {
                        lines.push({ text: row });
                    }
                }
                const codeTop = bodyTop + 44;
                setFont(13, 400, MONO);
                for (let i = 0; i < lines.length; i++) {
                    const row = lines[i];
                    const ly = codeTop + i * 21;
                    if (row.stretch !== undefined) {
                        const answer = ANSWERS[row.stretch];
                        const working = t >= answer.work && t < answer.at;
                        const answered = t >= answer.at;
                        const flash = 1 - phase(t, answer.at, 0.9);
                        let tint = 'rgba(251,191,36,0.1)';
                        let bar = pal.needs;
                        if (working) {
                            const pulse = 0.08 + 0.06 * Math.sin((t - answer.work) * 9);
                            tint = `rgba(96,165,250,${pulse.toFixed(3)})`;
                            bar = pal.running;
                        } else if (answered) {
                            tint = `rgba(74,222,128,${(0.07 + 0.1 * flash).toFixed(3)})`;
                            bar = pal.idle;
                        }
                        ctx.fillStyle = tint;
                        ctx.fillRect(mx, ly - 10, mw, 21);
                        ctx.fillStyle = bar;
                        ctx.fillRect(mx, ly - 10, 3, 21);
                    }
                    label(String(i + 1), mx + 38, ly + 0.5, 12, pal.faint, 400, MONO, 'right');
                    drawCode(row.text, mx + 56, ly + 0.5, row.stretch !== undefined && t >= ANSWERS[row.stretch].at ? phase(t, ANSWERS[row.stretch].at, 0.35) : 1);
                }
                // The two sides of the stretch in hand.
                const current = t < ANSWERS[0].at + 0.3 ? 0 : 1;
                const sides = current === 0
                    ? [['main', ['<nav className="site-nav">']], ['ruimte/lineup-page', ['<nav className="site-nav sticky">']]]
                    : [['main', ['<Link href="/tickets">Tickets</Link>', '<Link href="/map">Map</Link>']], ['ruimte/lineup-page', ['<Link href="/lineup">Line-up</Link>']]];
                const half = mw / 2;
                line(mx + half, sidesTop, 1, 172);
                for (let s = 0; s < 2; s++) {
                    const sx = mx + s * half;
                    label(sides[s][0], sx + 10, sidesTop + 16, 12, pal.muted, 500);
                    button(sx + half - 112, sidesTop + 4, 100, 24, 'Take this side', 'secondary');
                    line(sx, sidesTop + 32, half, 1);
                    sides[s][1].forEach((text, i) => drawCode(text, sx + 10, sidesTop + 50 + i * 21, 1));
                }
                line(mx, sidesTop + 172, mw, 1);
                const settled = t >= ANSWERS[current].at;
                if (settled) {
                    icon('check', mx + 10, sidesTop + 184, 12, pal.idle);
                    label('Answered', mx + 28, sidesTop + 190, 12, pal.idle);
                }
                button(DW - 12 - 170, sidesTop + 178, 170, 24, 'Both, main first', 'ghost', 1, 0, 'bothWays');
            }
            ctx.restore();
            strokeRound(0.5, 0.5, DW - 1, DH - 1, 13.5, 'rgba(255,255,255,0.12)');
            const pointer = dialogCursor(t);
            if (pointer) {
                ctx.save();
                ctx.translate(pointer.x, pointer.y);
                ctx.scale(1 / DS, 1 / DS);
                cursor(0, 0, pointer.alpha, pointer.press);
                ctx.restore();
            }
            ctx.restore();
        };
        const KEYWORDS = new Set(['import', 'from', 'export', 'function', 'return']);
        const drawCode = (text, x, y, alpha) => {
            setFont(13, 400, MONO);
            const re = /('[^']*'|"[^"]*"|[A-Za-z_]+|\s+|.)/g;
            let match;
            let cx = x;
            ctx.save();
            ctx.globalAlpha *= alpha;
            while ((match = re.exec(text))) {
                const part = match[0];
                let color = pal.termFg;
                if (part[0] === "'" || part[0] === '"') {
                    color = pal.green;
                } else if (KEYWORDS.has(part)) {
                    color = pal.magenta;
                } else if (/^[A-Z]/.test(part)) {
                    color = pal.cyan;
                } else if (/^[<>/{}()=;]+$/.test(part)) {
                    color = '#8b8b96';
                }
                if (part.trim()) {
                    label(part, cx, y, 13, color, 400, MONO);
                }
                cx += measure(part);
            }
            ctx.restore();
        };

        /* ---------- The window around the canvas, and the phone beside it ---------- */
        const WIN = { x: 0, y: 0, w: 1560 };
        const SIDEBAR = 248;
        const MAIN_W = WIN.w - SIDEBAR;
        const CELL_W = (MAIN_W - 1) / 2;
        const CONTENT_H = (CELL_W * 9) / 16;
        const CELL_H = CONTENT_H + 40;
        WIN.h = 48 + CELL_H * 2 + 1;
        const CELLS = [
            { x: SIDEBAR, y: 48, glyph: 'frame', name: 'Launch' },
            { x: SIDEBAR + CELL_W + 1, y: 48, glyph: 'globe', name: 'Nachtveld' },
            { x: SIDEBAR, y: 48 + CELL_H + 1, glyph: 'claude', name: 'Launch the Nachtveld site' },
            { x: SIDEBAR + CELL_W + 1, y: 48 + CELL_H + 1, glyph: 'codex', name: 'tests' }
        ];
        const CANVAS_CELL = { x: CELLS[0].x, y: CELLS[0].y + 40, w: CELL_W, h: CONTENT_H };
        const PHONE = { x: 1462, y: 236, w: 292, h: 610, r: 50 };
        const DESK_START = { x: CANVAS_CELL.x + CANVAS_CELL.w / 2, y: CANVAS_CELL.y + CANVAS_CELL.h / 2, z: SW / CANVAS_CELL.w };
        const DESK_WIDE = { x: 880, y: 452, z: 0.985 };
        const DESK_FAR = { x: 880, y: 452, z: 0.8 };
        const deskPath = makePath(DESK_START, DESK_WIDE, 'wijk', 1.0);
        const deskAt = (t) => {
            if (t < 51.2) {
                return deskPath(ease.inOutCubic(phase(t, T_DESK, 51.2 - T_DESK)));
            }
            if (t < T_END) {
                return { x: DESK_WIDE.x, y: DESK_WIDE.y, z: DESK_WIDE.z * (1 + 0.008 * (t - 51.2)) };
            }
            const from = { x: DESK_WIDE.x, y: DESK_WIDE.y, z: DESK_WIDE.z * (1 + 0.008 * (T_END - 51.2)) };
            return makePath(from, DESK_FAR, 'lerp')(ease.inOutCubic(phase(t, T_END, 1.6)));
        };
        const setDesk = (desk) => {
            ctx.setTransform(desk.z, 0, 0, desk.z, SW / 2 - desk.x * desk.z, SH / 2 - desk.y * desk.z);
        };
        const sidebarRow = (x, y, glyphName, name, opts, t) => {
            const nested = !!opts.nested;
            if (opts.selected) {
                fillRound(x + 8, y, SIDEBAR - 16, 32, 6, pal.active);
            }
            const tx = x + (nested ? 32 : 16);
            glyph(glyphName, tx, y + 9, 14, opts.selected ? pal.text : pal.muted);
            ctx.save();
            ctx.beginPath();
            ctx.rect(tx, y, SIDEBAR - 44 - tx + x, 32);
            ctx.clip();
            label(name, tx + 22, y + 16.5, 14, opts.selected || opts.beside ? pal.text : pal.muted, nested ? 400 : 500);
            ctx.restore();
            if (opts.done) {
                icon('circleCheck', x + SIDEBAR - 34, y + 10, 12, pal.idle);
            }
            if (opts.status) {
                statusDot(x + SIDEBAR - 24, y + 16, opts.status, t, 4);
            }
        };
        const drawWindow = (t) => {
            const needs = t >= T_APPROVAL && t < T_ALLOW + 0.35;
            const needsIn = ease.inOutCubic(phase(t, T_APPROVAL, 0.35)) * (1 - ease.inOutCubic(phase(t, T_ALLOW + 0.35, 0.35)));
            fillRound(WIN.x - 2, WIN.y + 24, WIN.w + 4, WIN.h, 16, 'rgba(0,0,0,0.5)');
            fillRound(WIN.x, WIN.y, WIN.w, WIN.h, 12, pal.bg);
            ctx.save();
            R.roundRect(ctx, WIN.x, WIN.y, WIN.w, WIN.h, 12);
            ctx.clip();
            // Sidebar.
            ctx.fillStyle = pal.surface;
            ctx.fillRect(0, 0, SIDEBAR, WIN.h);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(SIDEBAR - 1, 0, 1, WIN.h);
            const lights = ['#ff5f57', '#febc2e', '#28c840'];
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(23 + i * 20, 24, 6, 0, TAU);
                ctx.fillStyle = lights[i];
                ctx.fill();
            }
            label('Ruimte', 92, 24.5, 13, pal.faint, 600);
            icon('panelClose', SIDEBAR - 32, 16, 16, pal.muted);
            let ry = 58;
            if (needsIn > 0.01) {
                ctx.save();
                ctx.globalAlpha *= needsIn;
                statusDot(24, ry + 12, 'needs', t, 4);
                label('Needs you', 36, ry + 12.5, 13, pal.faint, 500);
                label('1', SIDEBAR - 20, ry + 12.5, 13, pal.faint, 500, SANS, 'right');
                sidebarRow(0, ry + 26, 'claude', 'Launch the Nachtveld site', { status: needs ? 'needs' : 'running' }, t);
                ctx.restore();
                ry += 72 * needsIn;
            }
            const lead = leadStatus(t);
            const rows = [
                ['frame', 'Launch', { selected: true }],
                ['pen', 'Festival site', { nested: true }],
                ['note', 'Brief', { nested: true }],
                ['claude', 'Launch the Nachtveld site', { nested: true, status: lead, beside: true }],
                ['claude', 'Line-up page', { nested: true, done: true }],
                ['claude', 'Ticket shop', { nested: true, done: true }],
                ['claude', 'Festival map', { nested: true, done: true }],
                ['codex', 'tests', { nested: true, beside: true }],
                ['globe', 'Nachtveld', { nested: true, beside: true }],
                'separator',
                ['frame', 'Press kit', {}],
                ['frame', 'Artist portal', {}]
            ];
            for (const row of rows) {
                if (row === 'separator') {
                    ctx.fillStyle = 'rgba(255,255,255,0.05)';
                    ctx.fillRect(0, ry + 12, SIDEBAR - 1, 1);
                    ry += 24;
                    continue;
                }
                sidebarRow(0, ry, row[0], row[1], row[2], t);
                ry += 33;
            }
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(0, WIN.h - 49, SIDEBAR - 1, 1);
            icon('plus', 18, WIN.h - 32, 14, pal.muted);
            label('View', 40, WIN.h - 24.5, 14, pal.muted);
            statusDot(SIDEBAR - 88, WIN.h - 25, 'idle', t, 4);
            icon('chart', SIDEBAR - 64, WIN.h - 33, 16, pal.muted);
            icon('settings', SIDEBAR - 32, WIN.h - 33, 16, pal.muted);
            // Toolbar.
            ctx.fillStyle = pal.surface;
            ctx.fillRect(SIDEBAR, 0, MAIN_W, 48);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(SIDEBAR, 47, MAIN_W, 1);
            icon('laptop', SIDEBAR + 18, 17, 14, pal.muted);
            fillRound(SIDEBAR + 42, 16, 16, 16, 3, R.rgba(SITE.coral, 0.2));
            label('N', SIDEBAR + 50, 24.5, 11, SITE.coral, 600, SANS, 'center');
            label('nachtveld-web', SIDEBAR + 66, 24.5, 14, pal.text, 500);
            setFont(14, 500);
            icon('chevronDown', SIDEBAR + 72 + measure('nachtveld-web'), 17, 14, pal.muted);
            const tr = WIN.w - 12;
            icon('search', tr - 22, 16, 16, pal.muted);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(tr - 44, 16, 1, 16);
            icon('tablet', tr - 78, 16, 16, pal.muted);
            icon('gitBranch', tr - 110, 16, 16, pal.muted);
            icon('folder', tr - 142, 16, 16, pal.muted);
            // Grid: cells on a hairline of the border color.
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(SIDEBAR, 48, MAIN_W, WIN.h - 48);
            for (let i = 0; i < 4; i++) {
                const cell = CELLS[i];
                ctx.fillStyle = pal.bg;
                ctx.fillRect(cell.x, cell.y, CELL_W, CELL_H);
                const focused = i === 0;
                ctx.fillStyle = focused ? pal.surface : '#0e0e10';
                ctx.fillRect(cell.x, cell.y, CELL_W, 40);
                ctx.fillStyle = 'rgba(255,255,255,0.07)';
                ctx.fillRect(cell.x, cell.y + 39, CELL_W, 1);
                glyph(cell.glyph, cell.x + 14, cell.y + 13, 14, focused ? pal.text : pal.muted);
                label(cell.name, cell.x + 36, cell.y + 20.5, 13, focused ? pal.text : pal.muted, 500);
                icon('close', cell.x + CELL_W - 26, cell.y + 13, 14, pal.muted);
            }
            drawBrowserCell(CELLS[1].x, CELLS[1].y + 40, CELL_W, CONTENT_H, t);
            drawChatCell(CELLS[2].x, CELLS[2].y + 40, CELL_W, CONTENT_H, t);
            drawTerminalCell(CELLS[3].x, CELLS[3].y + 40, CELL_W, CONTENT_H, t);
            ctx.restore();
            strokeRound(WIN.x + 0.5, WIN.y + 0.5, WIN.w - 1, WIN.h - 1, 11.5, 'rgba(255,255,255,0.1)');
        };
        const drawBrowserCell = (x, y, w, h, t) => {
            const live = t >= T_LIVE + 0.1;
            const url = live ? 'nachtveld.app/lineup' : 'localhost:3000/lineup';
            const loading = live ? phase(t, T_LIVE + 0.1, 0.5) : 0;
            drawAddressBar(x, y, w, url, url.length, loading);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y + 37, w, h - 37);
            ctx.clip();
            ctx.translate(x, y + 37);
            ctx.scale(w / PAGE_W, w / PAGE_W);
            const reveal = live ? phase(t, T_LIVE + 0.35, 0.7) : 1;
            drawPage('fixed', (h - 37) / (w / PAGE_W), reveal);
            ctx.restore();
        };
        const drawChatCell = (x, y, w, h, t) => {
            const colW = Math.min(w - 48, 540);
            const cx = x + (w - colW) / 2;
            const bottom = y + h - 12;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            const composerH = drawChatBottom(cx - 6, colW + 12, bottom, t);
            drawThread(L_ITEMS, cx, y + 14, colW, bottom - composerH - 14, t, null, pal.bg);
            ctx.restore();
        };
        const drawTerminalCell = (x, y, w, h, t) => {
            ctx.fillStyle = pal.termBg;
            ctx.fillRect(x, y, w, h);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            let ly = y + 20;
            for (const line of T_LINES) {
                let lx = x + 14;
                for (const [str, color] of line.parts) {
                    label(str, lx, ly, 13, color, 400, MONO);
                    setFont(13, 400, MONO);
                    lx += measure(str);
                }
                ly += 20;
            }
            ctx.restore();
        };
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
        const T_BANNER = 50.7;
        const T_EXPAND = 51.45;
        const drawPhone = (t) => {
            const { x, y, w, h, r } = PHONE;
            fillRound(x + 10, y + 26, w - 20, h, r, 'rgba(0,0,0,0.45)');
            ctx.fillStyle = '#2a2a31';
            ctx.fillRect(x - 3, y + 120, 4, 34);
            ctx.fillRect(x - 3, y + 166, 4, 56);
            ctx.fillRect(x + w - 1, y + 150, 4, 80);
            fillRound(x, y, w, h, r, '#26262d');
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, r - 0.5, 'rgba(255,255,255,0.14)');
            const sx = x + 8;
            const sy = y + 8;
            const sw = w - 16;
            const sh = h - 16;
            ctx.save();
            R.roundRect(ctx, sx, sy, sw, sh, r - 8);
            ctx.clip();
            const wall = ctx.createLinearGradient(sx, sy, sx + sw * 0.6, sy + sh);
            wall.addColorStop(0, '#16192a');
            wall.addColorStop(0.55, '#0e0f16');
            wall.addColorStop(1, '#0a0a0d');
            ctx.fillStyle = wall;
            ctx.fillRect(sx, sy, sw, sh);
            const expand = springy(phase(t, T_EXPAND, 0.8));
            const dismiss = ease.inCubic(phase(t, T_ALLOW + 0.4, 0.35));
            const back = clamp(ease.outCubic(phase(t, T_EXPAND, 0.35)) * (1 - ease.outCubic(phase(t, T_ALLOW + 0.45, 0.4))));
            const cx = sx + sw / 2;
            ctx.save();
            ctx.globalAlpha = 1 - back * 0.85;
            label('Friday, June 12', cx, sy + 104, 15, 'rgba(255,255,255,0.75)', 500, SANS, 'center');
            label('9:41', cx, sy + 160, 76, '#e9ecf4', 600, SANS, 'center');
            ctx.restore();
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.arc(cx + side * 88, sy + sh - 66, 24, 0, TAU);
                ctx.fill();
            }
            if (back > 0.01) {
                ctx.fillStyle = `rgba(0,0,0,${(0.4 * back).toFixed(3)})`;
                ctx.fillRect(sx, sy, sw, sh);
            }
            if (t >= T_BANNER && dismiss < 1) {
                const drop = springy(phase(t, T_BANNER, 0.75));
                const bannerH = 76;
                const cardH = 236;
                const rx = sx + lerp(10, 8, expand);
                const rw = sw - lerp(20, 16, expand);
                const rtop = lerp(lerp(sy - 100, sy + 236, drop), sy + 236, expand) - dismiss * 60;
                const rh = lerp(bannerH, cardH, expand);
                ctx.save();
                ctx.globalAlpha = clamp(drop * 3) * (1 - dismiss);
                fillRound(rx, rtop, rw, rh, lerp(20, 24, expand), expand < 0.5 ? 'rgba(58,58,66,0.9)' : R.mix('#3a3a42', pal.raised, clamp((expand - 0.5) * 2), 0.97));
                strokeRound(rx + 0.5, rtop + 0.5, rw - 1, rh - 1, lerp(20, 24, expand) - 0.5, 'rgba(255,255,255,0.08)');
                if (expand < 0.5) {
                    ctx.globalAlpha *= 1 - expand * 2;
                    appIcon(rx + 12, rtop + 16, 38);
                    label('Launch the Nachtveld site', rx + 60, rtop + 27, 14, '#ffffff', 600);
                    label('Allow deploy to production?', rx + 60, rtop + 49, 14, 'rgba(255,255,255,0.75)');
                    label('now', rx + rw - 12, rtop + 27, 12, 'rgba(255,255,255,0.45)', 400, SANS, 'right');
                } else {
                    ctx.globalAlpha *= (expand - 0.5) * 2;
                    const px = rx + 16;
                    const pw = rw - 32;
                    icon('hand', px, rtop + 18, 18, pal.needs);
                    label('Allow deploy to production?', px + 28, rtop + 28, 15, pal.text, 600);
                    label('Launch the Nachtveld site', px + 28, rtop + 50, 13, pal.muted);
                    fillRound(px, rtop + 72, pw, 58, 12, pal.sunken);
                    label('~/nachtveld-web', px + 12, rtop + 90, 13, pal.muted, 400, MONO);
                    label('bun run deploy --prod', px + 12, rtop + 112, 13, pal.text, 400, MONO);
                    const pressed = Math.sin(Math.PI * phase(t, T_ALLOW - 0.05, 0.25));
                    const chosen = ease.outCubic(phase(t, T_ALLOW + 0.05, 0.3));
                    const by = rtop + 152;
                    fillRound(px, by, pw, 38, 10, 'rgba(255,255,255,0.08)');
                    label('Deny', px + pw / 2, by + 19.5, 14, pal.text, 500, SANS, 'center');
                    ctx.save();
                    ctx.translate(px + pw / 2, by + 60);
                    ctx.scale(1 - pressed * 0.05, 1 - pressed * 0.05);
                    fillRound(-pw / 2, -19, pw, 38, 10, chosen > 0.5 ? R.mix(pal.text, pal.idle, (chosen - 0.5) * 2) : pal.text);
                    label(chosen > 0.5 ? 'Allowed' : 'Allow', 0, 0.5, 14, pal.bg, 600, SANS, 'center');
                    ctx.restore();
                    // A thumb press: a soft disc where the tap lands.
                    const tap = phase(t, T_ALLOW - 0.25, 0.7);
                    if (tap > 0 && tap < 1) {
                        const k = ease.outCubic(tap);
                        ctx.beginPath();
                        ctx.arc(px + pw / 2 + 30, by + 60, 12 + k * 24, 0, TAU);
                        ctx.fillStyle = `rgba(255,255,255,${(0.28 * (1 - k)).toFixed(3)})`;
                        ctx.fill();
                    }
                }
                ctx.restore();
            }
            fillRound(cx - 50, sy + 14, 100, 30, 15, '#000000');
            fillRound(cx - 60, sy + sh - 14, 120, 5, 2.5, 'rgba(255,255,255,0.55)');
            ctx.restore();
        };

        /* ---------- Captions and the end card ---------- */
        const drawCaptions = (t) => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            for (const caption of CAPTIONS) {
                if (t < caption.t0 - 0.1 || t > caption.t1 + 0.1) {
                    continue;
                }
                const a = ease.outCubic(phase(t, caption.t0, 0.45)) * (1 - ease.inCubic(phase(t, caption.t1 - 0.4, 0.4)));
                if (a <= 0.01) {
                    continue;
                }
                const band = ctx.createLinearGradient(0, SH - 230, 0, SH);
                band.addColorStop(0, 'rgba(13,13,16,0)');
                band.addColorStop(1, `rgba(13,13,16,${(0.92 * a).toFixed(3)})`);
                ctx.fillStyle = band;
                ctx.fillRect(0, SH - 230, SW, 230);
                ctx.globalAlpha = a;
                label(caption.text, SW / 2, SH - 88 + (1 - a) * 8, 30, pal.text, 500, SANS, 'center');
                ctx.globalAlpha = 1;
            }
        };
        const drawEndCard = (t) => {
            const k = ease.outCubic(phase(t, 56.35, 1.1));
            if (k <= 0) {
                return;
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            if (!measured) {
                measureWord();
                measured = true;
            }
            // The wordmark closes in from a little air, the way it opened the film.
            const track = (1 - k) * 34;
            const scale = 0.62;
            ctx.save();
            ctx.globalAlpha = k;
            ctx.translate(SW / 2, 470);
            ctx.scale(scale, scale);
            const total = wordW + track * 5;
            ctx.font = WORD_FONT;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = pal.text;
            const start = -total / 2;
            let tx = 0;
            for (let j = 0; j < WORD.length; j++) {
                ctx.fillText(j === DOT_AT ? 'ı' : WORD[j], start + left[j] + j * track, 0);
                if (j === DOT_AT) {
                    tx = start + left[j] + j * track + adv[j] / 2 + tittle.dx;
                }
            }
            R.roundRect(ctx, tx - tittle.w / 2, -(tittle.top - tittle.h / 2) - tittle.h / 2, tittle.w, tittle.h, Math.min(tittle.w, tittle.h) * 0.3);
            ctx.fillStyle = pal.accent;
            ctx.fill();
            ctx.restore();
            const tag = ease.outCubic(phase(t, 56.95, 0.8));
            ctx.globalAlpha = tag;
            label('Space for AI Engineering.', SW / 2, 580 + (1 - tag) * 8, 44, pal.text, 600, SANS, 'center');
            const url = ease.outCubic(phase(t, 57.45, 0.8));
            ctx.globalAlpha = url;
            label('ruimte.app', SW / 2, 650 + (1 - url) * 6, 26, pal.muted, 500, SANS, 'center');
            ctx.globalAlpha = 1;
        };

        /* ---------- The canvas stage ---------- */
        const drawCanvas = (t) => {
            cam = camAt(t);
            const grid = t < 2 ? 0 : ease.inOutSine(phase(t, 2.2, 1.3));
            dotGrid(grid);
            setWorld();
            drawEdges(t);
            if (t < 3.8) {
                drawWord(t);
            }
            drawNodes(t);
            drawFlights(t);
            setVirtual();
            const pointer = cursorAt(t);
            if (pointer) {
                cursor(pointer.x, pointer.y, pointer.alpha, pointer.press);
            }
            drawDialog(t);
        };

        return {
            draw(t) {
                if (t < T_DESK) {
                    view.s = 1;
                    view.x = 0;
                    view.y = 0;
                    drawCanvas(t);
                } else {
                    const desk = deskAt(t);
                    const fade = t < T_END ? 1 : 1 - ease.inOutSine(phase(t, T_END, 0.85));
                    if (fade > 0.001) {
                        ctx.save();
                        ctx.globalAlpha = fade;
                        setDesk(desk);
                        drawWindow(t);
                        // The canvas inside its cell: the same camera, now one view of the window.
                        const k = desk.z;
                        view.s = (k * CANVAS_CELL.w) / SW;
                        view.x = (CANVAS_CELL.x - desk.x) * k + SW / 2;
                        view.y = (CANVAS_CELL.y - desk.y) * k + SH / 2;
                        ctx.save();
                        setDesk(desk);
                        ctx.beginPath();
                        ctx.rect(CANVAS_CELL.x, CANVAS_CELL.y, CANVAS_CELL.w, CANVAS_CELL.h);
                        ctx.clip();
                        ctx.fillStyle = pal.bg;
                        ctx.fillRect(CANVAS_CELL.x, CANVAS_CELL.y, CANVAS_CELL.w, CANVAS_CELL.h);
                        cam = camAt(t);
                        dotGrid(1);
                        setWorld();
                        drawEdges(t);
                        drawNodes(t);
                        ctx.restore();
                        setDesk(desk);
                        drawPhone(t);
                        ctx.restore();
                    }
                }
                drawCaptions(t);
                drawEndCard(t);
                // A one pixel read ends the frame's recording, so frames drawn in a batch never pile up unflushed.
                ctx.getImageData(0, 0, 1, 1);
            }
        };
    },

    /* The score: D major at 96 BPM, bar lines on 2, 4.5, 7, 9.5 ... so the sketch, the context lines and the team
       each start on a downbeat. One motif carries the story: D5, E5, A5 are the three boxes of the sketch (line-up,
       tickets, map). They sound as the boxes are drawn, again as the agent reads them, as the three agents start,
       one at a time as each task comes home, together when the branches merge, and last under the end card. */
    score(kit) {
        const BEAT = 0.625;
        const GRID = -0.5;
        // Every grid step between two times, counted by index so the times never drift.
        const steps = (from, to, step) => {
            const out = [];
            for (let k = Math.ceil((from - GRID) / step - 1e-6); GRID + k * step < to - 1e-6; k++) {
                out.push({ time: GRID + k * step, k });
            }
            return out;
        };

        const CHORDS = {
            Dadd9: { pad: ['F#3', 'A3', 'D4', 'E4'], bass: 'D2', arp: ['D4', 'A4', 'E5', 'F#5'] },
            Gmaj9: { pad: ['B3', 'D4', 'F#4', 'A4'], bass: 'G2', arp: ['G4', 'B4', 'D5', 'F#5'] },
            A7sus4: { pad: ['G3', 'A3', 'D4', 'E4'], bass: 'A2', arp: ['A4', 'D5', 'E5', 'G5'] },
            A7: { pad: ['G3', 'A3', 'C#4', 'E4'], bass: 'A2', arp: ['A4', 'C#5', 'E5', 'G5'] },
            A: { pad: ['E3', 'A3', 'C#4', 'E4'], bass: 'A2', arp: ['A4', 'C#5', 'E5', 'A5'] },
            Bm7: { pad: ['F#3', 'A3', 'B3', 'D4'], bass: 'B1', arp: ['F#4', 'B4', 'D5', 'A5'] },
            Gmaj7: { pad: ['G3', 'B3', 'D4', 'F#4'], bass: 'G2', arp: ['G4', 'B4', 'D5', 'F#5'] },
            Em7: { pad: ['G3', 'B3', 'D4', 'E4'], bass: 'E2', arp: ['E4', 'B4', 'D5', 'G5'] },
            Glyd: { pad: ['G3', 'B3', 'C#4', 'F#4'], bass: 'G2', arp: null },
            DoverF: { pad: ['F#3', 'A3', 'D4', 'E4'], bass: 'F#2', arp: ['F#4', 'A4', 'D5', 'E5'] },
            Gadd9: { pad: ['G3', 'B3', 'D4', 'A4'], bass: 'G2', arp: ['G4', 'B4', 'D5', 'A5'] },
            Dend: { pad: ['D3', 'A3', 'E4', 'F#4', 'A4'], bass: 'D2', arp: null }
        };
        // I IV V under the wordmark; I vi in the sketch; IV ii V as the context goes over; I vi IV V for the team;
        // a Lydian IV that hangs while the question waits; I vi ii V in the browser; IV ii V I for the merge; and
        // the lift, IV I6 V IV, home to I on the end card.
        const CHANGES = [
            [0, 'Dadd9'], [2.0, 'Gmaj9'], [3.75, 'A7sus4'],
            [4.5, 'Dadd9'], [7.0, 'Bm7'],
            [9.5, 'Gmaj7'], [12.0, 'Em7'], [14.5, 'A7sus4'], [16.05, 'A7'],
            [17.0, 'Dadd9'], [19.5, 'Bm7'], [22.0, 'Gmaj7'], [24.5, 'A7sus4'],
            [26.2, 'Glyd'], [30.55, 'A7sus4'],
            [32.0, 'Dadd9'], [34.5, 'Bm7'], [37.0, 'Em7'], [39.5, 'A7sus4'], [40.55, 'A7'],
            [42.55, 'Gmaj7'], [44.5, 'Em7'], [45.65, 'A7sus4'],
            [46.9, 'Dadd9'], [48.3, 'Bm7'],
            [49.5, 'Gadd9'], [50.75, 'DoverF'], [52.0, 'A7sus4'], [52.5, 'A'], [53.8, 'Gadd9'],
            [55.6, 'Dend']
        ];
        const chordAt = (time) => {
            let name = CHANGES[0][1];
            for (const [at, which] of CHANGES) {
                if (at <= time + 1e-6) {
                    name = which;
                }
            }
            return CHORDS[name];
        };

        // How each stretch of the film is played. Energy follows the picture: thin at the wordmark and the sketch,
        // building with the team, empty for the question, full in the browser, focused for the merge, widest at the end.
        const SECTIONS = [
            { from: 0, to: 4.5, pad: [0.1, 900], bass: ['long', 0.1] },
            { from: 4.5, to: 9.5, pad: [0.1, 1000], bass: ['long', 0.13], arp: [BEAT, 0.04, 1600] },
            { from: 9.5, to: 17.0, pad: [0.105, 1150], bass: ['long', 0.16], arp: [BEAT / 2, 0.042, 1900] },
            { from: 17.0, to: 26.2, pad: [0.11, 1400], bass: ['pulse', 0.24], arp: [BEAT / 2, 0.068, 2300], kick: 0.45, hats: 19.5 },
            { from: 26.2, to: 32.0, pad: [0.1, 850], bass: ['long', 0.16] },
            { from: 32.0, to: 42.55, pad: [0.11, 1500], bass: ['pulse', 0.26], arp: [BEAT / 2, 0.07, 2600], kick: 0.46, hats: 32.0 },
            { from: 42.55, to: 46.9, pad: [0.105, 1250], bass: ['long', 0.22], arp: [BEAT, 0.07, 2200], kick: 0.3, sparse: true },
            { from: 46.9, to: 49.5, pad: [0.11, 1400], bass: ['long', 0.22], arp: [BEAT / 2, 0.06, 2300] },
            { from: 49.5, to: 55.6, pad: [0.12, 2000], bass: ['pulse', 0.3], arp: [BEAT / 2, 0.09, 3200], kick: 0.55, hats: 49.5, snare: true },
            { from: 55.6, to: 60, pad: [0.12, 1300], bass: ['long', 0.22] }
        ];
        // The arc of the pads, which carry most of the weight: a slow rise to the question, a drop, a rise to the end.
        const PAD_ARC = [[0, 0.042], [4.5, 0.033], [9.5, 0.035], [17, 0.045], [25.5, 0.058], [26.2, 0.03], [30.5, 0.032], [32, 0.052],
            [40.8, 0.058], [42.55, 0.046], [46.9, 0.048], [49.5, 0.072], [55.6, 0.08], [60, 0.07]];
        const arcAt = (time) => {
            for (let i = 1; i < PAD_ARC.length; i++) {
                if (time <= PAD_ARC[i][0]) {
                    const [t0, v0] = PAD_ARC[i - 1];
                    const [t1, v1] = PAD_ARC[i];
                    return v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
                }
            }
            return PAD_ARC[PAD_ARC.length - 1][1];
        };
        const sectionAt = (time) => SECTIONS.find((section) => time >= section.from - 1e-6 && time < section.to - 1e-6) || SECTIONS[SECTIONS.length - 1];

        const drums = kit.bus({ gain: 0.75, send: 0.06 });
        const low = kit.bus({ gain: 0.8, send: 0.04 });
        const pads = kit.bus({ gain: 0.8, send: 0.32, pan: -0.05 });
        const arps = kit.bus({ gain: 0.75, send: 0.28, pan: 0.12 });
        const bells = kit.bus({ gain: 0.8, send: 0.42, pan: -0.08 });
        const ui = kit.bus({ gain: 0.6, send: 0.12, pan: 0.05 });
        const fx = kit.bus({ gain: 0.7, send: 0.3 });

        // Pads and bass, one per chord.
        CHANGES.forEach(([at, name], i) => {
            const chord = CHORDS[name];
            const section = sectionAt(at);
            const next = i + 1 < CHANGES.length ? CHANGES[i + 1][0] : 60;
            const last = name === 'Dend';
            const length = last ? 1.2 : next - at;
            // Under the wordmark the chords bloom slowly, so the opening swells instead of stepping.
            const attack = i === 0 ? 1.8 : last ? 0.25 : at < 4.5 ? 1.0 : Math.min(0.9, Math.max(0.2, length * 0.3));
            // Each chord holds a little past the next one's start, so a change crossfades without a dip.
            kit.pad(pads, at, chord.pad, last ? length : length + attack * 0.6, { gain: arcAt(at + Math.min(length, 2) / 2), cutoff: section.pad[1], attack, release: last ? 2.4 : 1.0 });
            if (section.bass[0] === 'long' && at >= 3.75) {
                kit.bass(low, at, chord.bass, last ? 1.3 : length - 0.05, { gain: section.bass[1], cutoff: 380 });
            }
        });

        // The pulse: eighth-note bass, arpeggios and drums, section by section.
        const ORDER = [0, 1, 2, 3, 1, 2, 3, 2];
        const kicks = [];
        for (const section of SECTIONS) {
            if (section.bass[0] === 'pulse') {
                for (const { time, k } of steps(section.from, section.to, BEAT / 2)) {
                    const onBeat = k % 2 === 0;
                    kit.bass(low, time, chordAt(time).bass, 0.2, { gain: section.bass[1] * (onBeat ? 1 : 0.7), cutoff: onBeat ? 520 : 400 });
                }
            }
            if (section.arp) {
                const [step, gain, bright] = section.arp;
                for (const { time, k } of steps(section.from, section.to, step)) {
                    const chord = chordAt(time);
                    if (!chord.arp) {
                        continue;
                    }
                    const slot = step < BEAT ? k % 8 : (k * 2) % 8;
                    const accent = slot === 0 ? 1.25 : slot % 2 === 0 ? 1 : 0.8;
                    kit.pluck(arps, time, chord.arp[ORDER[slot]], { gain: gain * accent, length: 0.22, bright });
                }
            }
            if (section.kick) {
                for (const { time, k } of steps(section.from, section.to, BEAT)) {
                    const inBar = ((k % 4) + 4) % 4;
                    if (section.sparse ? inBar === 0 : inBar === 0 || inBar === 2) {
                        kit.kick(drums, time, { gain: section.kick * (inBar === 0 ? 1 : 0.8), pitch: 50 });
                        kicks.push(time);
                    }
                    if (section.snare && (inBar === 1 || inBar === 3)) {
                        kit.snare(drums, time, { gain: 0.16, tone: 200, decay: 0.14 });
                    }
                }
            }
            if (section.hats !== undefined) {
                for (const { time, k } of steps(section.hats, section.to, BEAT / 2)) {
                    kit.hat(drums, time, { gain: k % 2 === 0 ? 0.05 : 0.085 });
                }
            }
        }
        // The team hands off to the question: the pulse steps aside as the camera turns to the card.
        pads.sidechain(kicks, 0.28, 0.3);
        arps.sidechain(kicks, 0.3, 0.25);
        low.sidechain(kicks, 0.35, 0.18);
        drums.automate([[0, 0.75], [25.6, 0.75], [26.2, 0], [31.9, 0], [32.0, 0.75], [60, 0.75]]);
        arps.automate([[0, 0.75], [25.7, 0.75], [26.3, 0], [31.9, 0], [32.0, 0.75], [60, 0.75]]);
        low.automate([[0, 0.8], [25.7, 0.8], [26.2, 0.55], [31.9, 0.55], [32.0, 0.8], [60, 0.8]]);

        const motif = ['D5', 'E5', 'A5'];

        // 0 to 4.5: the wordmark. A bell on the dot, the five tiles popping out, a swell as the camera pulls back.
        kit.bell(bells, 0.12, 'A5', { gain: 0.14, decay: 2.4 });
        kit.bell(bells, 0.12, 'D5', { gain: 0.06, decay: 2.0 });
        [[0.94, 'A4'], [0.99, 'D5'], [0.99, 'F#5'], [1.04, 'E5'], [1.04, 'A5']].forEach(([time, name]) => {
            kit.pluck(arps, time, name, { gain: 0.05, length: 0.16, bright: 2600 });
        });
        kit.riser(fx, 1.8, 2.7, { gain: 0.1 });

        // 4.5 to 9.5: each box of the sketch gets its note of the motif as it is drawn.
        [5.7, 7.2, 8.65].forEach((time, i) => {
            kit.bell(bells, time, motif[i], { gain: 0.11, decay: 1.8 });
            kit.pluck(arps, time, motif[i], { gain: 0.05, length: 0.4, bright: 1800 });
        });

        // 9.5 to 17: the lines connect, the prompt goes, the agent reads the boxes in the order they were drawn.
        kit.tick(ui, 10.95, { gain: 0.05, pitch: 1800 });
        kit.tick(ui, 11.8, { gain: 0.05, pitch: 2000 });
        kit.tick(ui, 13.2, { gain: 0.07, pitch: 2400 });
        [13.9, 14.7, 15.5].forEach((time, i) => {
            kit.bell(bells, time, motif[i], { gain: 0.14, decay: 2.0 });
        });
        kit.riser(fx, 15.9, 1.1, { gain: 0.08 });

        // 17 to 26: three agents start, and the first task (the map) comes home.
        [18.3, 18.45, 18.6].forEach((time, i) => {
            kit.pluck(arps, time, motif[i], { gain: 0.09, length: 0.35, bright: 3000 });
            kit.bell(bells, time, motif[i], { gain: 0.07, decay: 1.4 });
        });
        kit.bell(bells, 24.8, 'A5', { gain: 0.14, decay: 2.2 });

        // 26 to 31: the question. The Lydian C# is the amber; arrow keys and Enter, then the answer lets V back in.
        kit.bell(bells, 26.3, 'C#6', { gain: 0.08, decay: 2.6 });
        kit.bell(bells, 26.3, 'F#5', { gain: 0.05, decay: 2.2 });
        kit.tick(ui, 28.45, { gain: 0.08, pitch: 1700 });
        kit.tick(ui, 29.1, { gain: 0.08, pitch: 2300 });
        kit.tick(ui, 29.75, { gain: 0.1, pitch: 1500 });
        kit.pluck(arps, 29.75, 'D5', { gain: 0.06, length: 0.5, bright: 1800 });
        kit.riser(fx, 31.1, 0.9, { gain: 0.08 });

        // 31 to 41: the browser. Two screenshots, the tickets task and then the line-up task come home.
        for (const shot of [35.6, 39.45]) {
            kit.tick(ui, shot, { gain: 0.07, pitch: 3200 });
            kit.tick(ui, shot + 0.07, { gain: 0.05, pitch: 2500 });
        }
        kit.bell(bells, 34.6, 'E5', { gain: 0.14, decay: 2.2 });
        kit.bell(bells, 40.95, 'D5', { gain: 0.15, decay: 2.2 });
        kit.riser(fx, 41.1, 1.45, { gain: 0.09 });

        // 41 to 48: the merge, stretch by stretch, then all three notes at once as the branches come together.
        kit.pluck(arps, 44.05, 'F#5', { gain: 0.08, length: 0.4, bright: 2800 });
        kit.tick(ui, 44.05, { gain: 0.05 });
        kit.pluck(arps, 44.8, 'A5', { gain: 0.08, length: 0.4, bright: 2800 });
        kit.tick(ui, 44.8, { gain: 0.05 });
        kit.tick(ui, 45.65, { gain: 0.06, pitch: 2000 });
        kit.tick(ui, 46.2, { gain: 0.07, pitch: 2400 });
        motif.forEach((name) => {
            kit.bell(bells, 46.9, name, { gain: 0.09, decay: 2.4 });
        });
        kit.tick(ui, 47.7, { gain: 0.04, pitch: 2600 });

        // 48 to 55.6: the window opens out, the phone asks, a tap approves, the site goes live.
        kit.riser(fx, 48.3, 1.2, { gain: 0.1 });
        kit.hat(drums, 49.5, { open: true, gain: 0.1 });
        kit.bell(bells, 50.7, 'E6', { gain: 0.06, decay: 1.2 });
        kit.tick(ui, 52.5, { gain: 0.08, pitch: 1900 });
        kit.bell(bells, 52.5, 'A5', { gain: 0.13, decay: 2.0 });
        kit.hat(drums, 53.8, { open: true, gain: 0.09 });
        motif.forEach((name, i) => {
            kit.bell(bells, 53.8 + i * 0.1, name, { gain: 0.09, decay: 1.8 });
        });

        // 55.6 to 60: home. A soft boom, the tonic, and the motif once more under the wordmark, tagline and URL.
        kit.impact(fx, 55.6, { gain: 0.22 });
        [56.35, 56.95, 57.45].forEach((time, i) => {
            kit.bell(bells, time, motif[i], { gain: 0.12, decay: 2.0 });
        });
    }
});
