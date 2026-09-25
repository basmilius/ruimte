/* Reel harness: the helpers every take shares, one WebGL context for all shader takes, and the runner
   that sizes, times and drives a take inside a host element. Every take draws in a logical 560 x 500 box. */
(() => {
    'use strict';

    const W = 560;
    const H = 500;
    const TAU = Math.PI * 2;

    const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const invlerp = (a, b, v) => clamp((v - a) / (b - a));
    const smoothstep = (a, b, v) => {
        const t = invlerp(a, b, v);
        return t * t * (3 - 2 * t);
    };
    const fract = (v) => v - Math.floor(v);
    const mod = (a, n) => ((a % n) + n) % n;
    const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
    // A 0..1 window of `t` that starts at `start` and lasts `duration`.
    const phase = (t, start, duration) => clamp((t - start) / duration);

    const rawEase = {
        linear: (t) => t,
        inQuad: (t) => t * t,
        outQuad: (t) => 1 - (1 - t) * (1 - t),
        inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
        inCubic: (t) => t * t * t,
        outCubic: (t) => 1 - Math.pow(1 - t, 3),
        inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        inQuart: (t) => t * t * t * t,
        outQuart: (t) => 1 - Math.pow(1 - t, 4),
        inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
        inQuint: (t) => t * t * t * t * t,
        outQuint: (t) => 1 - Math.pow(1 - t, 5),
        inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
        inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
        outSine: (t) => Math.sin((t * Math.PI) / 2),
        inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
        inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
        outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
        inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
        inBack: (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
        outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
        inOutBack: (t, s = 1.70158) => {
            const c = s * 1.525;
            return t < 0.5 ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2 : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
        },
        outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
        outBounce: (t) => {
            const n = 7.5625;
            const d = 2.75;
            if (t < 1 / d) {
                return n * t * t;
            }
            if (t < 2 / d) {
                return n * (t -= 1.5 / d) * t + 0.75;
            }
            if (t < 2.5 / d) {
                return n * (t -= 2.25 / d) * t + 0.9375;
            }
            return n * (t -= 2.625 / d) * t + 0.984375;
        },
        smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10)
    };
    const ease = {};
    for (const [name, fn] of Object.entries(rawEase)) {
        ease[name] = (t, ...rest) => fn(clamp(t), ...rest);
    }
    // A cubic-bezier easing like CSS, for when a take wants a curve of its own.
    ease.bezier = (x1, y1, x2, y2) => {
        const sample = (a, b, t) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
        return (x) => {
            x = clamp(x);
            let lo = 0;
            let hi = 1;
            let t = x;
            for (let i = 0; i < 24; i++) {
                const v = sample(x1, x2, t);
                if (Math.abs(v - x) < 1e-5) {
                    break;
                }
                if (v < x) {
                    lo = t;
                } else {
                    hi = t;
                }
                t = (lo + hi) / 2;
            }
            return sample(y1, y2, t);
        };
    };

    const rng = (seed = 1) => {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };
    const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
    const seedOf = (text) => {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    };

    // Improved Perlin noise, -1..1, seeded once so every take sees the same field.
    const perm = new Uint8Array(512);
    {
        const r = rng(4210);
        const p = Array.from({ length: 256 }, (_, i) => i);
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }
        for (let i = 0; i < 512; i++) {
            perm[i] = p[i & 255];
        }
    }
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const grad = (h, x, y, z) => {
        const k = h & 15;
        const u = k < 8 ? x : y;
        const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
        return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
    };
    const noise = (x, y = 0, z = 0) => {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        const u = fade(x);
        const v = fade(y);
        const w = fade(z);
        const A = perm[X] + Y;
        const AA = perm[A] + Z;
        const AB = perm[A + 1] + Z;
        const B = perm[X + 1] + Y;
        const BA = perm[B] + Z;
        const BB = perm[B + 1] + Z;
        return lerp(
            lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
            lerp(
                lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
                lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
                v
            ),
            w
        );
    };
    const fbm = (x, y = 0, z = 0, octaves = 4) => {
        let sum = 0;
        let amp = 0.5;
        let f = 1;
        for (let i = 0; i < octaves; i++) {
            sum += amp * noise(x * f, y * f, z * f);
            f *= 2;
            amp *= 0.5;
        }
        return sum;
    };

    // A damped spring, stepped in small slices so it stays stable at any frame rate.
    class Spring {
        constructor(value = 0, { stiffness = 170, damping = 26, mass = 1 } = {}) {
            this.x = value;
            this.v = 0;
            this.target = value;
            this.k = stiffness;
            this.c = damping;
            this.m = mass;
        }
        set(value) {
            this.x = value;
            this.target = value;
            this.v = 0;
            return this;
        }
        step(dt) {
            const slices = Math.max(1, Math.ceil(dt / (1 / 240)));
            const h = dt / slices;
            for (let i = 0; i < slices; i++) {
                const force = -this.k * (this.x - this.target) - this.c * this.v;
                this.v += (force / this.m) * h;
                this.x += this.v * h;
            }
            return this.x;
        }
        get settled() {
            return Math.abs(this.x - this.target) < 1e-3 && Math.abs(this.v) < 1e-3;
        }
    }

    // The site's dark theme, token for token (apps/site/src/app/globals.css), plus the app icon's two planes.
    const pal = {
        bg: '#0d0d10',
        surface: '#131316',
        raised: '#18181c',
        sunken: '#08080a',
        hover: '#202024',
        active: '#28282e',
        dot: '#202024',
        border: 'rgba(255,255,255,0.07)',
        borderStrong: 'rgba(255,255,255,0.13)',
        text: '#ececf1',
        muted: '#9a9aa6',
        faint: '#5f5f6b',
        accent: '#155dfc',
        running: '#60a5fa',
        needs: '#fbbf24',
        idle: '#4ade80',
        error: '#ef4444',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#67e8f9',
        termBg: '#08080a',
        termFg: '#d6d6de',
        termDim: '#6b6b76',
        note: '#3b3416',
        skill: '#c084fc',
        markDark: '#1c2233',
        markLight: '#d9dee6'
    };
    const hexToRgb = (hex) => {
        const h = hex.replace('#', '');
        const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
        const n = parseInt(full, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const rgba = (hex, a = 1) => {
        const [r, g, b] = hexToRgb(hex);
        return `rgba(${r},${g},${b},${a})`;
    };
    const mix = (a, b, t, alpha = 1) => {
        const x = hexToRgb(a);
        const y = hexToRgb(b);
        return `rgba(${Math.round(lerp(x[0], y[0], t))},${Math.round(lerp(x[1], y[1], t))},${Math.round(lerp(x[2], y[2], t))},${alpha})`;
    };
    // 0..1 floats for a shader uniform.
    const vec3 = (hex) => hexToRgb(hex).map((c) => c / 255);

    const fonts = {
        display: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Geist", sans-serif',
        mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
        hand: '"Kalam", "Comic Sans MS", cursive'
    };

    const roundRect = (ctx, x, y, w, h, r) => {
        const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    };

    const R = {
        W,
        H,
        TAU,
        clamp,
        lerp,
        invlerp,
        smoothstep,
        fract,
        mod,
        dist,
        phase,
        ease,
        rng,
        hash,
        seedOf,
        noise,
        fbm,
        Spring,
        pal,
        hexToRgb,
        rgba,
        mix,
        vec3,
        fonts,
        roundRect
    };

    /* One WebGL context for every shader take: each draws into a corner of it and is copied onto its own canvas. */
    const GL = (() => {
        let canvas = null;
        let gl = null;
        let failed = false;
        const programs = new Map();
        const textures = new WeakMap();
        const PRELUDE = [
            '#extension GL_OES_standard_derivatives : enable',
            'precision highp float;',
            'uniform vec2 u_res;',
            'uniform vec2 u_origin;',
            'uniform float u_time;',
            'uniform float u_scale;',
            'uniform vec4 u_pointer;',
            '#define FC (gl_FragCoord.xy - u_origin)',
            // Logical coordinates, the same 560 x 500 box with y down that the 2D takes draw in.
            'vec2 logical() { vec2 p = FC / u_scale; return vec2(p.x, 500.0 - p.y); }',
            ''
        ].join('\n');
        const VERTEX = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

        const init = () => {
            if (gl || failed) {
                return !!gl;
            }
            canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
            if (!gl) {
                failed = true;
                return false;
            }
            gl.getExtension('OES_standard_derivatives');
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                programs.clear();
                gl = null;
                failed = true;
            });
            return true;
        };

        const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error(log || 'shader did not compile');
            }
            return shader;
        };

        const program = (frag) => {
            let entry = programs.get(frag);
            if (entry) {
                return entry;
            }
            const p = gl.createProgram();
            gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX));
            gl.attachShader(p, compile(gl.FRAGMENT_SHADER, PRELUDE + frag));
            gl.bindAttribLocation(p, 0, 'a_pos');
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
                throw new Error(gl.getProgramInfoLog(p) || 'program did not link');
            }
            const uniforms = new Map();
            const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < count; i++) {
                const info = gl.getActiveUniform(p, i);
                const name = info.name.replace(/\[0\]$/, '');
                uniforms.set(name, { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size });
            }
            entry = { p, uniforms };
            programs.set(frag, entry);
            return entry;
        };

        const texture = (source, dirty) => {
            let tex = textures.get(source);
            const fresh = !tex;
            if (!tex) {
                tex = gl.createTexture();
                textures.set(source, tex);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            } else {
                gl.bindTexture(gl.TEXTURE_2D, tex);
            }
            if (fresh || dirty) {
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            }
            return tex;
        };

        const setUniform = (entry, name, value, unit) => {
            const u = entry.uniforms.get(name);
            if (!u) {
                return unit;
            }
            const { loc, type } = u;
            switch (type) {
                case gl.FLOAT:
                    typeof value === 'number' ? gl.uniform1f(loc, value) : gl.uniform1fv(loc, value);
                    break;
                case gl.FLOAT_VEC2:
                    gl.uniform2fv(loc, value);
                    break;
                case gl.FLOAT_VEC3:
                    gl.uniform3fv(loc, value);
                    break;
                case gl.FLOAT_VEC4:
                    gl.uniform4fv(loc, value);
                    break;
                case gl.INT:
                case gl.BOOL:
                    typeof value === 'number' ? gl.uniform1i(loc, value) : gl.uniform1iv(loc, value);
                    break;
                case gl.FLOAT_MAT2:
                    gl.uniformMatrix2fv(loc, false, value);
                    break;
                case gl.FLOAT_MAT3:
                    gl.uniformMatrix3fv(loc, false, value);
                    break;
                case gl.FLOAT_MAT4:
                    gl.uniformMatrix4fv(loc, false, value);
                    break;
                case gl.SAMPLER_2D: {
                    const source = value && value.canvas ? value.canvas : value;
                    gl.activeTexture(gl.TEXTURE0 + unit);
                    texture(source, !!(value && value.dirty));
                    gl.uniform1i(loc, unit);
                    return unit + 1;
                }
                default:
                    break;
            }
            return unit;
        };

        const draw = (runner, frag, uniforms, composite) => {
            if (!init()) {
                return false;
            }
            const pw = runner.canvas.width;
            const ph = runner.canvas.height;
            if (canvas.width < pw || canvas.height < ph) {
                canvas.width = Math.max(canvas.width, pw);
                canvas.height = Math.max(canvas.height, ph);
            }
            const oy = canvas.height - ph;
            let entry;
            try {
                entry = program(frag);
            } catch (error) {
                console.error(`[${runner.def.id}]`, error.message);
                failed = true;
                return false;
            }
            gl.viewport(0, oy, pw, ph);
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(0, oy, pw, ph);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(entry.p);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            const p = runner.pointer;
            let unit = 0;
            unit = setUniform(entry, 'u_res', [pw, ph], unit);
            unit = setUniform(entry, 'u_origin', [0, oy], unit);
            unit = setUniform(entry, 'u_time', runner.t, unit);
            unit = setUniform(entry, 'u_scale', runner.scale, unit);
            unit = setUniform(entry, 'u_pointer', [p.x, p.y, p.active, p.inside ? 1 : 0], unit);
            for (const [name, value] of Object.entries(uniforms || {})) {
                unit = setUniform(entry, name, value, unit);
            }
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const ctx = runner.ctx;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = composite || 'source-over';
            ctx.drawImage(canvas, 0, 0, pw, ph, 0, 0, pw, ph);
            ctx.restore();
            return true;
        };

        return { draw, available: () => init() };
    })();

    const registry = [];
    const Reel = {
        R,
        pieces: registry,
        add(def) {
            if (!def || !def.id || typeof def.create !== 'function') {
                throw new Error('A take needs an id and create()');
            }
            registry.push(def);
        },
        get(id) {
            return registry.find((def) => def.id === id);
        },
        glAvailable: () => GL.available()
    };

    /* Drives one take inside a host element. The host sets the size; the canvas fills it at 560:500. */
    class Runner {
        constructor(def, host, { quality = 1, maxDpr = 2, interactive = true } = {}) {
            this.def = def;
            this.host = host;
            this.quality = quality;
            this.maxDpr = maxDpr;
            this.t = 0;
            this.scale = 1;
            this.instance = null;
            this.error = null;
            this.buffers = [];
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'take-canvas';
            this.canvas.setAttribute('aria-hidden', 'true');
            host.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
            this.pointer = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, active: 0, inside: false, down: false, nx: 0, ny: 0 };
            this.listeners = [];
            if (interactive) {
                const on = (type, fn) => {
                    host.addEventListener(type, fn);
                    this.listeners.push([type, fn]);
                };
                const locate = (event) => {
                    const r = this.canvas.getBoundingClientRect();
                    this.pointer.tx = ((event.clientX - r.left) / r.width) * W;
                    this.pointer.ty = ((event.clientY - r.top) / r.height) * H;
                };
                on('pointermove', (event) => {
                    if (event.pointerType === 'touch' && !this.pointer.down) {
                        return;
                    }
                    locate(event);
                    this.pointer.inside = true;
                });
                on('pointerdown', (event) => {
                    locate(event);
                    this.pointer.down = true;
                    this.pointer.inside = true;
                });
                const up = () => {
                    this.pointer.down = false;
                };
                on('pointerup', up);
                on('pointercancel', up);
                on('pointerleave', () => {
                    this.pointer.inside = false;
                    this.pointer.down = false;
                });
            }
            this.observer = new ResizeObserver(() => this.resize());
            this.observer.observe(host);
            this.resize();
        }

        makeEnv() {
            const runner = this;
            const env = {
                W,
                H,
                R,
                id: this.def.id,
                quality: this.quality,
                ctx: this.ctx,
                canvas: this.canvas,
                pointer: this.pointer,
                get scale() {
                    return runner.scale;
                },
                get t() {
                    return runner.t;
                },
                rand: rng(seedOf(this.def.id)),
                clear() {
                    runner.ctx.clearRect(0, 0, W, H);
                },
                // Fades the edges of what is drawn so far into transparency, as an ellipse that fits the box.
                fadeEdges(inner = 0.6, outer = 1) {
                    const ctx = runner.ctx;
                    ctx.save();
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.translate(W / 2, H / 2);
                    ctx.scale(1, H / W);
                    const g = ctx.createRadialGradient(0, 0, (W / 2) * inner, 0, 0, (W / 2) * outer);
                    g.addColorStop(0, 'rgba(0,0,0,1)');
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(-W, -W, W * 2, W * 2);
                    ctx.restore();
                },
                // An offscreen canvas at the take's own resolution, with the logical transform set. Cleared on resize.
                buffer() {
                    const canvas = document.createElement('canvas');
                    const handle = { canvas, ctx: canvas.getContext('2d') };
                    runner.fitBuffer(handle);
                    runner.buffers.push(handle);
                    return handle;
                },
                shader(frag) {
                    return {
                        draw(uniforms, composite) {
                            return GL.draw(runner, frag, uniforms, composite);
                        }
                    };
                },
                gl: () => GL.available()
            };
            return env;
        }

        fitBuffer(handle) {
            if (handle.canvas.width !== this.canvas.width || handle.canvas.height !== this.canvas.height) {
                handle.canvas.width = this.canvas.width;
                handle.canvas.height = this.canvas.height;
            }
            handle.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
        }

        resize() {
            const width = this.host.clientWidth;
            if (!width) {
                return;
            }
            const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
            const pw = Math.round(width * dpr);
            const ph = Math.round((pw * H) / W);
            if (pw === this.canvas.width && ph === this.canvas.height) {
                return;
            }
            this.canvas.width = pw;
            this.canvas.height = ph;
            this.scale = pw / W;
            for (const handle of this.buffers) {
                this.fitBuffer(handle);
            }
            if (this.instance && this.instance.resize) {
                this.guard(() => this.instance.resize());
            }
            if (this.instance && !this.live) {
                this.render();
            }
        }

        guard(fn) {
            if (this.error) {
                return;
            }
            try {
                fn();
            } catch (error) {
                this.error = error;
                console.error(`[${this.def.id}]`, error);
                this.host.dataset.error = error.message;
            }
        }

        ensure() {
            if (!this.instance && !this.error) {
                this.guard(() => {
                    this.env = this.makeEnv();
                    this.instance = this.def.create(this.env) || {};
                });
            }
            return !!this.instance;
        }

        render() {
            if (!this.ensure()) {
                return;
            }
            const ctx = this.ctx;
            ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            this.guard(() => this.instance.draw(this.t));
        }

        smoothPointer(dt) {
            const p = this.pointer;
            const k = 1 - Math.exp(-dt * 9);
            const target = p.inside ? 1 : 0;
            if (!p.inside) {
                p.tx = lerp(p.tx, W / 2, 1 - Math.exp(-dt * 1.5));
                p.ty = lerp(p.ty, H / 2, 1 - Math.exp(-dt * 1.5));
            }
            p.x += (p.tx - p.x) * k;
            p.y += (p.ty - p.y) * k;
            p.active += (target - p.active) * (1 - Math.exp(-dt * 5));
            p.nx = (p.x / W) * 2 - 1;
            p.ny = (p.y / H) * 2 - 1;
        }

        tick(dt) {
            if (!this.ensure()) {
                return;
            }
            this.smoothPointer(dt);
            this.t += dt;
            if (this.instance.update) {
                this.guard(() => this.instance.update(this.t, dt));
            }
            this.render();
        }

        // Starts over and runs the take to `time` without drawing the frames in between.
        seek(time) {
            this.reset();
            if (!this.ensure()) {
                return;
            }
            const step = 1 / 60;
            while (this.t + step <= time && !this.error) {
                this.smoothPointer(step);
                this.t += step;
                if (this.instance.update) {
                    this.guard(() => this.instance.update(this.t, step));
                } else {
                    break;
                }
            }
            this.t = time;
            this.render();
        }

        reset() {
            if (this.instance && this.instance.destroy) {
                this.guard(() => this.instance.destroy());
            }
            this.instance = null;
            this.error = null;
            delete this.host.dataset.error;
            this.buffers = [];
            this.t = 0;
        }

        destroy() {
            this.reset();
            for (const [type, fn] of this.listeners) {
                this.host.removeEventListener(type, fn);
            }
            this.observer.disconnect();
            this.canvas.remove();
        }
    }

    /* One clock for every live runner, paused while the page is hidden. */
    const Clock = (() => {
        const live = new Set();
        let frame = 0;
        let previous = 0;
        const loop = (now) => {
            const dt = previous ? Math.min((now - previous) / 1000, 1 / 20) : 1 / 60;
            previous = now;
            for (const runner of live) {
                runner.tick(dt);
            }
            frame = live.size ? requestAnimationFrame(loop) : 0;
        };
        const wake = () => {
            if (!frame && live.size && !document.hidden) {
                previous = 0;
                frame = requestAnimationFrame(loop);
            }
        };
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                cancelAnimationFrame(frame);
                frame = 0;
            } else {
                wake();
            }
        });
        return {
            play(runner) {
                runner.live = true;
                live.add(runner);
                wake();
            },
            pause(runner) {
                runner.live = false;
                live.delete(runner);
            },
            has: (runner) => live.has(runner)
        };
    })();

    window.Reel = Reel;
    window.ReelRunner = Runner;
    window.ReelClock = Clock;
})();
