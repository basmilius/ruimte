Reel.add({
    id: 'resonance',
    title: 'Resonance',
    line: 'Find the right frequency and the noise settles into structure.',
    principles: ['Timing', 'Slow in and slow out'],
    tech: 'Canvas 2D, 6000 grains, Chladni modes',
    hint: 'Touch the plate to push the sand away',
    poster: 4.6,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const CX = W / 2;
        const CY = H / 2;
        // The plate is larger than the visible disc, so its square edge never shows.
        const HALF = 262;
        const COUNT = Math.round(6000 * Math.max(0.5, env.quality));
        const MODE_TIME = 5;
        // [n, m, sign]: minus is the classic antisymmetric figure, plus the symmetric one.
        const MODES = [
            [3, 7, -1],
            [4, 7, 1],
            [6, 9, -1],
            [5, 9, 1]
        ];
        const CYCLE = MODES.length * MODE_TIME;
        const PI = Math.PI;

        const px = new Float32Array(COUNT);
        const py = new Float32Array(COUNT);
        const vx = new Float32Array(COUNT);
        const vy = new Float32Array(COUNT);
        const kind = new Uint8Array(COUNT);

        // A tiny xorshift so the jitter is deterministic and allocation-free.
        let seed = 0x9e3779b9 | 0;
        const random = () => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) / 4294967296;
        };

        for (let i = 0; i < COUNT; i++) {
            px[i] = env.rand();
            py[i] = env.rand();
            const roll = env.rand();
            kind[i] = roll < 0.035 ? 3 : roll < 0.25 ? 2 : roll < 0.62 ? 1 : 0;
        }

        let lastMode = -1;
        let accumulator = 0;
        const STEP = 1 / 60;

        const modeAt = (time) => Math.floor(R.mod(time, CYCLE) / MODE_TIME);

        // The plate rings up after every change: quiet at first, then full, so the grains ease into the flow.
        const amplitudeAt = (time) => R.ease.inOutSine(R.invlerp(0.15, 1.3, R.mod(time, MODE_TIME)));

        // Grains share a few fills, so dense lines build up brightness the way piled sand does.
        const LAYERS = [
            [0, 1.25, 'rgba(236,226,208,0.42)'],
            [1, 1.25, 'rgba(240,232,218,0.55)'],
            [2, 1.7, 'rgba(246,240,230,0.62)'],
            [3, 1.6, 'rgba(96,140,255,0.9)']
        ];

        const kick = (strength) => {
            for (let i = 0; i < COUNT; i++) {
                const angle = random() * R.TAU;
                const speed = strength * (0.35 + random() * 0.65);
                vx[i] += Math.cos(angle) * speed;
                vy[i] += Math.sin(angle) * speed;
            }
        };

        const stepGrains = (slice, time) => {
            const mode = MODES[modeAt(time)];
            const sign = mode[2];
            const amp = amplitudeAt(time);
            const settle = Math.min(1, 3.2 * slice) * amp;
            const maxStep = 0.42 * slice;
            const jitter = 0.11 * Math.sqrt(slice) * amp;
            const damp = Math.exp(-slice * 7);
            const pointer = env.pointer;
            const fingerX = (pointer.x - CX) / (HALF * 2) + 0.5;
            const fingerY = (pointer.y - CY) / (HALF * 2) + 0.5;
            const fingerOn = pointer.active;
            const fingerR = 58 / (HALF * 2);
            const nPi = mode[0] * PI;
            const mPi = mode[1] * PI;
            for (let i = 0; i < COUNT; i++) {
                let x = px[i];
                let y = py[i];
                const cnx = Math.cos(nPi * x);
                const snx = Math.sin(nPi * x);
                const cmx = Math.cos(mPi * x);
                const smx = Math.sin(mPi * x);
                const cny = Math.cos(nPi * y);
                const sny = Math.sin(nPi * y);
                const cmy = Math.cos(mPi * y);
                const smy = Math.sin(mPi * y);
                const wave = cnx * cmy + sign * cmx * cny;
                const slopeX = -nPi * snx * cmy - sign * mPi * smx * cny;
                const slopeY = -mPi * cnx * smy - sign * nPi * cmx * sny;
                const slope2 = slopeX * slopeX + slopeY * slopeY + 1e-4;
                // A damped Newton step toward the nearest nodal line: fast far away, soft as it arrives.
                let dx = ((-wave * slopeX) / slope2) * settle;
                let dy = ((-wave * slopeY) / slope2) * settle;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > maxStep) {
                    dx *= maxStep / len;
                    dy *= maxStep / len;
                }
                // Grains only dance where the plate moves; on a node they are still.
                const shake = jitter * (Math.abs(wave) + 0.075);
                x += dx + (random() - 0.5) * shake + vx[i] * slice;
                y += dy + (random() - 0.5) * shake + vy[i] * slice;
                vx[i] *= damp;
                vy[i] *= damp;
                if (fingerOn > 0.01) {
                    const ox = x - fingerX;
                    const oy = y - fingerY;
                    const d2 = ox * ox + oy * oy;
                    if (d2 < fingerR * fingerR) {
                        const dist = Math.sqrt(d2) + 1e-5;
                        const push = (fingerR - dist) * Math.min(1, 14 * slice) * fingerOn;
                        x += (ox / dist) * push;
                        y += (oy / dist) * push;
                    }
                }
                px[i] = x < 0 ? -x : x > 1 ? 2 - x : x;
                py[i] = y < 0 ? -y : y > 1 ? 2 - y : y;
            }
        };

        return {
            update(t, dt) {
                const mode = modeAt(t);
                if (mode !== lastMode) {
                    if (lastMode !== -1) {
                        kick(0.34);
                    }
                    lastMode = mode;
                }
                accumulator += dt;
                while (accumulator >= STEP * 0.5) {
                    const slice = Math.min(STEP, accumulator);
                    stepGrains(slice, t);
                    accumulator -= slice;
                }
            },
            draw(t) {
                env.clear();
                const local = R.mod(t, MODE_TIME);
                const mode = MODES[modeAt(t)];

                // The ring that leaves the center at every change of frequency.
                const ring = R.invlerp(0, 1.5, local);
                if (ring < 1 && t >= MODE_TIME) {
                    const radius = 30 + R.ease.outCubic(ring) * 250;
                    ctx.strokeStyle = R.rgba('#c9d6ff', 0.16 * (1 - ring) * (1 - ring));
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.arc(CX, CY, radius, 0, R.TAU);
                    ctx.stroke();
                }

                const plate = HALF * 2;
                const ox = CX - HALF;
                const oy = CY - HALF;
                for (let j = 0; j < LAYERS.length; j++) {
                    const layer = LAYERS[j];
                    const size = layer[1];
                    const half = size / 2;
                    ctx.fillStyle = layer[2];
                    ctx.beginPath();
                    for (let i = 0; i < COUNT; i++) {
                        if (kind[i] !== layer[0]) {
                            continue;
                        }
                        // A grain in the air after a kick reads a touch larger, as if nearer.
                        const speed = Math.abs(vx[i]) + Math.abs(vy[i]);
                        const lift = speed > 0.05 ? Math.min(1, speed * 3) * 0.9 : 0;
                        const grain = size + lift;
                        ctx.rect(ox + px[i] * plate - half - lift / 2, oy + py[i] * plate - half - lift / 2, grain, grain);
                    }
                    ctx.fill();
                }

                // The dial: which mode the plate sings in, fading across a change.
                const labelIn = R.smoothstep(0.2, 0.9, local) * (1 - R.smoothstep(MODE_TIME - 0.35, MODE_TIME, local));
                env.fadeEdges(0.52, 0.86);

                // Drawn after the mask: a quiet readout tucked into the corner, well inside the box.
                ctx.font = '500 11px ' + R.fonts.mono;
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = R.rgba(R.pal.muted, 0.5 * labelIn);
                ctx.fillText('n ' + mode[0] + '  m ' + mode[1], 56, 446);
                ctx.fillStyle = R.rgba(R.pal.faint, 0.6 * labelIn);
                ctx.fillText(Math.round(110 * Math.hypot(mode[0], mode[1])) + ' Hz', 56, 461);
            }
        };
    }
});
