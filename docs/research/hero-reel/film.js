/* Film harness: a 1920 x 1080 frame drawn once per frame in order, which can place any reel take in it. */
(() => {
    'use strict';

    const W = 1920;
    const H = 1080;
    const films = [];

    // A take rendered off screen at a given pixel width, advanced by the film's own clock.
    const makeTake = (id, { width = 1120, options = {}, quality = 1 } = {}) => {
        const def = Reel.get(id);
        if (!def) {
            throw new Error('No take ' + id);
        }
        const host = document.createElement('div');
        host.style.cssText = `position:absolute;left:-40000px;top:0;width:${Math.round(width)}px;aspect-ratio:560/500;`;
        document.body.appendChild(host);
        const runner = new ReelRunner(def, host, { quality, maxDpr: 1, interactive: false, options });
        runner.ensure();
        return {
            runner,
            canvas: runner.canvas,
            get t() {
                return runner.t;
            },
            // Scripted pointer in the take's logical 560 x 500 box; `active` 0..1.
            point(x, y, active = 1) {
                Object.assign(runner.pointer, { tx: x, ty: y, inside: active > 0.5 });
                runner.pointer.active = active;
            },
            tick(dt) {
                runner.tick(dt);
            },
            seek(time) {
                runner.seek(time);
            },
            // Draws the take's current frame into the film at x, y with width w (height follows 560:500).
            draw(ctx, x, y, w, alpha = 1) {
                ctx.save();
                ctx.globalAlpha *= alpha;
                ctx.drawImage(runner.canvas, x, y, w, (w * 500) / 560);
                ctx.restore();
            }
        };
    };

    const Film = {
        W,
        H,
        fps: 30,
        films,
        define(def) {
            films.push(def);
        },
        get(id) {
            return films.find((film) => film.id === id);
        },
        // Sets up a film on a canvas; returns frame(n), which must be called for n = 0, 1, 2, ... in order.
        mount(def, canvas) {
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext('2d');
            const takes = [];
            const env = {
                W,
                H,
                R: Reel.R,
                ctx,
                fps: Film.fps,
                duration: def.duration,
                take(id, opts) {
                    const take = makeTake(id, opts);
                    takes.push(take);
                    return take;
                },
                rand: Reel.R.rng(Reel.R.seedOf(def.id))
            };
            const instance = def.create(env);
            let last = -1;
            return {
                frame(n) {
                    if (n !== last + 1) {
                        throw new Error('Frames must be drawn in order: asked ' + n + ' after ' + last);
                    }
                    last = n;
                    const t = n / Film.fps;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.globalAlpha = 1;
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = Reel.R.pal.bg;
                    ctx.fillRect(0, 0, W, H);
                    instance.draw(t, 1 / Film.fps);
                },
                frames: Math.round(def.duration * Film.fps)
            };
        }
    };
    window.Film = Film;
})();
