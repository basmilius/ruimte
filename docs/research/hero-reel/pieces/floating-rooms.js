Reel.add({
    id: 'floating-rooms',
    title: 'Floating Rooms',
    line: 'A quiet, lit volume with room for every window, and the light always on the one at work.',
    principles: ['Solid drawing', 'Staging'],
    tech: 'WebGL, SDF raymarching in bounding boxes, analytic soft shadows',
    hint: 'Move to orbit the room',
    poster: 3.2,
    create(env) {
        const R = env.R;
        const N = 6;
        const CYCLE = 13.5;
        const TURN = 4.5;

        const FRAG = `
uniform vec3 u_cam;
uniform vec3 u_cr;
uniform vec3 u_cu;
uniform vec3 u_cf;
uniform float u_focal;
uniform vec3 u_light;
uniform vec3 u_c[6];
uniform vec3 u_ax[6];
uniform vec3 u_ay[6];
uniform vec3 u_az[6];
uniform vec4 u_size[6];
uniform vec4 u_mat[6];

const float EDGE = 0.016;
float g_mask[6];

float hash1(float n) {
    return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

float box2(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + r;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

float cover(float d, float aa) {
    return clamp(0.5 - d / aa, 0.0, 1.0);
}

float sdSlab(vec3 q, vec4 s) {
    vec2 d = abs(q.xy) - (s.xy - EDGE) + s.w;
    float d2 = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - s.w;
    vec2 w = vec2(d2, abs(q.z) - (s.z - EDGE));
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - EDGE;
}

float scene(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < 6; i++) {
        if (g_mask[i] > 0.5) {
            vec3 o = p - u_c[i];
            vec3 q = vec3(dot(o, u_ax[i]), dot(o, u_ay[i]), dot(o, u_az[i]));
            d = min(d, sdSlab(q, u_size[i]));
        }
    }
    return d;
}

// Words as capsules in rows, so a pane reads as text without a font.
float textRows(vec2 p, vec4 rect, float rowH, float seed, float aa, out float rowId) {
    rowId = floor((rect.w - p.y) / rowH);
    if (p.y > rect.w || p.y < rect.y || p.x < rect.x || p.x > rect.z) {
        return 0.0;
    }
    if (hash1(rowId * 5.31 + seed * 1.7) < 0.22) {
        return 0.0;
    }
    float yc = rect.w - (rowId + 0.5) * rowH;
    float cw = rowH * 0.34;
    float len = floor(mix(0.3, 1.0, hash1(rowId * 7.13 + seed)) * (rect.z - rect.x) / cw);
    float cx = (p.x - rect.x) / cw;
    float slot = floor(cx / 6.0);
    float wl = 3.6 + floor(hash1(slot * 3.7 + rowId * 13.3 + seed) * 2.0) + step(0.85, hash1(slot * 1.3 + rowId)) * 1.4;
    float end = min(wl, len - slot * 6.0);
    if (end < 0.8) {
        return 0.0;
    }
    float h = rowH * 0.13;
    float hx = max((end - 0.4) * 0.5 * cw, h);
    vec2 q = vec2(p.x - (rect.x + slot * 6.0 * cw + hx), p.y - yc);
    return cover(box2(q, vec2(hx, h), h), aa);
}

// The front face of a pane: a small Ruimte node. Returns emitted light and how much the face is screen.
vec4 face(vec2 p, vec4 s, vec4 m, float aa, float t) {
    float hx = s.x;
    float hy = s.y;
    float kind = m.y;
    float seed = m.z;
    float lit = m.w;
    vec3 col = vec3(0.0);
    float bar = 0.078;
    float inset = 0.018;
    float inner = box2(p, vec2(hx - inset, hy - inset), 0.05);
    float screen = cover(inner, aa);
    if (screen <= 0.0) {
        return vec4(0.0);
    }
    float top = hy - inset;
    float body = top - bar;
    vec3 surface = vec3(0.075, 0.075, 0.086);
    vec3 muted = vec3(0.6, 0.6, 0.65);
    vec3 base = surface * (p.y > body ? 1.25 : 1.0);
    base += vec3(0.05) * cover(abs(p.y - body) - 0.0015, aa) * step(0.0, -inner - 0.004);
    // kind glyph and title in the bar
    float yb = body + bar * 0.5;
    float glyph = cover(abs(box2(p - vec2(-hx + 0.07, yb), vec2(0.018, 0.015), 0.006)) - 0.0035, aa);
    float title = cover(box2(p - vec2(-hx + 0.13 + 0.07 * (0.6 + seed * 0.1), yb), vec2(0.07 * (0.6 + seed * 0.1), 0.0085), 0.0085), aa);
    col += muted * 0.55 * (glyph + title);
    // status dot, glowing a little onto the bar
    vec3 status = kind < 0.5 ? vec3(0.376, 0.647, 0.98) : kind < 1.5 ? vec3(0.984, 0.749, 0.141) : vec3(0.29, 0.87, 0.5);
    float pulse = kind < 1.5 ? 0.75 + 0.25 * sin(t * 3.2 + seed * 4.0) : 1.0;
    float dd = length(p - vec2(hx - 0.06, yb));
    col += status * (cover(dd - 0.017, aa) * 1.1 + exp(-dd * 40.0) * 0.25) * pulse;
    if (kind < 0.5) {
        // terminal: sunken body, a prompt, output in two tones
        base = mix(base, vec3(0.031, 0.031, 0.039), step(p.y, body));
        float row;
        float ink = textRows(p, vec4(-hx + 0.085, -hy + 0.1, hx - 0.05, body - 0.035), 0.052, seed, aa, row);
        float kindRow = hash1(row * 2.9 + seed);
        vec3 ink1 = kindRow < 0.28 ? vec3(0.84, 0.84, 0.87) : kindRow < 0.36 ? vec3(0.38, 0.65, 0.98) : vec3(0.4, 0.4, 0.44);
        col += ink1 * ink * 0.5;
        float ry = body - 0.035 - (row + 0.5) * 0.052;
        float chevron = kindRow < 0.28 ? cover(box2(p - vec2(-hx + 0.055, ry), vec2(0.007, 0.007), 0.003), aa) : 0.0;
        col += vec3(0.29, 0.87, 0.5) * chevron * step(-hy + 0.1, ry) * 0.8;
        float caret = cover(box2(p - vec2(-hx + 0.1, -hy + 0.08), vec2(0.008, 0.014), 0.002), aa) * step(0.5, fract(t * 1.1));
        col += vec3(0.84) * caret * m.x;
    } else if (kind < 1.5) {
        // chat: a person's bubble on the right, the agent's answer as text, a question card in amber
        float row;
        float bubble = box2(p - vec2(hx * 0.3, body - 0.1), vec2(hx * 0.55, 0.055), 0.03);
        base = mix(base, vec3(0.13, 0.13, 0.15), cover(bubble, aa));
        float ink = textRows(p, vec4(hx * 0.3 - hx * 0.48, body - 0.14, hx * 0.3 + hx * 0.48, body - 0.06), 0.04, seed + 3.0, aa, row);
        col += vec3(0.8) * ink * 0.6;
        float answer = textRows(p, vec4(-hx + 0.07, -hy + 0.3, hx - 0.07, body - 0.2), 0.05, seed + 7.0, aa, row);
        col += vec3(0.62, 0.62, 0.67) * answer * 0.5;
        float card = box2(p - vec2(0.0, -hy + 0.15), vec2(hx - 0.06, 0.1), 0.03);
        base = mix(base, vec3(0.1, 0.09, 0.06), cover(card, aa));
        col += vec3(0.984, 0.749, 0.141) * cover(abs(card) - 0.003, aa) * 0.55;
        float opt = min(box2(p - vec2(-hx * 0.42, -hy + 0.11), vec2(hx * 0.33, 0.026), 0.026), box2(p - vec2(hx * 0.42, -hy + 0.11), vec2(hx * 0.33, 0.026), 0.026));
        col += vec3(0.984, 0.749, 0.141) * cover(opt, aa) * 0.22;
        float q = textRows(p, vec4(-hx + 0.1, -hy + 0.17, hx - 0.1, -hy + 0.225), 0.04, seed + 11.0, aa, row);
        col += vec3(0.85) * q * 0.55;
    } else if (kind < 2.5) {
        // browser: address pill, a hero block, a headline and three cards
        float pill = box2(p - vec2(0.0, body - 0.05), vec2(hx - 0.07, 0.024), 0.024);
        base = mix(base, vec3(0.03, 0.03, 0.04), cover(pill, aa));
        float url = cover(box2(p - vec2(-hx + 0.2, body - 0.05), vec2(0.1, 0.007), 0.007), aa);
        col += muted * url * 0.5;
        float hero = box2(p - vec2(0.0, body - 0.19), vec2(hx - 0.07, 0.08), 0.02);
        vec3 heroCol = mix(vec3(0.05, 0.1, 0.24), vec3(0.1, 0.1, 0.16), clamp((p.x + hx) / (2.0 * hx), 0.0, 1.0));
        base = mix(base, heroCol, cover(hero, aa));
        float head = cover(box2(p - vec2(-hx + 0.25, body - 0.17), vec2(0.17, 0.014), 0.014), aa);
        col += vec3(0.9) * head * 0.65;
        float sub = cover(box2(p - vec2(-hx + 0.2, body - 0.215), vec2(0.12, 0.008), 0.008), aa);
        col += vec3(0.7) * sub * 0.45;
        float cw = (2.0 * hx - 0.14 - 0.08) / 3.0;
        float cx = p.x - (-hx + 0.07);
        float ci = clamp(floor(cx / (cw + 0.04)), 0.0, 2.0);
        float cc = -hx + 0.07 + ci * (cw + 0.04) + cw * 0.5;
        float card = box2(p - vec2(cc, -hy + 0.1), vec2(cw * 0.5, 0.065), 0.018);
        base = mix(base, vec3(0.12, 0.12, 0.14), cover(card, aa));
        float cl = cover(box2(p - vec2(cc - cw * 0.12, -hy + 0.12), vec2(cw * 0.32, 0.007), 0.007), aa);
        col += vec3(0.7) * cl * 0.5;
    } else {
        float row;
        float ink = textRows(p, vec4(-hx + 0.07, -hy + 0.06, hx - 0.07, body - 0.04), 0.06, seed, aa, row);
        col += vec3(0.55) * ink * 0.4;
    }
    return vec4(base * screen + col * screen * lit, screen);
}

vec2 boxHit(vec3 ro, vec3 rd, vec3 b) {
    vec3 m = 1.0 / (rd + vec3(1e-6));
    vec3 n = m * ro;
    vec3 k = abs(m) * b;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z));
}

float sdRect(vec2 q, vec4 s) {
    vec2 d = abs(q) - s.xy + s.w;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - s.w;
}

// Every pane is thin and flat, so its shadow is its outline projected along the light,
// softened by how far the light travelled past it: a penumbra without a shadow march.
float shadow(vec3 p, vec3 L, float self) {
    float res = 1.0;
    for (int j = 0; j < 6; j++) {
        if (abs(float(j) - self) < 0.5) {
            continue;
        }
        vec3 o = p - u_c[j];
        float dn = dot(L, u_az[j]);
        float s = -dot(o, u_az[j]) / (abs(dn) < 1e-3 ? 1e-3 : dn);
        if (s > 0.0) {
            vec3 hp = o + L * s;
            vec2 q = vec2(dot(hp, u_ax[j]), dot(hp, u_ay[j]));
            float pen = 0.015 + s * 0.16;
            res = min(res, mix(0.18, 1.0, smoothstep(-pen, pen, sdRect(q, u_size[j]))));
        }
    }
    return res;
}

vec4 shade(vec3 p, vec3 rd, float t, float fp) {
    float best = 1e5;
    float id = 0.0;
    vec3 bq = vec3(0.0);
    vec4 bs = vec4(1.0);
    vec4 bm = vec4(0.0);
    vec3 bx = vec3(1.0, 0.0, 0.0);
    vec3 by = vec3(0.0, 1.0, 0.0);
    vec3 bz = vec3(0.0, 0.0, 1.0);
    for (int i = 0; i < 6; i++) {
        vec3 o = p - u_c[i];
        vec3 q = vec3(dot(o, u_ax[i]), dot(o, u_ay[i]), dot(o, u_az[i]));
        float d = sdSlab(q, u_size[i]);
        if (d < best) {
            best = d;
            id = float(i);
            bq = q;
            bs = u_size[i];
            bm = u_mat[i];
            bx = u_ax[i];
            by = u_ay[i];
            bz = u_az[i];
        }
    }
    vec2 e = vec2(0.0012, -0.0012);
    vec3 nl = normalize(e.xyy * sdSlab(bq + e.xyy, bs) + e.yyx * sdSlab(bq + e.yyx, bs) +
        e.yxy * sdSlab(bq + e.yxy, bs) + e.xxx * sdSlab(bq + e.xxx, bs));
    vec3 n = normalize(bx * nl.x + by * nl.y + bz * nl.z);
    vec3 v = -rd;
    float ndv = max(dot(n, v), 0.0);
    vec3 toL = u_light - p;
    float ld = length(toL);
    vec3 L = toL / ld;
    float fall = 2.2 / (1.0 + 0.06 * ld * ld);
    float ndl = max(dot(n, L), 0.0) * fall;
    float sh = shadow(p, L, id);
    vec3 h = normalize(L + v);
    float focus = bm.x;

    vec3 albedo = vec3(0.085, 0.085, 0.097);
    vec3 col = albedo * (0.3 + 1.25 * ndl * sh);

    // the front face carries the node
    float front = smoothstep(0.55, 0.9, nl.z);
    if (front > 0.0) {
        float aa = fp / max(ndv, 0.3) * 1.2;
        vec4 f = face(bq.xy, bs, bm, aa, u_time);
        col = mix(col, f.rgb * (0.55 + 0.45 * sh) + albedo * 0.5 * ndl * sh, f.a * front);
    }

    // glossy coat: a soft studio box up left, a faint sky, a tight key highlight
    vec3 r = reflect(rd, n);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    float softbox = smoothstep(0.72, 0.99, dot(r, normalize(vec3(-0.38, 0.5, 0.78))));
    float sky = smoothstep(-0.4, 1.0, r.y);
    col += vec3(0.86, 0.9, 1.0) * (softbox * softbox * 0.55 + sky * 0.05) * mix(fres, 1.0, 0.16) * (0.35 + 0.65 * sh);
    col += vec3(0.9, 0.93, 1.0) * pow(max(dot(n, h), 0.0), 90.0) * 0.55 * sh;
    // cool rim where the pane turns away from the eye
    col += vec3(0.6, 0.68, 0.84) * pow(1.0 - ndv, 3.0) * 0.32;

    // the pane at work wears a thin accent edge
    float side = 1.0 - smoothstep(0.35, 0.75, abs(nl.z));
    float perim = smoothstep(-0.02, -0.002, sdRect(bq.xy, bs)) * step(0.0, nl.z);
    vec3 accent = vec3(0.16, 0.45, 1.0);
    col += accent * (side * 1.1 + perim * 0.45) * focus;

    float fog = 1.0 - smoothstep(5.9, 8.9, t);
    col *= mix(0.4, 1.0, fog);
    return vec4(col * fog, fog);
}

void main() {
    vec2 uv = (FC - 0.5 * u_res) / u_res.y;
    vec3 rd = normalize(u_cf * u_focal + u_cr * uv.x + u_cu * uv.y);
    vec3 ro = u_cam;
    float tmin = 1e5;
    float tmax = -1.0;
    for (int i = 0; i < 6; i++) {
        vec3 o = ro - u_c[i];
        vec3 lo = vec3(dot(o, u_ax[i]), dot(o, u_ay[i]), dot(o, u_az[i]));
        vec3 ld = vec3(dot(rd, u_ax[i]), dot(rd, u_ay[i]), dot(rd, u_az[i]));
        vec2 hit = boxHit(lo, ld, u_size[i].xyz + 0.02);
        g_mask[i] = 0.0;
        if (hit.x < hit.y && hit.y > 0.0) {
            g_mask[i] = 1.0;
            tmin = min(tmin, max(hit.x, 0.0));
            tmax = max(tmax, hit.y);
        }
    }
    if (tmax < 0.0) {
        gl_FragColor = vec4(0.0);
        return;
    }
    float pix = 1.0 / (u_res.y * u_focal);
    float t = tmin;
    float hit = 0.0;
    float prevD = 1e5;
    float prevT = t;
    float edgeT = -1.0;
    float edgeCov = 0.0;
    for (int s = 0; s < 40; s++) {
        float d = scene(ro + rd * t);
        float fp = pix * t;
        if (d < fp * 0.3) {
            hit = 1.0;
            break;
        }
        // A ray that grazed a pane within a pixel and moved on keeps that pane's edge,
        // so every silhouette is anti-aliased, also where one pane passes in front of another.
        if (d > prevD && prevD < fp * 1.3 && edgeT < 0.0) {
            edgeT = prevT;
            edgeCov = 1.0 - smoothstep(fp * 0.3, fp * 1.3, prevD);
        }
        prevD = d;
        prevT = t;
        t += max(d, fp * 0.4);
        if (t > tmax) {
            break;
        }
    }
    // one shading call per pixel: a silhouette over empty space is shaded where it was grazed,
    // a silhouette over another pane is its rim, which is what a grazing view of an edge shows
    vec4 col = vec4(0.0);
    if (hit > 0.5 || edgeCov > 0.0) {
        float ts = hit > 0.5 ? t : edgeT;
        col = shade(ro + rd * ts, rd, ts, pix * ts);
        if (hit < 0.5) {
            col *= edgeCov;
        } else if (edgeCov > 0.0) {
            float fog = 1.0 - smoothstep(5.9, 8.9, edgeT);
            vec4 e = vec4(vec3(0.4, 0.44, 0.53) * fog, fog) * edgeCov;
            col = e + col * (1.0 - e.a);
        }
    }
    gl_FragColor = col;
}
`;
        const shader = env.shader(FRAG);

        // Three front panes take turns at the front; three stay back as depth.
        const panes = [
            { kind: 0, pos: [-0.64, 0.4, 0.18], size: [0.6, 0.39], rot: [-0.1, 0.36, 0.02], face: [-0.07, -0.03] },
            { kind: 1, pos: [0.7, 0.2, 0.06], size: [0.42, 0.52], rot: [0.06, -0.42, -0.025], face: [0.08, -0.01] },
            { kind: 2, pos: [-0.06, -0.66, 0.3], size: [0.62, 0.35], rot: [0.38, 0.08, 0.015], face: [0.0, 0.05] },
            { kind: 3, pos: [0.02, 0.06, -0.62], size: [0.56, 0.36], rot: [-0.05, -0.1, 0.02], face: [0, 0] },
            { kind: 3, pos: [0.9, 0.74, -1.0], size: [0.36, 0.25], rot: [-0.08, -0.2, -0.03], face: [0, 0] },
            { kind: 1, pos: [-1.18, -0.6, -0.8], size: [0.34, 0.25], rot: [0.12, 0.5, 0.02], face: [0, 0] }
        ];
        const uC = new Float32Array(N * 3);
        const uX = new Float32Array(N * 3);
        const uY = new Float32Array(N * 3);
        const uZ = new Float32Array(N * 3);
        const uSize = new Float32Array(N * 4);
        const uMat = new Float32Array(N * 4);
        const cam = new Float32Array(3);
        const cr = new Float32Array(3);
        const cu = new Float32Array(3);
        const cf = new Float32Array(3);
        // a key light up left and in front: a point, so every face gets a falloff across it
        const light = new Float32Array([-2.6, 3.0, 3.6]);
        const uniforms = {
            u_cam: cam,
            u_cr: cr,
            u_cu: cu,
            u_cf: cf,
            u_focal: 0.5 / Math.tan((30 * Math.PI) / 360),
            u_light: light,
            u_c: uC,
            u_ax: uX,
            u_ay: uY,
            u_az: uZ,
            u_size: uSize,
            u_mat: uMat
        };

        // Rise and fall of one pane's turn at the front, wrapped so the cycle has no seam.
        const turnOf = (pane, t) => {
            const span = (lt) => {
                const start = pane * TURN;
                const rise = R.ease.inOutCubic((lt - start) / 1.6);
                const fall = R.ease.inOutCubic((lt - start - TURN + 0.25) / 1.5);
                return rise - fall;
            };
            const lt = R.mod(t, CYCLE);
            return Math.max(span(lt), span(lt + CYCLE), 0);
        };

        const axes = (rx, ry, rz, into, i) => {
            const cx = Math.cos(rx);
            const sx = Math.sin(rx);
            const cy = Math.cos(ry);
            const sy = Math.sin(ry);
            const cz = Math.cos(rz);
            const sz = Math.sin(rz);
            // Ry * Rx * Rz applied to the unit axes
            const apply = (ux, uy, uz, out) => {
                const ax = ux * cz - uy * sz;
                const ay = ux * sz + uy * cz;
                const bx = ax;
                const by = cx * ay - sx * uz;
                const bz = sx * ay + cx * uz;
                out[i * 3] = cy * bx + sy * bz;
                out[i * 3 + 1] = by;
                out[i * 3 + 2] = -sy * bx + cy * bz;
            };
            apply(1, 0, 0, into.x);
            apply(0, 1, 0, into.y);
            apply(0, 0, 1, into.z);
        };
        const axisOut = { x: uX, y: uY, z: uZ };

        const normalize = (vec) => {
            const len = Math.hypot(vec[0], vec[1], vec[2]) || 1;
            vec[0] /= len;
            vec[1] /= len;
            vec[2] /= len;
            return vec;
        };

        const pointer = env.pointer;

        const layout = (t) => {
            let tx = 0;
            let ty = 0.03;
            let tz = 0;
            let faceYaw = 0;
            let facePitch = 0;
            for (let i = 0; i < N; i++) {
                const pane = panes[i];
                const focus = i < 3 ? turnOf(i, t) : 0;
                const wave = (R.TAU * t) / CYCLE;
                const bob = 0.035 * Math.sin(2 * wave + i * 1.9);
                const px = pane.pos[0];
                const py = pane.pos[1] + bob;
                const pz = pane.pos[2];
                // the pane at work comes forward and squares up to the eye
                const lift = R.ease.inOutSine(focus);
                uC[i * 3] = px * (1 - 0.08 * lift);
                uC[i * 3 + 1] = py * (1 - 0.08 * lift);
                uC[i * 3 + 2] = pz + 0.3 * lift;
                const rx = pane.rot[0] * (1 - 0.65 * lift) + 0.03 * Math.sin(2 * wave + i * 2.3);
                const ry = pane.rot[1] * (1 - 0.7 * lift) + 0.045 * Math.sin(wave + i * 1.3);
                const rz = pane.rot[2] + 0.012 * Math.sin(wave + i);
                axes(rx, ry, rz, axisOut, i);
                uSize[i * 4] = pane.size[0];
                uSize[i * 4 + 1] = pane.size[1];
                uSize[i * 4 + 2] = 0.034;
                uSize[i * 4 + 3] = 0.06;
                uMat[i * 4] = focus;
                uMat[i * 4 + 1] = pane.kind;
                uMat[i * 4 + 2] = R.hash(i + 1) * 3;
                uMat[i * 4 + 3] = i < 3 ? 0.55 + 0.45 * focus : 0.4;
                tx += uC[i * 3] * focus * 0.12;
                ty += uC[i * 3 + 1] * focus * 0.12;
                tz += uC[i * 3 + 2] * focus * 0.12;
                faceYaw += pane.face[0] * focus;
                facePitch += pane.face[1] * focus;
            }
            const wave = (R.TAU * t) / CYCLE;
            const active = pointer.active;
            const yaw = 0.2 * Math.sin(wave) + faceYaw + pointer.nx * 0.55 * active;
            const pitch = 0.1 + 0.04 * Math.sin(2 * wave + 1) + facePitch + pointer.ny * 0.32 * active;
            const dist = 5.95;
            cam[0] = tx + dist * Math.sin(yaw) * Math.cos(pitch);
            cam[1] = ty + dist * Math.sin(pitch);
            cam[2] = tz + dist * Math.cos(yaw) * Math.cos(pitch);
            cf[0] = tx - cam[0];
            cf[1] = ty - cam[1];
            cf[2] = tz - cam[2];
            normalize(cf);
            // right = forward x up
            cr[0] = -cf[2];
            cr[1] = 0;
            cr[2] = cf[0];
            normalize(cr);
            cu[0] = cr[1] * cf[2] - cr[2] * cf[1];
            cu[1] = cr[2] * cf[0] - cr[0] * cf[2];
            cu[2] = cr[0] * cf[1] - cr[1] * cf[0];
        };

        return {
            draw(t) {
                layout(t);
                env.clear();
                shader.draw(uniforms);
                env.fadeEdges(0.66, 1.0);
            }
        };
    }
});
