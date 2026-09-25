Reel.add({
    id: 'making-room',
    title: 'Making Room',
    line: 'There is always room for one more. Open a node and the rest make space.',
    principles: ['Slow in and slow out', 'Staging'],
    tech: 'Canvas 2D, power diagram with Lloyd relaxation',
    hint: 'Move in to claim a room of your own',
    poster: 9.0,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;

        const CX = 280;
        const CY = 252;
        const RX = 214;
        const RY = 194;
        const EXPONENT = 4.2;
        const GUTTER = 3.5;
        const CORNER = 9;
        const EVENT = 3.2;
        const START = 1;
        const INITIAL = 11;
        const GROW = 2.1;
        const MAXV = 200;

        // The region: a superellipse, convex, sampled densely enough that its facets never show.
        const SIDES = 88;
        const regionX = new Float64Array(SIDES);
        const regionY = new Float64Array(SIDES);
        for (let i = 0; i < SIDES; i++) {
            const angle = (i / SIDES) * R.TAU;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            regionX[i] = CX + RX * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / EXPONENT);
            regionY[i] = CY + RY * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / EXPONENT);
        }
        let regionArea = 0;
        for (let i = 0; i < SIDES; i++) {
            const k = (i + 1) % SIDES;
            regionArea += regionX[i] * regionY[k] - regionX[k] * regionY[i];
        }
        regionArea = Math.abs(regionArea) / 2;

        const makeBuffer = () => ({ x: new Float64Array(MAXV), y: new Float64Array(MAXV), l: new Int32Array(MAXV), n: 0 });
        const bufA = makeBuffer();
        const bufB = makeBuffer();
        const bufC = makeBuffer();

        // Sutherland-Hodgman against the half-plane x.n <= c. Each vertex carries the label of the edge that leaves it,
        // so the finished cell knows which neighbor every side belongs to.
        const clip = (src, dst, nx, ny, limit, label) => {
            const count = src.n;
            let written = 0;
            if (count === 0) {
                dst.n = 0;
                return;
            }
            let px = src.x[count - 1];
            let py = src.y[count - 1];
            let pl = src.l[count - 1];
            let pd = px * nx + py * ny - limit;
            for (let k = 0; k < count; k++) {
                const qx = src.x[k];
                const qy = src.y[k];
                const ql = src.l[k];
                const qd = qx * nx + qy * ny - limit;
                if (qd <= 0) {
                    if (pd > 0) {
                        const cut = pd / (pd - qd);
                        dst.x[written] = px + (qx - px) * cut;
                        dst.y[written] = py + (qy - py) * cut;
                        dst.l[written] = pl;
                        written++;
                    }
                    dst.x[written] = qx;
                    dst.y[written] = qy;
                    dst.l[written] = ql;
                    written++;
                } else if (pd <= 0) {
                    const cut = pd / (pd - qd);
                    dst.x[written] = px + (qx - px) * cut;
                    dst.y[written] = py + (qy - py) * cut;
                    dst.l[written] = label;
                    written++;
                }
                px = qx;
                py = qy;
                pl = ql;
                pd = qd;
            }
            dst.n = written;
        };

        const catalog = [
            ['terminal', 'zsh'],
            ['chat', 'claude'],
            ['browser', 'localhost'],
            ['note', 'plan'],
            ['chat', 'codex'],
            ['terminal', 'bun dev'],
            ['browser', 'docs'],
            ['chat', 'review'],
            ['terminal', 'tests'],
            ['note', 'notes'],
            ['chat', 'agent 2'],
            ['browser', 'preview'],
            ['terminal', 'git']
        ];
        const statusColors = [pal.running, pal.needs, pal.idle, pal.idle, pal.running];

        const cells = [];
        let you = null;

        const birthOf = (id) => (id < INITIAL ? -Infinity : START + 2 * (id - INITIAL) * EVENT);
        const deathOf = (id) => START + (2 * id + 1) * EVENT;

        const powerAt = (x, y, skip) => {
            let best = Infinity;
            for (const cell of cells) {
                if (cell === skip) {
                    continue;
                }
                const value = (x - cell.x) * (x - cell.x) + (y - cell.y) * (y - cell.y) - cell.w;
                if (value < best) {
                    best = value;
                }
            }
            return best;
        };

        const makeCell = (id, x, y, fixed) => {
            const entry = catalog[(id * 5) % catalog.length];
            const cell = {
                id,
                kind: fixed ? 'you' : entry[0],
                name: fixed ? 'you' : entry[1],
                x,
                y,
                w: 0,
                fixed,
                size: fixed ? 1 : 0.72 + 0.6 * R.hash(id * 3.71 + 0.4),
                share: 0,
                born: fixed ? 0 : birthOf(id),
                dies: fixed ? Infinity : deathOf(id),
                poly: makeBuffer(),
                area: 0,
                cx: x,
                cy: y,
                deriv: 0
            };
            // Weighted so the new site starts as a sliver around its own point instead of stealing a whole cell.
            cell.w = cells.length ? -powerAt(x, y, null) + 24 : 0;
            return cell;
        };

        const shareOf = (cell, t) => {
            if (cell.fixed) {
                return 1.15 * env.pointer.active;
            }
            const grow = cell.born === -Infinity ? 1 : R.ease.inOutCubic((t - cell.born) / GROW);
            const shrink = R.ease.inOutCubic((t - cell.dies) / GROW);
            const breathe = 1 + 0.1 * Math.sin(t * 0.45 + cell.id * 1.7);
            return cell.size * breathe * grow * (1 - shrink);
        };

        const computeCell = (cell) => {
            const src = bufA;
            for (let i = 0; i < SIDES; i++) {
                src.x[i] = regionX[i];
                src.y[i] = regionY[i];
                src.l[i] = -1;
            }
            src.n = SIDES;
            let from = bufA;
            let to = bufB;
            const pp = cell.x * cell.x + cell.y * cell.y;
            for (let j = 0; j < cells.length; j++) {
                const other = cells[j];
                if (other === cell) {
                    continue;
                }
                const nx = other.x - cell.x;
                const ny = other.y - cell.y;
                if (nx * nx + ny * ny < 1e-6) {
                    continue;
                }
                const limit = (other.x * other.x + other.y * other.y - pp - other.w + cell.w) / 2;
                clip(from, to, nx, ny, limit, j);
                const swap = from;
                from = to;
                to = swap;
                if (from.n === 0) {
                    break;
                }
            }
            const poly = cell.poly;
            poly.n = from.n;
            let area = 0;
            let sx = 0;
            let sy = 0;
            let deriv = 0;
            for (let k = 0; k < from.n; k++) {
                poly.x[k] = from.x[k];
                poly.y[k] = from.y[k];
                poly.l[k] = from.l[k];
            }
            for (let k = 0; k < poly.n; k++) {
                const next = (k + 1) % poly.n;
                const cross = poly.x[k] * poly.y[next] - poly.x[next] * poly.y[k];
                area += cross;
                sx += (poly.x[k] + poly.x[next]) * cross;
                sy += (poly.y[k] + poly.y[next]) * cross;
                const label = poly.l[k];
                if (label >= 0) {
                    const other = cells[label];
                    const length = Math.hypot(poly.x[next] - poly.x[k], poly.y[next] - poly.y[k]);
                    deriv += length / (2 * Math.hypot(other.x - cell.x, other.y - cell.y));
                }
            }
            if (Math.abs(area) > 1e-6) {
                cell.cx = sx / (3 * area);
                cell.cy = sy / (3 * area);
            } else {
                cell.cx = cell.x;
                cell.cy = cell.y;
            }
            cell.area = Math.abs(area) / 2;
            cell.deriv = deriv;
        };

        let nextId = INITIAL;
        const sync = (t) => {
            while (birthOf(nextId) <= t) {
                const angle = nextId * 2.39996 + 0.6;
                const radius = 0.3 + 0.35 * R.hash(nextId * 5.3);
                cells.push(makeCell(nextId, CX + Math.cos(angle) * RX * radius, CY + Math.sin(angle) * RY * radius, false));
                nextId++;
            }
            for (let i = cells.length - 1; i >= 0; i--) {
                const cell = cells[i];
                if (!cell.fixed && t > cell.dies + GROW && cell.area < 1) {
                    cells.splice(i, 1);
                }
            }
            if (env.pointer.active > 0.02 && !you) {
                you = makeCell(-1, env.pointer.x, env.pointer.y, true);
                cells.push(you);
            } else if (you && env.pointer.active <= 0.02) {
                cells.splice(cells.indexOf(you), 1);
                you = null;
            }
        };

        const relax = (t, dt) => {
            sync(t);
            if (you) {
                // Keep the person's site inside the region, where a cell can be cut for it.
                const dx = (env.pointer.x - CX) / RX;
                const dy = (env.pointer.y - CY) / RY;
                const reach = Math.pow(Math.pow(Math.abs(dx), EXPONENT) + Math.pow(Math.abs(dy), EXPONENT), 1 / EXPONENT);
                const pull = reach > 0.82 ? 0.82 / reach : 1;
                you.x = CX + dx * RX * pull;
                you.y = CY + dy * RY * pull;
            }
            let total = 0;
            for (const cell of cells) {
                cell.share = shareOf(cell, t);
                total += cell.share;
            }
            for (const cell of cells) {
                computeCell(cell);
            }
            const moveRate = 1 - Math.exp(-dt * 2.6);
            const weightRate = 1 - Math.exp(-dt * 9);
            let mean = 0;
            for (const cell of cells) {
                const targetArea = total > 0 ? (regionArea * cell.share) / total : 0;
                const slope = Math.max(cell.deriv, 0.35);
                const step = R.clamp(((targetArea - cell.area) / slope) * weightRate, -900, 900);
                cell.w += step;
                if (!cell.fixed) {
                    cell.x += (cell.cx - cell.x) * moveRate;
                    cell.y += (cell.cy - cell.y) * moveRate;
                    if (you) {
                        // The person's site pushes the sites it comes near, so no two points ever meet.
                        const dx = cell.x - you.x;
                        const dy = cell.y - you.y;
                        const distance = Math.hypot(dx, dy);
                        if (distance < 56 && distance > 1e-3) {
                            const push = ((56 - distance) / distance) * moveRate * 1.5;
                            cell.x += dx * push;
                            cell.y += dy * push;
                        }
                    }
                }
                mean += cell.w;
            }
            mean /= Math.max(1, cells.length);
            for (const cell of cells) {
                cell.w -= mean;
            }
        };

        // Prewarm, so the very first frame is already a settled layout.
        {
            for (let id = 0; id < INITIAL; id++) {
                const radius = Math.sqrt((id + 0.5) / INITIAL) * 0.78;
                const angle = id * 2.39996;
                const cell = makeCell(id, CX + Math.cos(angle) * RX * radius, CY + Math.sin(angle) * RY * radius, false);
                cell.w = 0;
                cells.push(cell);
            }
            for (let i = 0; i < 240; i++) {
                relax(0, 1 / 60);
            }
        }

        // The inset pane: the cell cut back by half a gutter along every side, which stays convex and never self-crosses.
        const inset = (poly, out) => {
            let from = bufA;
            let to = bufB;
            for (let k = 0; k < poly.n; k++) {
                from.x[k] = poly.x[k];
                from.y[k] = poly.y[k];
                from.l[k] = 0;
            }
            from.n = poly.n;
            let signed = 0;
            for (let k = 0; k < poly.n; k++) {
                const next = (k + 1) % poly.n;
                signed += poly.x[k] * poly.y[next] - poly.x[next] * poly.y[k];
            }
            const orient = signed > 0 ? 1 : -1;
            for (let k = 0; k < poly.n; k++) {
                const next = (k + 1) % poly.n;
                const ex = poly.x[next] - poly.x[k];
                const ey = poly.y[next] - poly.y[k];
                const length = Math.hypot(ex, ey);
                if (length < 1e-4) {
                    continue;
                }
                // Inward normal for this winding.
                const inx = (-ey / length) * orient;
                const iny = (ex / length) * orient;
                clip(from, to, -inx, -iny, -(poly.x[k] * inx + poly.y[k] * iny + GUTTER), 0);
                const swap = from;
                from = to;
                to = swap;
                if (from.n === 0) {
                    break;
                }
            }
            out.n = from.n;
            for (let k = 0; k < from.n; k++) {
                out.x[k] = from.x[k];
                out.y[k] = from.y[k];
            }
        };

        const roundedPath = (poly) => {
            const count = poly.n;
            ctx.beginPath();
            if (count < 3) {
                return false;
            }
            const lastX = poly.x[count - 1];
            const lastY = poly.y[count - 1];
            ctx.moveTo((lastX + poly.x[0]) / 2, (lastY + poly.y[0]) / 2);
            for (let k = 0; k < count; k++) {
                const prev = (k + count - 1) % count;
                const next = (k + 1) % count;
                const ax = poly.x[prev] - poly.x[k];
                const ay = poly.y[prev] - poly.y[k];
                const bx = poly.x[next] - poly.x[k];
                const by = poly.y[next] - poly.y[k];
                const la = Math.hypot(ax, ay);
                const lb = Math.hypot(bx, by);
                if (la < 1e-4 || lb < 1e-4) {
                    continue;
                }
                const cos = R.clamp((ax * bx + ay * by) / (la * lb), -1, 1);
                const half = Math.acos(cos) / 2;
                // The arc may only use half of each side, or two corners would overlap.
                const radius = Math.min(CORNER, Math.min(la, lb) * 0.5 * Math.tan(half));
                ctx.arcTo(poly.x[k], poly.y[k], poly.x[next], poly.y[next], Math.max(0, radius));
            }
            ctx.closePath();
            return true;
        };

        const glyph = (kind, cx, cy, size, color) => {
            const unit = size / 10;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(unit, unit);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (kind === 'terminal') {
                ctx.moveTo(-5, -3.5);
                ctx.lineTo(-1.5, 0);
                ctx.lineTo(-5, 3.5);
                ctx.moveTo(0.5, 4);
                ctx.lineTo(5, 4);
            } else if (kind === 'chat') {
                ctx.moveTo(-5, 5);
                ctx.lineTo(-5, -2.5);
                ctx.arcTo(-5, -5, -2.5, -5, 2.5);
                ctx.lineTo(3, -5);
                ctx.arcTo(5.5, -5, 5.5, -2.5, 2.5);
                ctx.lineTo(5.5, 0.5);
                ctx.arcTo(5.5, 3, 3, 3, 2.5);
                ctx.lineTo(-2, 3);
                ctx.closePath();
            } else if (kind === 'browser') {
                ctx.arc(0, 0, 5.2, 0, R.TAU);
                ctx.moveTo(-5.2, 0);
                ctx.lineTo(5.2, 0);
                ctx.moveTo(0, -5.2);
                ctx.bezierCurveTo(3.2, -2.5, 3.2, 2.5, 0, 5.2);
                ctx.bezierCurveTo(-3.2, 2.5, -3.2, -2.5, 0, -5.2);
            } else {
                ctx.moveTo(-5, -5);
                ctx.lineTo(5, -5);
                ctx.lineTo(5, 1.5);
                ctx.lineTo(1.5, 5);
                ctx.lineTo(-5, 5);
                ctx.closePath();
                ctx.moveTo(-2.5, -1.5);
                ctx.lineTo(2.5, -1.5);
                ctx.moveTo(-2.5, 1.5);
                ctx.lineTo(0.5, 1.5);
            }
            ctx.stroke();
            ctx.restore();
        };

        const pane = makeBuffer();
        const meanArea = () => regionArea / Math.max(1, cells.length);

        return {
            update(t, dt) {
                relax(t, dt);
            },
            draw(t) {
                env.clear();
                const typical = Math.sqrt(meanArea());
                for (const cell of cells) {
                    if (cell.poly.n < 3) {
                        continue;
                    }
                    inset(cell.poly, pane);
                    if (!roundedPath(pane)) {
                        continue;
                    }
                    const age = t - cell.born;
                    const fresh = cell.fixed ? 0 : R.clamp(1 - (age - 0.4) / 1.6);
                    const leaving = cell.fixed ? 0 : R.clamp((t - cell.dies) / GROW);
                    if (cell.fixed) {
                        const active = env.pointer.active;
                        ctx.fillStyle = R.rgba(pal.accent, 0.05 * active);
                        ctx.fill();
                        ctx.setLineDash([4, 4]);
                        ctx.lineDashOffset = -t * 8;
                        ctx.strokeStyle = R.rgba(pal.accent, 0.75 * active);
                        ctx.lineWidth = 1.2;
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.fillStyle = R.rgba(pal.text, 0.7 * active);
                        ctx.font = '500 12px ' + R.fonts.mono;
                        ctx.textAlign = 'center';
                        ctx.fillText('you', cell.cx, cell.cy + 4);
                        ctx.textAlign = 'left';
                        continue;
                    }
                    ctx.fillStyle = pal.surface;
                    ctx.fill();
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = fresh > 0 ? R.rgba('#ffffff', 0.09 + 0.22 * fresh) : 'rgba(255,255,255,0.09)';
                    ctx.stroke();

                    // Content grows with the room it gets and leaves before its cell closes.
                    const room = Math.sqrt(cell.area) / typical;
                    const presence = R.smoothstep(0.35, 0.75, room) * (1 - R.smoothstep(0, 0.6, leaving));
                    if (presence > 0.01) {
                        const size = R.clamp(room, 0.75, 1.15);
                        const x = cell.cx;
                        const y = cell.cy;
                        ctx.globalAlpha = presence;
                        glyph(cell.kind, x, y - 9 * size, 17 * size, pal.muted);
                        ctx.font = '500 ' + Math.round(12 * size) + 'px ' + R.fonts.mono;
                        const width = ctx.measureText(cell.name).width;
                        const dot = 3.2 * size;
                        const gap = 6 * size;
                        const start = x - (width + dot * 2 + gap) / 2;
                        const baseline = y + 15 * size;
                        const slot = Math.floor((t + R.hash(cell.id * 1.3) * 9) / 7);
                        const status = statusColors[Math.floor(R.hash(cell.id * 13.1 + slot * 7.7) * statusColors.length)];
                        const beat = status === pal.idle ? 1 : 0.68 + 0.32 * Math.sin(t * (status === pal.needs ? 3.4 : 4.6) + cell.id);
                        ctx.fillStyle = status;
                        ctx.globalAlpha = presence * beat;
                        ctx.beginPath();
                        ctx.arc(start + dot, baseline - 4 * size, dot, 0, R.TAU);
                        ctx.fill();
                        ctx.globalAlpha = presence;
                        ctx.fillStyle = pal.muted;
                        ctx.fillText(cell.name, start + dot * 2 + gap, baseline);
                        ctx.globalAlpha = 1;
                    }
                    if (age > 0 && age < 1.6) {
                        // The pulse that says a node was opened here.
                        const ring = R.ease.outCubic(age / 1.3);
                        ctx.strokeStyle = R.rgba(pal.text, 0.4 * (1 - R.clamp(age / 1.3)));
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(cell.cx, cell.cy, 6 + ring * 54, 0, R.TAU);
                        ctx.stroke();
                    }
                }
                env.fadeEdges(0.72, 1);
            }
        };
    }
});
