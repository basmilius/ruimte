Reel.add({
    id: 'room-in-a-room',
    title: 'Room in a Room',
    line: 'Ruimte means room. Every node is a room, and every room holds a canvas.',
    principles: ['Staging', 'Slow in and slow out'],
    tech: 'Canvas 2D, logarithmic camera, recursive scene',
    hint: 'Move to lean into the room',
    poster: 2.6,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;
        const W = env.W;
        const H = env.H;

        // The page area of the browser node holds the whole 560 x 500 scene at this scale, so it keeps the box's aspect.
        const SCALE = 236 / 560;
        const PERIOD = 5.4;
        const DIVE = 1.75;
        const DWELL = PERIOD - DIVE;
        // A slow push through the hold, so a hold is a moving hold and the dive starts from a camera already alive.
        const DRIFT = 0.035;
        const HEAD = 22;
        const RADIUS = 8;
        const diveEase = R.ease.bezier(0.72, 0, 0.2, 1);

        const room = { x: 162, y: 156, w: 236, h: 236 / 1.12 };
        const fixX = room.x / (1 - SCALE);
        const fixY = room.y / (1 - SCALE);
        const edgeColor = R.mix(pal.bg, pal.accent, 0.55);

        const nodes = [
            { kind: 'terminal', title: 'zsh', x: -6, y: 96, w: 130, h: 116, status: 'running' },
            { kind: 'chat', title: 'claude', x: 2, y: 262, w: 122, h: 132, status: 'needs' },
            { kind: 'note', title: 'plan', x: 436, y: 104, w: 118, h: 84, status: null },
            { kind: 'agent', title: 'codex', x: 436, y: 250, w: 132, h: 108, status: 'running' },
            { kind: 'browser', title: 'station.ruimte.app', x: room.x, y: room.y - HEAD, w: room.w, h: room.h + HEAD, status: 'idle', room: true }
        ];
        const target = nodes[4];
        // Each edge leaves a port along a direction, so it bends like a connector on the canvas and not like a straight wire.
        const edges = [
            { ax: 58, ay: 212, adx: 0, ady: 1, bx: 162, by: 232, bdx: -1, bdy: 0, into: true },
            { ax: 124, ay: 312, adx: 1, ady: 0, bx: 162, by: 326, bdx: -1, bdy: 0, into: true },
            { ax: 398, ay: 214, adx: 1, ady: 0, bx: 494, by: 188, bdx: 0, bdy: 1, into: false },
            { ax: 398, ay: 300, adx: 1, ady: 0, bx: 436, by: 304, bdx: -1, bdy: 0, into: false }
        ];
        for (const edge of edges) {
            const reach = Math.max(18, Math.hypot(edge.bx - edge.ax, edge.by - edge.ay) * 0.42);
            edge.c1x = edge.ax + edge.adx * reach;
            edge.c1y = edge.ay + edge.ady * reach;
            edge.c2x = edge.bx + edge.bdx * reach;
            edge.c2y = edge.by + edge.bdy * reach;
        }
        const termLines = [
            ['$ ', 'bun test', 'cmd'],
            ['', '312 pass  0 fail', 'ok'],
            ['$ ', 'git switch -c hero', 'cmd'],
            ['', "Switched to 'hero'", 'dim'],
            ['$ ', 'bun run build', 'cmd'],
            ['', 'built in 1.4s', 'dim'],
            ['$ ', 'ruimte-context agent', 'cmd'],
            ['', 'started codex', 'ok'],
            ['$ ', 'git diff --stat', 'cmd'],
            ['', '4 files changed', 'dim'],
            ['$ ', 'bun dev', 'cmd'],
            ['', 'ready on :5173', 'ok']
        ];
        const chatMessages = [
            { user: true, lines: ['tidy the auth flow'] },
            { user: false, lines: ['Split it into three', 'steps. Plan below.'] },
            { user: true, lines: ['go ahead'] },
            { user: false, lines: ['Tests are green.', 'Want a review?'] }
        ];
        const toolRows = [
            ['Read', 'hero.ts'],
            ['Edit', 'reel.ts'],
            ['Run', 'bun test'],
            ['Read', 'brief.md'],
            ['Edit', 'take.ts']
        ];
        const noteLines = ['1. read the brief', '2. draw the takes', '3. ship one'];
        const statusColor = { running: pal.running, needs: pal.needs, idle: pal.idle };

        const setFont = (spec) => {
            ctx.font = spec;
        };

        // Real glyphs while they are big enough to read, bars once they are not, and a crossfade between.
        const label = (text, x, y, size, color, zoom, mono, alpha = 1) => {
            const screen = size * zoom;
            const glyph = R.smoothstep(4.6, 6.4, screen);
            if (glyph > 0.01) {
                ctx.globalAlpha = alpha * glyph;
                setFont((mono ? '500 ' : '500 ') + size + 'px ' + (mono ? R.fonts.mono : R.fonts.sans));
                ctx.fillStyle = color;
                ctx.fillText(text, x, y);
            }
            if (glyph < 0.99) {
                ctx.globalAlpha = alpha * (1 - glyph) * 0.55;
                ctx.fillStyle = color;
                ctx.fillRect(x, y - size * 0.62, text.length * size * (mono ? 0.6 : 0.52), size * 0.62);
            }
            ctx.globalAlpha = 1;
        };

        const topRounded = (x, y, width, height, radius) => {
            ctx.beginPath();
            ctx.moveTo(x, y + height);
            ctx.arcTo(x, y, x + width, y, radius);
            ctx.arcTo(x + width, y, x + width, y + height, radius);
            ctx.lineTo(x + width, y + height);
            ctx.closePath();
        };
        const bottomRounded = (x, y, width, height, radius) => {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + width, y);
            ctx.arcTo(x + width, y + height, x, y + height, radius);
            ctx.arcTo(x, y + height, x, y, radius);
            ctx.closePath();
        };

        const glyph = (kind, cx, cy, color, width) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (kind === 'terminal') {
                ctx.moveTo(cx - 4, cy - 3);
                ctx.lineTo(cx - 1, cy);
                ctx.lineTo(cx - 4, cy + 3);
                ctx.moveTo(cx + 0.5, cy + 3.5);
                ctx.lineTo(cx + 4, cy + 3.5);
            } else if (kind === 'chat' || kind === 'agent') {
                ctx.moveTo(cx - 4, cy + 4);
                ctx.lineTo(cx - 4, cy - 2);
                ctx.arcTo(cx - 4, cy - 4, cx - 2, cy - 4, 2);
                ctx.lineTo(cx + 2.5, cy - 4);
                ctx.arcTo(cx + 4.5, cy - 4, cx + 4.5, cy - 2, 2);
                ctx.lineTo(cx + 4.5, cy + 0.5);
                ctx.arcTo(cx + 4.5, cy + 2.5, cx + 2.5, cy + 2.5, 2);
                ctx.lineTo(cx - 1.5, cy + 2.5);
                ctx.closePath();
            } else if (kind === 'browser') {
                ctx.arc(cx, cy, 4.2, 0, R.TAU);
                ctx.moveTo(cx - 4.2, cy);
                ctx.lineTo(cx + 4.2, cy);
                ctx.moveTo(cx, cy - 4.2);
                ctx.bezierCurveTo(cx + 2.6, cy - 2, cx + 2.6, cy + 2, cx, cy + 4.2);
                ctx.bezierCurveTo(cx - 2.6, cy + 2, cx - 2.6, cy - 2, cx, cy - 4.2);
            } else {
                ctx.moveTo(cx - 4, cy - 4);
                ctx.lineTo(cx + 4, cy - 4);
                ctx.lineTo(cx + 4, cy + 1);
                ctx.lineTo(cx + 1, cy + 4);
                ctx.lineTo(cx - 4, cy + 4);
                ctx.closePath();
            }
            ctx.stroke();
        };

        const pulse = (t, speed, phase) => 0.5 + 0.5 * Math.sin(t * speed + phase);

        const drawTerminal = (node, t, zoom) => {
            const x = node.x;
            const top = node.y + HEAD;
            ctx.fillStyle = pal.termBg;
            bottomRounded(x, top, node.w, node.h - HEAD, RADIUS);
            ctx.fill();
            ctx.save();
            ctx.clip();
            // One line every 0.9 s, typed out; the window scrolls as each one lands, a pure function of time.
            const step = 0.9;
            const into = R.fract(t / step);
            // Start with a full screen of history, so the first frame already looks like a session that has been running.
            const count = Math.floor(t / step) + 9;
            const lineH = 11;
            const visible = 8;
            const scroll = R.ease.outCubic(R.clamp(into / 0.35)) * lineH;
            const baseY = top + 14 + lineH * (visible - 1) - scroll + lineH;
            for (let j = 0; j <= visible; j++) {
                const index = count - j;
                if (index < 0) {
                    continue;
                }
                const entry = termLines[index % termLines.length];
                const y = baseY - j * lineH;
                if (y < top + 4 || y > node.y + node.h + lineH) {
                    continue;
                }
                let text = entry[1];
                if (j === 0 && entry[2] === 'cmd') {
                    text = text.slice(0, Math.floor(text.length * R.clamp(into / 0.55)));
                }
                const color = entry[2] === 'cmd' ? pal.termFg : entry[2] === 'ok' ? pal.green : pal.termDim;
                if (entry[0]) {
                    label(entry[0], x + 8, y, 8, pal.faint, zoom, true);
                }
                if (text) {
                    label(text, x + 8 + (entry[0] ? 9.6 : 9.6), y, 8, color, zoom, true);
                }
            }
            const caretY = baseY + lineH;
            if (caretY < node.y + node.h - 2 && Math.sin(t * 6) > -0.2) {
                ctx.fillStyle = pal.termFg;
                ctx.globalAlpha = 0.8;
                ctx.fillRect(x + 8, caretY - 7, 4.8, 8.5);
                ctx.globalAlpha = 1;
            }
            ctx.restore();
        };

        const drawChat = (node, t, zoom) => {
            const x = node.x;
            const top = node.y + HEAD;
            const bottom = node.y + node.h;
            ctx.save();
            bottomRounded(x, top, node.w, node.h - HEAD, RADIUS);
            ctx.clip();
            // A message lands once per room, a beat after the camera settles.
            const shifted = t - 0.9;
            const count = Math.floor(shifted / PERIOD);
            const into = shifted - count * PERIOD;
            const arrive = R.ease.outCubic(R.clamp(into / 0.6));
            const heightOf = (message) => (message.user ? 20 : 26);
            let y = bottom - 28;
            const newest = chatMessages[((count % chatMessages.length) + chatMessages.length) % chatMessages.length];
            y += (1 - arrive) * (heightOf(newest) + 6);
            for (let j = 0; j < 4; j++) {
                const index = count - j;
                const message = chatMessages[((index % chatMessages.length) + chatMessages.length) % chatMessages.length];
                const mh = heightOf(message);
                const alpha = j === 0 ? arrive : 1;
                if (message.user) {
                    const bw = message.lines[0].length * 4.9 + 14;
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = pal.hover;
                    R.roundRect(ctx, x + node.w - 8 - bw, y - mh, bw, mh - 2, 7);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    label(message.lines[0], x + node.w - 1 - bw, y - mh + 12, 8.5, pal.text, zoom, false, alpha);
                } else {
                    label(message.lines[0], x + 9, y - mh + 9, 8.5, pal.muted, zoom, false, alpha);
                    label(message.lines[1], x + 9, y - mh + 20, 8.5, pal.muted, zoom, false, alpha);
                }
                y -= mh + 6;
                if (y < top) {
                    break;
                }
            }
            // The reply field, so it reads as a chat before a single word does.
            ctx.fillStyle = pal.surface;
            ctx.fillRect(x, bottom - 24, node.w, 24);
            ctx.strokeStyle = pal.borderStrong;
            ctx.lineWidth = 1 / (env.scale * zoom);
            R.roundRect(ctx, x + 6, bottom - 20, node.w - 12, 15, 5);
            ctx.stroke();
            label('Reply', x + 12, bottom - 10, 8, pal.faint, zoom, false);
            ctx.restore();
        };

        const drawAgent = (node, t, zoom) => {
            const x = node.x;
            const top = node.y + HEAD;
            const step = 1.35;
            const count = Math.floor(t / step);
            const into = R.fract(t / step);
            const slide = R.ease.inOutCubic(R.clamp(into / 0.45));
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, top + 5, node.w, 48);
            ctx.clip();
            for (let j = 0; j < 4; j++) {
                const row = toolRows[(count + j) % toolRows.length];
                const slot = j - slide;
                const y = top + 16 + slot * 15;
                const alpha = j === 0 ? 1 - slide : j === 3 ? slide : 1;
                const running = j === 3 || (j === 2 && slide < 0.5);
                ctx.fillStyle = running ? pal.running : pal.green;
                ctx.globalAlpha = alpha * (running ? 0.5 + 0.5 * pulse(t, 7, 0) : 0.9);
                ctx.beginPath();
                ctx.arc(x + 11, y - 3, 2, 0, R.TAU);
                ctx.fill();
                ctx.globalAlpha = 1;
                label(row[0], x + 18, y, 8, pal.text, zoom, true, alpha);
                label(row[1], x + 18 + row[0].length * 4.8 + 5, y, 8, pal.muted, zoom, true, alpha);
            }
            ctx.restore();
            // A thin progress shimmer under the running row.
            const barY = top + 58;
            ctx.fillStyle = pal.hover;
            R.roundRect(ctx, x + 10, barY, node.w - 20, 3, 1.5);
            ctx.fill();
            ctx.fillStyle = pal.running;
            ctx.globalAlpha = 0.85;
            R.roundRect(ctx, x + 10, barY, (node.w - 20) * R.ease.inOutSine(into), 3, 1.5);
            ctx.fill();
            ctx.globalAlpha = 1;
        };

        const drawNote = (node, zoom) => {
            const x = node.x;
            for (let j = 0; j < noteLines.length; j++) {
                label(noteLines[j], x + 9, node.y + HEAD + 16 + j * 13, 8.5, '#e9dfb8', zoom, false, 0.85);
            }
        };

        const drawNode = (node, t, zoom, dim, isInnermost, selection) => {
            const hair = 1 / (env.scale * zoom);
            const isNote = node.kind === 'note';
            const bodyColor = isNote ? pal.note : pal.surface;
            ctx.globalAlpha = dim;
            ctx.fillStyle = bodyColor;
            R.roundRect(ctx, node.x, node.y, node.w, node.h, RADIUS);
            ctx.fill();
            ctx.fillStyle = isNote ? pal.note : pal.raised;
            topRounded(node.x, node.y, node.w, HEAD, RADIUS);
            ctx.fill();
            ctx.globalAlpha = 1;
            if (node.w * zoom > 14) {
                if (node.kind === 'terminal') {
                    drawTerminal(node, t, zoom);
                } else if (node.kind === 'chat') {
                    drawChat(node, t, zoom);
                } else if (node.kind === 'agent') {
                    drawAgent(node, t, zoom);
                } else if (isNote) {
                    drawNote(node, zoom);
                }
            }
            if (node.room && isInnermost) {
                ctx.fillStyle = pal.bg;
                bottomRounded(node.x, node.y + HEAD, node.w, node.h - HEAD, RADIUS);
                ctx.fill();
            }
            if (dim < 1) {
                // Dimming paints the ground over the node, so the node sinks back instead of turning see-through.
                ctx.globalAlpha = 1 - dim;
                ctx.fillStyle = pal.bg;
                R.roundRect(ctx, node.x - 1, node.y - 1, node.w + 2, node.h + 2, RADIUS + 1);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            // Title bar: kind glyph, title, status dot.
            const midY = node.y + HEAD / 2;
            if (node.w * zoom > 10) {
                glyph(node.kind, node.x + 12, midY, isNote ? '#cdbf8e' : pal.muted, 1.1);
                if (node.room) {
                    ctx.fillStyle = pal.sunken;
                    R.roundRect(ctx, node.x + 22, node.y + 4.5, node.w - 42, HEAD - 9, 6.5);
                    ctx.fill();
                    label(node.title, node.x + 29, midY + 3, 8.5, pal.muted, zoom, false);
                } else {
                    label(node.title, node.x + 22, midY + 3.3, 9.5, isNote ? '#e9dfb8' : pal.text, zoom, false, 0.92);
                }
                if (node.status) {
                    const color = statusColor[node.status];
                    const beat = node.status === 'idle' ? 1 : 0.55 + 0.45 * pulse(t, node.status === 'needs' ? 3.2 : 4.4, node.x);
                    ctx.fillStyle = color;
                    ctx.globalAlpha = beat;
                    ctx.beginPath();
                    ctx.arc(node.x + node.w - 11, midY, 3, 0, R.TAU);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                }
            }
            ctx.strokeStyle = isNote ? 'rgba(236,236,241,0.12)' : pal.border;
            ctx.lineWidth = hair;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y + HEAD);
            ctx.lineTo(node.x + node.w, node.y + HEAD);
            ctx.stroke();
            ctx.strokeStyle = node.room ? pal.borderStrong : pal.border;
            R.roundRect(ctx, node.x, node.y, node.w, node.h, RADIUS);
            ctx.stroke();
            if (selection > 0.01) {
                ctx.strokeStyle = R.rgba(pal.accent, 0.75 * selection);
                ctx.lineWidth = Math.max(1.6 / zoom, hair * 2);
                const pad = 3.5;
                R.roundRect(ctx, node.x - pad, node.y - pad, node.w + pad * 2, node.h + pad * 2, RADIUS + pad);
                ctx.stroke();
            }
        };

        const bezierPoint = (edge, at) => {
            const inv = 1 - at;
            const wa = inv * inv * inv;
            const wb = 3 * inv * inv * at;
            const wc = 3 * inv * at * at;
            const wd = at * at * at;
            return [wa * edge.ax + wb * edge.c1x + wc * edge.c2x + wd * edge.bx, wa * edge.ay + wb * edge.c1y + wc * edge.c2y + wd * edge.by];
        };

        const drawEdges = (zoom, flow, dim) => {
            ctx.strokeStyle = edgeColor;
            ctx.lineWidth = Math.max(1.5, 1 / (env.scale * zoom));
            ctx.lineCap = 'round';
            ctx.globalAlpha = dim;
            ctx.beginPath();
            for (const edge of edges) {
                ctx.moveTo(edge.ax, edge.ay);
                ctx.bezierCurveTo(edge.c1x, edge.c1y, edge.c2x, edge.c2y, edge.bx, edge.by);
            }
            ctx.stroke();
            ctx.fillStyle = edgeColor;
            ctx.beginPath();
            for (const edge of edges) {
                ctx.moveTo(edge.ax + 2.6, edge.ay);
                ctx.arc(edge.ax, edge.ay, 2.6, 0, R.TAU);
                ctx.moveTo(edge.bx + 2.6, edge.by);
                ctx.arc(edge.bx, edge.by, 2.6, 0, R.TAU);
            }
            ctx.fill();
            ctx.globalAlpha = 1;
            if (flow > 0.001 && flow < 0.999) {
                // Context runs into the room just before the camera follows it in.
                ctx.fillStyle = pal.running;
                for (let j = 0; j < edges.length; j++) {
                    const edge = edges[j];
                    const local = R.clamp(flow * 1.3 - j * 0.1);
                    const at = R.ease.inOutSine(edge.into ? local : 1 - local);
                    const [x, y] = bezierPoint(edge, at);
                    ctx.globalAlpha = Math.sin(local * Math.PI) * 0.95;
                    ctx.beginPath();
                    ctx.arc(x, y, 2.3, 0, R.TAU);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }
        };

        const drawGrid = (zoom, ox, oy, left, top, right, bottom) => {
            const spacing = 20;
            const screenSpacing = spacing * zoom;
            const alpha = 0.1 * R.smoothstep(4.5, 9, screenSpacing);
            if (alpha < 0.004) {
                return;
            }
            const toLocal = (sx, origin, fix) => fix + (sx - origin - fix) / zoom;
            const lx0 = Math.ceil(toLocal(left, ox, fixX) / spacing) * spacing;
            const lx1 = toLocal(right, ox, fixX);
            const ly0 = Math.ceil(toLocal(top, oy, fixY) / spacing) * spacing;
            const ly1 = toLocal(bottom, oy, fixY);
            const size = R.clamp(1.1 * zoom, 0.7, 2.2);
            ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
            ctx.beginPath();
            for (let ly = ly0; ly <= ly1; ly += spacing) {
                const sy = fixY + zoom * (ly - fixY) + oy;
                for (let lx = lx0; lx <= lx1; lx += spacing) {
                    const sx = fixX + zoom * (lx - fixX) + ox;
                    ctx.rect(sx - size / 2, sy - size / 2, size, size);
                }
            }
            ctx.fill();
        };

        return {
            draw(t) {
                env.clear();
                const unit = env.scale;
                const at = R.mod(t, PERIOD);
                const dive = diveEase(R.clamp((at - DWELL) / DIVE));
                const progress = (1 - DRIFT) * dive + DRIFT * (at / PERIOD);
                const camera = Math.pow(SCALE, -progress);
                const pointer = env.pointer;
                const leanX = -(pointer.x - W / 2) * 0.045 * pointer.active;
                const leanY = -(pointer.y - H / 2) * 0.045 * pointer.active;
                const selection = R.smoothstep(DWELL - 0.75, DWELL - 0.2, at) * (1 - R.smoothstep(PERIOD - 0.8, PERIOD, at));
                const flow = R.clamp((at - (DWELL - 1.3)) / 1.1);

                let clip = null;
                for (let level = 0; level < 6; level++) {
                    const zoom = camera * Math.pow(SCALE, level);
                    if (zoom * W < 6) {
                        break;
                    }
                    const lean = Math.min(zoom, 1);
                    const ox = leanX * lean;
                    const oy = leanY * lean;
                    const innermost = camera * Math.pow(SCALE, level + 1) * W < 6;
                    ctx.save();
                    let left = -20;
                    let top = -20;
                    let right = W + 20;
                    let bottom = H + 20;
                    if (clip) {
                        // Inset by a device pixel so the room's own hairline stays whole around the canvas inside it.
                        const inset = 0.8 / unit;
                        ctx.setTransform(unit, 0, 0, unit, 0, 0);
                        bottomRounded(clip.x + inset, clip.y + inset, clip.w - inset * 2, clip.h - inset * 2, Math.max(0, clip.r - inset));
                        ctx.clip();
                        left = Math.max(left, clip.x);
                        top = Math.max(top, clip.y);
                        right = Math.min(right, clip.x + clip.w);
                        bottom = Math.min(bottom, clip.y + clip.h);
                        // The page is the ground of the room: opaque while it is a window, gone once it is the whole view.
                        const ground = 1 - R.smoothstep(0.42, 1, zoom);
                        if (ground > 0.001) {
                            ctx.fillStyle = R.rgba(pal.bg, ground);
                            ctx.fillRect(clip.x, clip.y, clip.w, clip.h);
                        }
                    } else {
                        ctx.setTransform(unit, 0, 0, unit, 0, 0);
                    }
                    drawGrid(zoom, ox, oy, left, top, right, bottom);
                    ctx.setTransform(unit * zoom, 0, 0, unit * zoom, unit * (fixX * (1 - zoom) + ox), unit * (fixY * (1 - zoom) + oy));
                    // Everything but the room sinks back while the camera flies past it.
                    const dim = 1 - 0.55 * R.smoothstep(1.05, 2.1, zoom);
                    drawEdges(zoom, flow, dim);
                    for (const node of nodes) {
                        drawNode(node, t, zoom, node.room ? 1 : dim, innermost, node.room ? selection * (1 - R.smoothstep(1.1, 1.5, zoom)) : 0);
                    }
                    ctx.restore();
                    clip = {
                        x: fixX + zoom * (room.x - fixX) + ox,
                        y: fixY + zoom * (room.y - fixY) + oy,
                        w: room.w * zoom,
                        h: room.h * zoom,
                        r: RADIUS * zoom
                    };
                    if (innermost) {
                        break;
                    }
                }
                env.fadeEdges(0.52, 0.98);
            }
        };
    }
});
