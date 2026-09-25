Reel.add({
    id: 'interference',
    title: 'Interference',
    line: 'Two machines, one project. Where their grids meet, patterns appear.',
    principles: ['Timing', 'Appeal'],
    tech: 'WebGL, analytic dot lattices, supersampled and fwidth-free anti-aliasing',
    hint: 'Move to bend the top grid',
    poster: 19.4,
    create(env) {
        const R = env.R;
        const CYCLE = 24;
        const PITCH = 7.2;
        const CENTER = [280, 250];

        const FRAG = `
uniform vec2 u_center;
uniform vec4 u_aW;
uniform vec4 u_aL;
uniform vec4 u_bW;
uniform vec4 u_bL;
uniform vec2 u_bOff;
uniform vec3 u_lens;
uniform vec3 u_ptr;
uniform vec3 u_dot;

// Distance to the nearest point of a lattice: the four corners of the cell that holds p.
// Enough for square and hexagonal bases while a dot stays under a third of the pitch.
float nearest(vec2 p, mat2 toWorld, mat2 toLat) {
    vec2 f = floor(toLat * p);
    vec2 w0 = toWorld * f - p;
    vec2 w1 = toWorld * (f + vec2(1.0, 0.0)) - p;
    vec2 w2 = toWorld * (f + vec2(0.0, 1.0)) - p;
    vec2 w3 = toWorld * (f + vec2(1.0, 1.0)) - p;
    return sqrt(min(min(dot(w0, w0), dot(w1, w1)), min(dot(w2, w2), dot(w3, w3))));
}

void main() {
    vec2 p0 = logical();
    float px = 1.0 / u_scale;
    mat2 aW = mat2(u_aW.xy, u_aW.zw);
    mat2 aL = mat2(u_aL.xy, u_aL.zw);
    mat2 bW = mat2(u_bW.xy, u_bW.zw);
    mat2 bL = mat2(u_bL.xy, u_bL.zw);
    float r = u_dot.x;
    float cA = 0.0;
    float cB = 0.0;
    float cAB = 0.0;
    // four rotated-grid samples per pixel, each with a half-pixel edge
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        vec2 o = vec2(fi < 1.5 ? (fi < 0.5 ? 0.125 : -0.125) : (fi < 2.5 ? 0.375 : -0.375),
                      fi < 1.5 ? (fi < 0.5 ? 0.375 : -0.375) : (fi < 2.5 ? -0.125 : 0.125));
        vec2 p = p0 + o * px;
        vec2 rel = p - u_center;
        // the top lattice bends around the pointer like a loupe
        vec2 tp = p - u_ptr.xy;
        vec2 pa = rel + tp * u_ptr.z * exp(-dot(tp, tp) / 7000.0);
        // the bottom lattice sits under a soft radial lens
        vec2 pb = rel * (1.0 - u_lens.x * exp(-dot(rel, rel) / (u_lens.y * u_lens.y))) + u_bOff;
        float a = smoothstep(r + 0.5 * px, r - 0.5 * px, nearest(pa, aW, aL));
        float b = smoothstep(r + 0.5 * px, r - 0.5 * px, nearest(pb, bW, bL));
        cA += a;
        cB += b;
        cAB += a * b;
    }
    cA *= 0.25;
    cB *= 0.25;
    cAB *= 0.25;
    // below three pixels a pitch cannot be drawn honestly, so the grids settle to their average
    float avg = u_dot.y;
    float fine = smoothstep(3.2, 2.2, u_dot.z * u_scale);
    cA = mix(cA, avg, fine);
    cB = mix(cB, avg, fine);
    cAB = mix(cAB, avg * avg, fine);

    float d = length(p0 - u_center);
    float mask = 1.0 - smoothstep(138.0, 196.0, d);
    float lift = 0.8 + 0.2 * (1.0 - smoothstep(0.0, 200.0, d));
    // each grid alone is a faint texture; where the two coincide the light adds up, and that is the figure
    float alpha = ((cA + cB) * 0.13 + cAB * 1.15) * mask * lift;
    alpha = clamp(alpha, 0.0, 1.0);
    vec3 col = mix(vec3(0.9, 0.91, 0.95), vec3(0.97, 0.98, 1.0), clamp(cAB * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(col * alpha, alpha);
}
`;
        const shader = env.shader(FRAG);

        const aW = new Float32Array(4);
        const aL = new Float32Array(4);
        const bW = new Float32Array(4);
        const bL = new Float32Array(4);
        const bOff = new Float32Array(2);
        const lens = new Float32Array(3);
        const ptr = new Float32Array(3);
        const dotU = new Float32Array(3);
        const center = new Float32Array(CENTER);
        const uniforms = { u_center: center, u_aW: aW, u_aL: aL, u_bW: bW, u_bL: bL, u_bOff: bOff, u_lens: lens, u_ptr: ptr, u_dot: dotU };

        // A basis: first vector along the angle, second one turning from square to hexagonal.
        const basis = (angle, pitch, hex, world, lat) => {
            const ca = Math.cos(angle);
            const sa = Math.sin(angle);
            const hx = 0.5 * hex;
            const hy = R.lerp(1, Math.sqrt(3) / 2, hex);
            const e1x = ca * pitch;
            const e1y = sa * pitch;
            const e2x = (ca * hx - sa * hy) * pitch;
            const e2y = (sa * hx + ca * hy) * pitch;
            world[0] = e1x;
            world[1] = e1y;
            world[2] = e2x;
            world[3] = e2y;
            const det = e1x * e2y - e2x * e1y;
            lat[0] = e2y / det;
            lat[1] = -e1y / det;
            lat[2] = -e2x / det;
            lat[3] = e1x / det;
        };

        const deg = Math.PI / 180;
        const bell = (t, start, dur) => {
            const span = R.clamp((t - start) / dur);
            return Math.pow(Math.sin(Math.PI * span), 2);
        };
        const ramp = (t, start, dur) => R.ease.inOutSine((t - start) / dur);

        const pointer = env.pointer;
        const layout = (t) => {
            const lt = R.mod(t, CYCLE);
            // Three movements. Square on square: the twist blooms and dissolves while the scale breathes.
            // Hexagonal: the top grid turns first, the bottom follows, and they twist into rosettes.
            // The lens: the bottom grid swells from the middle and the figure blooms in rings.
            const twist = 5.2 * deg * bell(lt, 0, 8) + 3.4 * deg * bell(lt, 10.6, 5.4) + 0.9 * deg * bell(lt, 16, 8);
            const breath = 1 + 0.016 * Math.sin((R.TAU * lt) / 8) * bell(lt, 0, 8);
            const hexA = ramp(lt, 8, 2) - ramp(lt, 20.6, 2);
            const hexB = ramp(lt, 9.1, 2) - ramp(lt, 21.0, 2.2);
            // the whole figure turns a quarter per cycle, which a square grid cannot tell from none
            const spin = (Math.PI / 2) * (lt / CYCLE);
            basis(spin, PITCH, hexA, aW, aL);
            basis(spin + twist, PITCH * breath, hexB, bW, bL);
            const swell = bell(lt, 15.6, 8.2);
            // At rest the bottom grid sits in the gaps of the top one, a dim even field. As a figure blooms
            // it slides onto the top grid, so the rosettes glide in and settle on the center; then back out.
            const active = Math.sqrt(Math.max(bell(lt, 0, 8), bell(lt, 10.6, 5.4), swell));
            const gap = R.lerp(0.5, 1 / 3, hexB) * (1 - active);
            const drift = bell(lt, 0, 8) + bell(lt, 10.6, 5.4);
            bOff[0] = (bW[0] + bW[2]) * gap + 0.7 * Math.sin((R.TAU * lt) / 12) * drift;
            bOff[1] = (bW[1] + bW[3]) * gap + 0.5 * Math.sin((R.TAU * lt) / 8) * drift;
            lens[0] = 0.16 * swell;
            lens[1] = R.lerp(40, 230, R.ease.inOutSine((lt - 15.6) / 8.2));
            ptr[0] = pointer.x;
            ptr[1] = pointer.y;
            ptr[2] = 0.13 * pointer.active;
            const radius = PITCH * 0.25;
            dotU[0] = radius;
            dotU[1] = (Math.PI * radius * radius) / (PITCH * PITCH);
            dotU[2] = PITCH;
        };

        return {
            draw(t) {
                layout(t);
                env.clear();
                shader.draw(uniforms);
                env.fadeEdges(0.74, 1.0);
            }
        };
    }
});
