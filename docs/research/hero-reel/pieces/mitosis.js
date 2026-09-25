Reel.add({
    id: 'mitosis',
    title: 'Mitosis',
    line: 'One agent becomes a team, and the team comes back with one answer.',
    principles: ['Squash and stretch', 'Staging'],
    tech: 'WebGL, metaballs with an exponential smooth minimum, 2D labels',
    hint: 'Move and the goo leans toward you',
    poster: 6.4,
    create(env) {
        const R = env.R;
        const pal = R.pal;
        const CYCLE = 14;
        const MAX = 10;

        const FRAG = `
uniform vec4 u_ball[10];
uniform vec2 u_bdir[10];
uniform vec3 u_bcol[10];
uniform vec4 u_ring;
uniform vec3 u_lean;

const float K = 13.0;

vec4 over(vec4 top, vec4 under) {
    return top + under * (1.0 - top.a);
}

// An exponential smooth minimum over every ball: the distance, its gradient and the rim color
// all come out of the same weights, so colors run through a neck the way the goo does.
void field(vec2 p, out float d, out vec2 g, out vec3 rim) {
    float sum = 0.0;
    vec2 gs = vec2(0.0);
    vec3 cs = vec3(0.0);
    for (int i = 0; i < 10; i++) {
        vec4 b = u_ball[i];
        if (b.z > 0.5) {
            vec2 q = p - b.xy;
            vec2 dir = u_bdir[i];
            vec2 e = vec2(dot(q, dir) / b.w, dot(q, vec2(-dir.y, dir.x)) * b.w);
            float di = length(e) - b.z;
            float w = exp(-di / K);
            sum += w;
            gs += w * q / max(length(q), 1e-3);
            cs += w * u_bcol[i];
        }
    }
    sum = max(sum, 1e-30);
    d = -K * log(sum);
    g = gs / sum;
    rim = cs / sum;
}

void main() {
    vec2 p = logical();
    vec2 tp = u_lean.xy - p;
    float td = length(tp);
    p -= tp / max(td, 1.0) * u_lean.z * exp(-td * td / 45000.0) * smoothstep(0.0, 40.0, td);

    float d;
    vec2 g;
    vec3 rimCol;
    field(p, d, g, rimCol);
    float px = 1.0 / u_scale;
    float cov = clamp(0.5 - d / px, 0.0, 1.0);

    float glow = exp(-max(d, 0.0) / 18.0) * 0.12 * (1.0 - cov);
    vec4 col = vec4(rimCol * glow, glow);
    if (cov > 0.0) {
        // a rounded bevel as a height field, so the flat middle stays dark and the shoulder catches light
        float e = max(-d, 0.0);
        float bev = 42.0;
        float x = min(e, bev);
        float h = sqrt(max(bev * bev - (bev - x) * (bev - x), 1e-3));
        float slope = min((bev - x) / h, 7.0);
        vec3 n = normalize(vec3(g * slope, 1.0));
        vec3 L = normalize(vec3(-0.5, -0.64, 0.58));
        vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
        float ndl = max(dot(n, L), 0.0);
        float ndh = max(dot(n, H), 0.0);
        vec3 c = vec3(0.05, 0.053, 0.066) * (0.5 + 1.0 * ndl);
        // a soft window reflected in the gloss, then the tight highlight
        vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
        float window = smoothstep(0.82, 0.97, dot(r, normalize(vec3(-0.45, -0.55, 0.7))));
        c += vec3(0.8, 0.86, 1.0) * window * 0.16;
        c += vec3(0.96, 0.98, 1.0) * (pow(ndh, 90.0) * 0.95 + pow(ndh, 16.0) * 0.05);
        float fres = pow(1.0 - n.z, 2.2);
        c += rimCol * fres * 0.9;
        c += rimCol * exp(-e / 6.0) * 0.16;
        col = mix(col, vec4(c, 1.0), cov);
    }

    float rd = length(p - u_ring.xy);
    float band = exp(-pow((rd - u_ring.z) / 1.2, 2.0)) * 0.85 + exp(-abs(rd - u_ring.z) / 14.0) * 0.24;
    float ra = clamp(band * u_ring.w * (1.0 - cov), 0.0, 1.0);
    col = over(vec4(vec3(0.78, 0.88, 1.0) * ra, ra), col);
    gl_FragColor = col;
}
`;
        const shader = env.shader(FRAG);

        const cool = [0.6, 0.7, 0.9];
        const run = R.vec3(pal.running);
        const done = R.vec3(pal.idle);

        const agent = { home: [282, 246], rest: 64, label: 'claude' };
        const trace = { home: [150, 170], r: 36, parent: agent, label: 'trace', born: 1.45, split: 1.9, done: 7.8, merge: 8.95 };
        const query = { home: [414, 190], r: 34, parent: agent, label: 'query', born: 3.4, split: 1.8, done: 7.2, merge: 9.15 };
        const report = { home: [168, 344], r: 28, parent: trace, label: 'report', born: 3.7, split: 1.8, done: 6.75, merge: 8.3 };
        const children = [trace, query, report];
        const MERGE = 1.0;
        const ANSWER = 10.3;

        // Packets: tasks out in blue, results back in green, each on an arc between parent and child.
        const packets = [
            { slot: 4, from: agent, to: trace, at: 4.95, back: false },
            { slot: 5, from: agent, to: trace, at: 5.45, back: false },
            { slot: 6, from: agent, to: query, at: 5.3, back: false },
            { slot: 7, from: agent, to: query, at: 5.8, back: false },
            { slot: 8, from: trace, to: report, at: 5.75, back: false },
            { slot: 9, from: trace, to: report, at: 6.2, back: false },
            { slot: 4, from: report, to: trace, at: 6.8, back: true },
            { slot: 5, from: query, to: agent, at: 7.25, back: true },
            { slot: 6, from: trace, to: agent, at: 7.85, back: true }
        ];
        const FLIGHT = 0.95;

        const ringDown = (sec, amp, freq = 12, decay = 4.2) => (sec <= 0 ? 0 : amp * Math.exp(-decay * sec) * Math.sin(freq * sec));
        const pullSnap = (sec, amp, pull) => {
            if (sec < -0.4 || sec > 3.5) {
                return 0;
            }
            if (sec < 0) {
                // anticipation: a squash across the coming split
                return -0.06 * Math.sin((Math.PI * (sec + 0.4)) / 0.4);
            }
            if (sec < pull) {
                return amp * R.ease.inOutSine(sec / pull);
            }
            const after = sec - pull;
            return amp * Math.exp(-5 * after) * Math.cos(13 * after);
        };
        const splitEase = R.ease.bezier(0.5, 0, 0.3, 1.1);

        const angleOf = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);

        // Every ball keeps a stretch tensor (a, b); it becomes an axis and an amount only at the end.
        const state = {};
        const reset = (key) => {
            const ball = state[key] || (state[key] = { x: 0, y: 0, r: 0, a: 0, b: 0, col: [0, 0, 0] });
            ball.a = 0;
            ball.b = 0;
            return ball;
        };
        const addStretch = (ball, amount, angle) => {
            ball.a += amount * Math.cos(2 * angle);
            ball.b += amount * Math.sin(2 * angle);
        };

        const childPos = (child, lt, out) => {
            const parent = child.parent === agent ? state.agent : state[child.parent.label];
            const ph = child.parent === agent ? agent.home : trace.home;
            const ang = angleOf(ph, child.home);
            const dist = Math.hypot(child.home[0] - ph[0], child.home[1] - ph[1]);
            const sec = lt - child.born;
            const reach = splitEase(sec / child.split);
            // out from the parent's current center, then home; late in the cycle, back in slowly and fast at the end
            let x = ph[0] + Math.cos(ang) * dist * reach;
            let y = ph[1] + Math.sin(ang) * dist * reach;
            const merging = R.clamp((lt - child.merge) / MERGE);
            if (merging > 0) {
                const e = R.ease.inCubic(merging);
                x = R.lerp(x, parent.x, e);
                y = R.lerp(y, parent.y, e);
            }
            out[0] = x;
            out[1] = y;
            return out;
        };

        const KEYS = ['agent', 'trace', 'query', 'report', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9'];
        const tmpA = [0, 0];
        const tmpB = [0, 0];
        const pointer = env.pointer;

        const layout = (t) => {
            const lt = R.mod(t, CYCLE);
            const lean = pointer.active;

            // the agent: heartbeat, anticipation, the pull of each split, the knock of each return
            const sp = reset('agent');
            let rp2 = agent.rest * agent.rest;
            let px = agent.home[0];
            let py = agent.home[1];
            const beat = ringDown(lt - 0.35, 0.05, 14, 6) + ringDown(lt - 0.8, 0.04, 14, 6);
            for (const child of [trace, query]) {
                const ang = angleOf(agent.home, child.home);
                const sec = lt - child.born;
                addStretch(sp, pullSnap(sec, 0.14, 0.85), ang);
                const give = R.ease.inOutSine(R.clamp(sec / (child.split * 0.7)));
                rp2 -= child.r * child.r * 0.72 * give;
                const recoil = Math.sin(Math.PI * R.clamp(sec / 0.9)) * 7;
                px -= Math.cos(ang) * recoil;
                py -= Math.sin(ang) * recoil;
            }
            for (const child of [trace, query]) {
                const merging = R.clamp((lt - child.merge) / MERGE);
                const absorbed = R.smoothstep(0.55, 1, merging);
                rp2 += child.r * child.r * 0.72 * absorbed;
                const ang = angleOf(child.home, agent.home);
                const hit = lt - (child.merge + MERGE * 0.78);
                addStretch(sp, ringDown(hit, -0.16, 11, 3.8), ang);
                const push = ringDown(hit, 9, 9, 4);
                px += Math.cos(ang) * push;
                py += Math.sin(ang) * push;
            }
            const rest = 1 - R.smoothstep(1.1, 1.5, lt) + R.smoothstep(11.2, 12.2, lt);
            const answer = ringDown(lt - ANSWER, 0.07, 10, 3.5);
            sp.r = Math.sqrt(Math.max(rp2, 900)) * (1 + beat + answer + rest * 0.018 * Math.sin((R.TAU * lt) / 1.75));
            sp.x = px;
            sp.y = py;
            const flash = Math.exp(-3 * Math.max(0, lt - ANSWER)) * (lt > ANSWER ? 1 : 0);
            sp.col[0] = R.lerp(cool[0], 0.8, flash);
            sp.col[1] = R.lerp(cool[1], 1.0, flash);
            sp.col[2] = R.lerp(cool[2], 0.9, flash);

            // trace before report, since report is born out of trace
            for (const child of [trace, query, report]) {
                const key = child.label;
                const ball = reset(key);
                const sec = lt - child.born;
                if (sec < 0 || lt > child.merge + MERGE + 0.25) {
                    ball.r = 0;
                    continue;
                }
                childPos(child, lt, tmpA);
                childPos(child, lt - 1 / 60, tmpB);
                const vx = (tmpA[0] - tmpB[0]) * 60;
                const vy = (tmpA[1] - tmpB[1]) * 60;
                const speed = Math.hypot(vx, vy);
                ball.x = tmpA[0];
                ball.y = tmpA[1];
                if (speed > 1) {
                    addStretch(ball, Math.min(speed * 0.0011, 0.34), Math.atan2(vy, vx));
                }
                const parentHome = child.parent === agent ? agent.home : trace.home;
                const ang = angleOf(parentHome, child.home);
                // landing: the overshoot turns back and the child squashes along its path, then settles
                addStretch(ball, ringDown(sec - child.split * 0.62, -0.1, 12, 4.5), ang);
                // the parent splitting again pulls on this child the same way
                if (child === trace) {
                    addStretch(ball, pullSnap(lt - report.born, 0.12, 0.8), angleOf(trace.home, report.home));
                }
                // each packet that lands gives a small knock
                for (const pk of packets) {
                    if (pk.to === child) {
                        addStretch(ball, ringDown(lt - pk.at - FLIGHT * 0.85, -0.06, 14, 6), angleOf(pk.from.home, child.home));
                    }
                }
                const grow = R.ease.outCubic(R.clamp(sec / (child.split * 0.55)));
                let radius = child.r * (0.5 + 0.5 * grow);
                if (child === trace) {
                    const give = R.ease.inOutSine(R.clamp((lt - report.born) / (report.split * 0.7)));
                    const back = R.smoothstep(0.55, 1, R.clamp((lt - report.merge) / MERGE));
                    radius = Math.sqrt(Math.max(radius * radius - report.r * report.r * 0.45 * give + report.r * report.r * 0.45 * back, 100));
                }
                const merging = R.clamp((lt - child.merge) / MERGE);
                radius *= 1 - 0.75 * R.smoothstep(0.7, 1.15, merging + (lt - child.merge - MERGE > 0 ? (lt - child.merge - MERGE) * 2 : 0));
                ball.r = radius;
                const fin = R.smoothstep(child.done, child.done + 0.5, lt);
                ball.col[0] = R.lerp(run[0], done[0], fin);
                ball.col[1] = R.lerp(run[1], done[1], fin);
                ball.col[2] = R.lerp(run[2], done[2], fin);
            }

            for (let i = 4; i < MAX; i++) {
                reset('slot' + i).r = 0;
            }
            for (const pk of packets) {
                const prog = (lt - pk.at) / FLIGHT;
                if (prog < 0 || prog > 1) {
                    continue;
                }
                const ball = state['slot' + pk.slot];
                const from = pk.from === agent ? state.agent : state[pk.from.label];
                const to = pk.to === agent ? state.agent : state[pk.to.label];
                const ang = Math.atan2(to.y - from.y, to.x - from.x);
                const fx = from.x + Math.cos(ang) * (from.r - 10);
                const fy = from.y + Math.sin(ang) * (from.r - 10);
                const tx = to.x - Math.cos(ang) * (to.r - 10);
                const ty = to.y - Math.sin(ang) * (to.r - 10);
                const len = Math.hypot(tx - fx, ty - fy);
                const bend = (pk.back ? -0.22 : 0.22) * len;
                const cx = (fx + tx) / 2 - Math.sin(ang) * bend;
                const cy = (fy + ty) / 2 + Math.cos(ang) * bend;
                const e = R.ease.inOutSine(prog);
                const inv = 1 - e;
                ball.x = inv * inv * fx + 2 * inv * e * cx + e * e * tx;
                ball.y = inv * inv * fy + 2 * inv * e * cy + e * e * ty;
                ball.r = 7.5 * (0.75 + 0.25 * Math.sin(Math.PI * prog));
                const dx = 2 * inv * (cx - fx) + 2 * e * (tx - cx);
                const dy = 2 * inv * (cy - fy) + 2 * e * (ty - cy);
                addStretch(ball, 0.28 * Math.sin(Math.PI * prog), Math.atan2(dy, dx));
                const tint = pk.back ? done : run;
                ball.col[0] = tint[0];
                ball.col[1] = tint[1];
                ball.col[2] = tint[2];
            }

            // the pointer: every ball leans a little toward it
            for (let i = 0; i < MAX; i++) {
                const ball = state[KEYS[i]];
                const dx = pointer.x - ball.x;
                const dy = pointer.y - ball.y;
                const dd = Math.hypot(dx, dy) || 1;
                const pull = lean * 14 * Math.exp(-dd / 260);
                const x = ball.x + (dx / dd) * pull;
                const y = ball.y + (dy / dd) * pull;
                const mag = Math.hypot(ball.a, ball.b);
                const axis = Math.atan2(ball.b, ball.a) / 2;
                balls[i * 4] = x;
                balls[i * 4 + 1] = y;
                balls[i * 4 + 2] = ball.r;
                balls[i * 4 + 3] = 1 + Math.min(mag, 0.45);
                dirs[i * 2] = Math.cos(axis);
                dirs[i * 2 + 1] = Math.sin(axis);
                cols[i * 3] = ball.col[0];
                cols[i * 3 + 1] = ball.col[1];
                cols[i * 3 + 2] = ball.col[2];
            }
            const since = lt - ANSWER;
            const grow = R.ease.outCubic(R.clamp(since / 1.6));
            ring[0] = state.agent.x;
            ring[1] = state.agent.y;
            ring[2] = state.agent.r + 6 + grow * 150;
            ring[3] = since > 0 ? Math.pow(1 - R.clamp(since / 1.6), 1.6) * R.smoothstep(0, 0.08, since) : 0;
            leanU[0] = pointer.x;
            leanU[1] = pointer.y;
            leanU[2] = 34 * lean;
            return lt;
        };

        const balls = new Float32Array(MAX * 4);
        const dirs = new Float32Array(MAX * 2);
        const cols = new Float32Array(MAX * 3);
        const ring = new Float32Array(4);
        const leanU = new Float32Array(3);
        const uniforms = { u_ball: balls, u_bdir: dirs, u_bcol: cols, u_ring: ring, u_lean: leanU };

        const ctx = env.ctx;
        const label = (text, x, y, alpha, status) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = '500 12px ' + R.fonts.mono;
            ctx.textBaseline = 'middle';
            const width = ctx.measureText(text).width;
            const total = width + (status ? 11 : 0);
            const left = x - total / 2;
            if (status) {
                ctx.beginPath();
                ctx.arc(left + 3, y, 3, 0, R.TAU);
                ctx.fillStyle = status;
                ctx.fill();
            }
            ctx.fillStyle = pal.muted;
            ctx.fillText(text, left + (status ? 11 : 0), y);
            ctx.restore();
        };

        return {
            draw(t) {
                const lt = layout(t);
                env.clear();
                shader.draw(uniforms);
                // labels come in once a child has landed and leave as it heads home
                for (const child of children) {
                    const ball = state[child.label];
                    if (!ball || ball.r <= 0) {
                        continue;
                    }
                    const alpha = R.smoothstep(child.born + child.split * 0.7, child.born + child.split * 0.7 + 0.5, lt) * (1 - R.smoothstep(child.merge - 0.1, child.merge + 0.25, lt));
                    const fin = R.smoothstep(child.done, child.done + 0.5, lt);
                    const status = R.mix(pal.running, pal.idle, fin);
                    const rise = (1 - R.ease.outCubic(R.clamp((lt - child.born - child.split * 0.7) / 0.6))) * 6;
                    if (child === report) {
                        label(child.label, ball.x, ball.y + ball.r + 20 + rise, alpha, status);
                    } else {
                        label(child.label, ball.x, ball.y - ball.r - 20 + rise, alpha, status);
                    }
                }
                const sp = state.agent;
                label(agent.label, sp.x, sp.y + sp.r + 22, 0.7, null);
                env.fadeEdges(0.68, 1.0);
            }
        };
    }
});
