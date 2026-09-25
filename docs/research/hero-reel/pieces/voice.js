Reel.add({
    id: 'voice',
    title: 'Say It',
    line: 'Say what you want. It becomes a draft you can read before it goes anywhere.',
    principles: ['Timing', 'Appeal'],
    tech: 'Canvas 2D, waveform to text',
    hint: 'Move over the waveform to speak up',
    poster: 3.75,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;
        const TAU = R.TAU;
        const ease = R.ease;
        const SANS = R.fonts.sans;
        const MONO = R.fonts.mono;

        const CLAUDE = new Path2D(
            'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
        );

        const CYCLE = 14;
        const MIC_ON = 0.6;
        const STOP = 6.7;
        const FOLD = 6.8;
        const SOLID = 7.45;
        const OPEN = 7.8;
        const FLY = 8.0;
        const PASTE = 10.4;
        const LAND = 10.5;
        const CLOSE = 11.0;
        const CLEAR = 13.0;

        const CAP = { x: 100, y: 110, w: 360, h: 52 };
        const BARS = 35;
        const BAR_X = 164;
        const BAR_STEP = 6;
        const BAR_MAX = 34;
        const TERM = { x: 90, y: 250, w: 380, h: 186 };
        const HEAD = 28;
        const FOOT = 78;
        const PREVIEW = { x: 106, y: 206, w: 400, size: 16, lead: 24 };
        const DRAFT = { x: TERM.x + 22, y: TERM.y + TERM.h - FOOT + 23, size: 13 };
        const PROMPT = { x: TERM.x + 26, y: TERM.y + HEAD + 76 };

        // What the recognizer believes, over time: it guesses, then corrects itself as more audio arrives.
        const HYPOTHESES = [
            { at: 1.35, text: 'Run' },
            { at: 1.7, text: 'Run the' },
            { at: 2.15, text: 'Run the test' },
            { at: 2.55, text: 'Run the tests for' },
            { at: 2.95, text: 'Run the tests for cards' },
            { at: 3.5, text: 'Run the tests for carts' },
            { at: 3.95, text: 'Run the tests for carts and' },
            { at: 4.45, text: 'Run the tests for carts and fix the' },
            { at: 4.95, text: 'Run the tests for carts and fix the fail in' },
            { at: 5.6, text: 'Run the tests for carts and fix the failing one.' }
        ];
        const SYLLABLES = [1.05, 1.28, 1.52, 1.86, 2.06, 2.32, 2.62, 2.8, 3.12, 3.36, 3.72, 3.98, 4.24, 4.44, 4.66, 4.88, 5.08, 5.3, 5.52];
        const FINAL = HYPOTHESES[HYPOTHESES.length - 1];

        let measured = -1;
        let charW = 6.9;
        const layout = () => {
            ctx.font = '400 ' + PREVIEW.size + 'px ' + SANS;
            const probe = ctx.measureText('Run the tests').width;
            if (probe === measured) {
                return;
            }
            measured = probe;
            const space = ctx.measureText(' ').width;
            for (const hyp of HYPOTHESES) {
                hyp.words = hyp.text.split(' ');
                hyp.pos = [];
                let x = 0;
                let row = 0;
                for (const word of hyp.words) {
                    const wordWidth = ctx.measureText(word).width;
                    if (x > 0 && x + wordWidth > PREVIEW.w) {
                        x = 0;
                        row++;
                    }
                    hyp.pos.push({ x: PREVIEW.x + x, y: PREVIEW.y + row * PREVIEW.lead, w: wordWidth });
                    x += wordWidth + space;
                }
            }
            ctx.font = '400 ' + DRAFT.size + 'px ' + SANS;
            const draftSpace = ctx.measureText(' ').width;
            let x = 0;
            FINAL.draft = FINAL.words.map((word) => {
                const at = { x: DRAFT.x + x, y: DRAFT.y };
                x += ctx.measureText(word).width + draftSpace;
                return at;
            });
            FINAL.draftW = x - draftSpace;
            ctx.font = '400 11.5px ' + MONO;
            charW = ctx.measureText('0000000000').width / 10;
            let col = 2;
            FINAL.prompt = FINAL.words.map((word) => {
                const at = { x: PROMPT.x + col * charW, y: PROMPT.y };
                col += word.length + 1;
                return at;
            });
            FINAL.promptEnd = PROMPT.x + (col - 1) * charW;
        };

        /* The loudness of the voice at time t: a soft bump per syllable, then silence. */
        const envelope = (t) => {
            let sum = 0;
            for (let i = 0; i < SYLLABLES.length; i++) {
                const offset = (t - SYLLABLES[i]) / 0.1;
                if (offset > -3 && offset < 3) {
                    sum += Math.exp(-offset * offset) * (0.75 + 0.35 * R.hash(i * 3.7));
                }
            }
            return Math.min(1, sum);
        };
        const listening = (t) => ease.inOutSine((t - MIC_ON) / 0.3) * (1 - ease.inOutSine((t - STOP) / 0.2));

        const barHeight = (i, t, pointer) => {
            const center = (BARS - 1) / 2;
            const window = 1 - Math.pow(Math.abs(i - center) / center, 2) * 0.55;
            const grain = 0.35 + 0.65 * Math.abs(R.noise(i * 0.42, t * 4.2, 0.5));
            let level = envelope(t) * grain * window;
            // A voice in the room never quite reaches zero while the microphone is open.
            level += (0.05 + 0.04 * Math.abs(R.noise(i * 0.9, t * 7))) * listening(t);
            if (pointer.active > 0.01) {
                const bx = BAR_X + i * BAR_STEP;
                const near = Math.exp(-Math.pow((pointer.x - bx) / 40, 2)) * (1 - R.smoothstep(30, 90, Math.abs(pointer.y - (CAP.y + CAP.h / 2))));
                level += near * pointer.active * (0.45 + 0.3 * Math.abs(R.noise(i * 0.5, t * 6, 3)));
            }
            return R.clamp(level) * listening(t);
        };

        const line = (x1, y1, x2, y2) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };
        const mic = (x, y, color, size) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(size, size);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            R.roundRect(ctx, -3, -7, 6, 10, 3);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, -1, 6, 0.1 * Math.PI, 0.9 * Math.PI);
            ctx.stroke();
            line(0, 5, 0, 7.5);
            ctx.restore();
        };
        const iconAt = (kind, x, y, color) => {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (kind === 'claude') {
                ctx.translate(x - 6.5, y - 6.5);
                ctx.scale(13 / 24, 13 / 24);
                ctx.fill(CLAUDE);
            } else if (kind === 'close') {
                line(x - 3.5, y - 3.5, x + 3.5, y + 3.5);
                line(x + 3.5, y - 3.5, x - 3.5, y + 3.5);
            } else if (kind === 'lock') {
                R.roundRect(ctx, x - 4, y - 1, 8, 6.5, 1.5);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y - 1.5, 2.6, Math.PI, 0);
                ctx.stroke();
            }
            ctx.restore();
        };

        const drawCapsule = (t, pointer) => {
            const on = listening(t);
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = 18;
            ctx.shadowOffsetY = 6;
            R.roundRect(ctx, CAP.x, CAP.y, CAP.w, CAP.h, CAP.h / 2);
            ctx.fillStyle = pal.raised;
            ctx.fill();
            ctx.restore();
            R.roundRect(ctx, CAP.x + 0.5, CAP.y + 0.5, CAP.w - 1, CAP.h - 1, CAP.h / 2 - 0.5);
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            const cy = CAP.y + CAP.h / 2;
            const bx = CAP.x + 28;
            // Appeal lives in the press: the button gives under the finger and comes back a hair too far.
            const pressAt = (at) => {
                const progress = (t - at + 0.1) / 0.45;
                if (progress <= 0 || progress >= 1) {
                    return 0;
                }
                return progress < 0.3 ? ease.outQuad(progress / 0.3) : -0.35 * Math.sin(((progress - 0.3) / 0.7) * Math.PI) * (1 - (progress - 0.3) / 0.7);
            };
            const press = pressAt(MIC_ON) + pressAt(STOP);
            const scale = 1 - 0.14 * press;
            if (on > 0.01) {
                const ring = R.fract((t - MIC_ON) / 1.6);
                ctx.strokeStyle = 'rgba(21,93,252,' + (0.45 * (1 - ring) * on).toFixed(3) + ')';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(bx, cy, 16 + ring * 10, 0, TAU);
                ctx.stroke();
            }
            ctx.save();
            ctx.translate(bx, cy);
            ctx.scale(scale, scale);
            ctx.fillStyle = R.mix(pal.hover, pal.accent, on, 1);
            ctx.beginPath();
            ctx.arc(0, 0, 16, 0, TAU);
            ctx.fill();
            mic(0, 0, on > 0.5 ? '#ffffff' : pal.muted, 1.05);
            ctx.restore();

            for (let i = 0; i < BARS; i++) {
                const center = (BARS - 1) / 2;
                const x = BAR_X + i * BAR_STEP;
                // The fold: bars collapse from the ends inward, overlapping, and drop into the line of text.
                const lag = (Math.abs(i - center) / center) * 0.25;
                const fold = ease.inOutCubic((t - FOLD - (0.25 - lag)) / 0.4);
                const height = Math.max(2.5, barHeight(i, t, pointer) * BAR_MAX);
                if (fold <= 0) {
                    ctx.fillStyle = height > 3 ? R.mix(pal.accent, pal.running, R.clamp((height - 3) / BAR_MAX), 1) : 'rgba(236,236,241,0.2)';
                    R.roundRect(ctx, x - 1.5, cy - height / 2, 3, height, 1.5);
                    ctx.fill();
                    continue;
                }
                const target = FINAL.pos && FINAL.pos.length ? FINAL.pos : null;
                if (!target || fold >= 1) {
                    continue;
                }
                const lineY = PREVIEW.y + (FINAL.rows - 1) * PREVIEW.lead + 13;
                const tx = PREVIEW.x + (i / (BARS - 1)) * FINAL.rowW;
                const px = R.lerp(x, tx, fold);
                const py = R.lerp(cy, lineY, fold) - Math.sin(Math.PI * fold) * 16;
                ctx.globalAlpha = 1 - R.smoothstep(0.75, 1, fold) * 0.6;
                ctx.fillStyle = pal.running;
                const dh = R.lerp(Math.max(3, height), 2, R.clamp(fold * 2.5));
                R.roundRect(ctx, px - 1.5, py - dh / 2, 3, dh, 1.5);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            // The line the bars became, under the text, which then goes out as the text turns solid.
            const underline = R.clamp((t - FOLD - 0.55) / 0.12) * (1 - ease.inOutSine((t - SOLID) / 0.45));
            if (underline > 0 && FINAL.rowW) {
                ctx.fillStyle = 'rgba(96,165,250,' + (0.7 * underline).toFixed(3) + ')';
                const lineY = PREVIEW.y + (FINAL.rows - 1) * PREVIEW.lead + 13;
                ctx.fillRect(PREVIEW.x, lineY - 0.75, FINAL.rowW, 1.5);
            }

            ctx.font = '400 11.5px ' + SANS;
            ctx.textBaseline = 'middle';
            const status = t >= MIC_ON && t < STOP ? 'Listening' : t >= STOP && t < SOLID ? 'Finishing' : 'Ready';
            ctx.fillStyle = on > 0.5 ? pal.text : pal.muted;
            ctx.textAlign = 'right';
            ctx.fillText(status, CAP.x + CAP.w - 22, cy - 7);
            iconAt('lock', CAP.x + CAP.w - 82, cy + 7.5, pal.faint);
            ctx.fillStyle = pal.faint;
            ctx.font = '400 11px ' + SANS;
            ctx.fillText('On device', CAP.x + CAP.w - 22, cy + 8.5);
            ctx.textAlign = 'left';
        };

        const drawPreview = (t) => {
            if (t < HYPOTHESES[0].at || t > LAND + 0.8) {
                return;
            }
            ctx.textBaseline = 'middle';
            let k = -1;
            for (let i = 0; i < HYPOTHESES.length; i++) {
                if (HYPOTHESES[i].at <= t) {
                    k = i;
                }
            }
            const cur = HYPOTHESES[k];
            const prev = k > 0 ? HYPOTHESES[k - 1] : null;
            const frac = ease.outCubic((t - cur.at) / 0.3);
            const solid = ease.inOutSine((t - SOLID) / 0.4);
            for (let i = 0; i < cur.words.length; i++) {
                const word = cur.words[i];
                const to = cur.pos[i];
                const same = prev && prev.words[i] === word;
                let x = to.x;
                let y = to.y;
                let alpha = 1;
                let size = PREVIEW.size;
                let color = pal.muted;
                if (same) {
                    x = R.lerp(prev.pos[i].x, to.x, frac);
                    y = R.lerp(prev.pos[i].y, to.y, frac);
                } else {
                    // A corrected word rises into place while the guess it replaces rises out of it.
                    if (prev && prev.words[i] !== undefined) {
                        ctx.globalAlpha = 1 - frac;
                        ctx.font = '400 ' + PREVIEW.size + 'px ' + SANS;
                        ctx.fillStyle = pal.muted;
                        ctx.fillText(prev.words[i], prev.pos[i].x, prev.pos[i].y - frac * 9);
                    }
                    y += (1 - frac) * 9;
                    alpha = frac;
                    color = R.mix('#bcd4ff', pal.muted, R.clamp((t - cur.at) / 0.7), 1);
                }
                if (k === HYPOTHESES.length - 1) {
                    color = R.mix(pal.muted, pal.text, solid, 1);
                    // Into the draft: every word on its own arc, a few frames apart.
                    const fly = ease.inOutCubic((t - FLY - i * 0.018) / 0.6);
                    if (fly > 0 && FINAL.draft) {
                        const land = FINAL.draft[i];
                        x = R.lerp(to.x, land.x, fly);
                        y = R.lerp(to.y, land.y, fly) - Math.sin(Math.PI * fly) * 30;
                        size = R.lerp(PREVIEW.size, DRAFT.size, fly);
                    }
                    // Pasted: on to the prompt line, where it becomes terminal text.
                    const paste = ease.inOutCubic((t - LAND - i * 0.025) / 0.45);
                    if (paste > 0 && FINAL.prompt) {
                        const from = FINAL.draft[i];
                        const into = FINAL.prompt[i];
                        x = R.lerp(from.x, into.x, paste);
                        y = R.lerp(from.y, into.y, paste) - Math.sin(Math.PI * paste) * 14;
                        alpha = 1 - R.smoothstep(0.7, 1, paste);
                    }
                }
                ctx.globalAlpha = alpha;
                ctx.font = '400 ' + size.toFixed(2) + 'px ' + SANS;
                ctx.fillStyle = color;
                ctx.fillText(word, x, y);
            }
            if (prev) {
                for (let i = cur.words.length; i < prev.words.length; i++) {
                    ctx.globalAlpha = 1 - frac;
                    ctx.fillStyle = pal.muted;
                    ctx.fillText(prev.words[i], prev.pos[i].x, prev.pos[i].y - frac * 9);
                }
            }
            ctx.globalAlpha = 1;
        };

        const footerOpen = (t) => ease.inOutCubic((t - OPEN) / 0.4) * (1 - ease.inOutCubic((t - CLOSE) / 0.4));

        const drawTerminal = (t) => {
            const T = TERM;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 16;
            ctx.shadowOffsetY = 5;
            R.roundRect(ctx, T.x, T.y, T.w, T.h, 10);
            ctx.fillStyle = pal.termBg;
            ctx.fill();
            ctx.restore();
            ctx.save();
            R.roundRect(ctx, T.x, T.y, T.w, T.h, 10);
            ctx.clip();
            ctx.fillStyle = pal.raised;
            ctx.fillRect(T.x, T.y, T.w, HEAD);
            ctx.fillStyle = pal.border;
            ctx.fillRect(T.x, T.y + HEAD - 1, T.w, 1);

            ctx.font = '400 11.5px ' + MONO;
            ctx.textBaseline = 'middle';
            const bodyY = T.y + HEAD + 18;
            ctx.fillStyle = pal.green;
            ctx.fillText('●', T.x + 12, bodyY);
            ctx.fillStyle = pal.termFg;
            ctx.fillText('Updated cart.ts', T.x + 26, bodyY);
            ctx.fillStyle = pal.termDim;
            ctx.fillText('  Saved carts now last 30 days.', T.x + 12, bodyY + 18);
            ctx.fillText('  2 files changed, 12 tests pass', T.x + 12, bodyY + 36);

            // The prompt: the pasted draft waits here with its caret, and nobody presses Enter.
            const pasted = R.clamp((t - LAND - 0.35) / 0.2) * (1 - ease.inOutSine((t - CLEAR) / 0.4));
            ctx.fillStyle = pal.muted;
            ctx.fillText('>', PROMPT.x, PROMPT.y);
            let caretX = PROMPT.x + 2 * charW;
            if (pasted > 0 && FINAL.prompt) {
                ctx.globalAlpha = pasted;
                ctx.fillStyle = pal.termFg;
                FINAL.words.forEach((word, i) => {
                    ctx.fillText(word, FINAL.prompt[i].x, PROMPT.y);
                });
                ctx.globalAlpha = 1;
                caretX = t < CLEAR + 0.3 ? FINAL.promptEnd + 1 : caretX;
            }
            if (R.fract(t) < 0.55) {
                ctx.fillStyle = pal.termFg;
                ctx.fillRect(caretX, PROMPT.y - 7, 7, 14);
            }

            // The draft footer, as the terminal's dictation draws it: the text, Paste, Discard, and no Enter.
            const open = footerOpen(t);
            if (open > 0.001) {
                const fy = T.y + T.h - FOOT * open;
                ctx.fillStyle = pal.termBg;
                ctx.fillRect(T.x, fy, T.w, FOOT);
                ctx.fillStyle = pal.border;
                ctx.fillRect(T.x, fy, T.w, 1);
                ctx.save();
                ctx.translate(0, fy - (T.y + T.h - FOOT));
                const field = { x: T.x + 10, y: T.y + T.h - FOOT + 9, w: T.w - 20, h: 28 };
                R.roundRect(ctx, field.x, field.y, field.w, field.h, 7);
                ctx.fillStyle = pal.surface;
                ctx.fill();
                ctx.strokeStyle = t > FLY + 0.5 && t < PASTE ? 'rgba(21,93,252,0.8)' : pal.borderStrong;
                ctx.lineWidth = 1;
                ctx.stroke();
                const inField = t > FLY + 0.85 && t < LAND;
                if (inField && FINAL.draft) {
                    ctx.font = '400 ' + DRAFT.size + 'px ' + SANS;
                    ctx.fillStyle = pal.text;
                    FINAL.words.forEach((word, i) => {
                        ctx.fillText(word, FINAL.draft[i].x, DRAFT.y);
                    });
                    if (R.fract((t - FLY) * 1.0) < 0.55) {
                        ctx.fillRect(DRAFT.x + FINAL.draftW + 2, DRAFT.y - 7, 1.5, 14);
                    }
                }
                const by = T.y + T.h - 19;
                const pressed = Math.sin(Math.PI * R.clamp((t - PASTE + 0.1) / 0.3));
                ctx.font = '500 11.5px ' + SANS;
                ctx.globalAlpha = R.clamp((t - OPEN - 0.25) / 0.3);
                const pasteW = ctx.measureText('Paste into terminal').width + 18;
                ctx.save();
                ctx.translate(T.x + 10 + pasteW / 2, by);
                ctx.scale(1 - 0.05 * pressed, 1 - 0.05 * pressed);
                R.roundRect(ctx, -pasteW / 2, -11, pasteW, 22, 6);
                ctx.fillStyle = 'rgba(255,255,255,' + (0.04 + 0.08 * pressed).toFixed(3) + ')';
                ctx.fill();
                ctx.fillStyle = pressed > 0.2 ? pal.text : pal.muted;
                ctx.textAlign = 'center';
                ctx.fillText('Paste into terminal', 0, 0.5);
                ctx.restore();
                ctx.globalAlpha = R.clamp((t - OPEN - 0.33) / 0.3);
                const discardX = T.x + 16 + pasteW;
                const discardW = ctx.measureText('Discard').width + 18;
                R.roundRect(ctx, discardX, by - 11, discardW, 22, 6);
                ctx.fillStyle = pal.raised;
                ctx.fill();
                ctx.strokeStyle = pal.border;
                ctx.stroke();
                ctx.fillStyle = pal.text;
                ctx.fillText('Discard', discardX + 9, by + 0.5);
                ctx.globalAlpha = R.clamp((t - OPEN - 0.41) / 0.3);
                ctx.font = '400 11px ' + SANS;
                ctx.fillStyle = pal.muted;
                ctx.fillText('Pastes text without pressing Enter.', discardX + discardW + 10, by + 0.5);
                ctx.globalAlpha = 1;
                ctx.restore();
            }
            ctx.restore();

            R.roundRect(ctx, T.x + 0.5, T.y + 0.5, T.w - 1, T.h - 1, 9.5);
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            iconAt('claude', T.x + 14, T.y + HEAD / 2, pal.muted);
            ctx.font = '500 12px ' + SANS;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = pal.text;
            ctx.fillText('claude', T.x + 27, T.y + HEAD / 2 + 0.5);
            // The terminal's own dictation button, lit while it owns the microphone.
            const on = listening(t);
            const mx = T.x + T.w - 36;
            if (on > 0.01) {
                R.roundRect(ctx, mx - 10, T.y + 4, 20, 20, 5);
                ctx.fillStyle = 'rgba(21,93,252,' + (0.18 * on).toFixed(3) + ')';
                ctx.fill();
            }
            mic(mx, T.y + HEAD / 2 + 0.5, on > 0.5 ? '#3b82f6' : pal.muted, 0.72);
            iconAt('close', T.x + T.w - 14, T.y + HEAD / 2, pal.faint);
        };

        return {
            draw(time) {
                layout();
                if (FINAL.rows === undefined || FINAL.measured !== measured) {
                    FINAL.measured = measured;
                    FINAL.rows = FINAL.pos[FINAL.pos.length - 1].y === PREVIEW.y ? 1 : 2;
                    const last = FINAL.pos.filter((spot) => spot.y === FINAL.pos[FINAL.pos.length - 1].y);
                    FINAL.rowW = last[last.length - 1].x + last[last.length - 1].w - PREVIEW.x;
                }
                const t = R.mod(time, CYCLE);
                const pointer = env.pointer;
                env.clear();
                drawTerminal(t);
                drawCapsule(t, pointer);
                drawPreview(t);
                env.fadeEdges(0.8, 1.03);
            }
        };
    }
});
