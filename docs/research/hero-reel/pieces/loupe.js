Reel.add({
    id: 'loupe',
    title: 'Loupe',
    line: 'Follow the work. Wherever you look, it comes into focus.',
    principles: ['Squash and stretch', 'Appeal'],
    tech: 'WebGL, SDF refraction, chromatic aberration, spring-driven deformation',
    hint: 'Move to lead the lens',
    poster: 5.6,
    create(env) {
        const R = env.R;
        const pal = R.pal;
        const W = env.W;
        const H = env.H;
        const CYCLE = 16;
        const SEG = 4;
        const TRAVEL = 1.8;
        const LENS = 74;
        const MAG = 1.45;

        const FRAG = `
uniform sampler2D u_sharp;
uniform sampler2D u_blur;
uniform sampler2D u_live;
uniform vec4 u_liveRect;
uniform vec2 u_lens;
uniform vec2 u_deform;
uniform float u_size;
uniform float u_mag;
uniform float u_dim;
uniform vec4 u_dots[5];
uniform vec4 u_bar;
uniform vec3 u_barCol;

vec2 toUv(vec2 q) {
    return vec2(q.x / 560.0, 1.0 - q.y / 500.0);
}

vec4 over(vec4 top, vec4 under) {
    return top + under * (1.0 - top.a);
}

float box2(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + r;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

// A superellipse, with its value divided by its gradient so it reads as a distance in logical px.
float squircle(vec2 q, float r, out vec2 grad) {
    vec2 a = abs(q) / r + 1e-5;
    vec2 a3 = a * a * a;
    float f = pow(a3.x * a.x + a3.y * a.y, 0.25);
    vec2 g = sign(q) * a3 / (f * f * f);
    grad = g;
    return (f - 1.0) * r / max(length(g), 0.5);
}

vec4 sharpAt(vec2 q) {
    vec4 c = texture2D(u_sharp, toUv(q));
    vec2 lq = (q - u_liveRect.xy) / u_liveRect.zw;
    if (lq.x > 0.0 && lq.y > 0.0 && lq.x < 1.0 && lq.y < 1.0) {
        c = over(texture2D(u_live, vec2(lq.x, 1.0 - lq.y)), c);
    }
    return c;
}

// What moves on the canvas: status rings and a progress fill, drawn at any softness.
vec4 live(vec2 q, float soft) {
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 5; i++) {
        vec4 d = u_dots[i];
        vec3 col = d.w < 0.5 ? vec3(0.376, 0.647, 0.98) : vec3(0.984, 0.749, 0.141);
        float period = d.w < 0.5 ? 2.0 : 1.6;
        float ph = fract(u_time / period + float(i) * 0.31);
        float r = length(q - d.xy);
        float ringR = d.z + ph * d.z * 3.0;
        float ring = (1.0 - smoothstep(0.35, 0.8 + soft, abs(r - ringR))) * pow(1.0 - ph, 2.0) * 0.6;
        acc = over(vec4(col, 1.0) * ring, acc);
    }
    vec2 bc = u_bar.xy + vec2(u_bar.z, u_bar.w) * 0.5;
    float bd = box2(q - bc, vec2(u_bar.z, u_bar.w) * 0.5, u_bar.w * 0.5);
    float fill = clamp(0.5 - bd / soft, 0.0, 1.0) * step(0.5, u_bar.z);
    acc = over(vec4(u_barCol, 1.0) * fill, acc);
    return acc;
}

void main() {
    vec2 p = logical();
    float px = 1.0 / u_scale;
    vec4 col = texture2D(u_blur, toUv(p)) * u_dim;
    col = over(live(p, 2.2) * 0.45, col);

    vec2 rel = p - u_lens;
    float a = u_deform.x;
    float b = u_deform.y;
    mat2 inv = mat2(1.0 - a, -b, -b, 1.0 + a) / (1.0 - a * a - b * b);
    vec2 grad;
    // the lens lifts off the canvas: a soft shadow, offset down
    float ssd = squircle(inv * (rel - vec2(2.0, 13.0)), u_size, grad);
    float shade = (1.0 - smoothstep(-18.0, 30.0, ssd)) * 0.5;
    col = vec4(col.rgb * (1.0 - shade), shade + col.a * (1.0 - shade));

    float sd = squircle(inv * rel, u_size, grad);
    float cov = clamp(0.5 - sd / px, 0.0, 1.0);
    if (cov > 0.0) {
        float e = -sd;
        vec2 n = normalize(inv * grad + 1e-5);
        // flat in the middle, bending harder toward the rim, and each channel bends its own amount
        float s = 1.0 - clamp(e / 30.0, 0.0, 1.0);
        float bend = s * s * 34.0;
        vec2 base = u_lens + rel / u_mag;
        vec2 off = n * bend;
        float ca = 0.16 * s * s;
        vec4 cr = sharpAt(base + off * (1.0 + ca));
        vec4 cg = sharpAt(base + off);
        vec4 cb = sharpAt(base + off * (1.0 - ca));
        vec4 lens = vec4(cr.r, cg.g, cb.b, max(cg.a, max(cr.a, cb.a)));
        lens = over(live(base + off, 0.6), lens);
        // the glass itself: a faint cool body, lighter toward the top
        float body = 0.035 + 0.035 * clamp(-rel.y / u_size, -1.0, 1.0);
        lens = over(lens, vec4(vec3(0.75, 0.82, 1.0) * body, body));
        // light: a Fresnel rim that favors the key side, a specular streak inside it, a hairline edge
        vec2 key = normalize(vec2(-0.62, -0.78));
        float facing = dot(n, key);
        float rim = pow(s, 3.0) * (0.08 + 0.5 * max(facing, 0.0) + 0.14 * max(-facing, 0.0));
        float streak = smoothstep(0.45, 0.97, facing) * exp(-pow((e - 9.0) / 3.2, 2.0)) * 0.55;
        float caustic = smoothstep(0.5, 0.98, -facing) * exp(-pow((e - 6.0) / 4.0, 2.0)) * 0.16;
        float hair = (1.0 - smoothstep(0.0, 1.5 * px + 0.5, e)) * 0.4;
        float glow = rim + streak + caustic + hair;
        lens.rgb += vec3(0.92, 0.95, 1.0) * glow;
        lens.a = max(lens.a, max(lens.r, max(lens.g, lens.b)));
        lens = clamp(lens, 0.0, 1.0);
        col = mix(col, lens, cov);
    }
    gl_FragColor = col;
}
`;
        const shader = env.shader(FRAG);

        const accentEdge = R.mix(pal.bg, pal.accent, 0.55);
        const fontsReady = () => (document.fonts && document.fonts.status === 'loaded') || !document.fonts;

        const nodes = {
            browser: { x: 336, y: 307, w: 100, h: 86, title: 'localhost:3000', status: pal.idle },
            chat: { x: 336, y: 107, w: 100, h: 86, title: 'claude', status: pal.needs },
            plan: { x: 124, y: 307, w: 100, h: 86, title: 'plan', status: pal.running },
            term: { x: 124, y: 107, w: 100, h: 86, title: 'zsh', status: pal.running }
        };
        const fillers = [
            { x: 242, y: 24, w: 76, h: 50, title: 'note', kind: 'note' },
            { x: 240, y: 212, w: 80, h: 74, title: 'diff', kind: 'diff', status: pal.idle },
            { x: 16, y: 210, w: 84, h: 74, title: 'codex', kind: 'text', status: pal.idle },
            { x: 462, y: 206, w: 82, h: 76, title: 'zsh', kind: 'term', status: pal.idle },
            { x: 238, y: 420, w: 88, h: 58, title: 'review', kind: 'text', status: pal.running },
            { x: 462, y: 66, w: 78, h: 60, title: 'docs', kind: 'text' },
            { x: 22, y: 400, w: 78, h: 60, title: 'agent 3', kind: 'text', status: pal.idle },
            { x: 24, y: 70, w: 76, h: 58, title: 'tests', kind: 'term' },
            { x: 460, y: 392, w: 82, h: 60, title: 'deploy', kind: 'text', status: pal.needs }
        ];
        // The dwell points sit on a 1:2 Lissajous figure, so the lens draws a figure eight between them.
        const order = ['browser', 'chat', 'plan', 'term'];
        const lissajous = (theta) => [280 + 150 * Math.sin(theta), 250 + 100 * Math.sin(2 * theta)];
        const glide = R.ease.bezier(0.6, 0.02, 0.2, 1);

        const pathAt = (t) => {
            const lt = R.mod(t, CYCLE);
            const seg = Math.floor(lt / SEG);
            const travel = (lt - seg * SEG - (SEG - TRAVEL)) / TRAVEL;
            const theta = Math.PI / 4 + (seg + glide(travel)) * (Math.PI / 2);
            return lissajous(theta);
        };

        const edgePath = (ctx, ax, ay, bx, by) => {
            const mx = (ax + bx) / 2;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.bezierCurveTo(mx, ay, mx, by, bx, by);
        };

        const drawNode = (ctx, node, dim) => {
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.55)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 3;
            R.roundRect(ctx, node.x, node.y, node.w, node.h, 6);
            ctx.fillStyle = pal.surface;
            ctx.fill();
            ctx.restore();
            ctx.save();
            R.roundRect(ctx, node.x, node.y, node.w, node.h, 6);
            ctx.clip();
            ctx.fillStyle = 'rgba(255,255,255,0.025)';
            ctx.fillRect(node.x, node.y, node.w, 15);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(node.x, node.y + 15, node.w, 0.6);
            ctx.restore();
            R.roundRect(ctx, node.x + 0.3, node.y + 0.3, node.w - 0.6, node.h - 0.6, 6);
            ctx.strokeStyle = 'rgba(255,255,255,0.11)';
            ctx.lineWidth = 0.6;
            ctx.stroke();
            ctx.strokeStyle = R.rgba(pal.muted, dim ? 0.5 : 0.8);
            ctx.lineWidth = 0.7;
            R.roundRect(ctx, node.x + 6, node.y + 4.5, 6, 6, 1.5);
            ctx.stroke();
            ctx.fillStyle = R.rgba(pal.muted, dim ? 0.6 : 0.95);
            ctx.font = '500 7px ' + R.fonts.display;
            ctx.textBaseline = 'middle';
            ctx.fillText(node.title, node.x + 16, node.y + 8);
            if (node.status) {
                ctx.beginPath();
                ctx.arc(node.x + node.w - 8, node.y + 7.5, 2.4, 0, R.TAU);
                ctx.fillStyle = node.status;
                ctx.fill();
            }
        };

        const lines = (ctx, x, y, widths, gap, color, height) => {
            ctx.fillStyle = color;
            for (let i = 0; i < widths.length; i++) {
                if (widths[i] > 0) {
                    R.roundRect(ctx, x, y + i * gap, widths[i], height, height / 2);
                    ctx.fill();
                }
            }
        };

        const drawScene = (ctx) => {
            // the canvas dot grid, neutral
            ctx.fillStyle = 'rgba(255,255,255,0.13)';
            for (let y = 8; y < H; y += 14) {
                for (let x = 8; x < W; x += 14) {
                    ctx.beginPath();
                    ctx.arc(x, y, 0.75, 0, R.TAU);
                    ctx.fill();
                }
            }
            // context edges
            ctx.strokeStyle = accentEdge;
            ctx.lineWidth = 1.3;
            ctx.lineCap = 'round';
            const links = [
                [nodes.term.x + nodes.term.w, nodes.term.y + 30, nodes.chat.x, nodes.chat.y + 34],
                [nodes.chat.x + 50, nodes.chat.y + nodes.chat.h, nodes.browser.x + 50, nodes.browser.y],
                [nodes.plan.x + nodes.plan.w, nodes.plan.y + 50, nodes.browser.x, nodes.browser.y + 44],
                [nodes.term.x + 50, nodes.term.y + nodes.term.h, nodes.plan.x + 50, nodes.plan.y],
                [nodes.term.x + nodes.term.w, nodes.term.y + 64, 240, 240],
                [320, 256, nodes.browser.x, nodes.browser.y + 22],
                [100, 246, nodes.term.x, nodes.term.y + 60],
                [nodes.chat.x + nodes.chat.w, nodes.chat.y + 24, 462, 92],
                [100, 100, nodes.term.x, nodes.term.y + 20],
                [nodes.browser.x + nodes.browser.w, nodes.browser.y + 60, 460, 420],
                [100, 428, nodes.plan.x, nodes.plan.y + 64]
            ];
            for (const [ax, ay, bx, by] of links) {
                if (Math.abs(ax - bx) < 30) {
                    ctx.beginPath();
                    ctx.moveTo(ax, ay);
                    ctx.bezierCurveTo(ax, (ay + by) / 2, bx, (ay + by) / 2, bx, by);
                } else {
                    edgePath(ctx, ax, ay, bx, by);
                }
                ctx.stroke();
                ctx.fillStyle = accentEdge;
                ctx.beginPath();
                ctx.arc(ax, ay, 1.8, 0, R.TAU);
                ctx.arc(bx, by, 1.8, 0, R.TAU);
                ctx.fill();
            }
            ctx.lineCap = 'butt';

            for (const filler of fillers) {
                if (filler.kind === 'note') {
                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 8;
                    R.roundRect(ctx, filler.x, filler.y, filler.w, filler.h, 4);
                    ctx.fillStyle = pal.note;
                    ctx.fill();
                    ctx.restore();
                    ctx.fillStyle = 'rgba(251,226,150,0.85)';
                    ctx.font = '400 9px ' + R.fonts.hand;
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText('ship it friday', filler.x + 7, filler.y + 20);
                    ctx.fillText('ask about auth', filler.x + 7, filler.y + 34);
                    continue;
                }
                drawNode(ctx, filler, true);
                const bx = filler.x + 7;
                const by = filler.y + 22;
                if (filler.kind === 'diff') {
                    const rows = [
                        [pal.red, 52],
                        [pal.red, 38],
                        [pal.green, 60],
                        [pal.green, 44],
                        [pal.faint, 30],
                        [pal.green, 50]
                    ];
                    rows.forEach(([tone, width], i) => {
                        ctx.fillStyle = R.rgba(tone, 0.12);
                        ctx.fillRect(filler.x + 1, by + i * 8.5 - 2.5, filler.w - 2, 8);
                        lines(ctx, bx + 4, by + i * 8.5, [width], 0, R.rgba(tone, 0.75), 2.6);
                    });
                } else if (filler.kind === 'term') {
                    ctx.fillStyle = pal.termBg;
                    ctx.fillRect(filler.x + 1, filler.y + 16, filler.w - 2, filler.h - 17);
                    lines(ctx, bx, by, [30, 50, 42, 56, 24, 38], 8, R.rgba(pal.termDim, 0.9), 2.4);
                } else {
                    lines(ctx, bx, by, [filler.w - 20, filler.w - 30, filler.w - 24, filler.w - 40, filler.w - 28].slice(0, Math.floor((filler.h - 26) / 8)), 8, R.rgba(pal.muted, 0.35), 2.4);
                }
            }

            // the four the lens visits
            const mono = (size, weight = 400) => weight + ' ' + size + 'px ' + R.fonts.mono;
            const sans = (size, weight = 400) => weight + ' ' + size + 'px ' + R.fonts.display;
            ctx.textBaseline = 'alphabetic';

            const term = nodes.term;
            drawNode(ctx, term, false);
            ctx.fillStyle = pal.termBg;
            ctx.fillRect(term.x + 1, term.y + 16, term.w - 2, term.h - 17);
            // what the defocused ground shows of the terminal; the lens reads the live layer over it
            lines(ctx, term.x + 7, term.y + 22, [48, 70, 62, 66, 40, 56], 9, R.rgba(pal.termDim, 0.9), 2.2);

            const chat = nodes.chat;
            drawNode(ctx, chat, false);
            R.roundRect(ctx, chat.x + 36, chat.y + 20, chat.w - 42, 14, 5);
            ctx.fillStyle = pal.hover;
            ctx.fill();
            ctx.fillStyle = pal.text;
            ctx.font = sans(6);
            ctx.fillText('Add saved carts', chat.x + 42, chat.y + 29.2);
            ctx.fillStyle = pal.muted;
            ctx.font = sans(5.6);
            ctx.fillText('Schema and API are done.', chat.x + 7, chat.y + 44);
            R.roundRect(ctx, chat.x + 5, chat.y + 51, chat.w - 10, 30, 5);
            ctx.fillStyle = 'rgba(251,191,36,0.07)';
            ctx.fill();
            ctx.strokeStyle = R.rgba(pal.needs, 0.7);
            ctx.lineWidth = 0.7;
            ctx.stroke();
            ctx.fillStyle = pal.text;
            ctx.font = sans(6.2, 500);
            ctx.fillText('Run the migration?', chat.x + 10, chat.y + 62);
            R.roundRect(ctx, chat.x + 10, chat.y + 67, 26, 9, 4.5);
            ctx.fillStyle = pal.needs;
            ctx.fill();
            R.roundRect(ctx, chat.x + 40, chat.y + 67, 34, 9, 4.5);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.stroke();
            ctx.font = sans(5.4, 600);
            ctx.fillStyle = '#1a1405';
            ctx.fillText('Yes', chat.x + 18, chat.y + 73.4);
            ctx.fillStyle = pal.muted;
            ctx.fillText('Not yet', chat.x + 46.5, chat.y + 73.4);

            const plan = nodes.plan;
            drawNode(ctx, plan, false);
            const steps = [
                ['Schema for saved carts', true],
                ['API route and tests', true],
                ['Cart page UI', false],
                ['Migrate old carts', false]
            ];
            steps.forEach(([label, done], i) => {
                const y = plan.y + 28 + i * 11.5;
                R.roundRect(ctx, plan.x + 7, y - 5.2, 6.4, 6.4, 1.8);
                if (done) {
                    ctx.fillStyle = R.rgba(pal.idle, 0.9);
                    ctx.fill();
                    ctx.strokeStyle = pal.sunken;
                    ctx.lineWidth = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(plan.x + 8.6, y - 2);
                    ctx.lineTo(plan.x + 9.9, y - 0.8);
                    ctx.lineTo(plan.x + 11.9, y - 3.5);
                    ctx.stroke();
                } else {
                    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                    ctx.lineWidth = 0.7;
                    ctx.stroke();
                }
                ctx.fillStyle = done ? pal.muted : pal.text;
                ctx.font = sans(5.8);
                ctx.fillText(label, plan.x + 18, y);
            });
            R.roundRect(ctx, plan.x + 7, plan.y + plan.h - 12, plan.w - 14, 3.6, 1.8);
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fill();

            const web = nodes.browser;
            drawNode(ctx, web, false);
            R.roundRect(ctx, web.x + 5, web.y + 19, web.w - 10, 9, 4.5);
            ctx.fillStyle = pal.sunken;
            ctx.fill();
            ctx.fillStyle = pal.faint;
            ctx.font = mono(5);
            ctx.fillText('localhost:3000/cart', web.x + 10, web.y + 25.4);
            const page = { x: web.x + 5, y: web.y + 31, w: web.w - 10, h: web.h - 36 };
            R.roundRect(ctx, page.x, page.y, page.w, page.h, 3);
            ctx.fillStyle = '#0b0c10';
            ctx.fill();
            const glow = ctx.createLinearGradient(page.x, page.y, page.x + page.w, page.y + page.h);
            glow.addColorStop(0, 'rgba(21,93,252,0.35)');
            glow.addColorStop(1, 'rgba(192,132,252,0.08)');
            R.roundRect(ctx, page.x + 3, page.y + 3, page.w - 6, 25, 2);
            ctx.fillStyle = glow;
            ctx.fill();
            ctx.fillStyle = pal.text;
            ctx.font = sans(7.4, 700);
            ctx.fillText('Saved carts', page.x + 7, page.y + 13);
            ctx.fillStyle = pal.muted;
            ctx.font = sans(4.8);
            ctx.fillText('Pick up where you left off.', page.x + 7, page.y + 20.5);
            const cardW = (page.w - 6 - 6) / 3;
            for (let i = 0; i < 3; i++) {
                R.roundRect(ctx, page.x + 3 + i * (cardW + 3), page.y + 31, cardW, page.h - 34, 2);
                ctx.fillStyle = pal.hover;
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.18)';
                ctx.fillRect(page.x + 6 + i * (cardW + 3), page.y + page.h - 8, cardW * 0.55, 1.6);
            }
        };

        // Status rings and the progress fill live in the shader, so the big textures upload once.
        const dots = new Float32Array(5 * 4);
        const setDot = (i, x, y, radius, kind) => {
            dots[i * 4] = x;
            dots[i * 4 + 1] = y;
            dots[i * 4 + 2] = radius;
            dots[i * 4 + 3] = kind;
        };
        setDot(0, nodes.chat.x + nodes.chat.w - 8, nodes.chat.y + 7.5, 2.4, 1);
        setDot(1, nodes.plan.x + nodes.plan.w - 8, nodes.plan.y + 7.5, 2.4, 0);
        setDot(2, nodes.term.x + nodes.term.w - 8, nodes.term.y + 7.5, 2.4, 0);
        setDot(3, fillers[4].x + fillers[4].w - 8, fillers[4].y + 7.5, 2.4, 0);
        setDot(4, fillers[8].x + fillers[8].w - 8, fillers[8].y + 7.5, 2.4, 1);
        const bar = new Float32Array([nodes.plan.x + 7, nodes.plan.y + nodes.plan.h - 12, 0, 3.6]);
        const barCol = new Float32Array(3);

        // The terminal types into a small canvas of its own, uploaded only when a character changes.
        const liveRect = new Float32Array([nodes.term.x + 1, nodes.term.y + 16, nodes.term.w - 2, nodes.term.h - 17]);
        const script = [
            { at: 10.9, text: '$ bun test cart', kind: 'cmd' },
            { at: 11.9, text: ' pass  schema.test  6', kind: 'pass' },
            { at: 12.25, text: ' pass  api.test   12', kind: 'pass' },
            { at: 12.6, text: ' pass  saved.test  9', kind: 'pass' },
            { at: 13.05, text: ' run   ui.test', kind: 'run' },
            { at: 13.7, text: ' 27 pass  0 fail', kind: 'sum' }
        ];

        let sharp = null;
        let blur = null;
        let live = null;
        let texScale = 0;
        let liveScale = 0;
        let liveKey = '';
        let uploadSharp = true;
        let liveDirty = true;
        let builtWithFonts = false;

        const build = () => {
            texScale = R.clamp(env.scale * 1.6, 1.25, 3);
            if (!sharp) {
                sharp = document.createElement('canvas');
                blur = document.createElement('canvas');
                live = document.createElement('canvas');
            }
            sharp.width = Math.round(W * texScale);
            sharp.height = Math.round(H * texScale);
            const sctx = sharp.getContext('2d');
            sctx.setTransform(texScale, 0, 0, texScale, 0, 0);
            sctx.clearRect(0, 0, W, H);
            drawScene(sctx);

            const bs = R.clamp(env.scale * 0.7, 0.5, 1.4);
            blur.width = Math.round(W * bs);
            blur.height = Math.round(H * bs);
            const bctx = blur.getContext('2d');
            bctx.setTransform(1, 0, 0, 1, 0, 0);
            bctx.clearRect(0, 0, blur.width, blur.height);
            bctx.filter = 'blur(' + (2.1 * bs).toFixed(2) + 'px)';
            if (bctx.filter && bctx.filter !== 'none') {
                bctx.drawImage(sharp, 0, 0, blur.width, blur.height);
                bctx.filter = 'none';
            } else {
                // No canvas filter (older Safari): a downsample and upsample makes a soft enough defocus.
                const small = document.createElement('canvas');
                small.width = Math.round(W / 4);
                small.height = Math.round(H / 4);
                const smctx = small.getContext('2d');
                smctx.imageSmoothingQuality = 'high';
                smctx.drawImage(sharp, 0, 0, small.width, small.height);
                bctx.imageSmoothingQuality = 'high';
                bctx.drawImage(small, 0, 0, blur.width, blur.height);
            }

            liveScale = texScale;
            live.width = Math.round(liveRect[2] * liveScale);
            live.height = Math.round(liveRect[3] * liveScale);
            liveKey = '';
            uploadSharp = true;
            builtWithFonts = fontsReady();
        };

        const drawLive = (lt) => {
            let key = '';
            const shown = [];
            for (const line of script) {
                if (lt >= line.at) {
                    const typed = line.kind === 'cmd' ? Math.min(line.text.length, Math.floor((lt - line.at) * 16) + 2) : line.text.length;
                    shown.push([line, typed]);
                    key += typed + ',';
                }
            }
            const caretOn = R.mod(lt, 1.06) < 0.62;
            key += caretOn ? 'c' : '';
            if (key === liveKey) {
                return;
            }
            liveKey = key;
            liveDirty = true;
            const ctx = live.getContext('2d');
            ctx.setTransform(liveScale, 0, 0, liveScale, 0, 0);
            ctx.fillStyle = pal.termBg;
            ctx.fillRect(0, 0, liveRect[2], liveRect[3]);
            ctx.font = '400 5.6px ' + R.fonts.mono;
            ctx.textBaseline = 'alphabetic';
            const colors = { pass: pal.idle, run: pal.running, sum: pal.termFg };
            let y = 10;
            let caretX = 7;
            let caretY = 10;
            for (const [line, typed] of shown) {
                const text = line.text.slice(0, typed);
                if (line.kind === 'cmd') {
                    ctx.fillStyle = pal.idle;
                    ctx.fillText('$', 6, y);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(text.slice(1), 6 + ctx.measureText('$').width, y);
                    caretX = 6 + ctx.measureText(text).width + 1;
                    caretY = y;
                } else {
                    ctx.fillStyle = colors[line.kind];
                    ctx.fillText(text.slice(0, 6), 6, y);
                    ctx.fillStyle = line.kind === 'sum' ? pal.termFg : pal.termDim;
                    ctx.fillText(text.slice(6), 6 + ctx.measureText(text.slice(0, 6)).width, y);
                    caretX = 6;
                    caretY = y + 9;
                }
                y += 9;
            }
            if (!shown.length) {
                ctx.fillStyle = pal.idle;
                ctx.fillText('$', 6, 10);
                caretX = 6 + ctx.measureText('$ ').width;
            } else if (shown.length === script.length) {
                ctx.fillStyle = pal.idle;
                ctx.fillText('$', 6, y);
                caretX = 6 + ctx.measureText('$ ').width;
                caretY = y;
            }
            if (caretOn) {
                ctx.fillStyle = pal.termFg;
                ctx.fillRect(caretX, caretY - 5.2, 3.2, 6.6);
            }
        };

        const pointer = env.pointer;
        const pos = { x: 0, y: 0, vx: 0, vy: 0 };
        const deform = { a: 0, b: 0, va: 0, vb: 0 };
        {
            const start = pathAt(0);
            pos.x = start[0];
            pos.y = start[1];
        }
        const uLens = new Float32Array(2);
        const uDeform = new Float32Array(2);

        build();

        return {
            update(t, dt) {
                const path = pathAt(t);
                const tx = R.lerp(path[0], R.clamp(pointer.x, 90, W - 90), pointer.active);
                const ty = R.lerp(path[1], R.clamp(pointer.y, 90, H - 90), pointer.active);
                const slices = Math.max(1, Math.ceil(dt / (1 / 240)));
                const step = dt / slices;
                for (let i = 0; i < slices; i++) {
                    // position: a spring slightly under critical, so the lens trails and settles
                    const stiff = 64;
                    const damp = 14.5;
                    pos.vx += (-stiff * (pos.x - tx) - damp * pos.vx) * step;
                    pos.vy += (-stiff * (pos.y - ty) - damp * pos.vy) * step;
                    pos.x += pos.vx * step;
                    pos.y += pos.vy * step;
                    // shape: stretch along the velocity, held by a soft underdamped spring,
                    // as a traceless tensor so overshoot turns into a squash across the same axis
                    const speed = Math.hypot(pos.vx, pos.vy);
                    const amount = Math.min(speed * 0.0007, 0.2);
                    const ang = Math.atan2(pos.vy, pos.vx);
                    const ta = amount * Math.cos(2 * ang);
                    const tb = amount * Math.sin(2 * ang);
                    const ks = 150;
                    const cs = 6.2;
                    deform.va += (-ks * (deform.a - ta) - cs * deform.va) * step;
                    deform.vb += (-ks * (deform.b - tb) - cs * deform.vb) * step;
                    deform.a += deform.va * step;
                    deform.b += deform.vb * step;
                }
            },
            resize() {
                build();
            },
            draw(t) {
                if (!builtWithFonts && fontsReady()) {
                    build();
                }
                const lt = R.mod(t, CYCLE);
                drawLive(lt);
                // the plan's progress fills while the lens is on its way, completes, then a new task starts
                const grow = R.ease.inOutCubic(R.phase(lt, 6.2, 3.6));
                const reset = R.phase(lt, 14.6, 0.01);
                const fill = reset > 0 ? 0.22 : R.lerp(0.22, 1, grow);
                bar[2] = (nodes.plan.w - 14) * fill;
                const done = R.smoothstep(0.97, 1, fill);
                const c1 = R.vec3(pal.running);
                const c2 = R.vec3(pal.idle);
                barCol[0] = R.lerp(c1[0], c2[0], done);
                barCol[1] = R.lerp(c1[1], c2[1], done);
                barCol[2] = R.lerp(c1[2], c2[2], done);
                uLens[0] = pos.x;
                uLens[1] = pos.y;
                uDeform[0] = R.clamp(deform.a, -0.3, 0.3);
                uDeform[1] = R.clamp(deform.b, -0.3, 0.3);
                env.clear();
                shader.draw({
                    u_sharp: { canvas: sharp, dirty: uploadSharp },
                    u_blur: { canvas: blur, dirty: uploadSharp },
                    u_live: { canvas: live, dirty: liveDirty || uploadSharp },
                    u_liveRect: liveRect,
                    u_lens: uLens,
                    u_deform: uDeform,
                    u_size: LENS,
                    u_mag: MAG,
                    u_dim: 0.52,
                    u_dots: dots,
                    u_bar: bar,
                    u_barCol: barCol
                });
                uploadSharp = false;
                liveDirty = false;
                env.fadeEdges(0.62, 1.0);
            }
        };
    }
});
