Reel.add({
    id: 'letterspace',
    title: 'Letterspace',
    line: 'Ruimte is Dutch for space. So the word makes some.',
    principles: ['Squash and stretch', 'Anticipation', 'Exaggeration'],
    tech: 'Canvas 2D, measured glyphs, analytic springs',
    hint: 'Move along the word to make room',
    poster: 3.6,
    create(env) {
        const { R, W } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const PI = Math.PI;
        const LOOP = 9.6;

        const SIZE = 90;
        const FONT = `600 ${SIZE}px ${R.fonts.display}`;
        const WORD = ['r', 'u', 'i', 'm', 't', 'e'];
        const DOT_AT = 2;
        const BASELINE = 286;
        const CX = W / 2;
        // Each gap opens exactly as wide as the piece of the product it makes room for.
        const GAPS = [27, 22, 37, 47, 38];

        const T_SQUEEZE = 1.1;
        const T_OPEN = 1.46;
        const T_WIND = 4.92;
        const T_SLAM = 5.3;
        const SLAM_DUR = 0.14;
        const T_WAVE = 6.55;
        const WAVE_EVERY = 0.1;
        const HOP = 22;
        const HOP_DUR = 0.36;
        const CROUCH = 0.08;

        const springStep = (e, omega, zeta) => {
            if (e <= 0) {
                return 0;
            }
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * e) * (Math.cos(wd * e) + ((zeta * omega) / wd) * Math.sin(wd * e));
        };

        /* Metrics: advances, pair kerning and the tittle, measured from the real font once it is ready. */
        const adv = new Array(WORD.length).fill(SIZE * 0.5);
        const left = new Array(WORD.length).fill(0);
        let wordW = 0;
        let xHeight = SIZE * 0.54;
        const tittle = { dx: 0, top: SIZE * 0.72, w: SIZE * 0.135, h: SIZE * 0.13 };
        let measured = false;
        const probe = document.createElement('canvas');

        const measure = () => {
            ctx.save();
            ctx.font = FONT;
            for (let i = 0; i < WORD.length; i++) {
                adv[i] = ctx.measureText(i === DOT_AT ? '\u0131' : WORD[i]).width;
            }
            let x = 0;
            for (let i = 0; i < WORD.length; i++) {
                left[i] = x;
                x += adv[i];
                if (i < WORD.length - 1) {
                    const first = WORD[i];
                    const second = WORD[i + 1];
                    x += ctx.measureText(first + second).width - ctx.measureText(first).width - ctx.measureText(second).width;
                }
            }
            wordW = x;
            const xm = ctx.measureText('x');
            if (xm.actualBoundingBoxAscent) {
                xHeight = xm.actualBoundingBoxAscent;
            }
            ctx.restore();
            // Find the tittle as what the dotted i has and the dotless one does not.
            const scale = 4;
            const pw = Math.ceil(adv[DOT_AT] * scale) + 8;
            const ph = Math.ceil(SIZE * 1.1 * scale);
            probe.width = pw;
            probe.height = ph;
            const pen = probe.getContext('2d', { willReadFrequently: true });
            const base = SIZE * 0.95 * scale;
            pen.font = `600 ${SIZE * scale}px ${R.fonts.display}`;
            pen.fillStyle = '#fff';
            pen.fillText('i', 4, base);
            const dotted = pen.getImageData(0, 0, pw, ph).data;
            pen.clearRect(0, 0, pw, ph);
            pen.fillText('\u0131', 4, base);
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
                tittle.dx = ((x0 + x1 + 1) / 2 - 4) / scale - adv[DOT_AT] / 2;
                tittle.top = (base - y0) / scale;
            }
        };
        const fontReady = () => !document.fonts || document.fonts.check(FONT);

        /* The choreography, as pure functions of the loop time. */
        const squeezeOf = (t) => {
            if (t < T_SQUEEZE || t > T_OPEN + 0.3) {
                return 0;
            }
            const inn = R.ease.inOutSine(R.phase(t, T_SQUEEZE, 0.3));
            const out = R.smoothstep(T_OPEN, T_OPEN + 0.12, t);
            return inn * (1 - out);
        };
        const openDelay = (i) => Math.abs(i - 1.5) * 0.045;
        const slamStart = (i) => T_SLAM + Math.abs(i - 2) * 0.028;
        const impactOf = (i) => slamStart(i) + SLAM_DUR;

        const gapAt = (i, t) => {
            if (t < T_SQUEEZE) {
                return recoil(i, t + LOOP);
            }
            if (t < T_OPEN + openDelay(i)) {
                return -5 * R.ease.inOutSine(R.phase(t, T_SQUEEZE, 0.3));
            }
            const target = GAPS[i];
            let gap = -5 + (target + 5) * springStep(t - T_OPEN - openDelay(i), 9.5, 0.5);
            if (t < T_WIND) {
                return gap;
            }
            gap = target + 5 * R.ease.inOutSine(R.phase(t, T_WIND, 0.34));
            const s0 = slamStart(i);
            if (t < s0) {
                return gap;
            }
            if (t < s0 + SLAM_DUR) {
                const progress = (t - s0) / SLAM_DUR;
                return (target + 5) * (1 - progress * progress * progress);
            }
            return recoil(i, t);
        };
        // After the slam the letters bounce apart a hair, twice, and settle shut.
        const recoil = (i, t) => {
            const since = t - impactOf(i);
            if (since < 0 || since > 3) {
                return 0;
            }
            return 4.5 * Math.exp(-since * 8) * Math.abs(Math.sin(since * 15));
        };

        const itemScale = (i, t) => {
            const start = T_OPEN + openDelay(i) + 0.14;
            if (t < start) {
                return 0;
            }
            return springStep(t - start, 15, 0.38);
        };
        const popTime = (i) => {
            const target = GAPS[i] + 5;
            const need = GAPS[i] * 0.42;
            return slamStart(i) + SLAM_DUR * Math.cbrt(1 - need / target);
        };

        const hopOf = (j, t) => {
            const start = T_WAVE + j * WAVE_EVERY;
            const since = t - start;
            const out = hopState;
            out.dy = 0;
            out.sx = 1;
            out.sy = 1;
            if (since < 0 || since > CROUCH + HOP_DUR + 1) {
                return out;
            }
            if (since < CROUCH) {
                const press = Math.sin(((since / CROUCH) * PI) / 2);
                out.sy = 1 - 0.09 * press;
                out.sx = 1 + 0.06 * press;
                return out;
            }
            const progress = (since - CROUCH) / HOP_DUR;
            if (progress < 1) {
                out.dy = -HOP * 4 * progress * (1 - progress);
                const speed = Math.abs(1 - 2 * progress);
                out.sy = 1 + 0.13 * speed;
                out.sx = 1 / Math.sqrt(out.sy);
                return out;
            }
            const land = since - CROUCH - HOP_DUR;
            const wobble = Math.exp(-land * 9) * Math.cos(land * 21);
            out.sy = 1 - 0.1 * wobble;
            out.sx = 1 + 0.08 * wobble;
            return out;
        };
        const hopState = { dy: 0, sx: 1, sy: 1 };

        /* The tittle's own flight: tossed by the hop of the i, one bounce on the stem, home. */
        const DOT_G = 1500;
        const DOT_V0 = 520;
        const DOT_REST = 0.42;
        const dotLaunch = T_WAVE + DOT_AT * WAVE_EVERY + CROUCH;
        const T1 = (2 * DOT_V0) / DOT_G;
        const V1 = DOT_V0 * DOT_REST;
        const T2 = (2 * V1) / DOT_G;
        const dotImpact1 = dotLaunch + T1;
        const dotImpact2 = dotImpact1 + T2;
        const dotState = { free: false, x: 0, y: 0, sx: 1, sy: 1, round: 0 };
        const dotOf = (t) => {
            const state = dotState;
            state.free = false;
            state.x = 0;
            state.y = 0;
            state.sx = 1;
            state.sy = 1;
            state.round = 0;
            if (t < dotLaunch || t > dotImpact2 + 1.2) {
                return state;
            }
            if (t < dotImpact1) {
                const since = t - dotLaunch;
                const progress = since / T1;
                const speed = DOT_V0 - DOT_G * since;
                state.free = true;
                state.y = -(DOT_V0 * since - 0.5 * DOT_G * since * since);
                state.x = 7 * Math.sin(PI * progress);
                const st = 1 + 0.5 * (Math.abs(speed) / DOT_V0) * R.smoothstep(0, 0.05, since);
                state.sy = st;
                state.sx = 1 / Math.pow(st, 0.75);
                state.round = R.smoothstep(0, 0.12, since);
                return state;
            }
            if (t < dotImpact2) {
                const since = t - dotImpact1;
                const progress = since / T2;
                const speed = V1 - DOT_G * since;
                state.free = true;
                state.y = -(V1 * since - 0.5 * DOT_G * since * since);
                state.x = -2.5 * Math.sin(PI * progress);
                // Squashed on the first contact, then stretched by the speed of the bounce.
                const hit = Math.exp(-since * 30);
                const st = 1 + 0.35 * (Math.abs(speed) / DOT_V0);
                state.sy = st * (1 - 0.45 * hit);
                state.sx = (1 / Math.pow(st, 0.75)) * (1 + 0.5 * hit);
                state.round = 1;
                return state;
            }
            const since = t - dotImpact2;
            const wobble = Math.exp(-since * 10) * Math.cos(since * 26);
            state.sy = 1 - 0.3 * wobble;
            state.sx = 1 + 0.3 * wobble;
            state.round = 1 - R.smoothstep(0.05, 0.4, since);
            return state;
        };

        // The i gives under the tittle when it lands back on the stem.
        const stemHit = (t) => {
            let give = 0;
            const s1 = t - dotImpact1;
            if (s1 > 0 && s1 < 1.2) {
                give += 0.08 * Math.exp(-s1 * 10) * Math.cos(s1 * 24);
            }
            const s2 = t - dotImpact2;
            if (s2 > 0 && s2 < 1.2) {
                give += 0.035 * Math.exp(-s2 * 10) * Math.cos(s2 * 24);
            }
            return give;
        };

        const gaps = new Array(5).fill(0);
        const gx = new Array(WORD.length).fill(0);
        const gxPrev = new Array(WORD.length).fill(0);
        const layout = (t, out) => {
            let total = 0;
            for (let i = 0; i < 5; i++) {
                gaps[i] = gapAt(i, t);
                total += gaps[i];
            }
            const start = CX - (wordW + total) / 2;
            let acc = 0;
            for (let j = 0; j < WORD.length; j++) {
                out[j] = start + left[j] + acc + adv[j] / 2;
                if (j < 5) {
                    acc += gaps[j];
                }
            }
            return total;
        };

        const pointerShift = (x) => {
            const pointer = env.pointer;
            const near = pointer.active * (1 - R.smoothstep(70, 170, Math.abs(pointer.y - (BASELINE - xHeight / 2))));
            if (near < 0.001) {
                return 0;
            }
            return Math.tanh((x - pointer.x) / 46) * 13 * near;
        };
        const pointerLean = (x) => {
            const pointer = env.pointer;
            const near = pointer.active * (1 - R.smoothstep(70, 170, Math.abs(pointer.y - (BASELINE - xHeight / 2))));
            if (near < 0.001) {
                return 0;
            }
            const k = (x - pointer.x) / 46;
            const sech = 1 / Math.cosh(k);
            return -Math.sign(k) * 0.14 * sech * sech * near;
        };

        /* The pieces of the product that fill the gaps. */
        const ITEM_COLORS = [pal.termFg, pal.needs, pal.muted, pal.muted, pal.text];
        const drawItem = (i, x, y, scale, squeeze, t) => {
            ctx.save();
            ctx.translate(x, y);
            const wobble = (1 - R.clamp(scale)) * (i % 2 ? 0.35 : -0.35);
            ctx.rotate(wobble);
            const size = 1.14 * scale;
            ctx.scale(size * squeeze, size / Math.sqrt(Math.max(0.2, squeeze)));
            ctx.lineWidth = 1;
            if (i === 0) {
                ctx.strokeStyle = pal.termDim;
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(-9.5, -4);
                ctx.lineTo(-5.5, 0);
                ctx.lineTo(-9.5, 4);
                ctx.stroke();
                if (R.fract(t / 1.04) < 0.62 || t < T_OPEN + 0.8) {
                    ctx.fillStyle = pal.termFg;
                    R.roundRect(ctx, -2, -8.5, 9, 17, 1.2);
                    ctx.fill();
                } else {
                    ctx.strokeStyle = 'rgba(214,214,222,0.35)';
                    ctx.lineWidth = 1;
                    R.roundRect(ctx, -1.5, -8, 8, 16, 1.2);
                    ctx.stroke();
                }
            } else if (i === 1) {
                const pulse = R.fract(t / 2.08);
                ctx.beginPath();
                ctx.arc(0, 0, 5 + pulse * 10, 0, R.TAU);
                ctx.strokeStyle = R.rgba(pal.needs, 0.45 * (1 - pulse));
                ctx.lineWidth = 1.4 * (1 - pulse) + 0.4;
                ctx.stroke();
                const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
                glow.addColorStop(0, R.rgba(pal.needs, 0.28));
                glow.addColorStop(1, R.rgba(pal.needs, 0));
                ctx.fillStyle = glow;
                ctx.fillRect(-14, -14, 28, 28);
                ctx.beginPath();
                ctx.arc(0, 0, 5, 0, R.TAU);
                ctx.fillStyle = pal.needs;
                ctx.fill();
            } else if (i === 2) {
                ctx.beginPath();
                R.roundRect(ctx, -14, -10, 28, 18, 7);
                ctx.fillStyle = pal.hover;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.13)';
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(-8, 7.5);
                ctx.lineTo(-11, 12);
                ctx.lineTo(-3, 7.8);
                ctx.fillStyle = pal.hover;
                ctx.fill();
                for (let k = 0; k < 3; k++) {
                    const hop = Math.max(0, Math.sin((t * 1.923 - k * 0.16) * R.TAU)) * 2.2;
                    ctx.beginPath();
                    ctx.arc(-6 + k * 6, -1 - hop, 1.7, 0, R.TAU);
                    ctx.fillStyle = pal.muted;
                    ctx.fill();
                }
            } else if (i === 3) {
                R.roundRect(ctx, -19, -8, 38, 16, 8);
                ctx.fillStyle = pal.surface;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.14)';
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(-11, 0, 3.2, 0, R.TAU);
                ctx.moveTo(-14.2, 0);
                ctx.lineTo(-7.8, 0);
                ctx.strokeStyle = pal.muted;
                ctx.lineWidth = 0.9;
                ctx.stroke();
                ctx.fillStyle = 'rgba(236,236,241,0.55)';
                ctx.fillRect(-5, -1.3, 13, 2.6);
                ctx.fillStyle = 'rgba(154,154,166,0.4)';
                ctx.fillRect(9.5, -1.3, 5, 2.6);
            } else {
                ctx.beginPath();
                ctx.moveTo(-12, 6);
                ctx.bezierCurveTo(-2, 6, 2, -6, 12, -6);
                ctx.strokeStyle = 'rgba(236,236,241,0.5)';
                ctx.lineWidth = 1.4;
                ctx.stroke();
                // A packet of context rides along the edge.
                const along = R.fract(t / 1.3);
                const rest = 1 - along;
                const px = rest * rest * rest * -12 + 3 * rest * rest * along * -2 + 3 * rest * along * along * 2 + along * along * along * 12;
                const py = rest * rest * rest * 6 + 3 * rest * rest * along * 6 + 3 * rest * along * along * -6 + along * along * along * -6;
                ctx.beginPath();
                ctx.arc(px, py, 1.6, 0, R.TAU);
                ctx.fillStyle = `rgba(236,236,241,${(0.9 * Math.sin(PI * along)).toFixed(3)})`;
                ctx.fill();
                for (const [ex, ey] of [
                    [-12, 6],
                    [12, -6]
                ]) {
                    ctx.beginPath();
                    ctx.arc(ex, ey, 3, 0, R.TAU);
                    ctx.fillStyle = pal.surface;
                    ctx.fill();
                    ctx.strokeStyle = pal.text;
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
            }
            ctx.restore();
        };

        // The puff when an item is squeezed out: a few specks thrown up and down, out of the closing gap.
        const drawPuff = (i, x, y, t) => {
            const since = t - popTime(i);
            if (since < 0 || since > 0.55) {
                return;
            }
            const life = since / 0.55;
            ctx.fillStyle = R.rgba(ITEM_COLORS[i], 0.85 * (1 - life));
            for (let k = 0; k < 8; k++) {
                const h1 = R.hash(i * 31 + k * 7.1);
                const h2 = R.hash(i * 17 + k * 3.3);
                const side = k % 2 ? 1 : -1;
                const angle = side * (PI / 2) + (h1 - 0.5) * 1.5;
                const speed = 70 + 90 * h2;
                const travel = (speed * (1 - Math.exp(-since * 7))) / 7;
                const radius = (1.1 + 1.3 * h1) * (1 - life * 0.6);
                ctx.beginPath();
                ctx.arc(x + Math.cos(angle) * travel, y + Math.sin(angle) * travel + 25 * since * since, radius, 0, R.TAU);
                ctx.fill();
            }
            if (since < 0.2) {
                const k = since / 0.2;
                ctx.beginPath();
                ctx.ellipse(x, y, 3 + 5 * k, 8 + 16 * k, 0, 0, R.TAU);
                ctx.strokeStyle = R.rgba(ITEM_COLORS[i], 0.5 * (1 - k));
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        };

        const drawGuides = () => {
            const gradient = ctx.createLinearGradient(40, 0, W - 40, 0);
            gradient.addColorStop(0, 'rgba(255,255,255,0)');
            gradient.addColorStop(0.25, 'rgba(255,255,255,0.07)');
            gradient.addColorStop(0.75, 'rgba(255,255,255,0.07)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(40, BASELINE, W - 80, 1);
            ctx.fillRect(40, Math.round(BASELINE - xHeight), W - 80, 1);
        };

        const drawReadout = (total) => {
            const units = Math.round(((total / 5) * 1000) / SIZE);
            ctx.font = `500 11px ${R.fonts.mono}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = 'rgba(154,154,166,0.75)';
            const sign = units > 0 ? '+' : units < 0 ? '-' : '';
            ctx.fillText(`tracking ${sign}${Math.abs(units)}`, CX, BASELINE + 58);
        };

        const drawTittle = (x, y, sx, sy, round, glow) => {
            const width = tittle.w;
            const height = tittle.h;
            if (glow > 0.01) {
                const halo = ctx.createRadialGradient(x, y, 0, x, y, width * 2.2);
                halo.addColorStop(0, R.rgba(pal.accent, 0.45 * glow));
                halo.addColorStop(1, R.rgba(pal.accent, 0));
                ctx.fillStyle = halo;
                ctx.fillRect(x - width * 2.2, y - width * 2.2, width * 4.4, width * 4.4);
            }
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(sx, sy);
            const radius = Math.min(width, height) * R.lerp(0.18, 0.5, round);
            R.roundRect(ctx, -width / 2, -height / 2, width, height, radius);
            ctx.fillStyle = pal.accent;
            ctx.fill();
            ctx.restore();
        };

        return {
            draw(t) {
                env.clear();
                if (!measured && fontReady()) {
                    measure();
                    measured = true;
                } else if (!wordW) {
                    measure();
                }
                const local = R.mod(t, LOOP);
                drawGuides();
                const total = layout(local, gx);
                layout(R.mod(t - 1 / 60, LOOP), gxPrev);
                const squeeze = squeezeOf(local);
                ctx.font = FONT;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = pal.text;
                let iTop = { x: 0, y: 0, sx: 1, sy: 1, skew: 0 };
                for (let j = 0; j < WORD.length; j++) {
                    const x = gx[j] + pointerShift(gx[j]);
                    let speed = (gx[j] - gxPrev[j]) * 60;
                    if (Math.abs(speed) > 4000) {
                        speed = 0;
                    }
                    const stretch = Math.min(0.2, Math.abs(speed) * 0.0003);
                    let sx = (1 + stretch) * (1 - 0.045 * squeeze);
                    let sy = (1 - stretch * 0.55) * (1 + 0.035 * squeeze);
                    let skew = R.clamp(speed * 0.0003, -0.2, 0.2) + pointerLean(gx[j]);
                    // The slam lands on every letter: flattened on the baseline, wobbling back.
                    const imp = Math.max(j > 0 ? impactOf(j - 1) : 0, j < 5 ? impactOf(j) : 0);
                    const si = local - imp;
                    if (si > 0 && si < 2) {
                        const wobble = Math.exp(-si * 7) * Math.cos(si * 24) * R.smoothstep(0, 0.025, si);
                        sx *= 1 + 0.18 * wobble;
                        sy *= 1 - 0.16 * wobble;
                    }
                    const hop = hopOf(j, local);
                    sx *= hop.sx;
                    sy *= hop.sy;
                    if (j === DOT_AT) {
                        const hit = stemHit(local);
                        sy *= 1 - hit;
                        sx *= 1 + hit * 0.8;
                    }
                    const dy = hop.dy;
                    ctx.save();
                    ctx.translate(x, BASELINE + dy);
                    ctx.transform(sx, 0, -skew * sy, sy, 0, 0);
                    ctx.fillText(j === DOT_AT ? '\u0131' : WORD[j], -adv[j] / 2, 0);
                    ctx.restore();
                    if (j === DOT_AT) {
                        iTop = { x, y: BASELINE + dy, sx, sy, skew };
                    }
                }
                // The pieces sit in the gaps, at the middle of the x-height, and get squeezed out by the slam.
                const midY = BASELINE - xHeight / 2;
                for (let i = 0; i < 5; i++) {
                    const x = (gx[i] + gx[i + 1]) / 2 + (pointerShift(gx[i]) + pointerShift(gx[i + 1])) / 2;
                    const scale = itemScale(i, local);
                    const pop = popTime(i);
                    if (scale > 0.01 && local < pop) {
                        let squeezeItem = 1;
                        if (local > slamStart(i)) {
                            squeezeItem = R.clamp((gaps[i] - 4) / (GAPS[i] - 4), 0.3, 1);
                        }
                        drawItem(i, x, midY, scale, squeezeItem, local);
                    }
                    drawPuff(i, x, midY, local);
                }
                // The tittle rides on the i, unless it has been tossed.
                const dot = dotOf(local);
                const restX = iTop.x + tittle.dx * iTop.sx + iTop.skew * iTop.sy * (tittle.top - tittle.h / 2);
                const restY = iTop.y - (tittle.top - tittle.h / 2) * iTop.sy;
                if (dot.free) {
                    const homeX = gx[DOT_AT] + pointerShift(gx[DOT_AT]) + tittle.dx;
                    const homeY = BASELINE - (tittle.top - tittle.h / 2);
                    drawTittle(homeX + dot.x, homeY + dot.y - (tittle.h / 2) * (dot.sy - 1), dot.sx, dot.sy, dot.round, 1);
                } else {
                    drawTittle(restX, restY + (tittle.h / 2) * (1 - dot.sy), iTop.sx * dot.sx, iTop.sy * dot.sy, dot.round, 0.35 + 0.65 * dot.round);
                }
                drawReadout(total + (pointerShift(gx[5]) - pointerShift(gx[0])));
                env.fadeEdges(0.86, 1.0);
            }
        };
    }
});
