Reel.add({
    id: 'patch-bay',
    title: 'Patch Bay',
    line: 'Draw a line to share context. Every connection is a real cable.',
    principles: ['Follow through and overlapping action', 'Secondary action'],
    tech: 'Canvas 2D, Verlet ropes',
    hint: 'Move to pluck the cables, press to grab one',
    poster: 4.15,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const TAU = R.TAU;
        const pal = R.pal;
        const CYCLE = 20;

        /* The canvas: four nodes in a loose diamond, each bobbing on a period that divides the cycle. */
        const NODES = [
            { kind: 'term', title: 'zsh', x: 218, y: 74, w: 124, h: 80, period: 5, phase: 0.2, status: pal.idle },
            { kind: 'chat', title: 'claude', x: 50, y: 196, w: 124, h: 82, period: 4, phase: 1.9, status: pal.running },
            { kind: 'web', title: 'localhost:3000', x: 380, y: 202, w: 136, h: 82, period: 6.666666666666667, phase: 3.1, status: pal.idle },
            { kind: 'note', title: 'brief', x: 224, y: 354, w: 112, h: 70, period: 10, phase: 4.4, status: null }
        ];
        const pulse = NODES.map(() => new R.Spring(0, { stiffness: 260, damping: 11 }));
        const nodeX = new Float32Array(NODES.length);
        const nodeY = new Float32Array(NODES.length);
        const nodeScale = new Float32Array(NODES.length).fill(1);

        // Ports: a node, a side and an offset along that side.
        const PORTS = {
            zB: [0, 'bottom', 62],
            zL: [0, 'left', 48],
            zD: [0, 'bottom', 22],
            zR: [0, 'right', 48],
            cR: [1, 'right', 44],
            cB: [1, 'bottom', 62],
            bL: [2, 'left', 34],
            bM: [2, 'left', 62],
            nL: [3, 'left', 36],
            nR: [3, 'right', 36]
        };
        const PORT_IDS = Object.keys(PORTS);
        const portLight = {};
        const portColor = {};
        for (const id of PORT_IDS) {
            portLight[id] = 0;
            portColor[id] = null;
        }
        const at = { x: 0, y: 0, nx: 0, ny: 0 };
        const portAt = (id) => {
            const [index, side, offset] = PORTS[id];
            const node = NODES[index];
            const scale = nodeScale[index];
            const cx = nodeX[index] + node.w / 2;
            const cy = nodeY[index] + node.h / 2;
            let lx = 0;
            let ly = 0;
            at.nx = 0;
            at.ny = 0;
            if (side === 'bottom' || side === 'top') {
                lx = offset - node.w / 2;
                ly = side === 'top' ? -node.h / 2 : node.h / 2;
                at.ny = side === 'top' ? -1 : 1;
            } else {
                lx = side === 'left' ? -node.w / 2 : node.w / 2;
                ly = offset - node.h / 2;
                at.nx = side === 'left' ? -1 : 1;
            }
            at.x = cx + lx * scale;
            at.y = cy + ly * scale;
            return at;
        };

        const placeNodes = (time) => {
            for (let index = 0; index < NODES.length; index++) {
                const node = NODES[index];
                const angle = (TAU * time) / node.period + node.phase;
                nodeX[index] = node.x + 2.2 * Math.sin(angle * 0.5 + 1);
                nodeY[index] = node.y + 4.5 * Math.sin(angle);
                nodeScale[index] = 1 + 0.045 * pulse[index].x;
            }
        };

        /* Cables: Verlet ropes with a fixed root port and a plug that moves. */
        const SEGMENTS = 22;
        // The context edge: the accent mixed into the ground. The amber one is a session that needs you.
        const context = R.mix(pal.accent, pal.bg, 0.42);
        const CABLES = [
            { root: 'cR', plug: 'zD', length: 172, base: context, mid: '#3f78f0', light: '#a9c3ff', dark: '#081a4a' },
            { root: 'zR', plug: 'bL', length: 146, base: context, mid: '#3f78f0', light: '#a9c3ff', dark: '#081a4a' },
            { root: 'zB', plug: null, length: 170, base: '#c98c12', mid: '#f0b43a', light: '#fff0c2', dark: '#4a3004' }
        ];
        const GRAVITY = 1150;
        const SUBSTEP = 1 / 120;
        const ITERATIONS = 10;
        for (const cable of CABLES) {
            cable.px = new Float32Array(SEGMENTS);
            cable.py = new Float32Array(SEGMENTS);
            cable.ox = new Float32Array(SEGMENTS);
            cable.oy = new Float32Array(SEGMENTS);
            cable.rest = cable.length / (SEGMENTS - 1);
            cable.held = false;
            // Ports that hold a cable keep a faint ring in its color.
            portColor[cable.root] = cable.light;
            if (cable.plug) {
                portColor[cable.plug] = cable.light;
            }
        }
        placeNodes(0);
        // Start every cable on a smooth curve that already leaves each port straight, so none begins in a loop.
        for (const cable of CABLES) {
            const root = portAt(cable.root);
            const rx = root.x;
            const ry = root.y;
            const r1x = rx + root.nx * cable.length * 0.3;
            const r1y = ry + root.ny * cable.length * 0.3;
            let ex = rx;
            let ey = ry + cable.length * 0.9;
            let e1x = ex;
            let e1y = ey - cable.length * 0.3;
            if (cable.plug) {
                const end = portAt(cable.plug);
                ex = end.x;
                ey = end.y;
                e1x = ex + end.nx * cable.length * 0.3;
                e1y = ey + end.ny * cable.length * 0.3 + 30;
            }
            for (let i = 0; i < SEGMENTS; i++) {
                const along = i / (SEGMENTS - 1);
                const rest = 1 - along;
                const w0 = rest * rest * rest;
                const w1 = 3 * rest * rest * along;
                const w2 = 3 * rest * along * along;
                const w3 = along * along * along;
                cable.px[i] = cable.ox[i] = w0 * rx + w1 * r1x + w2 * e1x + w3 * ex;
                cable.py[i] = cable.oy[i] = w0 * ry + w1 * r1y + w2 * e1y + w3 * ey;
            }
        }

        /* The phantom cursor's day: every move picks one plug up and puts it somewhere else. */
        const MOVES = [
            { cable: 2, to: 'bM', start: 0.8, rest: [452, 156] },
            { cable: 0, to: 'nL', start: 5.8, rest: [140, 330] },
            { cable: 0, to: 'zD', start: 10.8, rest: [150, 132] },
            { cable: 2, to: null, start: 15.6, rest: [366, 178] }
        ];
        const REST_START = [366, 178];
        const APPROACH = 1.0;
        const GRAB = 1.08;
        const UNPLUG = 1.22;
        const CARRY_FROM = 1.4;
        const CARRY_TO = 3.0;
        const SNAP = 3.2;
        const LIFT = 3.34;
        const DROP = 2.35;

        const cursor = { x: REST_START[0], y: REST_START[1], press: new R.Spring(0, { stiffness: 420, damping: 18 }) };
        const pillX = new R.Spring(cursor.x + 14, { stiffness: 140, damping: 12 });
        const pillY = new R.Spring(cursor.y + 24, { stiffness: 140, damping: 12 });
        const from = { x: REST_START[0], y: REST_START[1] };
        const carryFrom = { x: 0, y: 0 };
        const snapAt = { x: 0, y: 0 };
        let moveIndex = -1;
        const flashes = [];
        for (let i = 0; i < 4; i++) {
            flashes.push({ x: 0, y: 0, age: 9, color: '#fff' });
        }
        let flashNext = 0;

        const grabbed = { cable: -1, point: -1 };

        const wrapLocal = (time) => R.mod(time, CYCLE);

        const activeMove = (local) => {
            for (let i = MOVES.length - 1; i >= 0; i--) {
                if (local >= MOVES[i].start) {
                    return i;
                }
            }
            return -1;
        };

        const cursorTarget = (move, elapsed, time) => {
            const cable = CABLES[move.cable];
            const last = SEGMENTS - 1;
            if (elapsed < APPROACH + 0.08) {
                // Toward the plug: where it sits in its port, or where it swings right now.
                let gx = cable.px[last];
                let gy = cable.py[last];
                if (cable.plug) {
                    const port = portAt(cable.plug);
                    gx = port.x;
                    gy = port.y;
                }
                const e = R.ease.inOutCubic(elapsed / APPROACH);
                const dx = gx - from.x;
                const dy = gy - from.y;
                const bow = 0.18 * Math.sin(Math.PI * e);
                cursor.x = from.x + dx * e + dy * bow;
                cursor.y = from.y + dy * e - dx * bow;
                return;
            }
            if (elapsed < CARRY_FROM) {
                if (move.fromPort) {
                    // A tug: a push in first, then the pull that frees it.
                    const port = portAt(move.fromPort);
                    const tug = 20 * R.ease.inBack(R.clamp((elapsed - GRAB) / (CARRY_FROM - GRAB)), 2.4);
                    cursor.x = port.x + port.nx * tug;
                    cursor.y = port.y + port.ny * tug;
                } else {
                    cursor.x = cable.px[last];
                    cursor.y = cable.py[last];
                }
                carryFrom.x = cursor.x;
                carryFrom.y = cursor.y;
                return;
            }
            if (!move.to) {
                // Lift it clear and let go.
                const lift = R.ease.inOutCubic(R.clamp((elapsed - CARRY_FROM) / (DROP - CARRY_FROM)));
                const lx = carryFrom.x + 34;
                const ly = carryFrom.y - 46;
                cursor.x = R.lerp(carryFrom.x, lx, lift);
                cursor.y = R.lerp(carryFrom.y, ly, lift) - 10 * Math.sin(Math.PI * lift);
                snapAt.x = cursor.x;
                snapAt.y = cursor.y;
                if (elapsed > DROP + 0.25) {
                    retreat(move, elapsed - (DROP + 0.25), time);
                }
                return;
            }
            const port = portAt(move.to);
            const ax = port.x + port.nx * 26;
            const ay = port.y + port.ny * 26;
            if (elapsed < CARRY_TO) {
                // Carried on an arc, never a straight slide.
                const e = R.ease.inOutCubic((elapsed - CARRY_FROM) / (CARRY_TO - CARRY_FROM));
                const dx = ax - carryFrom.x;
                const dy = ay - carryFrom.y;
                const dist = Math.hypot(dx, dy) + 1e-3;
                // Bow upward on a sideways carry, and away from the cable's root on a steep one.
                let bx = -dy / dist;
                let by = dx / dist;
                if (Math.abs(by) > 0.35) {
                    if (by > 0) {
                        bx = -bx;
                        by = -by;
                    }
                } else {
                    const root = portAt(cable.root);
                    if (bx * (carryFrom.x - root.x) < 0) {
                        bx = -bx;
                        by = -by;
                    }
                }
                const qx = (carryFrom.x + ax) / 2 + bx * 0.34 * dist;
                const qy = (carryFrom.y + ay) / 2 + by * 0.34 * dist;
                const inv = 1 - e;
                cursor.x = inv * inv * carryFrom.x + 2 * inv * e * qx + e * e * ax;
                cursor.y = inv * inv * carryFrom.y + 2 * inv * e * qy + e * e * ay;
                return;
            }
            if (elapsed < SNAP) {
                // Into the socket accelerating, so it lands with a snap rather than a glide.
                const e = R.ease.inQuad((elapsed - CARRY_TO) / (SNAP - CARRY_TO));
                cursor.x = R.lerp(ax, port.x, e);
                cursor.y = R.lerp(ay, port.y, e);
                snapAt.x = cursor.x;
                snapAt.y = cursor.y;
                return;
            }
            snapAt.x = port.x;
            snapAt.y = port.y;
            if (elapsed < LIFT + 0.12) {
                cursor.x = port.x;
                cursor.y = port.y;
                return;
            }
            retreat(move, elapsed - (LIFT + 0.12), time);
        };

        // While it waits, the phantom cursor hovers the way a hand never holds still.
        const hover = { x: 0, y: 0 };
        const hoverAt = (time) => {
            hover.x = 3.2 * Math.sin(time * 1.15) + 1.4 * Math.sin(time * 2.3 + 1);
            hover.y = 2.6 * Math.sin(time * 1.6 + 0.5);
        };

        const retreat = (move, since, time) => {
            const e = R.ease.inOutCubic(since / 1.1);
            const dx = move.rest[0] - snapAt.x;
            const dy = move.rest[1] - snapAt.y;
            const bow = -0.14 * Math.sin(Math.PI * e);
            hoverAt(time);
            cursor.x = snapAt.x + dx * e + dy * bow + hover.x * e;
            cursor.y = snapAt.y + dy * e - dx * bow + hover.y * e;
        };

        const flash = (x, y, color) => {
            const ring = flashes[flashNext];
            flashNext = (flashNext + 1) % flashes.length;
            ring.x = x;
            ring.y = y;
            ring.age = 0;
            ring.color = color;
        };

        // Fires the moments of a move once, whatever the frame rate: grab, unplug, snap, drop.
        const crossed = (mark, before, after) => before < mark && after >= mark;
        const events = (move, before, after) => {
            const cable = CABLES[move.cable];
            if (crossed(GRAB, before, after)) {
                move.fromPort = cable.plug;
                cursor.press.target = 1;
                cable.held = true;
            }
            if (crossed(UNPLUG, before, after) && move.fromPort) {
                portLight[move.fromPort] = 0;
                portColor[move.fromPort] = null;
                cable.plug = null;
                pulse[PORTS[move.fromPort][0]].v -= 4;
            }
            if (move.to && crossed(SNAP, before, after)) {
                cable.plug = move.to;
                cable.held = false;
                const port = portAt(move.to);
                portLight[move.to] = 1;
                portColor[move.to] = cable.light;
                flash(port.x, port.y, cable.light);
                pulse[PORTS[move.to][0]].v += 9;
                cursor.press.target = 0;
            }
            if (!move.to && crossed(DROP, before, after)) {
                cable.held = false;
                cursor.press.target = 0;
            }
        };

        const simulate = (slice) => {
            const pointer = env.pointer;
            for (let index = 0; index < CABLES.length; index++) {
                const cable = CABLES[index];
                const last = SEGMENTS - 1;
                for (let i = 0; i < SEGMENTS; i++) {
                    const x = cable.px[i];
                    const y = cable.py[i];
                    const vx = (x - cable.ox[i]) * 0.993;
                    const vy = (y - cable.oy[i]) * 0.993;
                    cable.ox[i] = x;
                    cable.oy[i] = y;
                    cable.px[i] = x + vx;
                    cable.py[i] = y + vy + GRAVITY * slice * slice;
                }
                const root = portAt(cable.root);
                const rx = root.x;
                const ry = root.y;
                const rnx = root.nx;
                const rny = root.ny;
                let ex = 0;
                let ey = 0;
                let enx = 0;
                let eny = 0;
                if (cable.plug) {
                    const end = portAt(cable.plug);
                    ex = end.x;
                    ey = end.y;
                    enx = end.nx;
                    eny = end.ny;
                }
                for (let k = 0; k < ITERATIONS; k++) {
                    for (let i = 0; i < last; i++) {
                        const dx = cable.px[i + 1] - cable.px[i];
                        const dy = cable.py[i + 1] - cable.py[i];
                        const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6;
                        const diff = (dist - cable.rest) / dist;
                        // The plug outweighs the cable, so a free end hangs straight and swings slow.
                        const wa = i < 2 ? 0 : 1;
                        const wb = i + 1 === last ? 0.45 : 1;
                        const total = wa + wb || 1;
                        cable.px[i] += dx * diff * (wa / total);
                        cable.py[i] += dy * diff * (wa / total);
                        cable.px[i + 1] -= dx * diff * (wb / total);
                        cable.py[i + 1] -= dy * diff * (wb / total);
                    }
                    // A thick cable resists bending, most of all in the boot by each plug.
                    for (let i = 0; i < last - 1; i++) {
                        const boot = i < 3 || (i > last - 5 && cable.plug !== null);
                        const least = (boot ? 1.9 : 1.75) * cable.rest;
                        const dx = cable.px[i + 2] - cable.px[i];
                        const dy = cable.py[i + 2] - cable.py[i];
                        const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6;
                        if (dist < least) {
                            const push = ((least - dist) / dist) * (boot ? 0.2 : 0.06);
                            cable.px[i] -= dx * push;
                            cable.py[i] -= dy * push;
                            cable.px[i + 2] += dx * push;
                            cable.py[i + 2] += dy * push;
                        }
                    }
                    cable.px[0] = rx;
                    cable.py[0] = ry;
                    cable.px[1] = rx + rnx * cable.rest;
                    cable.py[1] = ry + rny * cable.rest;
                    if (cable.plug) {
                        cable.px[last] = ex;
                        cable.py[last] = ey;
                        cable.px[last - 1] = ex + enx * cable.rest;
                        cable.py[last - 1] = ey + eny * cable.rest;
                    } else if (cable.held) {
                        cable.px[last] = cursor.x;
                        cable.py[last] = cursor.y;
                    }
                    if (grabbed.cable === index && grabbed.point > 1 && grabbed.point < last - 1) {
                        cable.px[grabbed.point] = pointer.x;
                        cable.py[grabbed.point] = pointer.y;
                    }
                }
                // Your finger: it pushes the cable aside like a real one.
                if (pointer.active > 0.05 && grabbed.cable < 0) {
                    const radius = 20 * pointer.active;
                    for (let i = 2; i < last - 1; i++) {
                        const dx = cable.px[i] - pointer.x;
                        const dy = cable.py[i] - pointer.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < radius * radius) {
                            const dist = Math.sqrt(d2) + 1e-6;
                            cable.px[i] = pointer.x + (dx / dist) * radius;
                            cable.py[i] = pointer.y + (dy / dist) * radius;
                        }
                    }
                }
            }
        };

        const pickUp = () => {
            const pointer = env.pointer;
            if (!pointer.down || !pointer.inside) {
                grabbed.cable = -1;
                return;
            }
            if (grabbed.cable >= 0) {
                return;
            }
            let best = 38 * 38;
            for (let index = 0; index < CABLES.length; index++) {
                for (let i = 2; i < SEGMENTS - 2; i++) {
                    const dx = CABLES[index].px[i] - pointer.x;
                    const dy = CABLES[index].py[i] - pointer.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < best) {
                        best = d2;
                        grabbed.cable = index;
                        grabbed.point = i;
                    }
                }
            }
        };

        let accumulator = 0;
        let simTime = 0;
        // Let the cables find their rest before the first frame, so nothing starts crumpled.
        for (let i = 0; i < 360; i++) {
            simulate(SUBSTEP);
        }

        const tube = (cable) => {
            const xs = cable.px;
            const ys = cable.py;
            ctx.beginPath();
            ctx.moveTo(xs[0], ys[0]);
            for (let i = 1; i < SEGMENTS - 1; i++) {
                ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
            }
            ctx.lineTo(xs[SEGMENTS - 1], ys[SEGMENTS - 1]);
        };

        const drawCable = (cable) => {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.save();
            ctx.translate(0, 7);
            tube(cable);
            ctx.strokeStyle = 'rgba(0,0,0,0.32)';
            ctx.lineWidth = 7;
            ctx.stroke();
            ctx.restore();
            tube(cable);
            ctx.strokeStyle = cable.dark;
            ctx.lineWidth = 7.2;
            ctx.stroke();
            ctx.strokeStyle = cable.base;
            ctx.lineWidth = 5.2;
            ctx.stroke();
            // A round tube: a lit band toward the light, up and to the left, and a narrow specular line on it.
            ctx.save();
            ctx.translate(-0.4, -0.9);
            tube(cable);
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = cable.mid;
            ctx.lineWidth = 2.6;
            ctx.stroke();
            ctx.translate(-0.3, -0.6);
            tube(cable);
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = cable.light;
            ctx.lineWidth = 0.9;
            ctx.stroke();
            ctx.restore();
            ctx.globalAlpha = 1;
        };

        const drawPlug = (cable) => {
            const last = SEGMENTS - 1;
            let angle;
            if (cable.plug) {
                const port = portAt(cable.plug);
                angle = Math.atan2(-port.ny, -port.nx);
            } else {
                angle = Math.atan2(cable.py[last] - cable.py[last - 1], cable.px[last] - cable.px[last - 1]);
            }
            ctx.save();
            ctx.translate(cable.px[last], cable.py[last]);
            ctx.rotate(angle);
            ctx.fillStyle = '#c9ccd4';
            R.roundRect(ctx, -2, -2, 6, 4, 1.5);
            ctx.fill();
            ctx.fillStyle = cable.dark;
            R.roundRect(ctx, -15, -4.6, 14, 9.2, 3);
            ctx.fill();
            ctx.fillStyle = cable.base;
            R.roundRect(ctx, -14, -3.6, 12, 5, 2.4);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillRect(-12.5, -3, 9, 1);
            ctx.restore();
        };

        const glyph = (kind, x, y, color) => {
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (kind === 'term') {
                ctx.moveTo(x, y - 3);
                ctx.lineTo(x + 3, y);
                ctx.lineTo(x, y + 3);
                ctx.moveTo(x + 4.5, y + 3.5);
                ctx.lineTo(x + 8, y + 3.5);
            } else if (kind === 'chat') {
                R.roundRect(ctx, x - 0.5, y - 4, 9, 7, 2.5);
                ctx.moveTo(x + 1.5, y + 3);
                ctx.lineTo(x + 0.5, y + 5.5);
                ctx.lineTo(x + 4, y + 3);
            } else if (kind === 'web') {
                ctx.arc(x + 4, y, 4.2, 0, TAU);
                ctx.moveTo(x - 0.2, y);
                ctx.lineTo(x + 8.2, y);
                ctx.moveTo(x + 4, y - 4.2);
                ctx.bezierCurveTo(x + 6.5, y - 2, x + 6.5, y + 2, x + 4, y + 4.2);
                ctx.moveTo(x + 4, y - 4.2);
                ctx.bezierCurveTo(x + 1.5, y - 2, x + 1.5, y + 2, x + 4, y + 4.2);
            } else {
                ctx.moveTo(x, y - 3);
                ctx.lineTo(x + 8, y - 3);
                ctx.moveTo(x, y);
                ctx.lineTo(x + 8, y);
                ctx.moveTo(x, y + 3);
                ctx.lineTo(x + 5, y + 3);
            }
            ctx.stroke();
        };

        const drawNode = (index, time) => {
            const node = NODES[index];
            const scale = nodeScale[index];
            ctx.save();
            ctx.translate(nodeX[index] + node.w / 2, nodeY[index] + node.h / 2);
            ctx.scale(scale, scale);
            ctx.translate(-node.w / 2, -node.h / 2);
            const width = node.w;
            const height = node.h;
            const note = node.kind === 'note';
            R.roundRect(ctx, 0, 0, width, height, 8);
            ctx.fillStyle = note ? pal.note : pal.surface;
            ctx.fill();
            ctx.strokeStyle = pal.borderStrong;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.strokeStyle = pal.border;
            ctx.beginPath();
            ctx.moveTo(0, 24);
            ctx.lineTo(width, 24);
            ctx.stroke();
            glyph(node.kind, 9, 12, note ? '#c9b772' : pal.muted);
            ctx.font = '500 10.5px ' + R.fonts.mono;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = note ? '#d9c98a' : pal.muted;
            ctx.fillText(node.title, 24, 12.5);
            if (node.status) {
                const beat = node.status === pal.running ? 0.55 + 0.45 * Math.sin(time * 3.1) : 1;
                ctx.fillStyle = node.status;
                ctx.globalAlpha = 0.25 * beat;
                ctx.beginPath();
                ctx.arc(width - 11, 12, 5.5, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.beginPath();
                ctx.arc(width - 11, 12, 3, 0, TAU);
                ctx.fill();
            }
            // Content: small enough to read as a node, quiet enough to leave the cables in front.
            if (node.kind === 'term') {
                R.roundRect(ctx, 4, 27, width - 8, height - 31, 5);
                ctx.fillStyle = pal.termBg;
                ctx.fill();
                ctx.font = '500 9.5px ' + R.fonts.mono;
                ctx.fillStyle = pal.termDim;
                ctx.fillText('$', 10, 38);
                ctx.fillStyle = pal.termFg;
                ctx.fillText('bun dev', 20, 38);
                ctx.fillStyle = pal.green;
                ctx.fillText('ready', 10, 51);
                ctx.fillStyle = pal.termDim;
                ctx.fillText('in 212 ms', 44, 51);
                if (R.fract(time * 0.9) < 0.55) {
                    ctx.fillStyle = pal.termFg;
                    ctx.fillRect(10, 59, 5.5, 9);
                }
            } else if (node.kind === 'chat') {
                ctx.fillStyle = pal.raised;
                R.roundRect(ctx, 10, 32, 84, 13, 6.5);
                ctx.fill();
                ctx.fillStyle = 'rgba(21,93,252,0.32)';
                R.roundRect(ctx, width - 72, 50, 62, 13, 6.5);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.14)';
                ctx.fillRect(16, 37.5, 60, 2);
                ctx.fillRect(width - 64, 55.5, 44, 2);
                ctx.fillStyle = pal.faint;
                ctx.fillRect(10, 70, 48, 2);
            } else if (node.kind === 'web') {
                ctx.fillStyle = pal.raised;
                R.roundRect(ctx, 8, 30, width - 16, 12, 6);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fillRect(8, 48, width - 16, 10);
                ctx.fillRect(8, 62, (width - 20) / 2, 12);
                ctx.fillRect(12 + (width - 20) / 2, 62, (width - 20) / 2, 12);
            } else {
                ctx.fillStyle = 'rgba(217,201,138,0.3)';
                ctx.fillRect(10, 34, 78, 2);
                ctx.fillRect(10, 42, 90, 2);
                ctx.fillRect(10, 50, 64, 2);
                ctx.fillRect(10, 58, 72, 2);
            }
            ctx.restore();
        };

        const drawPort = (id) => {
            const port = portAt(id);
            const light = portLight[id];
            ctx.fillStyle = pal.sunken;
            ctx.beginPath();
            ctx.arc(port.x, port.y, 5, 0, TAU);
            ctx.fill();
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = portColor[id] && light > 0.01 ? portColor[id] : 'rgba(255,255,255,0.2)';
            ctx.globalAlpha = portColor[id] ? 0.45 + 0.55 * light : 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
        };

        const ARROW = new Path2D('M0 0 L0 16.2 L3.9 12.6 L6.6 18.6 L9.1 17.5 L6.5 11.7 L11.6 11.7 Z');

        return {
            update(t, dt) {
                accumulator += dt;
                while (accumulator > 1e-6) {
                    const slice = Math.min(SUBSTEP, accumulator);
                    accumulator -= slice;
                    simTime += slice;
                    const local = wrapLocal(simTime);
                    placeNodes(simTime);
                    const index = activeMove(local);
                    if (index !== moveIndex) {
                        if (index >= 0) {
                            from.x = cursor.x;
                            from.y = cursor.y;
                        }
                        moveIndex = index;
                    }
                    if (index >= 0) {
                        const move = MOVES[index];
                        const elapsed = local - move.start;
                        events(move, elapsed - slice, elapsed);
                        cursorTarget(move, elapsed, simTime);
                    } else {
                        const rest = MOVES[MOVES.length - 1].rest;
                        hoverAt(simTime);
                        cursor.x = rest[0] + hover.x;
                        cursor.y = rest[1] + hover.y;
                    }
                    cursor.press.step(slice);
                    for (const spring of pulse) {
                        spring.step(slice);
                    }
                    pillX.target = cursor.x + 14;
                    pillY.target = cursor.y + 24;
                    pillX.step(slice);
                    pillY.step(slice);
                    pickUp();
                    simulate(slice);
                    for (const id of PORT_IDS) {
                        portLight[id] = Math.max(portColor[id] ? 0.35 : 0, portLight[id] - slice * 1.4);
                    }
                    for (const ring of flashes) {
                        ring.age += slice;
                    }
                }
            },
            draw(t) {
                env.clear();
                placeNodes(simTime);
                for (let index = 0; index < NODES.length; index++) {
                    drawNode(index, t);
                }
                for (const id of PORT_IDS) {
                    drawPort(id);
                }
                // The cable in hand goes over the others.
                for (const cable of CABLES) {
                    if (!cable.held) {
                        drawCable(cable);
                    }
                }
                for (const cable of CABLES) {
                    if (cable.held) {
                        drawCable(cable);
                    }
                }
                for (const cable of CABLES) {
                    drawPlug(cable);
                }

                for (const ring of flashes) {
                    if (ring.age < 0.5) {
                        const k = ring.age / 0.5;
                        ctx.strokeStyle = ring.color;
                        ctx.globalAlpha = 0.7 * (1 - k) * (1 - k);
                        ctx.lineWidth = 1.6;
                        ctx.beginPath();
                        ctx.arc(ring.x, ring.y, 5 + R.ease.outCubic(k) * 20, 0, TAU);
                        ctx.stroke();
                        ctx.globalAlpha = (1 - k) * 0.9;
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath();
                        ctx.arc(ring.x, ring.y, 3.2 * (1 - k), 0, TAU);
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }
                }

                // The phantom cursor and its name tag, which trails it on a spring.
                const press = 1 - 0.12 * cursor.press.x;
                ctx.font = '500 10px ' + R.fonts.mono;
                ctx.textBaseline = 'middle';
                const label = 'claude';
                const width = ctx.measureText(label).width + 12;
                ctx.fillStyle = pal.accent;
                R.roundRect(ctx, pillX.x, pillY.x - 8, width, 16, 8);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.fillText(label, pillX.x + 6, pillY.x + 0.5);
                ctx.save();
                ctx.translate(cursor.x, cursor.y);
                ctx.scale(press, press);
                ctx.lineJoin = 'round';
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = 'rgba(8,8,10,0.95)';
                ctx.stroke(ARROW);
                ctx.fillStyle = '#f4f5f8';
                ctx.fill(ARROW);
                ctx.restore();

                env.fadeEdges(0.64, 0.99);
            }
        };
    }
});
