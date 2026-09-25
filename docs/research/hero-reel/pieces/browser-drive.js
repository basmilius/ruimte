Reel.add({
    id: 'browser-drive',
    title: 'By Address',
    line: 'An agent drives the browser by address, and sees what you see.',
    principles: ['Arcs', 'Timing'],
    tech: 'Canvas 2D, browser automation choreography',
    hint: 'Hover a node to select it',
    poster: 10.5,
    create(env) {
        const { R } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const ease = R.ease;
        const phase = R.phase;

        const CYCLE = 18;
        const CLAUDE = new Path2D(
            'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
        );
        const EDGE = R.mix(pal.bg, pal.accent, 0.55);
        const BRAND = '#f54900';

        const BROWSER = { x: 34, y: 108, w: 252, h: 252 };
        const PAGE = { x: BROWSER.x, y: BROWSER.y + 28 + 33, w: BROWSER.w, h: BROWSER.h - 61 };
        const CHAT = { x: 342, y: 138, w: 166, h: 262 };
        const THUMB_W = 136;
        const THUMB_H = Math.round((THUMB_W * PAGE.h) / PAGE.w);

        // Three visits, each: address, load, a picture, the picture flies to the chat.
        const VISITS = [
            { type: 0.5, load: 2.0, shot: 3.4, page: 'cart' },
            { type: 6.4, load: 7.3, shot: 8.45, page: 'checkout' },
            { back: 11.8, load: 11.85, shot: 13.35, page: 'fixed' }
        ];
        const FLIGHT = 0.95;
        const SHOT_LEAD = 0.36;
        const RESET = 16.6;
        const HOST = 'localhost:3000';

        const ENTRIES = [
            { at: 0.3, kind: 'tool', verb: 'Open', detail: 'localhost:3000/cart', live: [0.3, 3.3] },
            { at: VISITS[0].shot + SHOT_LEAD + FLIGHT - 0.35, kind: 'picture', visit: 0 },
            { at: 4.85, kind: 'text', lines: ['The total skips the', '$10 discount.'] },
            { at: 6.3, kind: 'tool', verb: 'Open', detail: '/checkout', live: [6.3, 8.4] },
            { at: VISITS[1].shot + SHOT_LEAD + FLIGHT - 0.35, kind: 'picture', visit: 1 },
            { at: 9.9, kind: 'text', lines: ['Checkout repeats it.'] },
            { at: 10.7, kind: 'tool', verb: 'Edit', detail: 'cart.ts', diff: true, live: [10.7, 11.5] },
            { at: 11.7, kind: 'tool', verb: 'Back', detail: '/cart', live: [11.7, 13.3] },
            { at: VISITS[2].shot + SHOT_LEAD + FLIGHT - 0.35, kind: 'picture', visit: 2 },
            { at: 14.85, kind: 'text', lines: ['Fixed. The total is', '$72.00 now.'] }
        ];
        const heightOf = (entry) => (entry.kind === 'tool' ? 24 : entry.kind === 'picture' ? THUMB_H + 12 : entry.lines.length * 17 + 10);

        /* The page, as blocks in its own coordinates, so the browser and every thumbnail draw the same picture. */
        const PAGES = {
            cart: { title: 'Cart', total: '$82.00', totalColor: pal.text },
            checkout: { title: 'Checkout' },
            fixed: { title: 'Cart', total: '$72.00', totalColor: pal.idle }
        };
        const ITEMS = [
            { name: 'Canvas tote', price: '$24.00', tint: '#33406a' },
            { name: 'Desk lamp', price: '$48.00', tint: '#6a3a33' },
            { name: 'Mug', price: '$20.00', tint: '#2f5a45' }
        ];

        const drawPage = (kind, reveal) => {
            // Blocks fade by their own reveal on top of whatever alpha the caller draws the page at.
            const base = ctx.globalAlpha;
            const width = PAGE.w;
            const block = (i) => ease.outCubic(R.clamp(reveal * 9 - i));
            const rise = (i) => (1 - block(i)) * 5;
            ctx.textBaseline = 'middle';
            let alpha = block(0);
            ctx.globalAlpha = base * alpha;
            ctx.fillStyle = '#16161a';
            ctx.fillRect(0, 0, width, 24);
            ctx.fillStyle = BRAND;
            R.roundRect(ctx, 12, 7, 10, 10, 2.5);
            ctx.fill();
            ctx.font = '600 12px ' + R.fonts.display;
            ctx.textAlign = 'left';
            ctx.fillStyle = pal.text;
            ctx.fillText('acme', 28, 12.5);
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            for (let i = 0; i < 3; i++) {
                R.roundRect(ctx, width - 104 + i * 32, 10, 24, 4, 2);
                ctx.fill();
            }
            alpha = block(1);
            ctx.globalAlpha = base * alpha;
            ctx.font = '600 13px ' + R.fonts.display;
            ctx.fillStyle = pal.text;
            ctx.fillText(PAGES[kind].title, 12, 40 + rise(1));
            if (kind === 'checkout') {
                const labels = ['Email', 'Card'];
                for (let i = 0; i < 2; i++) {
                    ctx.globalAlpha = base * block(2 + i);
                    const fy = 60 + i * 38 + rise(2 + i);
                    ctx.font = '400 12px ' + R.fonts.display;
                    ctx.fillStyle = pal.muted;
                    ctx.fillText(labels[i], 12, fy);
                    ctx.fillStyle = 'rgba(255,255,255,0.05)';
                    R.roundRect(ctx, 12, fy + 8, 140, 18, 4);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                ctx.globalAlpha = base * block(4);
                ctx.fillStyle = 'rgba(255,255,255,0.04)';
                R.roundRect(ctx, 164, 52 + rise(4), width - 176, 70, 6);
                ctx.fill();
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.fillStyle = pal.muted;
                ctx.fillText('Total', 172, 66 + rise(4));
                ctx.font = '600 13px ' + R.fonts.display;
                ctx.fillStyle = pal.text;
                ctx.fillText('$82.00', 172, 86 + rise(4));
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.fillStyle = pal.faint;
                ctx.fillText('3 items', 172, 106 + rise(4));
                ctx.globalAlpha = base * block(5);
                ctx.fillStyle = BRAND;
                R.roundRect(ctx, 12, 146 + rise(5), 140, 24, 6);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.font = '500 12px ' + R.fonts.display;
                ctx.fillText('Pay $82.00', 82, 158.5 + rise(5));
                ctx.textAlign = 'left';
            } else {
                for (let i = 0; i < ITEMS.length; i++) {
                    ctx.globalAlpha = base * block(2 + i);
                    const iy = 60 + i * 24 + rise(2 + i);
                    ctx.fillStyle = ITEMS[i].tint;
                    R.roundRect(ctx, 12, iy - 8, 16, 16, 3);
                    ctx.fill();
                    ctx.font = '400 12px ' + R.fonts.display;
                    ctx.fillStyle = pal.text;
                    ctx.textAlign = 'left';
                    ctx.fillText(ITEMS[i].name, 36, iy + 0.5);
                    ctx.textAlign = 'right';
                    ctx.fillStyle = pal.muted;
                    ctx.fillText(ITEMS[i].price, width - 12, iy + 0.5);
                }
                ctx.globalAlpha = base * block(5);
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fillRect(12, 131, width - 24, 1);
                const sy = 144 + rise(5);
                ctx.font = '400 12px ' + R.fonts.display;
                ctx.textAlign = 'left';
                ctx.fillStyle = pal.muted;
                ctx.fillText('Discount', 12, sy);
                ctx.textAlign = 'right';
                ctx.fillText('-$10.00', width - 12, sy);
                ctx.globalAlpha = base * block(6);
                ctx.textAlign = 'left';
                ctx.font = '600 12px ' + R.fonts.display;
                ctx.fillStyle = pal.text;
                ctx.fillText('Total', 12, 166 + rise(6));
                ctx.textAlign = 'right';
                ctx.fillStyle = PAGES[kind].totalColor;
                ctx.fillText(PAGES[kind].total, width - 12, 166 + rise(6));
                ctx.textAlign = 'left';
            }
            ctx.globalAlpha = base;
        };

        const pageAt = (t) => {
            // Which page the browser shows and how far it has built.
            if (t >= RESET) {
                return { kind: 'fixed', reveal: 1, alpha: 1 - ease.inOutSine(phase(t, RESET, 0.6)) };
            }
            for (let i = VISITS.length - 1; i >= 0; i--) {
                const visit = VISITS[i];
                if (t >= visit.load + 0.15) {
                    const leaving = i + 1 < VISITS.length ? 1 - phase(t, (VISITS[i + 1].load || 0) - 0.02, 0.15) : 1;
                    return { kind: visit.page, reveal: phase(t, visit.load + 0.15, 0.95), alpha: leaving };
                }
            }
            return null;
        };

        const urlAt = (t) => {
            const first = VISITS[0];
            const second = VISITS[1];
            if (t >= RESET) {
                return { text: HOST + '/cart', alpha: 1 - phase(t, RESET, 0.5), caret: false };
            }
            if (t >= VISITS[2].back) {
                return { text: HOST + '/cart', alpha: ease.outCubic(phase(t, VISITS[2].back, 0.25)), caret: false, swap: 1 - phase(t, VISITS[2].back, 0.25), from: HOST + '/checkout' };
            }
            if (t >= second.type) {
                const select = phase(t, second.type, 0.25);
                const typed = '/checkout'.slice(0, R.clamp(Math.floor((t - second.type - 0.3) / 0.065) + 1, 0, 9));
                if (t < second.type + 0.3) {
                    return { text: HOST + '/cart', alpha: 1, caret: false, select };
                }
                return { text: HOST + typed, alpha: 1, caret: t < second.load };
            }
            if (t >= first.type) {
                const full = HOST + '/cart';
                const count = R.clamp(Math.floor((t - first.type) / 0.07) + 1, 0, full.length);
                return { text: full.slice(0, count), alpha: 1, caret: t < first.load };
            }
            return { text: '', alpha: 1, caret: true };
        };

        const icon = (x, y, name, alpha) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.strokeStyle = R.rgba(pal.muted, alpha);
            ctx.lineWidth = 1.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (name === 'back' || name === 'forward') {
                const dir = name === 'back' ? 1 : -1;
                ctx.moveTo(5 * dir, 0);
                ctx.lineTo(-5 * dir, 0);
                ctx.moveTo(-1 * dir, -4);
                ctx.lineTo(-5 * dir, 0);
                ctx.lineTo(-1 * dir, 4);
            } else if (name === 'reload') {
                ctx.arc(0, 0, 4.5, -Math.PI * 0.35, Math.PI * 1.45);
                ctx.moveTo(4.2, -5.5);
                ctx.lineTo(3.4, -1.6);
                ctx.lineTo(7, -2.4);
            } else if (name === 'globe') {
                ctx.arc(0, 0, 5.5, 0, R.TAU);
                ctx.moveTo(-5.5, 0);
                ctx.lineTo(5.5, 0);
                ctx.moveTo(0, -5.5);
                ctx.bezierCurveTo(-3.5, -2, -3.5, 2, 0, 5.5);
                ctx.moveTo(0, -5.5);
                ctx.bezierCurveTo(3.5, -2, 3.5, 2, 0, 5.5);
            } else if (name === 'lock') {
                ctx.rect(-3.5, -1, 7, 5.5);
                ctx.moveTo(-2, -1);
                ctx.arc(0, -2.5, 2, Math.PI, 0);
                ctx.lineTo(2, -1);
            }
            ctx.stroke();
            ctx.restore();
        };

        const nodeFrame = (box, selected) => {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            R.roundRect(ctx, box.x, box.y + 3, box.w, box.h, 11);
            ctx.fill();
            ctx.fillStyle = pal.surface;
            R.roundRect(ctx, box.x, box.y, box.w, box.h, 11);
            ctx.fill();
            ctx.save();
            ctx.clip();
            ctx.fillStyle = pal.raised;
            ctx.fillRect(box.x, box.y, box.w, 28);
            ctx.fillStyle = pal.border;
            ctx.fillRect(box.x, box.y + 28, box.w, 1);
            ctx.restore();
            return () => {
                ctx.strokeStyle = pal.border;
                ctx.lineWidth = 1;
                R.roundRect(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 11);
                ctx.stroke();
                if (selected > 0.01) {
                    ctx.strokeStyle = R.rgba(pal.accent, selected);
                    ctx.lineWidth = 2;
                    R.roundRect(ctx, box.x - 1, box.y - 1, box.w + 2, box.h + 2, 12);
                    ctx.stroke();
                }
            };
        };

        const statusPill = (right, y, status, t) => {
            const label = status > 0.5 ? 'Idle' : 'Running';
            ctx.font = '400 12px ' + R.fonts.display;
            const width = ctx.measureText(label).width + 22;
            ctx.fillStyle = pal.sunken;
            R.roundRect(ctx, right - width, y - 8.5, width, 17, 8.5);
            ctx.fill();
            const pulse = status > 0.5 ? 1 : 0.6 + 0.4 * Math.cos((t / 2) * R.TAU);
            ctx.fillStyle = R.mix(pal.running, pal.idle, status, pulse);
            ctx.beginPath();
            ctx.arc(right - width + 9, y, 3, 0, R.TAU);
            ctx.fill();
            ctx.fillStyle = pal.muted;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, right - width + 17, y + 0.5);
        };

        const drawBrowser = (t, selected) => {
            const box = BROWSER;
            const finish = nodeFrame(box, selected);
            icon(box.x + 16, box.y + 14, 'globe', 1);
            ctx.font = '500 12px ' + R.fonts.display;
            ctx.fillStyle = pal.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Browser', box.x + 30, box.y + 14.5);

            const barY = box.y + 29;
            ctx.fillStyle = pal.raised;
            ctx.fillRect(box.x, barY, box.w, 32);
            ctx.fillStyle = pal.border;
            ctx.fillRect(box.x, barY + 32, box.w, 1);
            const backPress = phase(t, VISITS[2].back - 0.15, 0.4);
            if (backPress > 0 && backPress < 1) {
                ctx.fillStyle = R.rgba('#ffffff', 0.1 * Math.sin(Math.PI * backPress));
                R.roundRect(ctx, box.x + 5, barY + 5, 22, 22, 6);
                ctx.fill();
            }
            icon(box.x + 16, barY + 16, 'back', 1);
            icon(box.x + 38, barY + 16, 'forward', 0.5);
            icon(box.x + 60, barY + 16, 'reload', 1);
            const fx = box.x + 76;
            const fw = box.w - 84;
            ctx.fillStyle = pal.sunken;
            R.roundRect(ctx, fx, barY + 5, fw, 22, 6);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            ctx.stroke();
            icon(fx + 11, barY + 16, 'lock', 0.8);
            const url = urlAt(t);
            ctx.font = '400 12px ' + R.fonts.display;
            ctx.textAlign = 'left';
            const tx = fx + 21;
            if (url.select !== undefined) {
                const hostWidth = ctx.measureText(HOST).width;
                const pathWidth = ctx.measureText('/cart').width;
                ctx.fillStyle = R.rgba(pal.accent, 0.45 * url.select);
                ctx.fillRect(tx + hostWidth, barY + 9, pathWidth * url.select, 14);
            }
            if (url.from && url.swap > 0) {
                ctx.fillStyle = R.rgba(pal.text, url.swap);
                ctx.fillText(url.from, tx, barY + 16.5 - (1 - url.swap) * 4);
            }
            ctx.fillStyle = R.rgba(pal.text, url.alpha);
            const hostPart = url.text.slice(0, HOST.length);
            ctx.fillText(hostPart, tx, barY + 16.5 + (url.swap ? url.swap * 4 : 0));
            ctx.fillStyle = R.rgba(pal.muted, url.alpha);
            ctx.fillText(url.text.slice(HOST.length), tx + ctx.measureText(hostPart).width, barY + 16.5 + (url.swap ? url.swap * 4 : 0));
            if (url.caret && R.fract(t * 1.6) < 0.6) {
                ctx.fillStyle = pal.text;
                ctx.fillRect(tx + ctx.measureText(url.text).width + 1, barY + 10, 1.2, 13);
            }
            for (const visit of VISITS) {
                const load = phase(t, visit.load, 0.9);
                if (load > 0 && load < 1) {
                    const fade = 1 - phase(t, visit.load + 0.75, 0.15);
                    ctx.fillStyle = R.rgba(pal.accent, 0.16 * fade);
                    ctx.fillRect(box.x, barY + 30, box.w, 2);
                    ctx.fillStyle = R.rgba(pal.accent, fade);
                    const sweep = ease.inOutSine(R.fract(load * 1.4));
                    const from = Math.max(box.x, box.x + box.w * 1.33 * sweep - box.w * 0.33);
                    const to = Math.min(box.x + box.w, box.x + box.w * 1.33 * sweep);
                    if (to > from) {
                        ctx.fillRect(from, barY + 30, to - from, 2);
                    }
                }
            }

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(PAGE.x, PAGE.y);
            ctx.lineTo(PAGE.x + PAGE.w, PAGE.y);
            ctx.arcTo(PAGE.x + PAGE.w, PAGE.y + PAGE.h, PAGE.x, PAGE.y + PAGE.h, 11);
            ctx.arcTo(PAGE.x, PAGE.y + PAGE.h, PAGE.x, PAGE.y, 11);
            ctx.closePath();
            ctx.clip();
            const page = pageAt(t);
            if (page && page.alpha > 0) {
                ctx.save();
                ctx.translate(PAGE.x, PAGE.y);
                drawPageFaded(page.kind, page.reveal, page.alpha);
                ctx.restore();
            }
            drawShutter(t);
            ctx.restore();
            finish();
        };

        const drawPageFaded = (kind, reveal, alpha) => {
            if (alpha >= 0.999) {
                drawPage(kind, reveal);
                return;
            }
            // Fading a whole page: shrink its reveal instead of stacking alphas, so blocks leave in order.
            drawPage(kind, reveal * alpha);
        };

        const drawShutter = (t) => {
            for (const visit of VISITS) {
                const local = t - visit.shot;
                if (local < -0.2 || local > 0.6) {
                    continue;
                }
                // Brackets breathe out, then snap in: the anticipation before the picture is taken.
                const out = ease.outCubic(phase(local, -0.2, 0.18));
                const snap = ease.inCubic(phase(local, -0.02, 0.14));
                const gone = 1 - phase(local, 0.25, 0.3);
                const inset = 10 - out * 5 + snap * 9;
                const arm = 16;
                ctx.strokeStyle = R.rgba('#ffffff', 0.85 * out * gone);
                ctx.lineWidth = 2;
                ctx.lineCap = 'round';
                const x0 = PAGE.x + inset;
                const y0 = PAGE.y + inset;
                const x1 = PAGE.x + PAGE.w - inset;
                const y1 = PAGE.y + PAGE.h - inset;
                ctx.beginPath();
                ctx.moveTo(x0, y0 + arm);
                ctx.lineTo(x0, y0);
                ctx.lineTo(x0 + arm, y0);
                ctx.moveTo(x1 - arm, y0);
                ctx.lineTo(x1, y0);
                ctx.lineTo(x1, y0 + arm);
                ctx.moveTo(x1, y1 - arm);
                ctx.lineTo(x1, y1);
                ctx.lineTo(x1 - arm, y1);
                ctx.moveTo(x0 + arm, y1);
                ctx.lineTo(x0, y1);
                ctx.lineTo(x0, y1 - arm);
                ctx.stroke();
                const flash = local > 0.12 ? 1 - ease.outCubic(phase(local, 0.12, 0.35)) : 0;
                if (flash > 0) {
                    ctx.fillStyle = R.rgba('#ffffff', 0.28 * flash);
                    ctx.fillRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h);
                }
            }
        };

        const drawThumb = (kind, x, y, width, alpha, tilt, lift) => {
            const scale = width / PAGE.w;
            const height = PAGE.h * scale;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(x + width / 2, y + height / 2);
            ctx.rotate(tilt);
            ctx.fillStyle = 'rgba(0,0,0,' + (0.3 + lift * 0.2).toFixed(3) + ')';
            R.roundRect(ctx, -width / 2 + lift * 4, -height / 2 + 3 + lift * 10, width, height, 7);
            ctx.fill();
            ctx.translate(-width / 2, -height / 2);
            R.roundRect(ctx, 0, 0, width, height, 7);
            ctx.fillStyle = pal.surface;
            ctx.fill();
            ctx.save();
            ctx.clip();
            ctx.scale(scale, scale);
            drawPage(kind, 1);
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,0.13)';
            ctx.lineWidth = 1;
            R.roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 7);
            ctx.stroke();
            ctx.restore();
        };

        // The route `edge-route.ts` draws: out of the facing sides, a stub, one rail, corners rounded.
        const START = { x: BROWSER.x + BROWSER.w + 9, y: BROWSER.y + BROWSER.h / 2 };
        const END = { x: CHAT.x - 9, y: CHAT.y + CHAT.h / 2 };
        const RAIL = (START.x + END.x) / 2;
        const routePath = () => {
            const corner = Math.min(15, Math.abs(END.y - START.y) / 2);
            const down = Math.sign(END.y - START.y) || 1;
            ctx.beginPath();
            ctx.moveTo(START.x, START.y);
            ctx.lineTo(RAIL - corner, START.y);
            ctx.quadraticCurveTo(RAIL, START.y, RAIL, START.y + corner * down);
            ctx.lineTo(RAIL, END.y - corner * down);
            ctx.quadraticCurveTo(RAIL, END.y, RAIL + corner, END.y);
            ctx.lineTo(END.x, END.y);
        };
        const drawEdge = (active, pulseAt) => {
            routePath();
            ctx.strokeStyle = active > 0.01 ? R.mix(pal.bg, pal.accent, R.lerp(0.55, 1, active)) : EDGE;
            ctx.lineWidth = 2 + active;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.fillStyle = pal.bg;
            ctx.beginPath();
            ctx.arc(END.x, END.y, 5, 0, R.TAU);
            ctx.fill();
            ctx.stroke();
            if (pulseAt > 0 && pulseAt < 1) {
                // A spark rides the edge while the picture flies over it: two motions telling one transfer.
                const lenA = RAIL - START.x;
                const lenB = Math.abs(END.y - START.y);
                const lenC = END.x - RAIL;
                let along = pulseAt * (lenA + lenB + lenC);
                let px;
                let py;
                if (along < lenA) {
                    px = START.x + along;
                    py = START.y;
                } else if ((along -= lenA) < lenB) {
                    px = RAIL;
                    py = START.y + along * Math.sign(END.y - START.y);
                } else {
                    px = RAIL + (along - lenB);
                    py = END.y;
                }
                ctx.fillStyle = R.rgba(pal.running, 0.25);
                ctx.beginPath();
                ctx.arc(px, py, 7, 0, R.TAU);
                ctx.fill();
                ctx.fillStyle = pal.running;
                ctx.beginPath();
                ctx.arc(px, py, 3, 0, R.TAU);
                ctx.fill();
            }
        };

        const layout = (t, out) => {
            let total = 0;
            for (let i = 0; i < ENTRIES.length; i++) {
                const grow = ease.inOutCubic(phase(t, ENTRIES[i].at, 0.4));
                out[i] = total;
                total += heightOf(ENTRIES[i]) * grow;
            }
            return total;
        };
        const offsets = new Array(ENTRIES.length).fill(0);
        const BODY_TOP = CHAT.y + 29;
        const BODY_H = CHAT.h - 29;

        const drawChat = (t, selected, gone) => {
            const box = CHAT;
            const finish = nodeFrame(box, selected);
            ctx.save();
            ctx.translate(box.x + 9, box.y + 8);
            ctx.scale(12 / 24, 12 / 24);
            ctx.fillStyle = pal.muted;
            ctx.fill(CLAUDE);
            ctx.restore();
            ctx.font = '500 12px ' + R.fonts.display;
            ctx.fillStyle = pal.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('cart bug', box.x + 28, box.y + 14.5);
            const idle = ease.inOutSine(phase(t, 15.4, 0.4)) * (1 - ease.inOutSine(phase(t, 17.4, 0.4)));
            statusPill(box.x + box.w - 7, box.y + 14, idle, t);

            const total = layout(t, offsets);
            const scroll = Math.max(0, total - BODY_H + 14);
            ctx.save();
            ctx.beginPath();
            ctx.rect(box.x, BODY_TOP, box.w, BODY_H - 2);
            ctx.clip();
            let target = null;
            for (let i = 0; i < ENTRIES.length; i++) {
                const entry = ENTRIES[i];
                const shown = ease.outCubic(phase(t, entry.at + 0.1, 0.35)) * gone;
                const ey = BODY_TOP + 10 + offsets[i] - scroll;
                if (entry.kind === 'picture') {
                    const visit = VISITS[entry.visit];
                    const land = visit.shot + SHOT_LEAD + FLIGHT;
                    if (t < land) {
                        if (t > land - FLIGHT - 0.05) {
                            target = { x: box.x + 12, y: ey, kind: visit.page };
                        }
                        continue;
                    }
                    // Lands with a small settle, the follow through of the flight.
                    const settle = phase(t, land, 0.35);
                    const squash = settle < 1 ? 1 + Math.sin(settle * Math.PI) * 0.035 * (1 - settle) : 1;
                    const width = THUMB_W * squash;
                    drawThumb(visit.page, box.x + 12 - (width - THUMB_W) / 2, ey, width, gone, 0, 0);
                    continue;
                }
                if (shown <= 0.01 || ey > BODY_TOP + BODY_H || ey < BODY_TOP - 40) {
                    continue;
                }
                ctx.globalAlpha = shown;
                const rise = (1 - shown) * 6;
                if (entry.kind === 'tool') {
                    const live = t >= entry.live[0] && t < entry.live[1];
                    ctx.font = '400 12px ' + R.fonts.display;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    const vx = box.x + 28;
                    const vy = ey + 8 + rise;
                    ctx.strokeStyle = live ? pal.accent : pal.muted;
                    ctx.lineWidth = 1.2;
                    if (entry.verb === 'Edit') {
                        R.roundRect(ctx, box.x + 12, vy - 5, 10, 10, 2);
                        ctx.stroke();
                    } else {
                        ctx.save();
                        ctx.translate(box.x + 17, vy);
                        ctx.scale(0.85, 0.85);
                        ctx.beginPath();
                        ctx.arc(0, 0, 5.5, 0, R.TAU);
                        ctx.moveTo(-5.5, 0);
                        ctx.lineTo(5.5, 0);
                        ctx.moveTo(0, -5.5);
                        ctx.bezierCurveTo(-3.5, -2, -3.5, 2, 0, 5.5);
                        ctx.moveTo(0, -5.5);
                        ctx.bezierCurveTo(3.5, -2, 3.5, 2, 0, 5.5);
                        ctx.restore();
                        ctx.stroke();
                    }
                    const verbWidth = ctx.measureText(entry.verb).width;
                    if (live) {
                        const band = vx + verbWidth * (1.3 - 1.6 * R.fract(t / 1.6));
                        const gradient = ctx.createLinearGradient(band - 18, 0, band + 18, 0);
                        gradient.addColorStop(0, pal.muted);
                        gradient.addColorStop(0.5, pal.text);
                        gradient.addColorStop(1, pal.muted);
                        ctx.fillStyle = gradient;
                    } else {
                        ctx.fillStyle = pal.muted;
                    }
                    ctx.fillText(entry.verb, vx, vy + 0.5);
                    ctx.font = '400 12px ' + R.fonts.mono;
                    ctx.fillStyle = pal.faint;
                    const detail = entry.detail.length > 16 ? entry.detail.slice(0, 15) + '…' : entry.detail;
                    ctx.fillText(detail, vx + verbWidth + 6, vy + 0.5);
                    if (entry.diff) {
                        const dx = vx + verbWidth + 6 + ctx.measureText(detail).width + 6;
                        ctx.fillStyle = pal.green;
                        ctx.fillText('+3', dx, vy + 0.5);
                        ctx.fillStyle = pal.red;
                        ctx.fillText('-1', dx + 20, vy + 0.5);
                    }
                } else {
                    ctx.font = '400 12px ' + R.fonts.display;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    let word = 0;
                    for (let line = 0; line < entry.lines.length; line++) {
                        let lx = box.x + 12;
                        const parts = entry.lines[line].split(' ');
                        for (const part of parts) {
                            // Words stream in a few at a time, each rising into place.
                            const born = phase(t, entry.at + 0.12 + word * 0.075, 0.22);
                            if (born > 0) {
                                ctx.globalAlpha = born * gone;
                                ctx.fillStyle = born < 1 ? R.mix(pal.muted, pal.text, born) : pal.text;
                                ctx.fillText(part, lx, ey + 8 + line * 17 + (1 - ease.outCubic(born)) * 4);
                            }
                            lx += ctx.measureText(part + ' ').width;
                            word++;
                        }
                    }
                }
                ctx.globalAlpha = 1;
            }
            // The thread scrolls under a soft top edge instead of being cut by the header.
            const veil = ctx.createLinearGradient(0, BODY_TOP, 0, BODY_TOP + 16);
            veil.addColorStop(0, R.rgba(pal.surface, 1));
            veil.addColorStop(1, R.rgba(pal.surface, 0));
            ctx.fillStyle = veil;
            ctx.fillRect(box.x, BODY_TOP, box.w, 16);
            ctx.restore();
            finish();
            return target;
        };

        const drawFlight = (t, target) => {
            for (const visit of VISITS) {
                const start = visit.shot + SHOT_LEAD;
                const k = phase(t, start, FLIGHT);
                if (k <= 0 || k >= 1 || !target) {
                    continue;
                }
                const eased = ease.inOutCubic(k);
                const width = R.lerp(PAGE.w, THUMB_W, ease.inOutQuart(Math.min(1, k * 1.15)));
                const height = (width * PAGE.h) / PAGE.w;
                const fromX = PAGE.x + PAGE.w / 2;
                const fromY = PAGE.y + PAGE.h / 2;
                const toX = target.x + THUMB_W / 2;
                const toY = target.y + THUMB_H / 2;
                // The picture arcs up and over the edge, not along it.
                const ctrlX = (fromX + toX) / 2 + 20;
                const ctrlY = Math.min(fromY, toY) - 120;
                const rest = 1 - eased;
                const cx = rest * rest * fromX + 2 * rest * eased * ctrlX + eased * eased * toX;
                const cy = rest * rest * fromY + 2 * rest * eased * ctrlY + eased * eased * toY;
                const lift = Math.sin(Math.PI * k);
                drawThumb(visit.page, cx - width / 2, cy - height / 2, width, R.clamp(k * 6), -0.07 * lift, lift);
            }
        };

        return {
            draw(time) {
                const t = R.mod(time, CYCLE);
                env.clear();
                const pointer = env.pointer;
                const inside = (box) => (pointer.x > box.x && pointer.x < box.x + box.w && pointer.y > box.y && pointer.y < box.y + box.h ? 1 : 0);
                const selBrowser = inside(BROWSER) * pointer.active;
                const selChat = inside(CHAT) * pointer.active;
                const gone = 1 - ease.inOutSine(phase(t, RESET, 0.6));

                let pulse = 0;
                let active = 0;
                for (const visit of VISITS) {
                    const k = phase(t, visit.shot + SHOT_LEAD, FLIGHT);
                    if (k > 0 && k < 1) {
                        pulse = ease.inOutCubic(k);
                    }
                    active = Math.max(active, Math.sin(Math.PI * phase(t, visit.shot + SHOT_LEAD - 0.1, FLIGHT + 0.3)));
                }
                active = Math.max(active, Math.max(selBrowser, selChat) * 0.6);
                drawEdge(active, pulse);
                drawBrowser(t, selBrowser);
                const target = drawChat(t, selChat, gone);
                drawFlight(t, target);
                env.fadeEdges(0.76, 1.05);
            }
        };
    }
});
