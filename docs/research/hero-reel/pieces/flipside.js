Reel.add({
    id: 'flipside',
    title: 'Flipside',
    line: 'The mark, multiplied into a field of planes that turn to show both sides.',
    principles: ['Follow through and overlapping action', 'Appeal'],
    tech: 'Canvas 2D, lattice of 3D flips',
    hint: 'Move to tilt the tiles toward you',
    poster: 10.2,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;

        const CYCLE = 16;
        const FOCAL = 720;
        const GAP = 0.86;
        const CORNER = 4.2;
        const FLIP = 0.95;

        // The icon'pose own parallelogram, read off its SVG: two edge vectors in the icon'pose 512 grid.
        const LOGO_SCALE = 0.62;
        const E1 = [242, -89];
        const E2 = [-87, 303];
        const N = 4;
        const t1x = (E1[0] * LOGO_SCALE) / N;
        const t1y = (E1[1] * LOGO_SCALE) / N;
        const t2x = (E2[0] * LOGO_SCALE) / N;
        const t2y = (E2[1] * LOGO_SCALE) / N;
        // The back plane sits two tiles along each edge from the front one; the icon has it 0.38 tiles further along the first edge.
        const OFFSET = 2;
        const originX = 280 - 2.5 * (t1x + t2x);
        const originY = 250 - 2.5 * (t1y + t2y);
        const frontCenterX = originX + 1.5 * (t1x + t2x);
        const frontCenterY = originY + 1.5 * (t1y + t2y);
        const trueShift = [100 * LOGO_SCALE - OFFSET * (t1x + t2x), 100 * LOGO_SCALE - OFFSET * (t1y + t2y)];

        // The flip axis is the tile'pose long diagonal, from its lower-left corner to its upper-right one.
        const axisLen = Math.hypot(t1x - t2x, t1y - t2y);
        const AX = (t1x - t2x) / axisLen;
        const AY = (t1y - t2y) / axisLen;

        const light = [-0.45, -0.55, 0.7];
        {
            const norm = Math.hypot(light[0], light[1], light[2]);
            light[0] /= norm;
            light[1] /= norm;
            light[2] /= norm;
        }

        const LEVELS = 64;
        const makeRamp = (hex, lo, hi) => {
            const [red, green, blue] = R.hexToRgb(hex);
            const ramp = [];
            for (let i = 0; i < LEVELS; i++) {
                const gain = R.lerp(lo, hi, i / (LEVELS - 1));
                ramp.push('rgb(' + Math.min(255, Math.round(red * gain)) + ',' + Math.min(255, Math.round(green * gain)) + ',' + Math.min(255, Math.round(blue * gain)) + ')');
            }
            return ramp;
        };
        const darkRamp = makeRamp(pal.markDark, 0.45, 1.9);
        const lightRamp = makeRamp(pal.markLight, 0.32, 1.1);
        // The light side of the field is capped at 70% of the mark's own light plane; the end card keeps full strength.
        const FIELD_CAP = 0.7;
        const CAP_STEPS = 12;
        const cappedRamps = [];
        for (let i = 0; i <= CAP_STEPS; i++) {
            const cap = R.lerp(FIELD_CAP, 1, i / CAP_STEPS);
            cappedRamps.push(makeRamp(pal.markLight, 0.32 * cap, 1.1 * cap));
        }

        // Tiles: the field, the front plane of the mark and the back plane'pose visible part.
        const tiles = [];
        const rand = env.rand;
        for (let i = -9; i <= 15; i++) {
            for (let j = -8; j <= 13; j++) {
                const cx = originX + i * t1x + j * t2x;
                const cy = originY + i * t1y + j * t2y;
                const ex = (cx - 280) / 300;
                const ey = (cy - 250) / 272;
                if (ex * ex + ey * ey > 1) {
                    continue;
                }
                const front = i >= 0 && i < N && j >= 0 && j < N;
                const back = !front && i >= OFFSET && i < OFFSET + N && j >= OFFSET && j < OFFSET + N;
                tiles.push({
                    i,
                    j,
                    cx,
                    cy,
                    role: front ? 'front' : back ? 'back' : 'field',
                    fromWave: 0,
                    fromCenter: Math.hypot(cx - 280, cy - 250),
                    dissolve: rand(),
                    glint: rand() * 40,
                    glintPace: 5 + rand() * 7
                });
            }
        }
        // Back to front: field first, then the back plane, then the front plane on top of it.
        const order = { field: 0, back: 1, front: 2 };
        tiles.sort((first, second) => order[first.role] - order[second.role]);
        const waveX = 150;
        const waveY = 380;
        for (const tile of tiles) {
            tile.fromWave = Math.hypot(tile.cx - waveX, tile.cy - waveY);
        }

        const settle = (progress) => R.ease.outBack(Math.pow(R.clamp(progress), 1.25), 1.55);

        // The flip angle and presence of one tile at time cycleTime within the cycle: a pure function, so the loop is exact.
        const state = { angle: 0, presence: 1, gap: GAP, dx: 0, dy: 0, calm: 1 };
        const tileState = (tile, cycleTime) => {
            let angle = 0;
            let presence = 1;
            let gap = GAP;
            let dx = 0;
            let dy = 0;
            let calm = 1;
            // Wave one: a ripple from the lower left turns the whole field to its light side.
            const first = 1.3 + tile.fromWave * 0.0062;
            angle = Math.PI * settle((cycleTime - first) / FLIP);
            // Wave two: from the middle out, the mark stays and the rest turns away.
            const second = 5.3 + tile.fromCenter * 0.0068;
            const p2 = (cycleTime - second) / FLIP;
            if (tile.role === 'front') {
                angle += Math.PI * settle(p2);
            } else if (tile.role === 'back') {
                // A light tile of the mark answers the passing wave with a small nod, then holds.
                const nod = R.clamp(p2 * 1.6);
                angle += Math.sin(nod * Math.PI) * 0.32 * (1 - nod * 0.4);
                // Once the wave has passed, a light tile of the mark is no longer field: it comes up to full strength.
                calm = 1 - R.smoothstep(0, 1, nod);
            } else {
                const away = R.ease.inCubic(R.clamp(p2 / 0.8));
                angle += (Math.PI / 2) * away;
                presence = 1 - R.smoothstep(0.35, 1, away);
            }
            // The mark closes its seams and the back plane slides to where the icon has it.
            const knit = R.ease.inOutCubic((cycleTime - 8.0) / 0.8) * (1 - R.ease.inOutCubic((cycleTime - 12.3) / 0.7));
            if (tile.role !== 'field') {
                gap = R.lerp(GAP, 1, knit);
                if (tile.role === 'back') {
                    dx = trueShift[0] * knit;
                    dy = trueShift[1] * knit;
                }
            }
            // Dissolve: random, staggered flips bring the field back and turn the light plane dark again.
            if (tile.role === 'field') {
                const start = 12.6 + tile.dissolve * 2.3;
                const p3 = (cycleTime - start) / FLIP;
                if (p3 > 0) {
                    angle = 1.5 * Math.PI + (Math.PI / 2) * settle(p3);
                    presence = R.smoothstep(0, 0.35, p3);
                }
            } else if (tile.role === 'back') {
                const start = 12.5 + tile.dissolve * 1.9;
                angle += Math.PI * settle((cycleTime - start) / FLIP);
            }
            state.angle = angle;
            state.presence = presence;
            state.gap = gap;
            state.dx = dx;
            state.dy = dy;
            state.calm = calm;
            return state;
        };

        const corners = new Float32Array(8);
        const band = ctx.createLinearGradient(-1, 0, 1, 0);
        band.addColorStop(0, 'rgba(255,255,255,0)');
        band.addColorStop(0.5, 'rgba(255,255,255,1)');
        band.addColorStop(1, 'rgba(255,255,255,0)');

        const logoBack = new Path2D(
            'M310.675 440.051C296.039 444.972 281.933 450.859 267.47 456.245C249.541 462.876 231.527 469.224 213.435 475.287C204.206 478.471 195.541 482.771 186.093 485.253C175.098 488.291 164.153 481.772 158.814 470.962C151.669 456.494 159.931 440.029 163.748 425.911C166.626 415.268 169.719 404.835 172.695 394.288L193.118 324.212C200.3 298.698 207.283 273.114 214.065 247.465C219.469 227.395 230.961 203.775 248.387 194.375C260.298 187.948 275.477 182.462 288.109 177.858L344.383 157.43C351.068 154.937 357.793 151.75 364.515 149.144C377.409 144.264 390.348 139.533 403.331 134.95C418.558 129.405 442.31 116.319 453.522 138.276C456.748 144.592 456.556 157.597 454.481 164.501C446.295 191.738 439.342 219.499 431.432 246.843C428.262 257.742 424.148 268.094 421.072 279.072C415.383 300.702 409.282 321.857 402.775 343.433C393.244 375.041 389.08 403.98 359.958 421.381C345.093 430.264 324.861 432.27 310.675 440.051Z'
        );
        const logoFront = new Path2D(
            'M210.675 340.051C196.039 344.972 181.933 350.859 167.47 356.245C149.541 362.876 131.527 369.224 113.435 375.287C104.206 378.471 95.5412 382.771 86.0925 385.253C75.0978 388.291 64.1531 381.772 58.8144 370.962C51.6694 356.494 59.9308 340.029 63.7482 325.911C66.6258 315.268 69.719 304.835 72.6954 294.288L93.1175 224.212C100.3 198.698 107.283 173.114 114.065 147.465C119.469 127.395 130.961 103.775 148.387 94.3748C160.298 87.9485 175.477 82.4619 188.109 77.8575L244.383 57.43C251.068 54.9368 257.793 51.75 264.515 49.1442C277.409 44.2644 290.348 39.5327 303.331 34.9501C318.558 29.4047 342.31 16.3194 353.522 38.276C356.748 44.5919 356.556 57.5971 354.481 64.5007C346.295 91.7375 339.342 119.499 331.432 146.843C328.262 157.742 324.148 168.094 321.072 179.072C315.383 200.702 309.282 221.857 302.775 243.433C293.244 275.041 289.08 303.98 259.958 321.381C245.093 330.264 224.861 332.27 210.675 340.051Z'
        );
        // Centered on the front plane'pose middle in the icon'pose grid, so the front plane does not move in the crossfade.
        const LOGO_FRONT_CENTER = [206, 206];
        const sheen = ctx.createLinearGradient(-1, 0, 1, 0);
        sheen.addColorStop(0, 'rgba(255,255,255,0)');
        sheen.addColorStop(0.5, 'rgba(255,255,255,0.55)');
        sheen.addColorStop(1, 'rgba(255,255,255,0)');

        const rotate = (vx, vy, vz, kx, ky, cos, sin, out) => {
            // Rodrigues around an in-plane unit axis (kx, ky, 0).
            const dot = kx * vx + ky * vy;
            const crossX = ky * vz;
            const crossY = -kx * vz;
            const crossZ = kx * vy - ky * vx;
            out[0] = vx * cos + crossX * sin + kx * dot * (1 - cos);
            out[1] = vy * cos + crossY * sin + ky * dot * (1 - cos);
            out[2] = vz * cos + crossZ * sin;
            return out;
        };
        const vec = [0, 0, 0];
        const normal = [0, 0, 0];

        const drawTile = (tile, pose, tilt, cycleTime) => {
            // A tile is not a rhombus, so a true half turn would land it mirrored and out of the lattice. Past edge-on it
            // keeps turning the same way but opens back into its own footprint, showing the other face.
            const half = Math.round(pose.angle / Math.PI);
            const turned = pose.angle - half * Math.PI;
            const backFace = ((half % 2) + 2) % 2 === 1;
            const flipCos = Math.cos(turned);
            const flipSin = Math.sin(turned);
            const cx = tile.cx + pose.dx;
            const cy = tile.cy + pose.dy;
            // Tilt toward the pointer: the normal leans toward it, like a field of small magnets.
            let tiltCos = 1;
            let tiltSin = 0;
            let kx = 0;
            let ky = 0;
            if (tilt > 0.002) {
                const dx = env.pointer.x - cx;
                const dy = env.pointer.y - cy;
                const distance = Math.hypot(dx, dy) || 1;
                const angle = tilt * Math.exp(-(distance * distance) / (130 * 130));
                if (angle > 0.002) {
                    kx = -dy / distance;
                    ky = dx / distance;
                    tiltCos = Math.cos(angle);
                    tiltSin = Math.sin(angle);
                }
            }
            const hx = t1x * 0.5 * pose.gap;
            const hy = t1y * 0.5 * pose.gap;
            const vx2 = t2x * 0.5 * pose.gap;
            const vy2 = t2y * 0.5 * pose.gap;
            // Corners TL, TR, BR, BL around the center.
            const qx = [-hx - vx2, hx - vx2, hx + vx2, -hx + vx2];
            const qy = [-hy - vy2, hy - vy2, hy + vy2, -hy + vy2];
            for (let k = 0; k < 4; k++) {
                rotate(qx[k], qy[k], 0, AX, AY, flipCos, flipSin, vec);
                if (tiltSin !== 0) {
                    rotate(vec[0], vec[1], vec[2], kx, ky, tiltCos, tiltSin, vec);
                }
                const persp = FOCAL / (FOCAL - vec[2]);
                corners[k * 2] = cx + vec[0] * persp;
                corners[k * 2 + 1] = cy + vec[1] * persp;
            }
            rotate(0, 0, 1, AX, AY, flipCos, flipSin, normal);
            if (tiltSin !== 0) {
                rotate(normal[0], normal[1], normal[2], kx, ky, tiltCos, tiltSin, normal);
            }
            const facing = !backFace;
            const sign = normal[2] >= 0 ? 1 : -1;
            const nz = Math.abs(normal[2]);
            if (nz < 0.02) {
                return;
            }
            const diffuse = Math.max(0, sign * (normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]));
            let bright = (0.25 + 0.95 * diffuse) * (0.45 + 0.55 * Math.sqrt(nz));
            let cap = 1;
            if (!facing && pose.calm > 0) {
                // The light side glows in the middle and calms toward the edges, so the field never outshouts the headline.
                bright *= R.lerp(1, R.lerp(0.95, 0.3, R.smoothstep(30, 250, tile.fromCenter)), pose.calm);
                cap = R.lerp(1, FIELD_CAP, pose.calm);
            }
            const ramp = facing ? darkRamp : cappedRamps[Math.round(((cap - FIELD_CAP) / (1 - FIELD_CAP)) * CAP_STEPS)];
            const level = Math.round(R.clamp(bright / 1.2) * (LEVELS - 1));

            // Rounded outline through the projected corners.
            ctx.beginPath();
            const mx = (corners[6] + corners[0]) / 2;
            const my = (corners[7] + corners[1]) / 2;
            ctx.moveTo(mx, my);
            for (let k = 0; k < 4; k++) {
                const next = (k + 1) % 4;
                ctx.arcTo(corners[k * 2], corners[k * 2 + 1], corners[next * 2], corners[next * 2 + 1], CORNER * Math.min(1, nz * 1.6 + 0.2));
            }
            ctx.closePath();
            ctx.globalAlpha = pose.presence;
            ctx.fillStyle = ramp[level];
            ctx.fill();
            if (facing) {
                // A hairline rim on the dark side, the edge a dark plane needs on a dark page.
                ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + 0.1 * diffuse).toFixed(3) + ')';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
            // The specular sweep: a soft band crosses the face as it turns, once per half turn.
            const turn = R.mod(pose.angle, Math.PI);
            const sweep = Math.pow(Math.sin(turn), 2) * (turn > 0.02 && turn < Math.PI - 0.02 ? 1 : 0);
            if (sweep > 0.03 && pose.presence > 0.05) {
                const along = R.mod(pose.angle, Math.PI / 2) / (Math.PI / 2);
                const center = R.lerp(-1.5, 1.5, along);
                ctx.save();
                ctx.clip();
                const ux = (corners[4] - corners[0]) / 2;
                const uy = (corners[5] - corners[1]) / 2;
                const wx = (corners[2] - corners[6]) / 2;
                const wy = (corners[3] - corners[7]) / 2;
                const ox = (corners[0] + corners[4]) / 2;
                const oy = (corners[1] + corners[5]) / 2;
                ctx.transform(ux, uy, wx, wy, ox, oy);
                ctx.translate(center, 0);
                ctx.scale(0.45, 1);
                ctx.globalAlpha = pose.presence * sweep * (facing ? 0.22 : 0.4 * cap);
                ctx.fillStyle = band;
                ctx.fillRect(-1, -1.2, 2, 2.4);
                ctx.restore();
            }
            ctx.globalAlpha = 1;
        };

        const drawLogo = (target, cycleTime) => {
            const pointer = env.pointer;
            // The finished mark leans a touch toward the pointer, as the tiles do.
            const lean = pointer.active;
            target.save();
            target.translate(frontCenterX + pointer.nx * 6 * lean, frontCenterY + pointer.ny * 6 * lean);
            target.transform(1 + 0.03 * pointer.nx * lean, 0.02 * pointer.ny * lean, 0.02 * pointer.nx * lean, 1 + 0.03 * pointer.ny * lean, 0, 0);
            target.scale(LOGO_SCALE, LOGO_SCALE);
            target.translate(-LOGO_FRONT_CENTER[0], -LOGO_FRONT_CENTER[1]);
            target.fillStyle = lightRamp[Math.round((0.95 / 1.2) * (LEVELS - 1))];
            target.fill(logoBack);
            target.fillStyle = darkRamp[Math.round((0.92 / 1.2) * (LEVELS - 1))];
            target.fill(logoFront);
            target.strokeStyle = 'rgba(255,255,255,0.14)';
            target.lineWidth = 1.2 / LOGO_SCALE;
            target.stroke(logoFront);
            // One slow sheen across the finished mark.
            const pass = R.clamp((cycleTime - 9.4) / 1.5);
            if (pass > 0 && pass < 1) {
                const x = R.lerp(-60, 560, R.ease.inOutSine(pass));
                target.save();
                target.clip(logoBack);
                target.translate(x, 250);
                target.rotate(-0.35);
                target.scale(70, 400);
                target.globalAlpha = Math.sin(pass * Math.PI) * 0.5;
                target.fillStyle = sheen;
                target.fillRect(-1, -1, 2, 2);
                target.restore();
                target.save();
                target.clip(logoFront);
                target.translate(x, 250);
                target.rotate(-0.35);
                target.scale(70, 400);
                target.globalAlpha = Math.sin(pass * Math.PI) * 0.35;
                target.fillStyle = sheen;
                target.fillRect(-1, -1, 2, 2);
                target.restore();
            }
            target.restore();
        };

        const layer = env.buffer();

        return {
            draw(t) {
                env.clear();
                const cycleTime = R.mod(t, CYCLE);
                // The finished mark comes in over the knitted tiles, and the tiles leave only once it covers them.
                const logo = R.smoothstep(8.8, 9.2, cycleTime) * (1 - R.smoothstep(11.95, 12.35, cycleTime));
                const markTiles = 1 - R.smoothstep(9.2, 9.45, cycleTime) * (1 - R.smoothstep(11.6, 11.9, cycleTime));
                const tilt = 0.75 * env.pointer.active;
                for (const tile of tiles) {
                    const pose = tileState(tile, cycleTime);
                    if (tile.role !== 'field') {
                        pose.presence *= markTiles;
                    }
                    if (pose.presence <= 0.003) {
                        continue;
                    }
                    // Resting tiles catch the light now and then, so the field is never quite still.
                    if (tile.role === 'field' || cycleTime < 1.3 || cycleTime > 15) {
                        const glint = R.fract((t + tile.glint) / tile.glintPace);
                        pose.angle += Math.sin(R.clamp(glint / 0.09) * Math.PI) * 0.35;
                    }
                    drawTile(tile, pose, tilt, cycleTime);
                }
                if (logo >= 0.999) {
                    drawLogo(ctx, cycleTime);
                } else if (logo > 0.003) {
                    // Both planes drawn whole first, so the front one never turns see-through while the mark fades.
                    const target = layer.ctx;
                    target.save();
                    target.setTransform(1, 0, 0, 1, 0, 0);
                    target.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                    target.restore();
                    drawLogo(target, cycleTime);
                    ctx.save();
                    ctx.globalAlpha = logo;
                    ctx.drawImage(layer.canvas, 0, 0, env.W, env.H);
                    ctx.restore();
                }
                env.fadeEdges(0.45, 1);
            }
        };
    }
});
