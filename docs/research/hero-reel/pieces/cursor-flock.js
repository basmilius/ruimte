Reel.add({
    id: 'cursor-flock',
    title: 'Cursor Flock',
    line: 'Agents with cursors of their own, so yours stays free.',
    principles: ['Arcs', 'Secondary action'],
    tech: 'Canvas 2D, boids steering with target morph',
    hint: 'Move through the flock to part it',
    poster: 11.5,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const TAU = R.TAU;
        const COUNT = Math.round(28 + 16 * env.quality);
        const CX = W / 2;
        const CY = H / 2;

        const CYCLE = 16;
        const GATHER = 7.0;
        const STAGGER = 1.3;
        const FLIGHT = 1.8;
        const CLICK = 10.6;
        const CLICK_SPREAD = 1.0;
        const CROUCH = 12.55;
        const BURST = 12.95;

        const STEP = 1 / 60;
        const MAX_SPEED = 128;
        const MIN_SPEED = 62;
        const TRAIL = 12;
        const TRAIL_EVERY = 1 / 30;

        // The macOS arrow, tip at the origin.
        const ARROW = new Path2D('M0 0 L0 16.2 L3.9 12.6 L6.6 18.6 L9.1 17.5 L6.5 11.7 L11.6 11.7 Z');
        // The arrow points from its body toward its tip, about 22 degrees left of straight up.
        const FORWARD = Math.atan2(-11, -4.6);

        /* The formation: both planes of the Ruimte mark as outlines, with slots spaced evenly along them. */
        const MARK_X = CX - 6;
        const MARK_Y = CY - 9;
        const plane = (cx, cy) => {
            const side = 164;
            const skew = 28;
            const radius = 26;
            const corners = [
                [cx - side / 2 + skew, cy - side / 2],
                [cx + side / 2 + skew, cy - side / 2],
                [cx + side / 2 - skew, cy + side / 2],
                [cx - side / 2 - skew, cy + side / 2]
            ];
            const pts = [];
            for (let i = 0; i < 4; i++) {
                const prev = corners[(i + 3) % 4];
                const cur = corners[i];
                const next = corners[(i + 1) % 4];
                const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
                const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
                const ax = cur[0] + ((prev[0] - cur[0]) / inLen) * radius;
                const ay = cur[1] + ((prev[1] - cur[1]) / inLen) * radius;
                const bx = cur[0] + ((next[0] - cur[0]) / outLen) * radius;
                const by = cur[1] + ((next[1] - cur[1]) / outLen) * radius;
                for (let step = 0; step <= 12; step++) {
                    const along = step / 12;
                    const rest = 1 - along;
                    pts.push([rest * rest * ax + 2 * rest * along * cur[0] + along * along * bx, rest * rest * ay + 2 * rest * along * cur[1] + along * along * by]);
                }
            }
            return pts;
        };
        const back = plane(MARK_X - 38, MARK_Y - 34);
        const front = plane(MARK_X + 38, MARK_Y + 34);
        const perimeter = (pts) => {
            let len = 0;
            for (let i = 0; i < pts.length; i++) {
                const from = pts[i];
                const to = pts[(i + 1) % pts.length];
                len += Math.hypot(to[0] - from[0], to[1] - from[1]);
            }
            return len;
        };
        const pointAt = (pts, dist) => {
            let left = dist;
            for (let i = 0; i < pts.length; i++) {
                const from = pts[i];
                const to = pts[(i + 1) % pts.length];
                const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
                if (left <= len) {
                    const blend = len > 0 ? left / len : 0;
                    return [R.lerp(from[0], to[0], blend), R.lerp(from[1], to[1], blend)];
                }
                left -= len;
            }
            return pts[0];
        };
        const planePath = (pts) => {
            const path = new Path2D();
            path.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) {
                path.lineTo(pts[i][0], pts[i][1]);
            }
            path.closePath();
            return path;
        };
        const backPath = planePath(back);
        const frontPath = planePath(front);

        const backLen = perimeter(back);
        const frontLen = perimeter(front);
        const backCount = Math.round((COUNT * backLen) / (backLen + frontLen));
        const slotX = new Float32Array(COUNT);
        const slotY = new Float32Array(COUNT);
        // Both loops start on the left and run clockwise, so the outline draws itself in one direction.
        for (let i = 0; i < COUNT; i++) {
            const onBack = i < backCount;
            const pts = onBack ? back : front;
            const k = onBack ? i : i - backCount;
            const share = onBack ? backCount : COUNT - backCount;
            const len = onBack ? backLen : frontLen;
            const spot = pointAt(pts, ((k + 0.5) / share) * len);
            slotX[i] = spot[0];
            slotY[i] = spot[1];
        }

        const px = new Float32Array(COUNT);
        const py = new Float32Array(COUNT);
        const vx = new Float32Array(COUNT);
        const vy = new Float32Array(COUNT);
        const heading = new Float32Array(COUNT);
        const bank = new Float32Array(COUNT);
        const rot = new Float32Array(COUNT);
        const slotOf = new Int32Array(COUNT);
        const fromX = new Float32Array(COUNT);
        const fromY = new Float32Array(COUNT);
        const fromVx = new Float32Array(COUNT);
        const fromVy = new Float32Array(COUNT);
        const fromRot = new Float32Array(COUNT);
        const mode = new Uint8Array(COUNT);
        const trailX = new Float32Array(COUNT * TRAIL);
        const trailY = new Float32Array(COUNT * TRAIL);
        let trailHead = 0;
        let trailClock = 0;

        for (let i = 0; i < COUNT; i++) {
            const angle = env.rand() * TAU;
            const reach = Math.sqrt(env.rand());
            px[i] = CX + Math.cos(angle) * reach * 170;
            py[i] = CY + Math.sin(angle) * reach * 130;
            const dir = env.rand() * TAU;
            vx[i] = Math.cos(dir) * 90;
            vy[i] = Math.sin(dir) * 90;
            heading[i] = dir;
            rot[i] = dir - FORWARD;
            for (let j = 0; j < TRAIL; j++) {
                trailX[i * TRAIL + j] = px[i];
                trailY[i * TRAIL + j] = py[i];
            }
        }

        const SHADES = [];
        for (let i = 0; i <= 8; i++) {
            SHADES.push(R.mix('#f4f5f8', '#b4bac6', i / 8));
        }

        // A few cursors wear a status tint, three carry a name.
        const TINTS = [R.pal.running, R.pal.needs, R.pal.idle, R.pal.magenta, R.pal.running];
        const tintOf = new Array(COUNT).fill(null);
        for (let i = 0; i < TINTS.length; i++) {
            tintOf[Math.floor(((i + 0.3) / TINTS.length) * COUNT)] = TINTS[i];
        }
        const LABELS = [
            ['claude', R.pal.accent],
            ['codex', '#2a2a31'],
            ['agent 3', '#2a2a31']
        ];
        const labelIndex = [Math.floor(COUNT * 0.06), Math.floor(COUNT * 0.47), Math.floor(COUNT * 0.8)];
        const curious = [Math.floor(COUNT * 0.2), Math.floor(COUNT * 0.33), Math.floor(COUNT * 0.62), Math.floor(COUNT * 0.9)];
        const isCurious = new Uint8Array(COUNT);
        for (const i of curious) {
            isCurious[i] = 1;
        }
        // Name tags hang off their cursor on a spring, so they lag and swing through every turn.
        const tagX = new Float32Array(LABELS.length);
        const tagY = new Float32Array(LABELS.length);
        const tagVx = new Float32Array(LABELS.length);
        const tagVy = new Float32Array(LABELS.length);
        for (let i = 0; i < LABELS.length; i++) {
            tagX[i] = px[labelIndex[i]] + 14;
            tagY[i] = py[labelIndex[i]] + 22;
        }

        // The flock follows a slow wandering lead, which is what bends its path into long arcs.
        const leadX = (time) => CX + 105 * Math.sin((TAU * time) / CYCLE) + 30 * Math.sin((TAU * 3 * time) / CYCLE + 1.3);
        const leadY = (time) => CY + 70 * Math.sin((TAU * 2 * time) / CYCLE + 0.4);

        const assign = () => {
            // Match cursors to slots by their angle around the mark, so no two paths cross on the way in.
            const cursorAngles = [];
            const slotAngles = [];
            for (let i = 0; i < COUNT; i++) {
                cursorAngles.push([Math.atan2(py[i] - MARK_Y, px[i] - MARK_X), i]);
                slotAngles.push([Math.atan2(slotY[i] - MARK_Y, slotX[i] - MARK_X), i]);
            }
            cursorAngles.sort((left, right) => left[0] - right[0]);
            slotAngles.sort((left, right) => left[0] - right[0]);
            let bestShift = 0;
            let bestCost = Infinity;
            for (let shift = 0; shift < COUNT; shift++) {
                let cost = 0;
                for (let k = 0; k < COUNT; k++) {
                    const who = cursorAngles[k][1];
                    const where = slotAngles[(k + shift) % COUNT][1];
                    cost += Math.hypot(px[who] - slotX[where], py[who] - slotY[where]);
                }
                if (cost < bestCost) {
                    bestCost = cost;
                    bestShift = shift;
                }
            }
            for (let k = 0; k < COUNT; k++) {
                slotOf[cursorAngles[k][1]] = slotAngles[(k + bestShift) % COUNT][1];
            }
        };

        const wrapAngle = (angle) => R.mod(angle + Math.PI, TAU) - Math.PI;

        let lastCycle = -1;
        let assigned = false;
        let accumulator = 0;

        const stepFlock = (time, slice) => {
            const pointer = env.pointer;
            const lx = leadX(time);
            const ly = leadY(time);
            for (let i = 0; i < COUNT; i++) {
                if (mode[i] !== 0) {
                    continue;
                }
                let sepX = 0;
                let sepY = 0;
                let aliX = 0;
                let aliY = 0;
                let cohX = 0;
                let cohY = 0;
                let neighbors = 0;
                for (let j = 0; j < COUNT; j++) {
                    if (j === i) {
                        continue;
                    }
                    const dx = px[j] - px[i];
                    const dy = py[j] - py[i];
                    const d2 = dx * dx + dy * dy;
                    if (d2 > 70 * 70) {
                        continue;
                    }
                    neighbors++;
                    aliX += vx[j];
                    aliY += vy[j];
                    cohX += dx;
                    cohY += dy;
                    if (d2 < 40 * 40) {
                        const inv = 1 / Math.max(d2, 16);
                        sepX -= dx * inv;
                        sepY -= dy * inv;
                    }
                }
                let ax = 0;
                let ay = 0;
                if (neighbors > 0) {
                    ax += (aliX / neighbors - vx[i]) * 1.1 + (cohX / neighbors) * 0.9;
                    ay += (aliY / neighbors - vy[i]) * 1.1 + (cohY / neighbors) * 0.9;
                }
                ax += sepX * 7000;
                ay += sepY * 7000;
                // Steer after the lead rather than spring to it: the flock overshoots and turns back in arcs.
                const tx = lx - px[i];
                const ty = ly - py[i];
                const td = Math.sqrt(tx * tx + ty * ty) + 1e-3;
                const want = R.clamp(td * 1.4, MIN_SPEED, MAX_SPEED);
                ax += ((tx / td) * want - vx[i]) * 0.85;
                ay += ((ty / td) * want - vy[i]) * 0.85;
                // A soft wall keeps the flock inside the calm middle of the box.
                const ex = (px[i] - CX) / 180;
                const ey = (py[i] - CY) / 140;
                const reach = ex * ex + ey * ey;
                if (reach > 0.8) {
                    ax -= ex * (reach - 0.8) * 900;
                    ay -= ey * (reach - 0.8) * 900;
                }
                if (pointer.active > 0.01) {
                    const dx = px[i] - pointer.x;
                    const dy = py[i] - pointer.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) + 1e-3;
                    if (isCurious[i]) {
                        // The curious ones circle your cursor instead of fleeing it.
                        const orbit = 46 + 10 * Math.sin(i);
                        const pull = (orbit - dist) * 3.2;
                        const wantX = (-dy / dist) * 120 + (dx / dist) * pull;
                        const wantY = (dx / dist) * 120 + (dy / dist) * pull;
                        ax = R.lerp(ax, (wantX - vx[i]) * 4, pointer.active);
                        ay = R.lerp(ay, (wantY - vy[i]) * 4, pointer.active);
                    } else if (dist < 95) {
                        const push = (1 - dist / 95) * 1500 * pointer.active;
                        ax += (dx / dist) * push;
                        ay += (dy / dist) * push;
                    }
                }
                vx[i] += ax * slice;
                vy[i] += ay * slice;
                const speed = Math.hypot(vx[i], vy[i]) + 1e-5;
                const clampTo = speed > MAX_SPEED ? MAX_SPEED : speed < MIN_SPEED ? MIN_SPEED : speed;
                vx[i] *= clampTo / speed;
                vy[i] *= clampTo / speed;
                px[i] += vx[i] * slice;
                py[i] += vy[i] * slice;
                const nextHeading = Math.atan2(vy[i], vx[i]);
                const turnRate = wrapAngle(nextHeading - heading[i]) / slice;
                heading[i] = nextHeading;
                bank[i] += (R.clamp(turnRate * 0.32, -1, 1) - bank[i]) * (1 - Math.exp(-slice * 7));
                // The arrow turns after its path a beat late, so a sharp change of course still reads as a turn.
                rot[i] += wrapAngle(heading[i] - FORWARD - rot[i]) * (1 - Math.exp(-slice * 11));
            }
        };

        // A Hermite curve from where the cursor flies to its slot, leaving along its own velocity and
        // arriving at rest: an arc in, with the slow-in built into the curve itself.
        const flightAt = (i, progress) => {
            const s1 = progress;
            const s2 = s1 * s1;
            const s3 = s2 * s1;
            const h00 = 2 * s3 - 3 * s2 + 1;
            const h10 = s3 - 2 * s2 + s1;
            const h01 = -2 * s3 + 3 * s2;
            const j = slotOf[i];
            const reach = Math.hypot(slotX[j] - fromX[i], slotY[j] - fromY[i]);
            const speed = Math.hypot(fromVx[i], fromVy[i]) + 1e-5;
            const tangent = Math.min(FLIGHT * speed, 0.9 * reach + 70) / speed;
            px[i] = h00 * fromX[i] + h10 * fromVx[i] * tangent + h01 * slotX[j];
            py[i] = h00 * fromY[i] + h10 * fromVy[i] * tangent + h01 * slotY[j];
            const d00 = 6 * s2 - 6 * s1;
            const d10 = 3 * s2 - 4 * s1 + 1;
            const d01 = -6 * s2 + 6 * s1;
            const dx = d00 * fromX[i] + d10 * fromVx[i] * tangent + d01 * slotX[j];
            const dy = d00 * fromY[i] + d10 * fromVy[i] * tangent + d01 * slotY[j];
            return Math.atan2(dy, dx);
        };

        const orderOf = (i) => slotOf[i] / COUNT;

        return {
            update(t, dt) {
                const cycle = Math.floor(t / CYCLE);
                const local = t - cycle * CYCLE;
                if (cycle !== lastCycle) {
                    lastCycle = cycle;
                    assigned = false;
                }
                if (!assigned && local >= GATHER) {
                    assign();
                    assigned = true;
                }
                accumulator += dt;
                while (accumulator > 1e-6) {
                    const slice = Math.min(STEP, accumulator);
                    accumulator -= slice;
                    const now = t - accumulator;
                    const at = now - cycle * CYCLE;
                    for (let i = 0; i < COUNT; i++) {
                        const start = GATHER + orderOf(i) * STAGGER;
                        if (assigned && mode[i] === 0 && at >= start && at < BURST) {
                            mode[i] = 1;
                            fromX[i] = px[i];
                            fromY[i] = py[i];
                            fromVx[i] = vx[i];
                            fromVy[i] = vy[i];
                            fromRot[i] = rot[i];
                        }
                        if (mode[i] === 1) {
                            const progress = R.clamp((at - start) / FLIGHT);
                            const dir = flightAt(i, progress);
                            // The cursor faces its path, then turns upright to point as it lands.
                            const upright = R.ease.inOutCubic(R.invlerp(0.55, 1, progress));
                            const flying = dir - FORWARD;
                            const settle = fromRot[i] + wrapAngle(flying - fromRot[i]) * R.ease.outCubic(R.invlerp(0, 0.2, progress));
                            rot[i] = settle + wrapAngle(0 - settle) * upright;
                            bank[i] *= 1 - Math.min(1, slice * 4);
                            if (progress >= 1) {
                                mode[i] = 2;
                            }
                        }
                        if (mode[i] === 2 && (at >= BURST || at < GATHER)) {
                            // Out of the mark on a spiral: away from the middle, with a turn to it.
                            const j = slotOf[i];
                            const ox = slotX[j] - MARK_X;
                            const oy = slotY[j] - MARK_Y;
                            const dist = Math.hypot(ox, oy) + 1e-3;
                            vx[i] = (ox / dist) * 150 - (oy / dist) * 70;
                            vy[i] = (oy / dist) * 150 + (ox / dist) * 70;
                            heading[i] = Math.atan2(vy[i], vx[i]);
                            mode[i] = 0;
                        }
                    }
                    stepFlock(now, slice);
                    trailClock += slice;
                    if (trailClock >= TRAIL_EVERY) {
                        trailClock -= TRAIL_EVERY;
                        trailHead = (trailHead + 1) % TRAIL;
                        for (let i = 0; i < COUNT; i++) {
                            trailX[i * TRAIL + trailHead] = px[i];
                            trailY[i * TRAIL + trailHead] = py[i];
                        }
                    }
                    for (let k = 0; k < LABELS.length; k++) {
                        const i = labelIndex[k];
                        const targetX = px[i] + 13;
                        const targetY = py[i] + 24;
                        tagVx[k] += ((targetX - tagX[k]) * 150 - tagVx[k] * 11) * slice;
                        tagVy[k] += ((targetY - tagY[k]) * 150 - tagVy[k] * 11) * slice;
                        tagX[k] += tagVx[k] * slice;
                        tagY[k] += tagVy[k] * slice;
                    }
                }
            },
            draw(t) {
                env.clear();
                const local = R.mod(t, CYCLE);
                const pointer = env.pointer;
                const hold = R.smoothstep(GATHER + STAGGER + FLIGHT - 0.5, GATHER + STAGGER + FLIGHT + 0.4, local) * (1 - R.smoothstep(CROUCH, BURST + 0.25, local));
                const crouch = R.ease.inQuad(R.invlerp(CROUCH, BURST, local)) * (local < BURST ? 1 : 0);

                // The planes of the mark come up quietly under the finished outline.
                if (hold > 0.001) {
                    ctx.globalAlpha = hold;
                    ctx.fillStyle = R.pal.markDark;
                    ctx.fill(backPath);
                    ctx.fillStyle = 'rgba(217,222,230,0.075)';
                    ctx.fill(frontPath);
                    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
                    ctx.lineWidth = 1;
                    ctx.stroke(backPath);
                    ctx.stroke(frontPath);
                    ctx.globalAlpha = 1;
                }

                // Faint trails show the arcs each cursor flew.
                const trailAlpha = 1 - hold;
                if (trailAlpha > 0.01) {
                    ctx.strokeStyle = '#dfe4ee';
                    ctx.lineWidth = 1;
                    ctx.lineCap = 'round';
                    for (let seg = 0; seg < 3; seg++) {
                        ctx.globalAlpha = trailAlpha * (0.05 + seg * 0.06);
                        ctx.beginPath();
                        for (let i = 0; i < COUNT; i++) {
                            for (let k = seg * 4; k <= seg * 4 + 4 && k < TRAIL; k++) {
                                const idx = i * TRAIL + R.mod(trailHead - (TRAIL - 1) + k, TRAIL);
                                if (k === seg * 4) {
                                    ctx.moveTo(trailX[idx], trailY[idx]);
                                } else {
                                    ctx.lineTo(trailX[idx], trailY[idx]);
                                }
                            }
                        }
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                }

                for (let i = 0; i < COUNT; i++) {
                    let x = px[i];
                    let y = py[i];
                    let press = 1;
                    let ring = -1;
                    if (mode[i] === 2) {
                        const clickAt = CLICK + orderOf(i) * CLICK_SPREAD;
                        const since = local - clickAt;
                        if (since > -0.12 && since < 0.3) {
                            // A press: a quick dip in, then a spring back past rest.
                            press = since < 0 ? 1 - 0.18 * R.ease.inQuad((since + 0.12) / 0.12) : 0.82 + 0.18 * R.ease.outBack(since / 0.3, 3);
                        }
                        if (since >= 0 && since < 0.7) {
                            ring = since / 0.7;
                        }
                        x += (MARK_X - x) * 0.06 * crouch;
                        y += (MARK_Y - y) * 0.06 * crouch;
                        if (pointer.active > 0.01) {
                            const dx = x - pointer.x;
                            const dy = y - pointer.y;
                            const dist = Math.hypot(dx, dy) + 1e-3;
                            const lean = Math.max(0, 1 - dist / 80) * 10 * pointer.active;
                            x += (dx / dist) * lean;
                            y += (dy / dist) * lean;
                        }
                    }
                    if (ring >= 0) {
                        ctx.strokeStyle = tintOf[i] || '#e8ecf4';
                        ctx.globalAlpha = 0.5 * (1 - ring) * (1 - ring);
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.arc(x, y, 3 + R.ease.outCubic(ring) * 15, 0, TAU);
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                    }
                    const roll = Math.abs(bank[i]);
                    ctx.save();
                    ctx.translate(x, y);
                    // Banking: squeeze the arrow across its path as it rolls into the turn, and let it go a shade
                    // darker as its face turns away from the light.
                    const face = rot[i] + FORWARD;
                    ctx.rotate(face);
                    ctx.scale(press, press * (1 - 0.42 * roll));
                    ctx.rotate(-FORWARD);
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = 1.4;
                    ctx.strokeStyle = 'rgba(8,8,10,0.9)';
                    ctx.stroke(ARROW);
                    ctx.fillStyle = tintOf[i] || SHADES[Math.min(SHADES.length - 1, Math.round(roll * (SHADES.length - 1)))];
                    ctx.fill(ARROW);
                    ctx.restore();
                }

                ctx.font = '500 10px ' + R.fonts.mono;
                ctx.textBaseline = 'middle';
                for (let k = 0; k < LABELS.length; k++) {
                    const label = LABELS[k];
                    const width = ctx.measureText(label[0]).width + 12;
                    const lx = tagX[k];
                    const ly = tagY[k];
                    ctx.fillStyle = label[1];
                    R.roundRect(ctx, lx, ly - 8, width, 16, 8);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.fillStyle = '#ececf1';
                    ctx.fillText(label[0], lx + 6, ly + 0.5);
                }

                env.fadeEdges(0.66, 0.98);
            }
        };
    }
});
