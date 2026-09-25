Reel.add({
    id: 'in-step',
    title: 'In Step',
    line: 'Twenty sessions, each on its own clock, falling into step.',
    principles: ['Timing', 'Arcs'],
    tech: 'Canvas 2D, harmonic motion in 3D projection',
    hint: 'Move to turn the frame',
    poster: 3.2,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const COUNT = 20;
        // Pendulum k swings BASE + k times per cycle, so once a cycle they all meet again in one line.
        const CYCLE = 32;
        const BASE = 16;
        const SWING = 62;
        const TRAIL = 16;
        const TRAIL_SPAN = 0.7;
        const BAR_Y = 118;
        const HALF_BAR = 218;
        const LONGEST = 262;
        const FLOOR_Y = BAR_Y - LONGEST - 64;
        const FOCAL = 760;
        const DISTANCE = 900;
        const CX = W / 2;
        const CY = H / 2 - 4;

        const pivotX = new Float32Array(COUNT);
        const length = new Float32Array(COUNT);
        const omega = new Float32Array(COUNT);
        const amplitude = new Float32Array(COUNT);
        const slowest = CYCLE / BASE;
        const fastest = CYCLE / (BASE + COUNT - 1);
        for (let k = 0; k < COUNT; k++) {
            const period = CYCLE / (BASE + k);
            pivotX[k] = R.lerp(-HALF_BAR, HALF_BAR, k / (COUNT - 1));
            // The physical rule (length grows with the period squared), pressed into a gentler range.
            const shape = (period * period - fastest * fastest) / (slowest * slowest - fastest * fastest);
            length[k] = R.lerp(150, LONGEST, shape);
            omega[k] = (R.TAU * (BASE + k)) / CYCLE;
            // Every bob starts from the same sideways pull, like a board that lets them all go at once.
            amplitude[k] = Math.asin(SWING / length[k]);
        }

        const bobX = new Float32Array(COUNT);
        const bobY = new Float32Array(COUNT);
        const bobDepth = new Float32Array(COUNT);
        const poolX = new Float32Array(COUNT);
        const poolY = new Float32Array(COUNT);
        const poolScale = new Float32Array(COUNT);
        const pivX = new Float32Array(COUNT);
        const pivY = new Float32Array(COUNT);
        const trailX = new Float32Array(COUNT * TRAIL);
        const trailY = new Float32Array(COUNT * TRAIL);
        const order = new Int32Array(COUNT);
        const byDepth = (left, right) => bobDepth[right] - bobDepth[left];
        const out = { x: 0, y: 0, depth: 0 };

        const GRID = 28;
        const GRID_COLS = 23;
        const GRID_ROWS = 17;

        // The bobs turn from running to done as the row comes into line; the steps are built once.
        const STEPS = 32;
        const bobColors = [];
        for (let i = 0; i <= STEPS; i++) {
            bobColors.push(R.mix(R.pal.running, R.pal.idle, i / STEPS));
        }

        let cosYaw = 1;
        let sinYaw = 0;
        let cosPitch = 1;
        let sinPitch = 0;
        const project = (x, y, forward) => {
            const x1 = x * cosYaw - forward * sinYaw;
            const z1 = x * sinYaw + forward * cosYaw;
            const y2 = y * cosPitch - z1 * sinPitch;
            const z2 = y * sinPitch + z1 * cosPitch;
            const depth = DISTANCE + z2;
            out.x = CX + (FOCAL * x1) / depth;
            out.y = CY - (FOCAL * y2) / depth;
            out.depth = depth;
        };

        const sprite = (hex, core, mid) => {
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const paint = canvas.getContext('2d');
            const grad = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            grad.addColorStop(0, R.rgba(hex, core));
            grad.addColorStop(0.28, R.rgba(hex, mid));
            grad.addColorStop(1, R.rgba(hex, 0));
            paint.fillStyle = grad;
            paint.fillRect(0, 0, size, size);
            return canvas;
        };
        const glowRunning = sprite(R.pal.running, 0.6, 0.2);
        const glowIdle = sprite(R.pal.idle, 0.6, 0.2);
        const poolRunning = sprite(R.pal.running, 0.3, 0.12);
        const poolIdle = sprite(R.pal.idle, 0.3, 0.12);

        const angleAt = (k, time) => amplitude[k] * Math.cos(omega[k] * time);

        return {
            draw(t) {
                env.clear();
                const pointer = env.pointer;
                const phase = (R.TAU * t) / CYCLE;
                // The camera breathes once per cycle, so the loop closes on the same view.
                const yaw = -0.34 + 0.14 * Math.sin(phase) + pointer.nx * 0.55 * pointer.active;
                const pitch = 0.62 + 0.06 * Math.sin(phase * 2 + 0.6) + pointer.ny * 0.22 * pointer.active;
                cosYaw = Math.cos(yaw);
                sinYaw = Math.sin(yaw);
                cosPitch = Math.cos(pitch);
                sinPitch = Math.sin(pitch);

                // How close the row is to one line: the length of the mean phase vector.
                let sumC = 0;
                let sumS = 0;
                for (let k = 0; k < COUNT; k++) {
                    sumC += Math.cos(omega[k] * t);
                    sumS += Math.sin(omega[k] * t);
                }
                const inStep = Math.pow(Math.hypot(sumC, sumS) / COUNT, 3);

                // A neutral dot grid for a floor: the canvas the sessions live on.
                ctx.fillStyle = '#c8ccd6';
                for (let row = 0; row < GRID_ROWS; row++) {
                    const rowZ = (row - (GRID_ROWS - 1) / 2) * GRID;
                    for (let col = 0; col < GRID_COLS; col++) {
                        const x = (col - (GRID_COLS - 1) / 2) * GRID;
                        const reach = (x * x) / (300 * 300) + (rowZ * rowZ) / (220 * 220);
                        if (reach > 1) {
                            continue;
                        }
                        project(x, FLOOR_Y, rowZ);
                        const size = (1.5 * FOCAL) / out.depth;
                        ctx.globalAlpha = 0.16 * (1 - reach) * (1 - reach);
                        ctx.fillRect(out.x - size / 2, out.y - size / 2, size, size);
                    }
                }
                ctx.globalAlpha = 1;

                for (let k = 0; k < COUNT; k++) {
                    project(pivotX[k], BAR_Y, 0);
                    pivX[k] = out.x;
                    pivY[k] = out.y;
                    const angle = angleAt(k, t);
                    const bz = length[k] * Math.sin(angle);
                    project(pivotX[k], BAR_Y - length[k] * Math.cos(angle), bz);
                    bobX[k] = out.x;
                    bobY[k] = out.y;
                    bobDepth[k] = out.depth;
                    project(pivotX[k], FLOOR_Y, bz);
                    poolX[k] = out.x;
                    poolY[k] = out.y;
                    poolScale[k] = FOCAL / out.depth;
                    for (let j = 0; j < TRAIL; j++) {
                        const back = angleAt(k, t - (j / (TRAIL - 1)) * TRAIL_SPAN);
                        project(pivotX[k], BAR_Y - length[k] * Math.cos(back), length[k] * Math.sin(back));
                        trailX[k * TRAIL + j] = out.x;
                        trailY[k * TRAIL + j] = out.y;
                    }
                    order[k] = k;
                }
                order.sort(byDepth);

                // Light pools on the floor: the snake again, seen from above.
                for (let k = 0; k < COUNT; k++) {
                    const poolW = 44 * poolScale[k];
                    const poolH = poolW * sinPitch * 0.9;
                    ctx.globalAlpha = 1 - inStep;
                    ctx.drawImage(poolRunning, poolX[k] - poolW / 2, poolY[k] - poolH / 2, poolW, poolH);
                    if (inStep > 0.01) {
                        ctx.globalAlpha = inStep;
                        ctx.drawImage(poolIdle, poolX[k] - poolW / 2, poolY[k] - poolH / 2, poolW, poolH);
                    }
                }
                ctx.globalAlpha = 1;

                project(-HALF_BAR - 28, BAR_Y, 0);
                const barAx = out.x;
                const barAy = out.y;
                project(HALF_BAR + 28, BAR_Y, 0);
                const barBx = out.x;
                const barBy = out.y;
                ctx.lineCap = 'round';
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(barAx, barAy);
                ctx.lineTo(barBx, barBy);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(255,255,255,0.26)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(barAx, barAy - 1.8);
                ctx.lineTo(barBx, barBy - 1.8);
                ctx.stroke();

                // The snake: one faint line through every bob, so the wave reads at a glance.
                ctx.strokeStyle = '#b9cdf5';
                ctx.globalAlpha = 0.08 + 0.1 * inStep;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(bobX[0], bobY[0]);
                for (let k = 1; k < COUNT - 1; k++) {
                    ctx.quadraticCurveTo(bobX[k], bobY[k], (bobX[k] + bobX[k + 1]) / 2, (bobY[k] + bobY[k + 1]) / 2);
                }
                ctx.lineTo(bobX[COUNT - 1], bobY[COUNT - 1]);
                ctx.stroke();
                ctx.globalAlpha = 1;

                const bobColor = bobColors[Math.round(inStep * STEPS)];
                for (let rank = 0; rank < COUNT; rank++) {
                    const k = order[rank];
                    const size = FOCAL / bobDepth[k];
                    const near = R.clamp((size - 0.72) / 0.22, 0, 1);

                    ctx.strokeStyle = '#d6dcea';
                    ctx.globalAlpha = 0.15 + 0.13 * near;
                    ctx.lineWidth = Math.max(0.6, 0.75 * size);
                    ctx.beginPath();
                    ctx.moveTo(pivX[k], pivY[k]);
                    ctx.lineTo(bobX[k], bobY[k]);
                    ctx.stroke();

                    // The arc it just drew, thinning and fading behind it.
                    ctx.strokeStyle = R.pal.running;
                    for (let j = 1; j < TRAIL; j++) {
                        const fade = 1 - j / TRAIL;
                        ctx.globalAlpha = 0.5 * fade * (0.65 + 0.35 * near);
                        ctx.lineWidth = (0.6 + 1.6 * fade) * size;
                        ctx.beginPath();
                        ctx.moveTo(trailX[k * TRAIL + j - 1], trailY[k * TRAIL + j - 1]);
                        ctx.lineTo(trailX[k * TRAIL + j], trailY[k * TRAIL + j]);
                        ctx.stroke();
                    }

                    const glow = 40 * size;
                    ctx.globalAlpha = (0.65 + 0.35 * near) * (1 - inStep * 0.6);
                    ctx.drawImage(glowRunning, bobX[k] - glow / 2, bobY[k] - glow / 2, glow, glow);
                    if (inStep > 0.01) {
                        ctx.globalAlpha = inStep;
                        ctx.drawImage(glowIdle, bobX[k] - glow / 2, bobY[k] - glow / 2, glow, glow);
                    }
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = bobColor;
                    ctx.beginPath();
                    ctx.arc(bobX[k], bobY[k], 4.6 * size, 0, R.TAU);
                    ctx.fill();
                    ctx.fillStyle = 'rgba(255,255,255,0.8)';
                    ctx.beginPath();
                    ctx.arc(bobX[k] - 1.3 * size, bobY[k] - 1.4 * size, 1.4 * size, 0, R.TAU);
                    ctx.fill();

                    ctx.fillStyle = 'rgba(255,255,255,0.4)';
                    ctx.beginPath();
                    ctx.arc(pivX[k], pivY[k], 1.5 * size, 0, R.TAU);
                    ctx.fill();
                }

                env.fadeEdges(0.62, 0.98);
            }
        };
    }
});
