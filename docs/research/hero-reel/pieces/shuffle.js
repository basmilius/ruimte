Reel.add({
    id: 'shuffle',
    title: 'Shuffle',
    line: 'Terminals, chats and browsers, dealt the way you want them.',
    principles: ['Follow through and overlapping action', 'Arcs', 'Anticipation'],
    tech: 'Canvas 2D, analytic spring choreography',
    hint: 'Point at a card to lift it',
    poster: 2.08,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const PI = Math.PI;
        const LOOP = 12;

        const CW = 132;
        const CH = 100;
        const TB = 18;
        const HAND = 1.06;
        const GRID = 0.9;
        const CX = W / 2;
        const CY = H / 2 + 2;
        // The whole choreography is laid out at 1 and drawn larger, so the dealt grid fills most of the frame.
        const ZOOM = 1.2;

        // Bottom to top. The riffle and the deal are planned so each kind lands in its place in the grid.
        const KINDS = ['browser', 'note', 'plan', 'terminal', 'diff', 'chat'];
        const COUNT = KINDS.length;
        const RELEASE = [2, 5, 1, 4, 0, 3];
        const pileIndex = new Array(COUNT);
        RELEASE.forEach((card, landing) => {
            pileIndex[card] = landing;
        });
        const DEAL_SLOTS = [0, 2, 3, 5, 1, 4];
        const dealIndex = new Array(COUNT);
        const slotOf = new Array(COUNT);
        for (let deal = 0; deal < COUNT; deal++) {
            const card = RELEASE[COUNT - 1 - deal];
            dealIndex[card] = deal;
            slotOf[card] = DEAL_SLOTS[deal];
        }

        const T_ANTIC = 0.9;
        const T_FAN = 1.25;
        const T_PACKETS = 2.78;
        const T_RIFFLE = 3.58;
        const RIFFLE_EVERY = 0.12;
        const T_SQUARE = 4.5;
        const T_DEAL = 5.05;
        const DEAL_EVERY = 0.2;
        const T_GATHER = 10.0;
        const GATHER_EVERY = 0.13;

        const FAN_R = 300;
        const FAN_A = 0.31;
        const GX = CW * GRID + 10;
        const GY = CH * GRID + 10;

        const jitter = (k, salt, amount) => (R.hash(k * 17.3 + salt) - 0.5) * 2 * amount;

        const springStep = (e, omega, zeta) => {
            if (e <= 0) {
                return 0;
            }
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * e) * (Math.cos(wd * e) + ((zeta * omega) / wd) * Math.sin(wd * e));
        };

        const makePose = () => ({ x: 0, y: 0, rot: 0, scale: 1, lift: 0, z: 0 });
        const copyPose = (out, source) => {
            out.x = source.x;
            out.y = source.y;
            out.rot = source.rot;
            out.scale = source.scale;
            out.lift = source.lift;
            out.z = source.z;
            return out;
        };

        const setStack = (out, k) => {
            out.x = CX + (k - 2.5) * 1.4 + jitter(k, 1, 2.2);
            out.y = CY + 8 - k * 3;
            out.rot = jitter(k, 2, 0.045);
            out.scale = HAND;
            out.lift = 0;
            out.z = k;
            return out;
        };
        const setFan = (out, k, spread) => {
            const angle = ((k - 2.5) / 2.5) * FAN_A * spread;
            out.x = CX - 8 + FAN_R * Math.sin(angle);
            out.y = CY - 10 + FAN_R * (1 - Math.cos(angle));
            out.rot = angle;
            out.scale = HAND;
            out.lift = 0;
            out.z = k;
            return out;
        };
        const setPacket = (out, k) => {
            const side = k < 3 ? -1 : 1;
            const depth = k % 3;
            out.x = CX + side * 76 - side * depth * 1.1;
            out.y = CY + 6 - depth * 2.2;
            out.rot = -side * 0.09 + jitter(k, 3, 0.012);
            out.scale = HAND;
            out.lift = 0;
            out.z = depth + (side > 0 ? 3 : 0);
            return out;
        };
        const setPile = (out, k, squared) => {
            const layer = pileIndex[k];
            out.x = CX + (squared ? (layer - 2.5) * 0.5 : jitter(k, 4, 3.5));
            out.y = CY + 2 - layer * 2.1 + (squared ? 0 : jitter(k, 5, 2));
            out.rot = squared ? jitter(k, 6, 0.01) : jitter(k, 7, 0.07);
            out.scale = HAND;
            out.lift = squared ? 0.25 : 0;
            out.z = 10 + layer;
            return out;
        };
        const setSlot = (out, k) => {
            const slot = slotOf[k];
            out.x = CX + ((slot % 3) - 1) * GX;
            out.y = CY + (Math.floor(slot / 3) - 0.5) * GY;
            out.rot = 0;
            out.scale = GRID;
            out.lift = 0;
            out.z = 20 + dealIndex[k];
            return out;
        };

        /* One move from a (which may itself still be moving) to b: the path is an arc, position and rotation
           each follow a damped spring, rotation starts `lead` seconds early and overshoots more, and the move
           is pinned exactly onto b by `end`, so the next move always starts from rest. */
        const travel = (out, from, to, t, t0, opts) => {
            const lead = opts.lead || 0;
            if (t < t0 - lead) {
                return copyPose(out, from);
            }
            const e = t - t0;
            const progress = springStep(e, opts.omega, opts.zeta);
            const pr = springStep(e + lead, opts.omegaRot || opts.omega, opts.zetaRot || opts.zeta * 0.7);
            const settle = 1 - R.smoothstep(t0 + opts.end - 0.2, t0 + opts.end, t);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.hypot(dx, dy) || 1;
            const bend = opts.arc || 0;
            const mx = (from.x + to.x) / 2 + (-dy / len) * bend;
            const my = (from.y + to.y) / 2 + (dx / len) * bend + (opts.rise || 0);
            const remain = 1 - progress;
            let x = remain * remain * from.x + 2 * remain * progress * mx + progress * progress * to.x;
            let y = remain * remain * from.y + 2 * remain * progress * my + progress * progress * to.y;
            const pc = R.clamp(progress);
            const air = Math.sin(PI * pc);
            // Lean into the direction of travel, from the speed along x.
            const pPrev = springStep(e - 1 / 60, opts.omega, opts.zeta);
            const vx = (progress - pPrev) * 60 * dx;
            let rot = from.rot + (to.rot - from.rot) * pr + (opts.spin || 0) * air + R.clamp(vx * 0.00032, -0.2, 0.2);
            x = to.x + (x - to.x) * settle;
            y = to.y + (y - to.y) * settle;
            rot = to.rot + (rot - to.rot) * settle;
            out.x = x;
            out.y = y;
            out.rot = rot;
            out.scale = from.scale + (to.scale - from.scale) * pc + 0.06 * air * (opts.liftAmt || 0);
            out.lift = (opts.liftAmt || 0) * air * settle + to.lift * pc + from.lift * (1 - pc);
            out.z = t >= t0 + (opts.landAt || 0.35) ? to.z : opts.zFlight !== undefined ? opts.zFlight : to.z;
            return out;
        };

        const scratch = [];
        for (let i = 0; i < 8; i++) {
            scratch.push(makePose());
        }
        const target = makePose();

        const stackPose = (out, k, t) => {
            setStack(out, k);
            // Anticipation: the stack gathers itself, down and in, before it fans out.
            const antic = R.ease.inOutSine(R.phase(t, T_ANTIC, T_FAN - T_ANTIC));
            out.y += 5 * antic;
            out.scale *= 1 - 0.018 * antic;
            out.rot += -0.022 * antic * ((k - 2.5) / 2.5);
            return out;
        };

        const fanPose = (out, k, t) => {
            stackPose(out, k, Math.min(t, T_FAN));
            if (t < T_FAN) {
                return out;
            }
            const delay = Math.abs(k - 2.5) * 0.045;
            const spread = springStep(t - T_FAN - delay, 8.2, 0.6);
            const sx = out.x;
            const sy = out.y;
            const srot = out.rot;
            const sscale = out.scale;
            setFan(out, k, spread);
            const hold = 1 - R.clamp(spread);
            out.x += (sx - setFan(target, k, 0).x) * hold;
            out.y += (sy - target.y) * hold;
            out.rot += srot * hold;
            out.scale = sscale + (HAND - sscale) * R.clamp(spread);
            out.lift = 0.3 * Math.sin(PI * R.clamp(spread));
            // Once open, a small wave runs through the hand, card after card.
            const wave = Math.sin(PI * R.phase(t, 2.1 + k * 0.055, 0.42));
            out.y -= 4 * wave;
            out.lift += 0.12 * wave;
            return out;
        };

        const packetPose = (out, k, t) => {
            const from = fanPose(scratch[0], k, t);
            if (t < T_PACKETS - 0.1) {
                return copyPose(out, from);
            }
            const rank = k < 3 ? k : 5 - k;
            setPacket(target, k);
            return travel(out, from, target, t, T_PACKETS + rank * 0.05, {
                omega: 9.5,
                zeta: 0.78,
                zetaRot: 0.5,
                lead: 0.06,
                arc: k < 3 ? 14 : -14,
                end: 1.2,
                liftAmt: 0.2,
                landAt: 0
            });
        };

        const rifflePose = (out, k, t) => {
            const from = packetPose(scratch[1], k, t);
            const layer = pileIndex[k];
            const t0 = T_RIFFLE + layer * RIFFLE_EVERY;
            if (t < t0 - 0.05) {
                return copyPose(out, from);
            }
            setPile(target, k, false);
            const side = k < 3 ? -1 : 1;
            return travel(out, from, target, t, t0, {
                omega: 13,
                zeta: 0.7,
                zetaRot: 0.42,
                lead: 0.04,
                arc: 0,
                rise: -52,
                spin: side * 0.12,
                end: 0.95,
                liftAmt: 0.85,
                zFlight: 40 + layer,
                landAt: 0.3
            });
        };

        const squarePose = (out, k, t) => {
            const from = rifflePose(scratch[2], k, t);
            const t0 = T_SQUARE + pileIndex[k] * 0.018;
            if (t < t0) {
                return copyPose(out, from);
            }
            setPile(target, k, true);
            return travel(out, from, target, t, t0, { omega: 16, zeta: 0.5, zetaRot: 0.4, end: 0.5, landAt: 0 });
        };

        const dealPose = (out, k, t) => {
            const from = squarePose(scratch[3], k, t);
            const dealt = dealIndex[k];
            const t0 = T_DEAL + dealt * DEAL_EVERY;
            if (t < t0 - 0.08) {
                return copyPose(out, from);
            }
            setSlot(target, k);
            const dir = target.x - from.x < -1 ? -1 : target.x - from.x > 1 ? 1 : (target.y < from.y ? -1 : 1);
            return travel(out, from, target, t, t0, {
                omega: 10.5,
                zeta: 0.7,
                zetaRot: 0.36,
                lead: 0.08,
                arc: 0,
                rise: -46,
                spin: dir * 0.3,
                end: 1.25,
                liftAmt: 1,
                zFlight: 50 + dealt,
                landAt: 0.5
            });
        };

        const gatherPose = (out, k, t) => {
            const from = dealPose(scratch[4], k, t);
            const t0 = T_GATHER + k * GATHER_EVERY;
            if (t < t0) {
                return copyPose(out, from);
            }
            // Anticipation: each card leans back, away from the stack, before it swoops in.
            const away = Math.sin(PI * R.phase(t, t0, 0.42));
            const ax = from.x - CX;
            const ay = from.y - CY;
            const al = Math.hypot(ax, ay) || 1;
            const moved = copyPose(scratch[5], from);
            moved.x += (ax / al) * 7 * away;
            moved.y += (ay / al) * 7 * away;
            moved.scale *= 1 + 0.025 * away;
            moved.lift += 0.2 * away;
            setStack(target, k);
            target.z = 70 + k;
            return travel(out, moved, target, t, t0 + 0.13, {
                omega: 9,
                zeta: 0.74,
                zetaRot: 0.45,
                lead: 0.07,
                arc: 58,
                spin: ((slotOf[k] % 3) - 1 || 1) * -0.28,
                end: 1.1,
                liftAmt: 0.9,
                zFlight: 80 + k,
                landAt: 0.45
            });
        };

        const poses = [];
        for (let i = 0; i < COUNT; i++) {
            poses.push(makePose());
        }
        const order = [0, 1, 2, 3, 4, 5];
        const hover = [];
        for (let i = 0; i < COUNT; i++) {
            hover.push(new R.Spring(0, { stiffness: 260, damping: 20 }));
        }

        const computePoses = (t) => {
            const local = R.mod(t, LOOP);
            for (let k = 0; k < COUNT; k++) {
                gatherPose(poses[k], k, local);
            }
            for (let i = 1; i < COUNT; i++) {
                const card = order[i];
                let j = i - 1;
                while (j >= 0 && poses[order[j]].z > poses[card].z) {
                    order[j + 1] = order[j];
                    j--;
                }
                order[j + 1] = card;
            }
        };

        /* A soft shadow sprite, drawn once, stretched and faded with the card's lift. */
        const SHADOW_PAD = 24;
        const shadow = document.createElement('canvas');
        const SHADOW_RES = 2;
        shadow.width = (CW + SHADOW_PAD * 2) * SHADOW_RES;
        shadow.height = (CH + SHADOW_PAD * 2) * SHADOW_RES;
        {
            const pen = shadow.getContext('2d');
            pen.scale(SHADOW_RES, SHADOW_RES);
            pen.shadowColor = 'rgba(0,0,0,1)';
            pen.shadowBlur = 11 * SHADOW_RES;
            pen.shadowOffsetX = 1000 * SHADOW_RES;
            R.roundRect(pen, SHADOW_PAD - 1000, SHADOW_PAD, CW, CH, 9);
            pen.fillStyle = '#000';
            pen.fill();
        }

        /* The miniatures. Each draws in card space: centered, CW x CH, before the pose scale. */
        const LEFT = -CW / 2;
        const TOP = -CH / 2;
        const mono = (size, weight) => `${weight || 400} ${size}px ${R.fonts.mono}`;
        const sans = (size, weight) => `${weight || 400} ${size}px ${R.fonts.display}`;

        const dot = (x, y, radius, color, alpha) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, R.TAU);
            ctx.fillStyle = alpha === undefined ? color : R.rgba(color, alpha);
            ctx.fill();
        };

        const statusDot = (color, t, pulse) => {
            const x = -LEFT - 10;
            const y = TOP + TB / 2;
            if (pulse) {
                const ring = R.fract(t / 2);
                dot(x, y, 2.6 + ring * 5, color, 0.35 * (1 - ring));
            }
            dot(x, y, 2.6, color);
        };

        const glyph = (kind) => {
            const x = LEFT + 9;
            const y = TOP + TB / 2;
            ctx.strokeStyle = pal.muted;
            ctx.fillStyle = pal.muted;
            ctx.lineWidth = 1;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (kind === 'terminal') {
                ctx.moveTo(x - 2.5, y - 2.5);
                ctx.lineTo(x, y);
                ctx.lineTo(x - 2.5, y + 2.5);
                ctx.moveTo(x + 1, y + 2.8);
                ctx.lineTo(x + 3.5, y + 2.8);
            } else if (kind === 'chat') {
                R.roundRect(ctx, x - 3.5, y - 3, 7, 5.2, 1.6);
                ctx.moveTo(x - 1.5, y + 2.2);
                ctx.lineTo(x - 2.5, y + 4);
            } else if (kind === 'browser') {
                ctx.arc(x, y, 3.4, 0, R.TAU);
                ctx.moveTo(x - 3.4, y);
                ctx.lineTo(x + 3.4, y);
                ctx.moveTo(x, y - 3.4);
                ctx.bezierCurveTo(x + 2, y - 1.5, x + 2, y + 1.5, x, y + 3.4);
                ctx.bezierCurveTo(x - 2, y + 1.5, x - 2, y - 1.5, x, y - 3.4);
            } else if (kind === 'note') {
                ctx.moveTo(x - 3, y - 2.5);
                ctx.lineTo(x + 3, y - 2.5);
                ctx.moveTo(x - 3, y);
                ctx.lineTo(x + 3, y);
                ctx.moveTo(x - 3, y + 2.5);
                ctx.lineTo(x + 1, y + 2.5);
            } else if (kind === 'diff') {
                ctx.moveTo(x - 3, y - 1.8);
                ctx.lineTo(x + 1, y - 1.8);
                ctx.moveTo(x - 1, y - 3.8);
                ctx.lineTo(x - 1, y + 0.2);
                ctx.moveTo(x - 1, y + 3);
                ctx.lineTo(x + 3, y + 3);
            } else {
                ctx.rect(x - 3.2, y - 3.2, 2.4, 2.4);
                ctx.moveTo(x + 0.6, y - 2);
                ctx.lineTo(x + 3.6, y - 2);
                ctx.rect(x - 3.2, y + 0.8, 2.4, 2.4);
                ctx.moveTo(x + 0.6, y + 2);
                ctx.lineTo(x + 3.6, y + 2);
            }
            ctx.stroke();
        };

        const chrome = (kind, title, body, titleBar) => {
            R.roundRect(ctx, LEFT, TOP, CW, CH, 7);
            ctx.fillStyle = body;
            ctx.fill();
            ctx.save();
            ctx.clip();
            ctx.fillStyle = titleBar;
            ctx.fillRect(LEFT, TOP, CW, TB);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(LEFT, TOP + TB - 0.5, CW, 0.7);
            ctx.restore();
            glyph(kind);
            ctx.font = mono(7.6, 500);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = pal.muted;
            ctx.fillText(title, LEFT + 17, TOP + TB / 2 + 0.3);
        };

        const border = () => {
            R.roundRect(ctx, LEFT + 0.35, TOP + 0.35, CW - 0.7, CH - 0.7, 6.7);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 0.7;
            ctx.stroke();
        };

        // How much of the living state shows: grows in the hold, fades as each card leaves in the gather.
        const alive = (t, k, from, dur) => {
            const local = R.mod(t, LOOP);
            const gone = R.smoothstep(T_GATHER + k * GATHER_EVERY + 0.18, T_GATHER + k * GATHER_EVERY + 0.5, local);
            return R.clamp((local - from) / dur) * (1 - gone);
        };

        const drawTerminal = (t, k) => {
            chrome('terminal', 'zsh', pal.termBg, pal.surface);
            statusDot(pal.running, t, true);
            const x0 = LEFT + 8;
            let y = TOP + TB + 10;
            const lh = 10.2;
            ctx.textBaseline = 'alphabetic';
            ctx.font = mono(7.2, 400);
            ctx.fillStyle = pal.termDim;
            ctx.fillText('$', x0, y);
            ctx.fillStyle = pal.termFg;
            ctx.fillText('bun test', x0 + 7, y);
            const rows = [
                ['pass', pal.green, 'auth/session.test'],
                ['pass', pal.green, 'cart/add.test'],
                ['pass', pal.green, 'cart/timer.test']
            ];
            for (const [tag, color, file] of rows) {
                y += lh;
                ctx.fillStyle = color;
                ctx.fillText(tag, x0, y);
                ctx.fillStyle = pal.termDim;
                ctx.fillText(file, x0 + 27, y);
            }
            y += lh;
            const done = alive(t, k, 7.55, 0.001);
            ctx.fillStyle = done > 0.5 ? pal.green : pal.blue;
            ctx.fillText(done > 0.5 ? 'pass' : 'run ', x0, y);
            ctx.fillStyle = pal.termDim;
            ctx.fillText('e2e/checkout.test', x0 + 27, y);
            y += lh;
            const summary = '12 passed  0 failed';
            const typed = Math.floor(alive(t, k, 8.1, 0.6) * summary.length);
            let caretX = x0;
            if (typed > 0) {
                ctx.fillStyle = pal.termFg;
                const text = summary.slice(0, typed);
                ctx.fillText(text, x0, y);
                caretX = x0 + ctx.measureText(text).width + 1.5;
            }
            if (R.fract(t) < 0.55) {
                ctx.fillStyle = pal.termFg;
                ctx.fillRect(caretX, y - 6.4, 4, 7.6);
            }
        };

        const drawChat = (t, k) => {
            chrome('chat', 'claude', pal.surface, pal.surface);
            statusDot(pal.needs, t, true);
            ctx.textBaseline = 'alphabetic';
            // The person's message, right aligned.
            const bw = 78;
            R.roundRect(ctx, -LEFT - 8 - bw, TOP + TB + 6, bw, 15, 5);
            ctx.fillStyle = '#232329';
            ctx.fill();
            ctx.font = sans(7.2, 500);
            ctx.fillStyle = pal.text;
            ctx.textAlign = 'left';
            ctx.fillText('fix the flaky test', -LEFT - 8 - bw + 7, TOP + TB + 16.2);
            ctx.font = sans(7.2, 400);
            ctx.fillStyle = pal.muted;
            ctx.fillText('Found it: the cart timer', LEFT + 8, TOP + TB + 32);
            ctx.fillText('races the checkout test.', LEFT + 8, TOP + TB + 42);
            const typing = alive(t, k, 7.3, 0.2) * (1 - alive(t, k, 8.35, 0.15));
            if (typing > 0.01) {
                for (let i = 0; i < 3; i++) {
                    const hop = Math.max(0, Math.sin((t * 2.4 - i * 0.18) * R.TAU)) * 1.8;
                    dot(LEFT + 11 + i * 5, TOP + TB + 55 - hop, 1.4, pal.muted, typing);
                }
            }
            const reply = alive(t, k, 8.35, 0.35);
            if (reply > 0.01) {
                const e = R.ease.outBack(reply, 2.2);
                ctx.save();
                ctx.globalAlpha *= R.clamp(reply * 2);
                ctx.translate(LEFT + 8, TOP + TB + 58);
                ctx.scale(0.8 + 0.2 * e, 0.8 + 0.2 * e);
                R.roundRect(ctx, 0, -9, 58, 13, 4);
                ctx.fillStyle = 'rgba(74,222,128,0.1)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(74,222,128,0.35)';
                ctx.lineWidth = 0.6;
                ctx.stroke();
                ctx.font = mono(6.6, 500);
                ctx.fillStyle = pal.green;
                ctx.fillText('Edit cart.ts', 6, 0.2);
                ctx.restore();
            }
        };

        const drawBrowser = (t, k) => {
            chrome('browser', 'localhost:3000', '#0b0b0e', pal.surface);
            statusDot(pal.idle, t, false);
            const load = alive(t, k, 7.25, 0.9);
            if (load > 0 && load < 1) {
                ctx.save();
                ctx.globalAlpha *= 1 - R.smoothstep(0.8, 1, load);
                ctx.fillStyle = pal.accent;
                ctx.fillRect(LEFT, TOP + TB - 0.2, CW * R.ease.outCubic(load), 1.3);
                ctx.restore();
            }
            const x0 = LEFT + 9;
            const y0 = TOP + TB + 8;
            dot(x0 + 2.5, y0 + 1.5, 2.5, pal.text, 0.9);
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            for (let i = 0; i < 3; i++) {
                ctx.fillRect(-LEFT - 58 + i * 17, y0 + 0.6, 12, 2);
            }
            ctx.fillStyle = 'rgba(236,236,241,0.88)';
            ctx.fillRect(x0, y0 + 12, 54, 5);
            ctx.fillRect(x0, y0 + 20, 40, 5);
            ctx.fillStyle = 'rgba(154,154,166,0.45)';
            ctx.fillRect(x0, y0 + 30, 50, 2);
            ctx.fillRect(x0, y0 + 35, 36, 2);
            R.roundRect(ctx, x0, y0 + 43, 26, 9, 4.5);
            ctx.fillStyle = pal.accent;
            ctx.fill();
            // The image block resolves once the page has loaded.
            const img = alive(t, k, 7.9, 0.5);
            R.roundRect(ctx, -LEFT - 58, y0 + 11, 49, 42, 4);
            const gradient = ctx.createLinearGradient(-LEFT - 58, y0 + 11, -LEFT - 9, y0 + 53);
            gradient.addColorStop(0, R.mix('#18181c', '#1c2233', img, 1));
            gradient.addColorStop(1, R.mix('#18181c', '#2b3a63', img, 1));
            ctx.fillStyle = gradient;
            ctx.fill();
            if (img > 0.01) {
                ctx.save();
                ctx.globalAlpha *= img;
                ctx.translate(-LEFT - 33.5, y0 + 32);
                ctx.transform(1, 0, -0.35, 1, 0, 0);
                R.roundRect(ctx, -12, -10, 14, 14, 3);
                ctx.fillStyle = pal.markDark;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.18)';
                ctx.lineWidth = 0.6;
                ctx.stroke();
                R.roundRect(ctx, -4, -3, 14, 14, 3);
                ctx.fillStyle = pal.markLight;
                ctx.fill();
                ctx.restore();
            }
        };

        const drawNote = (t, k) => {
            chrome('note', 'brief', pal.note, '#332d13');
            ctx.textBaseline = 'alphabetic';
            ctx.font = sans(7.6, 600);
            ctx.fillStyle = '#f3e7b3';
            ctx.fillText('Ship the cart fix', LEFT + 9, TOP + TB + 13);
            ctx.font = sans(7.2, 400);
            ctx.fillStyle = 'rgba(243,231,179,0.78)';
            const lines = ['- flaky timer', '- saved carts', '- demo on friday'];
            lines.forEach((line, i) => {
                ctx.fillText(line, LEFT + 9, TOP + TB + 26 + i * 10.5);
            });
            const strike = alive(t, k, 8.55, 0.3);
            if (strike > 0.01) {
                ctx.strokeStyle = 'rgba(243,231,179,0.85)';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(LEFT + 8, TOP + TB + 23.5);
                ctx.lineTo(LEFT + 8 + 50 * R.ease.inOutCubic(strike), TOP + TB + 23.5);
                ctx.stroke();
            }
        };

        const drawDiff = (t, k) => {
            chrome('diff', 'cart.ts', pal.termBg, pal.surface);
            statusDot(pal.running, t, false);
            const rows = [
                [' ', '41', 'const timer = start()'],
                ['-', '42', 'await sleep(100)'],
                ['+', '42', 'await timer.done()'],
                [' ', '43', 'expect(cart).toBe(1)'],
                ['+', '44', 'timer.stop()']
            ];
            ctx.textBaseline = 'alphabetic';
            ctx.font = mono(6.8, 400);
            let y = TOP + TB + 4;
            const grow = alive(t, k, 7.8, 0.35);
            rows.forEach(([sign, num, code], i) => {
                const rowHeight = i === 4 ? 10.5 * R.ease.outCubic(grow) : 10.5;
                if (rowHeight < 0.5) {
                    return;
                }
                if (sign !== ' ') {
                    ctx.fillStyle = sign === '+' ? 'rgba(74,222,128,0.11)' : 'rgba(239,68,68,0.13)';
                    ctx.fillRect(LEFT, y, CW, rowHeight);
                    ctx.fillStyle = sign === '+' ? pal.green : pal.red;
                    ctx.fillRect(LEFT, y, 1.4, rowHeight);
                }
                ctx.save();
                ctx.globalAlpha *= R.clamp(rowHeight / 10.5);
                ctx.fillStyle = pal.faint;
                ctx.fillText(num, LEFT + 6, y + 7.6);
                ctx.fillStyle = sign === '+' ? pal.green : sign === '-' ? pal.red : pal.termDim;
                ctx.fillText(sign, LEFT + 18, y + 7.6);
                ctx.fillStyle = sign === ' ' ? pal.termDim : pal.termFg;
                ctx.fillText(code, LEFT + 26, y + 7.6);
                ctx.restore();
                y += rowHeight + 1.5;
            });
        };

        const drawPlan = (t, k) => {
            chrome('plan', 'plan', pal.surface, pal.surface);
            statusDot(pal.running, t, true);
            const items = ['Read the cart timer', 'Write a failing test', 'Fix the race', 'Run the suite'];
            const check = alive(t, k, 8.15, 0.45);
            ctx.textBaseline = 'alphabetic';
            items.forEach((text, i) => {
                const x = LEFT + 12;
                const y = TOP + TB + 12 + i * 15;
                let state = i < 2 ? 2 : i === 2 ? 1 : 0;
                let pop = 1;
                if (i === 2 && check > 0) {
                    state = 2;
                    pop = R.ease.outBack(check, 3);
                }
                if (i === 3 && check > 0.4) {
                    state = 1;
                }
                if (state === 2) {
                    ctx.beginPath();
                    ctx.arc(x, y - 2.6, 4 * pop, 0, R.TAU);
                    ctx.fillStyle = 'rgba(74,222,128,0.18)';
                    ctx.fill();
                    ctx.strokeStyle = pal.green;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x - 1.8 * pop, y - 2.6);
                    ctx.lineTo(x - 0.4 * pop, y - 1.1 * pop);
                    ctx.lineTo(x + 2 * pop, y - 4.2 * pop);
                    ctx.stroke();
                } else if (state === 1) {
                    ctx.beginPath();
                    ctx.arc(x, y - 2.6, 3.6, 0, R.TAU);
                    ctx.strokeStyle = 'rgba(96,165,250,0.25)';
                    ctx.lineWidth = 1.1;
                    ctx.stroke();
                    const spin = t * 5;
                    ctx.beginPath();
                    ctx.arc(x, y - 2.6, 3.6, spin, spin + 1.9);
                    ctx.strokeStyle = pal.running;
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.arc(x, y - 2.6, 3.6, 0, R.TAU);
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                    ctx.lineWidth = 0.9;
                    ctx.stroke();
                }
                ctx.font = sans(7.3, state === 1 ? 500 : 400);
                ctx.fillStyle = state === 2 ? pal.faint : state === 1 ? pal.text : pal.muted;
                ctx.fillText(text, x + 9, y);
            });
        };

        const DRAW = { terminal: drawTerminal, chat: drawChat, browser: drawBrowser, note: drawNote, diff: drawDiff, plan: drawPlan };

        const drawCard = (k, t) => {
            const pose = poses[k];
            const hv = hover[k].x;
            const lift = R.clamp(pose.lift + hv * 0.55, 0, 1.6);
            const scale = pose.scale * (1 + 0.035 * hv);
            const y = pose.y - 5 * hv;
            // The shadow drops away and softens as the card rises toward the light.
            ctx.save();
            ctx.translate(pose.x + 2 + 9 * lift, y + 4 + 15 * lift);
            ctx.rotate(pose.rot);
            const ss = scale * (1 + 0.07 * lift);
            ctx.scale(ss, ss);
            ctx.globalAlpha = R.clamp(0.62 - 0.26 * lift);
            ctx.drawImage(shadow, LEFT - SHADOW_PAD, TOP - SHADOW_PAD, CW + SHADOW_PAD * 2, CH + SHADOW_PAD * 2);
            ctx.restore();
            ctx.save();
            ctx.translate(pose.x, y);
            ctx.rotate(pose.rot);
            ctx.scale(scale, scale);
            DRAW[KINDS[k]](t, k);
            border();
            // A faint sheen on the top edge that brightens with lift.
            ctx.fillStyle = `rgba(255,255,255,${(0.035 + 0.04 * lift).toFixed(3)})`;
            ctx.fillRect(LEFT + 7, TOP + 0.4, CW - 14, 0.8);
            ctx.restore();
        };

        /* A soft rectangular fade: the grid is wider than the elliptical fade would keep clear at its corners. */
        const fadeX = ctx.createLinearGradient(0, 0, W, 0);
        const fadeY = ctx.createLinearGradient(0, 0, 0, H);
        for (const gradient of [fadeX, fadeY]) {
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(0.085, 'rgba(0,0,0,1)');
            gradient.addColorStop(0.915, 'rgba(0,0,0,1)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
        }
        const fadeFrame = () => {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.fillStyle = fadeX;
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = fadeY;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        };

        const hitTest = (px, py) => {
            for (let i = COUNT - 1; i >= 0; i--) {
                const k = order[i];
                const pose = poses[k];
                const dx = px - pose.x;
                const dy = py - pose.y;
                const cos = Math.cos(-pose.rot);
                const sin = Math.sin(-pose.rot);
                const lx = dx * cos - dy * sin;
                const ly = dx * sin + dy * cos;
                if (Math.abs(lx) < (CW * pose.scale) / 2 && Math.abs(ly) < (CH * pose.scale) / 2) {
                    return k;
                }
            }
            return -1;
        };

        return {
            update(t, dt) {
                computePoses(t);
                const pointer = env.pointer;
                const px = CX + (pointer.x - CX) / ZOOM;
                const py = CY + (pointer.y - CY) / ZOOM;
                const hit = pointer.inside && pointer.active > 0.2 ? hitTest(px, py) : -1;
                for (let k = 0; k < COUNT; k++) {
                    hover[k].target = k === hit ? 1 : 0;
                    hover[k].step(dt);
                }
            },
            draw(t) {
                env.clear();
                computePoses(t);
                ctx.save();
                ctx.translate(CX, CY);
                ctx.scale(ZOOM, ZOOM);
                ctx.translate(-CX, -CY);
                for (let i = 0; i < COUNT; i++) {
                    drawCard(order[i], t);
                }
                ctx.restore();
                fadeFrame();
            }
        };
    }
});
