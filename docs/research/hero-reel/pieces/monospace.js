Reel.add({
    id: 'monospace',
    title: 'Monospace',
    line: 'A terminal is a canvas too. This one draws the mark in 3D, one glyph at a time.',
    principles: ['Solid drawing', 'Timing'],
    tech: 'Canvas 2D, CPU raymarching into a 60 x 24 character grid',
    hint: 'Move to turn the mark',
    poster: 1.6,
    create(env) {
        const R = env.R;
        const pal = R.pal;
        const W = env.W;
        const H = env.H;
        const CYCLE = 18;
        const COLS = 60;
        const ROWS = 24;
        const FS = 10.4;
        const CW = 6.24;
        const LH = 11.6;
        const RAMP = ' .,:;=+*#%@';
        const NOISE = '!<>-_/\\[]{}=+*^?#%&$01';
        const TO_TORUS = 8.7;
        const TO_MARK = 15.8;
        const MORPH = 0.8;

        // window geometry, logical px
        const win = { w: COLS * CW + 32, h: 0, x: 0, y: 0 };
        const TITLE = 26;
        win.h = TITLE + 10 + 14 + 6 + ROWS * LH + 8 + 14 + 14 + 10;
        win.x = Math.round((W - win.w) / 2);
        win.y = Math.round((H - win.h) / 2);
        const gridX = win.x + 16;
        const gridY = win.y + TITLE + 10 + 14 + 6;
        const cmdY = win.y + TITLE + 10 + 10;
        const statusY = gridY + ROWS * LH + 8 + 10;
        const promptY = statusY + 14;

        // the object and the camera
        const SKEW = 0.42;
        const SHEAR_FIX = 1 / Math.sqrt(1 + SKEW * SKEW);
        const BOUND = 1.42;
        const FLOOR = -1.22;
        const cam = [0, 0.95, 4.2];
        const target = [0, -0.14, 0];
        const light = (() => {
            const raw = [-0.62, 0.74, 0.5];
            const len = Math.hypot(raw[0], raw[1], raw[2]);
            return [raw[0] / len, raw[1] / len, raw[2] / len];
        })();
        const fwd = [target[0] - cam[0], target[1] - cam[1], target[2] - cam[2]];
        {
            const len = Math.hypot(fwd[0], fwd[1], fwd[2]);
            fwd[0] /= len;
            fwd[1] /= len;
            fwd[2] /= len;
        }
        const right = [-fwd[2], 0, fwd[0]];
        {
            const len = Math.hypot(right[0], right[2]);
            right[0] /= len;
            right[2] /= len;
        }
        const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
        const FOCAL = 470;
        // a point key light, so every face falls off across itself instead of reading as one flat value
        const lamp = [-2.4, 2.9, 3.1];

        // rotation of the object, world to object space, set once per rendered frame
        const rot = new Float64Array(9);
        let morph = 0;

        const slab = (x, y, depth, cx, cy, cz) => {
            const qy = y - cy;
            const qx = x - cx - SKEW * qy;
            const qz = depth - cz;
            const rr = 0.07;
            const dx = Math.abs(qx) - 0.5 + rr;
            const dy = Math.abs(qy) - 0.5 + rr;
            const dz = Math.abs(qz) - 0.13 + rr;
            const ox = dx > 0 ? dx : 0;
            const oy = dy > 0 ? dy : 0;
            const oz = dz > 0 ? dz : 0;
            const inner = Math.min(Math.max(dx, dy, dz), 0);
            return (Math.sqrt(ox * ox + oy * oy + oz * oz) + inner - rr) * SHEAR_FIX;
        };
        let lastDark = 0;
        let lastLight = 0;
        let lastTorus = 0;
        const sdf = (wx, wy, wz) => {
            const x = rot[0] * wx + rot[1] * wy + rot[2] * wz;
            const y = rot[3] * wx + rot[4] * wy + rot[5] * wz;
            const depth = rot[6] * wx + rot[7] * wy + rot[8] * wz;
            let dist = 0;
            if (morph < 1) {
                lastDark = slab(x, y, depth, -0.3, 0.3, -0.17);
                lastLight = slab(x, y, depth, 0.3, -0.3, 0.17);
                dist = Math.min(lastDark, lastLight);
            }
            if (morph > 0) {
                const ring = Math.hypot(x, y) - 0.7;
                lastTorus = Math.hypot(ring, depth) - 0.29;
                dist = morph >= 1 ? lastTorus : dist + (lastTorus - dist) * morph;
            }
            return dist;
        };
        // which plane a surface point belongs to: 1 is the dark plane (ANSI blue), 0 the light one
        const blueAt = (wx, wy, wz) => {
            const x = rot[0] * wx + rot[1] * wy + rot[2] * wz;
            const y = rot[3] * wx + rot[4] * wy + rot[5] * wz;
            const depth = rot[6] * wx + rot[7] * wy + rot[8] * wz;
            const markId = R.smoothstep(-0.02, 0.02, slab(x, y, depth, 0.3, -0.3, 0.17) - slab(x, y, depth, -0.3, 0.3, -0.17));
            const torusId = R.smoothstep(-0.18, 0.18, y - x);
            return R.lerp(markId, torusId, morph);
        };

        const sphereHit = (ox, oy, oz, dx, dy, dz) => {
            const proj = ox * dx + oy * dy + oz * dz;
            const rest = ox * ox + oy * oy + oz * oz - BOUND * BOUND;
            const disc = proj * proj - rest;
            if (disc < 0) {
                return -1;
            }
            return -proj - Math.sqrt(disc);
        };

        const softShadow = (px, py, pz) => {
            // nothing to cast a shadow unless the light ray meets the bounding sphere
            const proj = px * light[0] + py * light[1] + pz * light[2];
            const rest = px * px + py * py + pz * pz - BOUND * BOUND;
            if (rest > 0 && (proj > 0 || proj * proj - rest < 0)) {
                return 1;
            }
            let res = 1;
            let travel = 0.04;
            for (let i = 0; i < 14; i++) {
                const dist = sdf(px + light[0] * travel, py + light[1] * travel, pz + light[2] * travel);
                res = Math.min(res, (7 * dist) / travel);
                if (res < 0.02) {
                    return 0;
                }
                travel += Math.max(dist * 0.9, 0.04);
                if (travel > 3.5) {
                    break;
                }
            }
            return R.clamp(res);
        };

        // per cell: glyph code and color bucket
        const glyph = new Uint8Array(COLS * ROWS);
        const bucket = new Uint8Array(COLS * ROWS);
        const solid = new Uint8Array(COLS * ROWS);
        const BUCKETS = ['#2f5f9f', pal.blue, '#b8d6fe', '#74747f', pal.termFg, '#ffffff', 'rgba(120,120,132,0.62)', R.rgba(pal.cyan, 0.85)];
        const FLOOR_BUCKET = 6;
        const NOISE_BUCKET = 7;

        const pointer = env.pointer;
        const orientation = (lt) => {
            const turn = R.ease.inOutCubic((lt - 2.8) / 2.8);
            // a small wind-up against the turn before it goes
            const windup = -0.16 * Math.sin(Math.PI * R.clamp((lt - 2.3) / 0.9)) * (lt < 3.2 ? 1 : 0);
            const tumbleU = R.clamp((lt - 9.1) / 7.3);
            const spin = R.TAU * R.ease.inOutSine(tumbleU);
            const tumble = 0.75 * Math.pow(Math.sin(Math.PI * tumbleU), 2);
            const drift = 0.09 * Math.sin((R.TAU * lt) / 6);
            const yaw = -0.4 + drift + windup + R.TAU * turn + spin + pointer.nx * 1.3 * pointer.active;
            const pitch = 0.16 + tumble + 0.04 * Math.sin((R.TAU * lt) / 9) + pointer.ny * 0.7 * pointer.active;
            return [yaw, pitch];
        };

        const render = (lt) => {
            const [yaw, pitch] = orientation(lt);
            morph = R.ease.inOutCubic((lt - TO_TORUS) / MORPH) - R.ease.inOutCubic((lt - TO_MARK) / MORPH);
            // object = Ry(-yaw) * Rx(-pitch) * world
            const cy = Math.cos(yaw);
            const sy = Math.sin(yaw);
            const cp = Math.cos(pitch);
            const sp = Math.sin(pitch);
            rot[0] = cy;
            rot[1] = sy * sp;
            rot[2] = -sy * cp;
            rot[3] = 0;
            rot[4] = cp;
            rot[5] = sp;
            rot[6] = sy;
            rot[7] = -cy * sp;
            rot[8] = cy * cp;

            for (let row = 0; row < ROWS; row++) {
                for (let col = 0; col < COLS; col++) {
                    const i = row * COLS + col;
                    const sxp = (col + 0.5 - COLS / 2) * CW;
                    const syp = (ROWS / 2 - row - 0.5) * LH;
                    let dx = fwd[0] * FOCAL + right[0] * sxp + up[0] * syp;
                    let dy = fwd[1] * FOCAL + right[1] * sxp + up[1] * syp;
                    let dz = fwd[2] * FOCAL + right[2] * sxp + up[2] * syp;
                    const dn = Math.hypot(dx, dy, dz);
                    dx /= dn;
                    dy /= dn;
                    dz /= dn;
                    glyph[i] = 0;
                    bucket[i] = 0;
                    solid[i] = 0;
                    let brightness = -1;
                    let blue = 0;
                    const t0 = sphereHit(cam[0], cam[1], cam[2], dx, dy, dz);
                    let hitT = -1;
                    let minD = 1e9;
                    let minT = 0;
                    if (t0 > 0) {
                        let travel = Math.max(t0, 0);
                        const tEnd = travel + BOUND * 2;
                        for (let j = 0; j < 40; j++) {
                            const dist = sdf(cam[0] + dx * travel, cam[1] + dy * travel, cam[2] + dz * travel);
                            if (dist < minD) {
                                minD = dist;
                                minT = travel;
                            }
                            if (dist < 0.004) {
                                hitT = travel;
                                break;
                            }
                            travel += dist * 0.85;
                            if (travel > tEnd) {
                                break;
                            }
                        }
                    }
                    if (hitT > 0) {
                        const px = cam[0] + dx * hitT;
                        const py = cam[1] + dy * hitT;
                        const pz = cam[2] + dz * hitT;
                        const e = 0.003;
                        const ta = sdf(px + e, py - e, pz - e);
                        const tb = sdf(px - e, py - e, pz + e);
                        const tc = sdf(px - e, py + e, pz - e);
                        const td = sdf(px + e, py + e, pz + e);
                        let nx = ta - tb - tc + td;
                        let ny = -ta - tb + tc + td;
                        let nz = -ta + tb - tc + td;
                        const nn = Math.hypot(nx, ny, nz) || 1;
                        nx /= nn;
                        ny /= nn;
                        nz /= nn;
                        let lx = lamp[0] - px;
                        let ly = lamp[1] - py;
                        let lz = lamp[2] - pz;
                        const ld = Math.hypot(lx, ly, lz);
                        lx /= ld;
                        ly /= ld;
                        lz /= ld;
                        const fall = 1.55 / (1 + 0.05 * ld * ld);
                        const ndl = Math.max(nx * lx + ny * ly + nz * lz, 0);
                        const sh = ndl > 0 ? softShadow(px + nx * 0.01, py + ny * 0.01, pz + nz * 0.01) : 0;
                        const hx = lx - dx;
                        const hy = ly - dy;
                        const hz = lz - dz;
                        const hn = Math.hypot(hx, hy, hz);
                        const ndh = Math.max((nx * hx + ny * hy + nz * hz) / hn, 0);
                        const rim = Math.pow(1 - Math.max(-(nx * dx + ny * dy + nz * dz), 0), 3);
                        const fill = Math.max(-ny, 0) * 0.1;
                        brightness = 0.05 + 0.85 * ndl * sh * fall + 0.55 * Math.pow(ndh, 30) * sh + 0.14 * rim + fill;
                        blue = blueAt(px, py, pz);
                        solid[i] = 1;
                    } else if (minD < 0.06 && minT > 0) {
                        // a ray that grazed the edge leaves a faint glyph, so the silhouette is not stepped
                        const px = cam[0] + dx * minT;
                        const py = cam[1] + dy * minT;
                        const pz = cam[2] + dz * minT;
                        brightness = 0.22 * (1 - minD / 0.06);
                        blue = blueAt(px, py, pz);
                        solid[i] = 1;
                    } else if (dy < 0) {
                        // the floor: a pool of light, with the object's shadow and a contact darkening
                        const ft = (FLOOR - cam[1]) / dy;
                        const fx = cam[0] + dx * ft;
                        const fz = cam[2] + dz * ft;
                        const rr = Math.hypot(fx - 0.25, (fz + 0.2) * 1.2);
                        const pool = 1 - R.smoothstep(0.3, 1.55, rr);
                        if (pool > 0.02) {
                            const sh = softShadow(fx, FLOOR, fz);
                            const ao = R.smoothstep(0.0, 0.9, sdf(fx, FLOOR, fz) - 0.05);
                            const lvl = pool * (0.04 + 0.2 * sh) * (0.3 + 0.7 * ao);
                            const level = Math.floor(lvl * 11);
                            if (level > 0) {
                                glyph[i] = Math.min(level, 2);
                                bucket[i] = FLOOR_BUCKET;
                            }
                        }
                    }
                    if (brightness >= 0) {
                        const lvl = Math.pow(R.clamp(brightness), 0.85);
                        glyph[i] = Math.max(1, Math.min(RAMP.length - 1, Math.round(lvl * (RAMP.length - 1))));
                        const tier = lvl < 0.34 ? 0 : lvl < 0.74 ? 1 : 2;
                        bucket[i] = (blue > 0.5 ? 0 : 3) + tier;
                    }
                }
            }
        };

        // Decode: around each command, a cell of the shape flickers through noise for a moment, left to right.
        const scrambled = (i, lt) => {
            const col = i % COLS;
            for (const at of [TO_TORUS, TO_MARK]) {
                const start = at + (col / COLS) * 0.42 + R.hash(i * 1.37 + at) * 0.2;
                const dur = 0.1 + R.hash(i * 2.11 + at) * 0.26;
                if (lt >= start && lt < start + dur) {
                    return true;
                }
            }
            return false;
        };

        const chrome = env.buffer();
        const grid = env.buffer();
        let chromeKey = '';
        let gridFrame = -1;
        const codes = new Array(COLS);

        const monoFont = (weight) => weight + ' ' + FS + 'px ' + R.fonts.mono;

        const drawChrome = () => {
            const ctx = chrome.ctx;
            ctx.clearRect(0, 0, W, H);
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.55)';
            ctx.shadowBlur = 38;
            ctx.shadowOffsetY = 14;
            R.roundRect(ctx, win.x, win.y, win.w, win.h, 11);
            ctx.fillStyle = pal.termBg;
            ctx.fill();
            ctx.restore();
            ctx.save();
            R.roundRect(ctx, win.x, win.y, win.w, win.h, 11);
            ctx.clip();
            ctx.fillStyle = pal.surface;
            ctx.fillRect(win.x, win.y, win.w, TITLE);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(win.x, win.y + TITLE, win.w, 1);
            ctx.restore();
            R.roundRect(ctx, win.x + 0.5, win.y + 0.5, win.w - 1, win.h - 1, 10.5);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.textBaseline = 'middle';
            ctx.font = '700 10px ' + R.fonts.mono;
            ctx.fillStyle = pal.faint;
            ctx.fillText('>_', win.x + 12, win.y + TITLE / 2 + 0.5);
            ctx.font = '500 12px ' + R.fonts.mono;
            ctx.fillStyle = pal.muted;
            ctx.fillText('zsh', win.x + 32, win.y + TITLE / 2 + 0.5);
            ctx.fillStyle = pal.faint;
            ctx.fillText('ruimte render', win.x + 32 + ctx.measureText('zsh  ').width, win.y + TITLE / 2 + 0.5);
            ctx.beginPath();
            ctx.arc(win.x + win.w - 16, win.y + TITLE / 2, 3.5, 0, R.TAU);
            ctx.fillStyle = pal.running;
            ctx.fill();
            ctx.font = monoFont(400);
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = pal.idle;
            ctx.fillText('$', gridX, cmdY);
            ctx.fillStyle = pal.termFg;
            ctx.fillText('ruimte render --mark', gridX + CW * 2, cmdY);
        };

        const drawGrid = (lt) => {
            const ctx = grid.ctx;
            ctx.clearRect(0, 0, W, H);
            ctx.font = monoFont(500);
            ctx.textBaseline = 'alphabetic';
            // pin every column to the grid whatever advance the loaded font has
            const adv = ctx.measureText('0').width || CW;
            const sx = CW / adv;
            const frameNo = Math.floor(lt * 20);
            for (let i = 0; i < COLS * ROWS; i++) {
                if (solid[i] && scrambled(i, lt)) {
                    bucket[i] = NOISE_BUCKET;
                    glyph[i] = 200 + Math.floor(R.hash(i * 7.3 + frameNo * 1.9) * NOISE.length);
                }
            }
            for (let k = 0; k < BUCKETS.length; k++) {
                ctx.fillStyle = BUCKETS[k];
                for (let row = 0; row < ROWS; row++) {
                    let any = false;
                    for (let col = 0; col < COLS; col++) {
                        const i = row * COLS + col;
                        if (glyph[i] && bucket[i] === k) {
                            codes[col] = glyph[i] >= 200 ? NOISE.charCodeAt(glyph[i] - 200) : RAMP.charCodeAt(glyph[i]);
                            any = true;
                        } else {
                            codes[col] = 32;
                        }
                    }
                    if (any) {
                        ctx.save();
                        ctx.translate(gridX, gridY + row * LH + LH * 0.78);
                        ctx.scale(sx, 1);
                        ctx.fillText(String.fromCharCode.apply(null, codes), 0, 0);
                        ctx.restore();
                    }
                }
            }
        };

        // what the person types, one character at a time with a human rhythm
        const typing = (text, start) => {
            const times = [];
            let at = start;
            for (let k = 0; k < text.length; k++) {
                times.push(at);
                at += 0.055 + R.hash(k * 3.1 + start) * 0.05 + (text[k] === ' ' ? 0.06 : 0);
            }
            return { text, times };
        };
        const commands = [typing('ruimte morph torus', 7.25), typing('ruimte morph mark', 14.35)];
        const enters = [TO_TORUS, TO_MARK];

        return {
            resize() {
                chromeKey = '';
                gridFrame = -1;
            },
            draw(t) {
                const ctx = env.ctx;
                const lt = R.mod(t, CYCLE);
                const key = (document.fonts && document.fonts.status) + ':' + env.scale;
                if (key !== chromeKey) {
                    chromeKey = key;
                    drawChrome();
                    gridFrame = -1;
                }
                // the terminal redraws at 30 frames a second, like a real one would
                const frame = Math.floor(t * 30);
                if (frame !== gridFrame) {
                    gridFrame = frame;
                    const ft = R.mod(frame / 30, CYCLE);
                    render(ft);
                    drawGrid(ft);
                }
                env.clear();
                ctx.drawImage(chrome.canvas, 0, 0, W, H);
                ctx.drawImage(grid.canvas, 0, 0, W, H);

                ctx.font = monoFont(400);
                ctx.textBaseline = 'alphabetic';
                const shape = morph < 0.02 ? 'mark' : morph > 0.98 ? 'torus' : lt < TO_MARK ? 'mark > torus' : 'torus > mark';
                ctx.fillStyle = pal.faint;
                ctx.fillText('frame ' + String(frame % 100000).padStart(5, '0'), gridX, statusY);
                ctx.fillText('60x24', gridX + CW * 20, statusY);
                ctx.fillStyle = morph > 0.02 && morph < 0.98 ? pal.cyan : pal.faint;
                const width = ctx.measureText(shape).width;
                ctx.fillText(shape, gridX + COLS * CW - width, statusY);

                ctx.fillStyle = pal.idle;
                ctx.fillText('$', gridX, promptY);
                let typed = '';
                let typingNow = false;
                for (let j = 0; j < commands.length; j++) {
                    const cmd = commands[j];
                    if (lt >= cmd.times[0] && lt < enters[j]) {
                        let count = 0;
                        while (count < cmd.text.length && lt >= cmd.times[count]) {
                            count++;
                        }
                        typed = cmd.text.slice(0, count);
                        typingNow = true;
                    }
                }
                ctx.fillStyle = pal.termFg;
                ctx.fillText(typed, gridX + CW * 2, promptY);
                const caretOn = typingNow || R.mod(lt, 1.06) < 0.62;
                if (caretOn) {
                    ctx.fillStyle = pal.termFg;
                    ctx.fillRect(gridX + CW * 2 + ctx.measureText(typed).width + 1, promptY - FS * 0.8, CW * 0.9, FS * 1.02);
                }
                env.fadeEdges(1.1, 1.5);
            }
        };
    }
});
