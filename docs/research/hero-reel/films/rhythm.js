/* Rhythm: the intro film cut like a festival aftermovie. 120 BPM, a beat every 15 frames, a bar every 2 s.
   Everything that moves lands on the beat; the one time the beat stops is when an agent waits for you. */
Film.define({
    id: 'rhythm',
    title: 'Rhythm',
    duration: 60,
    cuts: [4, 14, 24, 26, 28, 30, 32, 38, 40, 50, 54, 56, 58],
    /* The score: A minor at 120 BPM, a bar every 2 s, so every bar line is a cut or a beat the picture lands on.
       i, VI, III, VII with the dominant E pulling into each new act; the stop holds Fmaj7 and a Gsus; the ending
       lifts into the relative major (vi, V, IV, V, I) and resolves on C under the end card. */
    score(kit) {
        const BEAT = 0.5;
        const CHORDS = {
            Am: { pad: ['A3', 'C4', 'E4', 'G4'], bass: 'A2', arp: ['A4', 'C5', 'E5', 'G5', 'C6'] },
            F: { pad: ['A3', 'C4', 'F4', 'A4'], bass: 'F2', arp: ['F4', 'A4', 'C5', 'E5', 'A5'] },
            C: { pad: ['G3', 'C4', 'E4', 'G4'], bass: 'C3', arp: ['G4', 'C5', 'E5', 'G5', 'C6'] },
            G: { pad: ['G3', 'B3', 'D4', 'G4'], bass: 'G2', arp: ['G4', 'B4', 'D5', 'G5', 'B5'] },
            E: { pad: ['G#3', 'B3', 'E4', 'G#4'], bass: 'E2', arp: ['G#4', 'B4', 'E5', 'G#5', 'B5'] },
            Fmaj7: { pad: ['F3', 'A3', 'C4', 'E4'], bass: 'F2', arp: [] },
            Gsus: { pad: ['G3', 'C4', 'D4', 'G4'], bass: 'G2', arp: [] },
            Cadd9: { pad: ['C4', 'E4', 'G4', 'D5'], bass: 'C2', arp: [] }
        };
        const PROG = [
            [0, 'Am'], [2, 'F'],
            [4, 'Am'], [6, 'F'], [8, 'C'], [10, 'G'], [12, 'E'],
            [14, 'Am'], [16, 'F'], [18, 'C'], [20, 'G'], [22, 'E'],
            [24, 'Am'], [26, 'F'], [28, 'C'], [30, 'G'],
            [32, 'Fmaj7'], [36, 'Gsus'],
            [38, 'Am'], [40, 'F'], [42, 'C'], [44, 'G'], [46, 'Am'], [48, 'E'],
            [50, 'Am'], [52, 'G'], [54, 'F'], [56, 'G'], [58, 'Cadd9']
        ];
        const chordAt = (t) => {
            let name = PROG[0][1];
            for (const [at, chord] of PROG) {
                if (t >= at - 1e-6) {
                    name = chord;
                }
            }
            return CHORDS[name];
        };
        const within = (t, ranges) => ranges.some(([from, to]) => t >= from - 1e-6 && t < to - 1e-6);
        const beats = (from, to, step = BEAT) => {
            const out = [];
            for (let t = from; t < to - 1e-6; t += step) {
                out.push(Math.round(t * 1000) / 1000);
            }
            return out;
        };

        const drums = kit.bus({ gain: 0.8, send: 0.04 });
        const perc = kit.bus({ gain: 0.55, send: 0.12, pan: 0.08 });
        const low = kit.bus({ gain: 0.62, send: 0.02 });
        const pads = kit.bus({ gain: 0.55, send: 0.35, pan: -0.05 });
        const arp = kit.bus({ gain: 0.42, send: 0.28, pan: 0.18 });
        const answer = kit.bus({ gain: 0.42, send: 0.28, pan: -0.22 });
        const lead = kit.bus({ gain: 0.4, send: 0.4 });
        const fx = kit.bus({ gain: 0.55, send: 0.3 });
        const ui = kit.bus({ gain: 0.5, send: 0.15 });

        /* Drums. The kick is the film's own: every beat while the frame breathes, silent through the stop. */
        const KICK_ON = [[4, 32.02], [38, 50], [52, 58.02]];
        const kicks = beats(0, 60).filter((t) => within(t, KICK_ON));
        for (const t of kicks) {
            const down = Math.round(t / BEAT) % 4 === 0;
            const base = t < 8 ? 0.62 : t < 14 ? 0.74 : 0.84;
            kit.kick(drums, t, { gain: base * (down ? 1 : 0.94) });
        }
        pads.sidechain(kicks, 0.55);
        low.sidechain(kicks, 0.7, 0.2);
        arp.sidechain(kicks, 0.3);
        answer.sidechain(kicks, 0.3);

        // Backbeat on 2 and 4.
        for (const t of beats(0, 60)) {
            const inBar = Math.round(t / BEAT) % 4;
            if ((inBar === 1 || inBar === 3) && within(t, [[10, 13], [14, 32], [38, 50], [54, 58]])) {
                kit.snare(perc, t, { gain: t < 14 ? 0.3 : within(t, [[24, 32], [54, 58]]) ? 0.46 : 0.4 });
            }
        }
        // Fills into the big turns: sixteenths that grow.
        const fill = (from, to, step, g0, g1) => {
            const hits = beats(from, to, step);
            hits.forEach((t, i) => kit.snare(perc, t, { gain: g0 + ((g1 - g0) * i) / Math.max(1, hits.length - 1), decay: 0.1 }));
        };
        fill(13, 14, 0.125, 0.08, 0.36);
        fill(23.5, 24, 0.125, 0.14, 0.34);
        fill(49, 50, 0.25, 0.1, 0.24);
        fill(53, 53.5, 0.125, 0.08, 0.2);
        fill(53.5, 54, 0.0625, 0.2, 0.42);
        fill(57, 58, 0.125, 0.1, 0.38);

        // Hats: offbeat eighths from the four-view grid, sixteenths once agents run, open on the offbeat at the peaks.
        for (const t of beats(0, 60, 0.125)) {
            const sixteenth = Math.round(t / 0.125) % 4;
            const offbeat = sixteenth === 2;
            if (offbeat && within(t, [[8, 32], [38, 58]])) {
                const open = within(t, [[24, 32], [54, 58]]);
                kit.hat(perc, t, { gain: open ? 0.16 : t < 14 ? 0.13 : 0.17, open });
            } else if (!offbeat && sixteenth !== 0 && within(t, [[14, 32], [40, 50], [52, 58]])) {
                kit.hat(perc, t, { gain: within(t, [[24, 32], [54, 58]]) ? 0.08 : 0.06 });
            }
        }
        // A crash on every cut that lands with the beat running.
        for (const t of [14, 24, 26, 28, 30, 40, 54]) {
            kit.hat(perc, t, { gain: 0.2, open: true });
        }

        /* Bass: held roots under the first bars, then offbeat eighths ducked by the kick. */
        for (const [at, name] of PROG) {
            const chord = CHORDS[name];
            if (at < 2) {
                continue;
            }
            if (at < 8 || at === 32 || at === 50) {
                const soft = at === 36 ? 0.1 : at === 2 ? 0.24 : 0.3;
                kit.bass(low, at, chord.bass, at === 32 ? 0.9 : at === 36 ? 1.9 : 1.8, { gain: soft, cutoff: at === 36 ? 300 : 420 });
            }
        }
        for (const t of beats(8, 58)) {
            if (!within(t, [[8, 32], [38, 50], [52, 58]])) {
                continue;
            }
            const chord = chordAt(t);
            kit.bass(low, t + 0.25, chord.bass, 0.18, { gain: within(t, [[24, 32], [54, 58]]) ? 0.4 : 0.36, cutoff: within(t, [[54, 58]]) ? 900 : 700 });
            if (within(t, [[54, 58]]) && Math.round(t / BEAT) % 2 === 1) {
                kit.bass(low, t + 0.375, chord.bass, 0.1, { gain: 0.26, cutoff: 900 });
            }
        }

        /* Pads, one chord per bar. Their level carries the arc. */
        const padGain = (at) => {
            if (at < 4) {
                return 0.07;
            }
            if (at >= 32 && at < 38) {
                return 0.024;
            }
            if (at >= 50 && at < 54) {
                return 0.1;
            }
            if (at >= 54) {
                return 0.13;
            }
            return at < 14 ? 0.08 : 0.1;
        };
        const padCutoff = (at) => {
            if (at >= 32 && at < 36) {
                return 420;
            }
            if (at >= 36 && at < 38) {
                return 800;
            }
            if (at >= 54) {
                return 2600;
            }
            if (at >= 24 && at < 32) {
                return 2000;
            }
            return at < 14 ? 1100 : 1600;
        };
        for (let i = 0; i < PROG.length; i++) {
            const [at, name] = PROG[i];
            const next = i + 1 < PROG.length ? PROG[i + 1][0] : 60;
            if (at === 58) {
                continue;
            }
            const long = at === 32 || at === 36;
            kit.pad(pads, at, CHORDS[name].pad, next - at, {
                gain: padGain(at),
                cutoff: padCutoff(at),
                attack: at === 0 ? 1 : at === 36 ? 1.6 : long ? 0.6 : 0.05,
                release: long ? 0.6 : 0.25
            });
        }

        /* The wordmark: one step per beat, the dot on the downbeat at 2, the letters hop, the dot opens the window. */
        [['A4', 0], ['C5', 0.5], ['E5', 1], ['G5', 1.5]].forEach(([n, t], i) => kit.pluck(arp, t, n, { gain: 0.16 + i * 0.03, length: 0.3, bright: 2400 + i * 600 }));
        kit.riser(fx, 1.3, 0.7, { gain: 0.08 });
        kit.bell(lead, 2, 'A5', { gain: 0.22, decay: 2.4 });
        kit.bell(lead, 2, 'E6', { gain: 0.1, decay: 2 });
        kit.impact(fx, 2, { gain: 0.35 });
        ['C6', 'E6', 'G6', 'A6', 'C7', 'E7'].forEach((n, j) => kit.pluck(arp, 2.5 + j * 0.05, n, { gain: 0.05, length: 0.08, bright: 5000 }));
        kit.riser(fx, 2.9, 1.1, { gain: 0.16 });

        /* The grid: a pluck for every view that lands, climbing the chord. */
        const LANDINGS = [[4, 'A4'], [6, 'C5'], [8, 'E5'], [8.5, 'G5'], [10, 'G4'], [10.25, 'B4'], [10.5, 'D5'], [10.75, 'G5'], [11, 'B5']];
        for (const [t, n] of LANDINGS) {
            kit.pluck(arp, t, n, { gain: 0.2, length: 0.3, bright: 3600 });
            kit.tick(ui, t, { gain: 0.05, pitch: 2600 });
        }
        kit.riser(fx, 12, 2, { gain: 0.2 });
        kit.impact(fx, 14, { gain: 0.3 });

        /* Arpeggios: eighths while the agents start, sixteenths through the montage and the lift. */
        const arpeggio = (from, to, step, gain, bright, octaveUp = false) => {
            let i = 0;
            for (const t of beats(from, to, step)) {
                const tones = chordAt(t).arp;
                if (!tones.length) {
                    continue;
                }
                const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
                const n = tones[pattern[i % pattern.length]];
                const accent = Math.abs(t / BEAT - Math.round(t / BEAT)) < 1e-6;
                kit.pluck(arp, t, octaveUp ? kit.note(n) + 12 : n, { gain: gain * (accent ? 1 : 0.75), length: 0.16, bright });
                i++;
            }
        };
        arpeggio(18, 24, 0.25, 0.12, 2600);
        arpeggio(24, 32, 0.125, 0.11, 3400);
        arpeggio(54, 58, 0.125, 0.1, 4200);

        /* The agents: three start on three beats, plan steps tick, the Line-up page rings when it is done. */
        [[16, 'F5'], [16.5, 'A5'], [17, 'C6']].forEach(([t, n]) => {
            kit.bell(lead, t, n, { gain: 0.16, decay: 1.6 });
            kit.pluck(arp, t, n, { gain: 0.14, length: 0.35 });
        });
        for (const t of [18, 18.5, 19, 19.5, 20.5, 21, 23, 26.5, 27, 27.5]) {
            kit.tick(ui, t, { gain: 0.06, pitch: 2400 });
        }
        kit.bell(lead, 22, 'B5', { gain: 0.18, decay: 2 });
        kit.bell(lead, 22, 'E6', { gain: 0.12, decay: 1.8 });
        kit.riser(fx, 22.5, 1.5, { gain: 0.16 });
        kit.impact(fx, 24, { gain: 0.32 });
        kit.riser(fx, 30.5, 1.5, { gain: 0.14 });

        /* The stop: one hit on the downbeat at 32, then a filtered hold while an agent waits. */
        kit.impact(fx, 32, { gain: 0.42 });
        kit.bell(lead, 32.5, 'E5', { gain: 0.1, decay: 2.6 });
        kit.bell(lead, 34.5, 'C5', { gain: 0.05, decay: 2.4 });
        kit.tick(ui, 36, { gain: 0.08, pitch: 1800 });
        kit.tick(ui, 37, { gain: 0.1, pitch: 2200 });
        kit.riser(fx, 35, 3, { gain: 0.3 });
        kit.impact(fx, 38, { gain: 0.5 });
        kit.bell(lead, 38, 'A5', { gain: 0.14, decay: 1.6 });

        /* Computer use: the agent's hand plays the beats, yours the offbeats. */
        for (const t of beats(40, 50)) {
            const tones = chordAt(t).arp;
            const step = Math.round(t / BEAT) % 4;
            kit.pluck(arp, t, tones[[2, 3, 4, 3][step]], { gain: 0.13, length: 0.18, bright: 3000 });
            kit.pluck(answer, t + 0.25, tones[[0, 1, 0, 2][step]], { gain: 0.1, length: 0.14, bright: 2000 });
        }
        for (const t of [40, 42, 42.5, 45, 46, 47]) {
            kit.tick(ui, t, { gain: t === 42 || t === 46 ? 0.1 : 0.05, pitch: 2800 });
        }
        for (const t of [44.75, 45.25, 46.75, 47.25]) {
            kit.tick(ui, t, { gain: 0.06, pitch: 1700 });
        }
        for (const t of beats(43, 44.5, 0.125)) {
            kit.tick(ui, t, { gain: 0.03, pitch: 3200 });
        }
        kit.riser(fx, 48, 2, { gain: 0.14 });

        /* The phone: the floor drops out, builds back, and Allow on the downbeat at 54 lifts into the major. */
        kit.impact(fx, 50, { gain: 0.24 });
        kit.bell(lead, 50.1, 'E6', { gain: 0.1, decay: 1.4 });
        kit.bell(lead, 51, 'C6', { gain: 0.07, decay: 1.4 });
        for (const t of beats(50, 52, 0.25)) {
            kit.hat(perc, t, { gain: 0.05 });
        }
        kit.riser(fx, 52, 2, { gain: 0.26 });
        kit.tick(ui, 53.9, { gain: 0.08, pitch: 2000 });
        kit.impact(fx, 54, { gain: 0.5 });
        kit.bell(lead, 54, 'C6', { gain: 0.16, decay: 2 });
        const HOOK = [[54, 'A5', 0.6], [54.75, 'C6', 0.6], [55.5, 'A5', 0.4], [56, 'B5', 0.6], [56.75, 'D6', 0.6], [57.5, 'G5', 0.4]];
        for (const [t, n, length] of HOOK) {
            kit.pluck(lead, t, n, { gain: 0.16, length, bright: 3800, detune: 10 });
        }
        // The cells pop in thirty-seconds, fold, and the dot drops onto the i.
        ['G4', 'B4', 'D5', 'G5', 'B5', 'D6', 'G6', 'B6', 'D7'].forEach((n, i) => kit.pluck(arp, 56 + i * 0.0625, n, { gain: 0.05, length: 0.1, bright: 5200 }));
        kit.riser(fx, 57, 1, { gain: 0.22 });

        /* The end card: the dot lands, C with a ninth, and everything decays out before 60. */
        kit.impact(fx, 58, { gain: 0.55 });
        kit.pad(pads, 58, CHORDS.Cadd9.pad, 0.6, { gain: 0.13, cutoff: 1800, attack: 0.02, release: 1.1 });
        kit.bass(low, 58, 'C2', 0.7, { gain: 0.34, cutoff: 400 });
        kit.bell(lead, 58, 'C6', { gain: 0.22, decay: 1.8 });
        kit.bell(lead, 58, 'G6', { gain: 0.1, decay: 1.5 });
        kit.bell(lead, 58.35, 'E6', { gain: 0.07, decay: 1.2 });

        /* The arc, as a drive into the glue: each act a step up, changed on its cut, the lift the loudest. */
        const DRIVE = [[0, 0.62], [4, 0.5], [8, 0.58], [12, 0.66], [14, 0.72], [24, 0.86], [32, 0.8], [38, 0.86], [40, 0.76], [50, 0.62], [52, 0.72], [54, 0.98], [58, 0.92]];
        const drive = kit.master.gain;
        drive.setValueAtTime(DRIVE[0][1], 0);
        for (let i = 1; i < DRIVE.length; i++) {
            const [at, value] = DRIVE[i];
            drive.setValueAtTime(DRIVE[i - 1][1], at - 0.03);
            drive.linearRampToValueAtTime(value, at);
        }
        drive.setValueAtTime(0.92, 58.9);
        drive.linearRampToValueAtTime(0, 59.92);
    },
    create(v) {
        const { ctx, R } = v;
        const pal = R.pal;
        const E = R.ease;
        const clamp = R.clamp;
        const lerp = R.lerp;
        const phase = R.phase;
        const smooth = R.smoothstep;
        const TAU = Math.PI * 2;
        const SANS = R.fonts.display;
        const MONO = R.fonts.mono;
        const HAND = R.fonts.hand;

        /* The clock. */
        const BEAT = 0.5;
        const STOP_FROM = 32.5;
        const STOP_TO = 38;
        const LAST = 58;
        const beatLive = (t) => (t < STOP_FROM || t >= STOP_TO) && t < LAST + 0.02;
        let NOW = 0;
        let KICK = 0;
        let LIVE = true;

        const spring = (elapsed, omega, zeta) => {
            if (elapsed <= 0) {
                return 0;
            }
            const damped = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * elapsed) * (Math.cos(damped * elapsed) + ((zeta * omega) / damped) * Math.sin(damped * elapsed));
        };

        /* Text. The fonts are in before the film mounts, so measures can be kept. */
        const widths = new Map();
        const font = (size, weight = 400, family = SANS) => {
            ctx.font = `${weight} ${size}px ${family}`;
        };
        const measure = (s) => {
            const key = ctx.font + '|' + s;
            let width = widths.get(key);
            if (width === undefined) {
                width = ctx.measureText(s).width;
                widths.set(key, width);
            }
            return width;
        };
        const text = (s, x, y, size, color, weight = 400, family = SANS, align = 'left') => {
            font(size, weight, family);
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(s, x, y);
        };
        const wraps = new Map();
        const wrap = (s, width) => {
            const key = ctx.font + '|' + s + '|' + Math.round(width);
            let lines = wraps.get(key);
            if (lines) {
                return lines;
            }
            lines = [];
            let line = '';
            for (const word of s.split(' ')) {
                const next = line ? line + ' ' + word : word;
                if (line && measure(next) > width) {
                    lines.push(line);
                    line = word;
                } else {
                    line = next;
                }
            }
            lines.push(line);
            wraps.set(key, lines);
            return lines;
        };
        // The client's `.shine`: muted words with a light running over them from right to left every 1.6 s.
        const shine = (s, x, y, size, time, weight = 400, family = SANS) => {
            font(size, weight, family);
            const width = measure(s);
            const sweep = R.fract(time / 1.6);
            const center = x + width * (1.7 - 2.4 * sweep);
            const band = Math.max(16, width * 0.34);
            const gradient = ctx.createLinearGradient(center - band, 0, center + band, 0);
            gradient.addColorStop(0, pal.muted);
            gradient.addColorStop(0.5, pal.text);
            gradient.addColorStop(1, pal.muted);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = gradient;
            ctx.fillText(s, x, y);
            return width;
        };

        /* Shapes. */
        const fillRound = (x, y, w, h, r, color) => {
            R.roundRect(ctx, x, y, w, h, r);
            ctx.fillStyle = color;
            ctx.fill();
        };
        const strokeRound = (x, y, w, h, r, color, lineWidth = 1) => {
            R.roundRect(ctx, x, y, w, h, r);
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        };
        const rect = (x, y, w, h, color) => {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, w, h);
        };
        const circle = (x, y, r, color) => {
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0, r), 0, TAU);
            ctx.fillStyle = color;
            ctx.fill();
        };

        /* Lucide's own paths (24 unit box, 1.75 stroke), so a glyph reads as the app's glyph. */
        const ring = (cx, cy, rad) => `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0`;
        const box = (x, y, w, h, rad) => `M${x + rad} ${y}h${w - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${h - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}h${-(w - 2 * rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}v${-(h - 2 * rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}z`;
        const ICON_SRC = {
            terminal: ['M12 19h8', 'm4 17 6-6-6-6'],
            chat: ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'],
            globe: [ring(12, 12, 10), 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
            pen: [
                'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
                'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
                'm2.3 2.3 7.286 7.286',
                ring(11, 11, 2)
            ],
            file: ['M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z', 'M14 2v5a1 1 0 0 0 1 1h5', 'M10 9H8', 'M16 13H8', 'M16 17H8'],
            note: ['M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z', 'M15 3v5a1 1 0 0 0 1 1h5'],
            canvas: [box(3, 3, 7, 7, 1), box(14, 3, 7, 7, 1), box(14, 14, 7, 7, 1), box(3, 14, 7, 7, 1)],
            circle: [ring(12, 12, 10)],
            circleCheck: [ring(12, 12, 10), 'm9 12 2 2 4-4'],
            question: ['M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
            hand: [
                'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
                'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
                'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
                'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'
            ],
            arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
            chevronDown: ['m6 9 6 6 6-6'],
            chevronRight: ['m9 18 6-6-6-6'],
            maximize: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'],
            close: ['M18 6 6 18', 'm6 6 12 12'],
            eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', ring(12, 12, 3)],
            edit: ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'],
            lock: [box(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 10 0v4'],
            plus: ['M5 12h14', 'M12 5v14'],
            branch: ['M15 6a9 9 0 0 0-9 9V3', ring(18, 6, 3), ring(6, 18, 3)],
            loader: ['M21 12a9 9 0 1 1-6.219-8.56'],
            checkCheck: ['M18 6 7 17l-5-5', 'm22 10-7.5 7.5L13 16'],
            laptop: ['M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z', 'M20.054 15.987H3.946'],
            folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
            search: [ring(11, 11, 8), 'm21 21-4.3-4.3'],
            phone: [box(5, 2, 14, 20, 2), 'M12 18h.01'],
            panel: [box(3, 3, 18, 18, 2), 'M9 3v18', 'm16 15-3-3 3-3'],
            chart: ['M5 21v-6', 'M12 21V3', 'M19 21V9'],
            back: ['m12 19-7-7 7-7', 'M19 12H5'],
            forward: ['M5 12h14', 'm12 5 7 7-7 7'],
            reload: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5']
        };
        const ICONS = {};
        for (const [name, list] of Object.entries(ICON_SRC)) {
            ICONS[name] = list.map((d) => new Path2D(d));
        }
        const icon = (name, x, y, size, color, spin = 0, weight = 1.75) => {
            ctx.save();
            ctx.translate(x + size / 2, y + size / 2);
            if (spin) {
                ctx.rotate(spin);
            }
            ctx.scale(size / 24, size / 24);
            ctx.translate(-12, -12);
            ctx.strokeStyle = color;
            ctx.lineWidth = weight;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const path of ICONS[name]) {
                ctx.stroke(path);
            }
            ctx.restore();
        };
        const MARKS = {
            claude: new Path2D(
                'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
            ),
            codex: new Path2D(
                'M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.554 5.554 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.019.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.001zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z'
            )
        };
        const mark = (kind, x, y, size, color) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(size / 24, size / 24);
            ctx.fillStyle = color;
            ctx.fill(MARKS[kind]);
            ctx.restore();
        };
        const KIND_ICON = { chat: 'chat', terminal: 'terminal', browser: 'globe', drawing: 'pen', file: 'file', canvas: 'canvas', note: 'note' };
        const glyph = (view, x, y, size, color) => {
            if (view.agent) {
                mark(view.agent, x, y, size, color);
            } else {
                icon(KIND_ICON[view.kind], x, y, size, color);
            }
        };
        const TOOL_ICON = { read: 'eye', edit: 'edit', bash: 'terminal' };

        /* Status, pills and the parts every node shares. */
        const STATUS = { running: pal.running, needs: pal.needs, idle: pal.idle };
        const STATUS_WORD = { running: 'Running', needs: 'Needs you', idle: 'Idle' };
        // The client's status pulse lasts 2 s, one bar: here it is locked to the downbeat, and it holds its breath in the stop.
        const pulse = () => (LIVE ? 0.75 + 0.25 * Math.cos((NOW * TAU) / 2) : 1);
        const dot = (x, y, status, radius = 4) => {
            ctx.save();
            if (status === 'running') {
                ctx.globalAlpha *= pulse();
            }
            circle(x, y, radius, STATUS[status]);
            ctx.restore();
        };
        // `Pill`: 12px on the sunken ground; the right edge at `right`. Returns the width.
        const pill = (right, y, label, opts = {}) => {
            const family = opts.mono ? MONO : SANS;
            font(12, 400, family);
            const lead = opts.status || opts.icon ? 17 : 0;
            const w = measure(label) + 16 + lead;
            fillRound(right - w, y - 11, w, 22, 11, opts.raised ? pal.hover : pal.sunken);
            if (opts.status) {
                dot(right - w + 12, y, opts.status, 4);
            }
            if (opts.icon) {
                icon(opts.icon, right - w + 6, y - 6, 12, opts.iconColor || pal.muted, opts.spin || 0);
            }
            text(label, right - w + 8 + lead, y + 0.5, 12, pal.muted, 400, family);
            return w;
        };

        const HEADER = 39;
        // `NodeFrame`: an 11 radius frame, a 39 tall raised header with the glyph, the title, the pills and two buttons.
        const node = (x, y, w, h, o) => {
            const ground = o.kind === 'note' ? pal.note : o.kind === 'terminal' ? pal.termBg : pal.surface;
            fillRound(x - 1, y + 2, w + 2, h + 3, 12, 'rgba(0,0,0,0.22)');
            fillRound(x, y, w, h, 11, ground);
            ctx.save();
            R.roundRect(ctx, x, y, w, h, 11);
            ctx.clip();
            rect(x, y, w, HEADER, o.kind === 'note' ? pal.note : pal.raised);
            rect(x, y + HEADER - 1, w, 1, o.kind === 'note' ? 'rgba(236,236,241,0.12)' : 'rgba(255,255,255,0.07)');
            if (o.lod) {
                glyph(o, x + 10, y + 12, 14, pal.muted);
                rect(x + 34, y + 16, Math.min(w * 0.4, 120), 6, 'rgba(236,236,241,0.5)');
                if (o.status) {
                    circle(x + w - 20, y + 19.5, 6, STATUS[o.status]);
                }
            } else {
                const mid = y + HEADER / 2;
                glyph(o, x + 11, mid - 7, 14, pal.muted);
                let right = x + w - 8;
                icon('close', right - 21, mid - 7, 14, pal.muted);
                icon('maximize', right - 49, mid - 7, 14, pal.muted);
                right -= 62;
                if (o.status) {
                    right -= pill(right, mid, STATUS_WORD[o.status], { status: o.status }) + 6;
                }
                if (o.branch) {
                    right -= pill(right, mid, o.branch, { mono: true, icon: 'branch' }) + 6;
                }
                if (o.plan) {
                    const busy = o.plan[0] < o.plan[1];
                    right -= pill(right, mid, o.plan[0] + '/' + o.plan[1], { raised: true, icon: busy ? 'loader' : 'checkCheck', iconColor: busy ? pal.accent : pal.muted, spin: busy ? NOW * TAU * 1.1 : 0 }) + 6;
                }
                ctx.save();
                ctx.beginPath();
                ctx.rect(x + 32, y, Math.max(0, right - x - 32), HEADER);
                ctx.clip();
                text(o.title, x + 35, mid + 0.5, 13, pal.text, 500);
                ctx.restore();
            }
            ctx.restore();
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, 11, o.border || 'rgba(255,255,255,0.08)', o.borderWidth || 1);
        };

        // A connector as the client routes it: out of the facing sides, a stub, one rail, every corner rounded.
        const EDGE_HEX = '#113992';
        const EDGE_CONTEXT = EDGE_HEX;
        const routeBetween = (a, b, out) => {
            const dx = b.x + b.w / 2 - (a.x + a.w / 2);
            const dy = b.y + b.h / 2 - (a.y + a.h / 2);
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            const ax = horizontal ? Math.sign(dx) || 1 : 0;
            const ay = horizontal ? 0 : Math.sign(dy) || 1;
            const side = (r, sx, sy) => [sx === 0 ? r.x + r.w / 2 : sx > 0 ? r.x + r.w + 9 : r.x - 9, sy === 0 ? r.y + r.h / 2 : sy > 0 ? r.y + r.h + 9 : r.y - 9];
            const start = side(a, ax, ay);
            const end = side(b, -ax, -ay);
            out.length = 0;
            if (horizontal) {
                const rail = (start[0] + end[0]) / 2;
                out.push(start, [rail, start[1]], [rail, end[1]], end);
            } else {
                const rail = (start[1] + end[1]) / 2;
                out.push(start, [start[0], rail], [end[0], rail], end);
            }
            return out;
        };
        const traceRoute = (points) => {
            ctx.beginPath();
            ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length - 1; i++) {
                const [px, py] = points[i - 1];
                const [cx, cy] = points[i];
                const [nx, ny] = points[i + 1];
                const radius = Math.min(15, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
                if (radius < 0.5) {
                    ctx.lineTo(cx, cy);
                } else {
                    ctx.arcTo(cx, cy, nx, ny, radius);
                }
            }
            const last = points[points.length - 1];
            ctx.lineTo(last[0], last[1]);
        };
        const routeScratch = [];
        const edge = (a, b, color, width, dashed, grow = 1) => {
            const points = routeBetween(a, b, routeScratch);
            traceRoute(points);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            let length = 0;
            for (let i = 1; i < points.length; i++) {
                length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
            }
            if (grow < 1) {
                ctx.setLineDash(dashed ? [6, 6] : [length * grow, length + 10]);
                if (dashed) {
                    ctx.save();
                    ctx.globalAlpha *= grow;
                    ctx.stroke();
                    ctx.restore();
                } else {
                    ctx.stroke();
                }
            } else {
                ctx.setLineDash(dashed ? [6, 6] : []);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            if (grow > 0.9) {
                const end = points[points.length - 1];
                ctx.beginPath();
                ctx.arc(end[0], end[1], 5, 0, TAU);
                ctx.fillStyle = pal.bg;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        };

        /* Cursors: the person's own, and the agent's phantom from computer use. */
        const CURSOR = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');
        const cursor = (x, y, scale = 1, alpha = 1, press = 0) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x, y);
            const s = scale * (1 - press * 0.12);
            ctx.scale(s, s);
            ctx.translate(-1.5, -1.5);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.translate(0, 1.2);
            ctx.fill(CURSOR);
            ctx.translate(0, -1.2);
            ctx.fillStyle = '#000000';
            ctx.fill(CURSOR);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.lineJoin = 'round';
            ctx.stroke(CURSOR);
            ctx.restore();
        };
        const clickRing = (x, y, since, radius, color) => {
            if (since < 0 || since > 0.5) {
                return;
            }
            const k = since / 0.5;
            ctx.beginPath();
            ctx.arc(x, y, radius * (0.3 + 0.9 * E.outCubic(k)), 0, TAU);
            ctx.strokeStyle = R.rgba(color, 0.8 * (1 - k));
            ctx.lineWidth = 2;
            ctx.stroke();
        };
        // `PhantomForms.swift`: the arrow, and the drop with three dots while it thinks. Hotspot at (4, 3.5).
        const PHANTOM_ARROW = new Path2D('M4 3.5 L20.5 10.5 L13.5 13.5 L10.5 20.5 Z');
        const PHANTOM_DROP = (() => {
            const tip = [4, 3.5];
            const center = [12.5, 12.5];
            const radius = 7;
            const angle = Math.atan2(tip[1] - center[1], tip[0] - center[0]);
            const opening = Math.acos(radius / Math.hypot(tip[0] - center[0], tip[1] - center[1]));
            const path = new Path2D();
            path.moveTo(tip[0], tip[1]);
            path.lineTo(center[0] + radius * Math.cos(angle + opening), center[1] + radius * Math.sin(angle + opening));
            path.arc(center[0], center[1], radius, angle + opening, angle + TAU - opening);
            path.closePath();
            return path;
        })();
        const phantom = (x, y, scale, think, press, label, typed, labelAlpha = 1) => {
            ctx.save();
            ctx.translate(x, y);
            const s = scale * (1 - press * 0.18);
            ctx.save();
            ctx.scale(s, s);
            ctx.translate(-4, -3.5);
            ctx.shadowColor = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
            const path = think > 0.5 ? PHANTOM_DROP : PHANTOM_ARROW;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 7;
            ctx.lineJoin = 'round';
            ctx.stroke(path);
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = pal.accent;
            ctx.strokeStyle = pal.accent;
            ctx.lineWidth = 2;
            ctx.fill(path);
            ctx.stroke(path);
            if (think > 0.5) {
                for (let i = 0; i < 3; i++) {
                    const hop = Math.max(0, Math.sin((NOW / 0.9 - i * 0.16) * TAU)) * 1.2;
                    circle(9.3 + i * 3.2, 12.5 - hop, 1.1, '#ffffff');
                }
            }
            ctx.restore();
            if (label && labelAlpha > 0.01) {
                ctx.globalAlpha *= labelAlpha;
                const size = 14 * scale * 0.72;
                font(size, 400, typed ? MONO : SANS);
                const w = measure(label) + 18 * scale * 0.72;
                const lx = 16 * scale;
                const ly = 17 * scale;
                const lh = 26 * scale * 0.72;
                fillRound(lx, ly, w, lh, lh / 2, pal.raised);
                strokeRound(lx + 0.5, ly + 0.5, w - 1, lh - 1, lh / 2, 'rgba(255,255,255,0.07)');
                text(label, lx + 9 * scale * 0.72, ly + lh / 2 + 0.5, size, pal.text, 400, typed ? MONO : SANS);
            }
            ctx.restore();
        };

        /* A chat thread, laid out top down and pinned to its foot once it no longer fits (a chat scrolls). */
        const itemHeight = (item, w) => {
            if (item.type === 'user') {
                font(14);
                return wrap(item.text, w * 0.8 - 28).length * 21 + 20;
            }
            if (item.type === 'text') {
                font(14);
                return wrap(item.text, w).length * 21;
            }
            if (item.type === 'muted') {
                font(13);
                return wrap(item.text, w).length * 19;
            }
            if (item.type === 'tool') {
                return 28;
            }
            return 21;
        };
        const drawItem = (item, x, y, w, time) => {
            ctx.save();
            if (item.alpha !== undefined) {
                ctx.globalAlpha *= item.alpha;
            }
            if (item.type === 'user') {
                font(14);
                const lines = wrap(item.text, w * 0.8 - 28);
                let widest = 0;
                for (const line of lines) {
                    widest = Math.max(widest, measure(line));
                }
                const bw = widest + 28;
                fillRound(x + w - bw, y, bw, lines.length * 21 + 20, 16, pal.active);
                for (let k = 0; k < lines.length; k++) {
                    text(lines[k], x + w - bw + 14, y + 20.5 + k * 21, 14, pal.text);
                }
            } else if (item.type === 'tool') {
                const mid = y + 14;
                icon(TOOL_ICON[item.tool], x + 2, mid - 6, 12, item.live ? pal.accent : pal.muted);
                let lw = 0;
                if (item.live) {
                    lw = shine(item.label, x + 22, mid + 0.5, 13, time);
                } else {
                    text(item.label, x + 22, mid + 0.5, 13, pal.muted);
                    lw = measure(item.label);
                }
                text(item.detail, x + 30 + lw, mid + 0.5, 13, pal.faint, 400, MONO);
                icon('chevronRight', x + w - 14, mid - 6, 12, pal.faint);
            } else if (item.type === 'text') {
                font(14);
                const lines = wrap(item.text, w);
                const shown = item.words === undefined ? 1e9 : item.words;
                let count = 0;
                for (let k = 0; k < lines.length; k++) {
                    let lx = x;
                    for (const word of lines[k].split(' ')) {
                        const lhs = clamp(shown - count);
                        if (lhs > 0) {
                            ctx.save();
                            ctx.globalAlpha *= E.outCubic(lhs);
                            text(word, lx, y + 10.5 + k * 21 + (1 - E.outCubic(lhs)) * 4, 14, pal.text);
                            ctx.restore();
                        }
                        font(14);
                        lx += measure(word + ' ');
                        count++;
                    }
                }
            } else if (item.type === 'muted') {
                font(13);
                const lines = wrap(item.text, w);
                for (let k = 0; k < lines.length; k++) {
                    text(lines[k], x, y + 9.5 + k * 19, 13, pal.muted);
                }
            } else if (item.type === 'working') {
                dot(x + 4, y + 10.5, 'running', 4);
                const ww = shine('Working for', x + 16, y + 11, 13, time);
                text('00:' + String(item.seconds).padStart(2, '0'), x + 24 + ww, y + 11, 13, pal.faint);
            } else if (item.type === 'done') {
                icon('circleCheck', x, y + 4, 13, pal.idle);
                text(item.label || 'Done', x + 19, y + 11, 13, pal.idle);
            }
            ctx.restore();
        };
        const drawThread = (items, x, w, top, bottom, time, gap = 14) => {
            let total = -gap;
            for (const item of items) {
                total += itemHeight(item, w) + gap;
            }
            let y = total > bottom - top ? bottom - total : top;
            for (const item of items) {
                const h = itemHeight(item, w);
                if (y + h > top - 30) {
                    drawItem(item, x, y, w, time);
                }
                y += h + gap;
            }
        };

        /* The festival, as the agents build it: a cream page with its own ink, not the app's. */
        const PAGE = { bg: '#f2ede3', ink: '#1b1a17', muted: '#6f695e', line: 'rgba(27,26,23,0.12)', accent: '#e4572e', field: '#c9d8b6' };
        const ACTS = [
            ['Lune Park', 'Veld', '21:30'],
            ['Mira Vos', 'Bos', '20:15'],
            ['Night Swim', 'Veld', '19:00'],
            ['Oona', 'Bos', '22:40'],
            ['Juno Bay', 'Veld', '17:45'],
            ['Veldwerk', 'Bos', '18:30']
        ];
        const pageNav = (w, built) => {
            ctx.save();
            ctx.globalAlpha *= built;
            text('NACHTVELD', 22, 24, 15, PAGE.ink, 700);
            const links = ['Line-up', 'Tickets', 'Map'];
            let lx = w - 22;
            for (let i = links.length - 1; i >= 0; i--) {
                font(12, 500);
                lx -= measure(links[i]);
                text(links[i], lx, 24, 12, PAGE.muted, 500);
                lx -= 18;
            }
            rect(0, 47, w, 1, PAGE.line);
            ctx.restore();
        };
        // `beats` counts the blocks that are in: a live page grows a block on every beat, like hot reload.
        const browserPage = (page, w, h, built, time) => {
            rect(0, 0, w, h, PAGE.bg);
            const step = (i) => E.outCubic(clamp(built - i));
            const blockIn = (i) => {
                const k = step(i);
                ctx.globalAlpha = k;
                return (1 - k) * 8;
            };
            ctx.save();
            pageNav(w, step(0));
            if (page === 'home') {
                let off = blockIn(1);
                text('14 to 16 August', 22, 78 + off, 13, PAGE.accent, 600);
                off = blockIn(2);
                text('Two stages.', 22, 116 + off, 34, PAGE.ink, 700);
                text('Three nights.', 22, 156 + off, 34, PAGE.ink, 700);
                off = blockIn(3);
                fillRound(22, 188 + off, 104, 34, 17, PAGE.ink);
                text('Get tickets', 74, 205 + off, 13, PAGE.bg, 600, SANS, 'center');
                off = blockIn(4);
                fillRound(Math.max(300, w * 0.55), 70 + off, w - Math.max(300, w * 0.55) - 22, 160, 10, PAGE.field);
                circle(Math.max(300, w * 0.55) + 60, 130 + off, 16, PAGE.accent);
            } else if (page === 'lineup') {
                let off = blockIn(1);
                text('Line-up', 22, 80 + off, 26, PAGE.ink, 700);
                off = blockIn(2);
                const days = ['Fri 14', 'Sat 15', 'Sun 16'];
                for (let i = 0; i < 3; i++) {
                    const dx = 22 + i * 74;
                    fillRound(dx, 104 + off, 64, 26, 13, i === 0 ? PAGE.ink : 'rgba(27,26,23,0.06)');
                    text(days[i], dx + 32, 117.5 + off, 12, i === 0 ? PAGE.bg : PAGE.muted, 500, SANS, 'center');
                }
                const colW = (w - 56) / 2;
                for (let c = 0; c < 2; c++) {
                    off = blockIn(3 + c);
                    const cx = 22 + c * (colW + 12);
                    text(c === 0 ? 'Veld' : 'Bos', cx, 150 + off, 13, PAGE.accent, 700);
                    let row = 0;
                    for (const act of ACTS) {
                        if (act[1] !== (c === 0 ? 'Veld' : 'Bos')) {
                            continue;
                        }
                        const ry = 166 + row * 38 + off;
                        fillRound(cx, ry, colW, 32, 7, 'rgba(27,26,23,0.05)');
                        text(act[0], cx + 12, ry + 16.5, 13, PAGE.ink, 600);
                        text(act[2], cx + colW - 12, ry + 16.5, 12, PAGE.muted, 400, MONO, 'right');
                        row++;
                    }
                }
            } else if (page === 'map') {
                let off = blockIn(1);
                text('Map', 22, 80 + off, 26, PAGE.ink, 700);
                off = blockIn(2);
                const mx = 22;
                const my = 104 + off;
                const mw = w - 44;
                const mh = Math.max(80, h - 124);
                fillRound(mx, my, mw, mh, 12, PAGE.field);
                ctx.save();
                R.roundRect(ctx, mx, my, mw, mh, 12);
                ctx.clip();
                ctx.globalAlpha = step(3);
                ctx.strokeStyle = 'rgba(27,26,23,0.35)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 6]);
                ctx.beginPath();
                ctx.moveTo(mx + mw * 0.2, my + mh * 0.75);
                ctx.bezierCurveTo(mx + mw * 0.4, my + mh * 0.4, mx + mw * 0.6, my + mh * 0.9, mx + mw * 0.78, my + mh * 0.35);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = step(4);
                for (const [px, py, name] of [
                    [0.2, 0.72, 'Veld'],
                    [0.78, 0.33, 'Bos']
                ]) {
                    circle(mx + mw * px, my + mh * py, 12, PAGE.accent);
                    text(name, mx + mw * px + 18, my + mh * py + 0.5, 13, PAGE.ink, 700);
                }
                ctx.restore();
            } else if (page === 'tickets') {
                let off = blockIn(1);
                text('Tickets', 22, 80 + off, 26, PAGE.ink, 700);
                const cards = built >= 5 ? ['Day ticket', 'Weekend'] : ['Weekend'];
                const cw = (w - 56) / 2;
                for (let i = 0; i < 2; i++) {
                    off = blockIn(2 + i);
                    const cx = 22 + i * (cw + 12);
                    const cy = 104 + off;
                    if (i >= cards.length) {
                        strokeRound(cx + 0.5, cy + 0.5, cw - 1, 130, 12, 'rgba(27,26,23,0.18)');
                        continue;
                    }
                    const pop = cards.length === 2 && i === 0 ? E.outBack(clamp(built - 5), 2) : 1;
                    ctx.save();
                    ctx.translate(cx + cw / 2, cy + 65);
                    ctx.scale(pop, pop);
                    ctx.translate(-cx - cw / 2, -cy - 65);
                    fillRound(cx, cy, cw, 130, 12, i === 0 && cards.length === 2 ? PAGE.ink : '#ffffff');
                    const ink = i === 0 && cards.length === 2 ? PAGE.bg : PAGE.ink;
                    text(cards[i], cx + 16, cy + 26, 15, ink, 700);
                    text(cards[i] === 'Weekend' ? 'Fri 14 to Sun 16' : 'Pick your day', cx + 16, cy + 50, 12, i === 0 && cards.length === 2 ? 'rgba(242,237,227,0.7)' : PAGE.muted);
                    fillRound(cx + 16, cy + 84, 90, 30, 15, PAGE.accent);
                    text('Choose', cx + 61, cy + 99.5, 12, '#ffffff', 600, SANS, 'center');
                    ctx.restore();
                }
            }
            ctx.restore();
        };
        // `BrowserBody.tsx`: the 37 tall bar with back, forward, reload and the address, the page under it.
        const browserView = (view, w, h, time, built) => {
            rect(0, 0, w, 37, pal.raised);
            rect(0, 36, w, 1, 'rgba(255,255,255,0.07)');
            icon('back', 8, 12, 13, pal.muted);
            icon('forward', 30, 12, 13, pal.muted);
            icon('reload', 52, 12, 13, pal.muted);
            fillRound(74, 5, w - 82, 27, 6, pal.sunken);
            strokeRound(74.5, 5.5, w - 83, 26, 6, 'rgba(255,255,255,0.05)');
            icon('lock', 83, 13, 11, pal.muted);
            text(view.url, 101, 19, 13, pal.text);
            const loadK = R.fract(built);
            if (built < view.blocks && loadK < 0.5) {
                rect(0, 35, w, 2, 'rgba(21,93,252,0.16)');
                rect(-w / 3 + E.inOutSine(loadK * 2) * (w * 4) / 3, 35, w / 3, 2, pal.accent);
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 37, w, h - 37);
            ctx.clip();
            ctx.translate(0, 37);
            const scale = Math.min(1, w / 470);
            ctx.scale(scale, scale);
            browserPage(view.page, w / scale, (h - 37) / scale, built, time);
            ctx.restore();
        };

        /* Terminals tick on the beat: one new line per beat, the older ones pushed up. */
        const TEST_LINES = [
            ['lineup', 'shows Veld and Bos'],
            ['lineup', 'groups acts by day'],
            ['tickets', 'adds a pass to the cart'],
            ['map', 'places both stages'],
            ['tickets', 'totals the order'],
            ['lineup', 'sorts acts by time'],
            ['map', 'draws the walking route'],
            ['home', 'links to tickets']
        ];
        const DEV_LINES = [
            ['GET', '/lineup', '200', '6ms'],
            ['GET', '/map', '200', '4ms'],
            ['GET', '/', '200', '3ms'],
            ['GET', '/api/acts', '200', '11ms'],
            ['POST', '/api/cart', '201', '18ms'],
            ['GET', '/tickets', '200', '5ms']
        ];
        const terminalView = (view, w, h, time, lineH = 18, size = 13) => {
            rect(0, 0, w, h, pal.termBg);
            const count = Math.floor(time / BEAT + 1e-6);
            const since = time - count * BEAT;
            const scroll = (1 - E.outCubic(clamp(since / 0.14))) * lineH;
            const rows = Math.ceil(h / lineH) + 1;
            font(size, 400, MONO);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let k = 0; k < rows; k++) {
                const line = count - k;
                const ly = h - 14 - k * lineH + scroll;
                if (ly < -lineH) {
                    break;
                }
                ctx.globalAlpha = k === 0 ? E.outCubic(clamp(since / 0.12)) : 1;
                if (view.id === 'tests') {
                    const entry = TEST_LINES[R.mod(line, TEST_LINES.length)];
                    ctx.fillStyle = pal.green;
                    ctx.fillText('(pass)', 8, ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(entry[0] + ' > ' + entry[1], 8 + measure('(pass) '), ly);
                } else {
                    const entry = DEV_LINES[R.mod(line, DEV_LINES.length)];
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText('14:02:' + String(R.mod(line, 60)).padStart(2, '0'), 8, ly);
                    ctx.fillStyle = pal.blue;
                    ctx.fillText(entry[0], 8 + measure('14:02:00 '), ly);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(entry[1], 8 + measure('14:02:00 POST '), ly);
                    ctx.fillStyle = pal.green;
                    ctx.fillText(entry[2], 8 + measure('14:02:00 POST /api/cart '), ly);
                }
            }
            ctx.globalAlpha = 1;
        };

        /* A drawing: hand strokes that draw themselves, one per beat. */
        const SKETCH = [
            'M 20 40 C 50 38, 90 39, 120 40 C 121 60, 120 76, 121 94 C 90 96, 50 95, 19 96 C 18 76, 20 58, 20 40',
            'M 180 14 C 210 13, 250 15, 280 14 C 281 30, 280 42, 281 56 C 250 57, 210 55, 179 57 C 179 42, 180 28, 180 14',
            'M 180 80 C 210 79, 250 81, 280 80 C 281 96, 280 108, 281 122 C 250 123, 210 121, 179 123 C 179 108, 180 94, 180 80',
            'M 180 146 C 210 145, 250 147, 280 146 C 281 162, 280 174, 281 188 C 250 189, 210 187, 179 189 C 179 174, 180 160, 180 146',
            'M 124 60 C 140 50, 160 38, 174 35 M 166 30 L 175 35 L 168 42',
            'M 124 70 C 140 80, 160 98, 174 101 M 165 95 L 175 101 L 167 108',
            'M 122 82 C 138 120, 156 156, 174 166 M 164 161 L 175 166 L 170 175'
        ].map((d) => new Path2D(d));
        const SKETCH_WORDS = [
            [0, 'home', 44, 69],
            [1, 'line-up', 202, 36],
            [2, 'tickets', 202, 102],
            [3, 'map', 214, 168]
        ];
        const dotsLocal = (w, h, pitch = 16) => {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            for (let y = 8; y < h; y += pitch) {
                for (let x = 8; x < w; x += pitch) {
                    ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
                }
            }
        };
        const drawingView = (w, h, time, strokes) => {
            rect(0, 0, w, h, pal.bg);
            dotsLocal(w, h);
            const scale = Math.min(1.2, (w - 30) / 300, (h - 20) / 200);
            ctx.save();
            ctx.translate((w - 300 * scale) / 2, (h - 200 * scale) / 2);
            ctx.scale(scale, scale);
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = pal.text;
            for (let k = 0; k < SKETCH.length; k++) {
                const amount = E.inOutSine(clamp(strokes - k));
                if (amount <= 0) {
                    continue;
                }
                ctx.setLineDash([amount * 420, 600]);
                ctx.stroke(SKETCH[k]);
            }
            ctx.setLineDash([]);
            for (const [at, word, x, y] of SKETCH_WORDS) {
                const k = clamp((strokes - at) * 2 - 0.5);
                if (k > 0) {
                    ctx.save();
                    ctx.globalAlpha *= k;
                    text(word, x, y, 17, pal.text, 400, HAND);
                    ctx.restore();
                }
            }
            ctx.restore();
        };

        /* A file, with the line the agent just wrote washed green. */
        const CODE = [
            [['k', 'export const '], ['v', 'stages'], ['p', ' = ['], ['s', "'Veld'"], ['p', ', '], ['s', "'Bos'"], ['p', '];']],
            [],
            [['k', 'export const '], ['v', 'days'], ['p', ' = [']],
            [['p', '    { date: '], ['s', "'2026-08-14'"], ['p', ', label: '], ['s', "'Fri 14'"], ['p', ' },']],
            [['p', '    { date: '], ['s', "'2026-08-15'"], ['p', ', label: '], ['s', "'Sat 15'"], ['p', ' },']],
            [['p', '    { date: '], ['s', "'2026-08-16'"], ['p', ', label: '], ['s', "'Sun 16'"], ['p', ' }']],
            [['p', '];']],
            [],
            [['k', 'export function '], ['f', 'lineupFor'], ['p', '(day: Day) {']],
            [['k', '    return '], ['v', 'acts'], ['p', '.'], ['f', 'filter'], ['p', '((act) => act.day === day.date);']],
            [['p', '}']]
        ];
        const CODE_COLOR = { k: pal.magenta, v: pal.text, p: pal.termFg, s: '#a3e635', f: pal.blue };
        const fileView = (w, h, time) => {
            rect(0, 0, w, h, pal.termBg);
            const written = Math.floor(time / 2) % CODE.length;
            const since = time - Math.floor(time / 2) * 2;
            font(12, 400, MONO);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < CODE.length; i++) {
                const ly = 16 + i * 19;
                if (ly > h) {
                    break;
                }
                if (i === written && CODE[i].length) {
                    ctx.fillStyle = `rgba(74,222,128,${(0.14 * (1 - smooth(0.6, 2, since))).toFixed(3)})`;
                    ctx.fillRect(0, ly - 9.5, w, 19);
                    ctx.fillStyle = pal.green;
                    ctx.fillRect(0, ly - 9.5, 2, 19);
                }
                ctx.fillStyle = pal.termDim;
                ctx.textAlign = 'right';
                ctx.fillText(String(i + 1), 26, ly);
                ctx.textAlign = 'left';
                let lx = 38;
                for (const [kind, part] of CODE[i]) {
                    ctx.fillStyle = CODE_COLOR[kind];
                    ctx.fillText(part, lx, ly);
                    lx += measure(part);
                }
            }
        };

        /* The canvas of the project: a brief, the lead agent, its team and the tests. World units are app pixels. */
        const NOTE = { x: -636, y: -284, w: 250, h: 168 };
        const TESTS = { x: -636, y: -84, w: 250, h: 368 };
        const LEAD = { x: -330, y: -250, w: 390, h: 500 };
        const KIDS = [
            {
                title: 'Line-up page',
                branch: 'lineup-page',
                task: 'Build /lineup: both stages, all three days.',
                at: 16,
                y: -284,
                plan: [[16, 0], [18, 1], [19.5, 2], [20.5, 3], [22, 4]],
                done: 22,
                tools: [['edit', 'Edit', 'src/pages/lineup.tsx'], ['read', 'Read', 'content/acts.json'], ['edit', 'Edit', 'src/components/ActCard.tsx'], ['bash', 'Ran', 'bun test lineup']]
            },
            {
                title: 'Ticket shop',
                branch: 'ticket-shop',
                task: 'Build /tickets with a cart and checkout.',
                at: 16.5,
                y: -86,
                plan: [[16.5, 0], [19, 1], [21, 2]],
                done: 99,
                tools: [['read', 'Read', 'src/pages/tickets.tsx'], ['edit', 'Edit', 'src/tickets/checkout.ts'], ['bash', 'Ran', 'bun test tickets'], ['edit', 'Edit', 'src/tickets/cart.ts']]
            },
            {
                title: 'Festival map',
                branch: 'festival-map',
                task: 'Build /map with both stages and the routes.',
                at: 17,
                y: 112,
                plan: [[17, 0], [18.5, 1], [20.5, 2], [23, 3]],
                done: 99,
                tools: [['edit', 'Edit', 'src/pages/map.tsx'], ['read', 'Read', 'Festival brief'], ['edit', 'Edit', 'src/map/routes.ts'], ['bash', 'Ran', 'bun test map']]
            }
        ];
        const KID_X = 176;
        const KID_W = 456;
        const KID_H = 172;
        const kidRect = { x: 0, y: 0, w: KID_W, h: KID_H };
        const planOf = (kid, time) => {
            let count = 0;
            for (const [at, n] of kid.plan) {
                if (time >= at) {
                    count = n;
                }
            }
            return count;
        };
        const LEAD_ASK = 'Launch the Nachtveld site: line-up, tickets and a map.';
        const LEAD_PLAN = 'Three pages, so three agents, each in its own worktree with its own plan.';
        const leadItems = (time, words) => {
            const items = [{ type: 'user', text: LEAD_ASK }, { type: 'tool', tool: 'read', label: 'Read', detail: 'Festival brief' }, { type: 'text', text: LEAD_PLAN, words }];
            if (time >= 14.9) {
                items.push({ type: 'tool', tool: 'bash', label: time < 17.2 ? 'Starting' : 'Started', detail: '3 agents', live: time < 17.2, alpha: E.outCubic(phase(time, 14.9, 0.3)) });
            }
            if (time >= 22) {
                items.push({ type: 'muted', text: 'Line-up page is done. Waiting on the other two.', alpha: E.outCubic(phase(time, 22.1, 0.3)) });
            } else if (words > 16 && time < 14.9) {
                items.push({ type: 'working', seconds: 8 + Math.floor(time / 2) });
            }
            return items;
        };
        const leadStatus = (time) => (time >= 17.2 && time < 22 ? 'idle' : 'running');
        const leadWords = (time) => (time - 4.6) / 0.25;

        const drawWorld = (time, lod) => {
            // Edges first, under the nodes.
            edge(NOTE, LEAD, EDGE_CONTEXT, 2, false);
            for (const kid of KIDS) {
                const k = spring(time - kid.at + 0.22, 15, 0.72);
                if (time < kid.at - 0.22) {
                    continue;
                }
                kidRect.x = lerp(LEAD.x + LEAD.w - KID_W, KID_X, k);
                kidRect.y = lerp(LEAD.y + 120, kid.y, k);
                const done = time >= kid.done;
                edge(LEAD, kidRect, done ? EDGE_CONTEXT : EDGE_CONTEXT, 2, !done, clamp(k * 1.3));
            }
            // The note.
            node(NOTE.x, NOTE.y, NOTE.w, NOTE.h, { kind: 'note', title: 'Festival brief', lod });
            if (!lod) {
                const lines = ['Nachtveld, 14 to 16 August', 'Two stages: Veld and Bos', 'Pages: line-up, tickets, map'];
                for (let i = 0; i < lines.length; i++) {
                    text(lines[i], NOTE.x + 14, NOTE.y + HEADER + 24 + i * 24, 14, pal.text);
                }
            } else {
                for (let i = 0; i < 3; i++) {
                    rect(NOTE.x + 14, NOTE.y + HEADER + 20 + i * 26, NOTE.w * (0.7 - i * 0.1), 7, 'rgba(236,236,241,0.35)');
                }
            }
            // Codex runs the tests in a terminal.
            node(TESTS.x, TESTS.y, TESTS.w, TESTS.h, { kind: 'terminal', agent: 'codex', title: 'tests', status: 'running', lod });
            ctx.save();
            R.roundRect(ctx, TESTS.x, TESTS.y + HEADER, TESTS.w, TESTS.h - HEADER, 11);
            ctx.clip();
            ctx.translate(TESTS.x, TESTS.y + HEADER);
            if (lod) {
                rect(0, 0, TESTS.w, TESTS.h - HEADER, pal.termBg);
                for (let i = 0; i < 8; i++) {
                    rect(10, 18 + i * 28, 30, 7, pal.green);
                    rect(46, 18 + i * 28, 100 + ((i * 37) % 60), 7, 'rgba(214,214,222,0.4)');
                }
            } else {
                terminalView({ id: 'tests' }, TESTS.w, TESTS.h - HEADER - 2, time, 20, 12);
            }
            ctx.restore();
            // The lead.
            node(LEAD.x, LEAD.y, LEAD.w, LEAD.h, { kind: 'chat', agent: 'claude', title: 'Launch the Nachtveld site', status: leadStatus(time), lod });
            ctx.save();
            R.roundRect(ctx, LEAD.x, LEAD.y + HEADER, LEAD.w, LEAD.h - HEADER, 11);
            ctx.clip();
            if (lod) {
                fillRound(LEAD.x + LEAD.w * 0.3, LEAD.y + 60, LEAD.w * 0.62, 50, 18, pal.active);
                for (let i = 0; i < 5; i++) {
                    rect(LEAD.x + 18, LEAD.y + 140 + i * 28, LEAD.w * (0.8 - (i % 3) * 0.15), 8, 'rgba(236,236,241,0.35)');
                }
            } else {
                drawThread(leadItems(time, leadWords(time)), LEAD.x + 18, LEAD.w - 36, LEAD.y + HEADER + 16, LEAD.y + LEAD.h - 18, time);
            }
            ctx.restore();
            // The team.
            for (const kid of KIDS) {
                if (time < kid.at - 0.22) {
                    continue;
                }
                const k = spring(time - kid.at + 0.22, 15, 0.72);
                const x = lerp(LEAD.x + LEAD.w - KID_W, KID_X, k);
                const y = lerp(LEAD.y + 120, kid.y, k);
                ctx.save();
                ctx.globalAlpha *= smooth(0, 0.25, k);
                const done = time >= kid.done;
                const plan = planOf(kid, time);
                node(x, y, KID_W, KID_H, { kind: 'chat', agent: 'claude', title: kid.title, status: done ? 'idle' : 'running', plan: [plan, 4], branch: kid.branch, lod });
                if (!lod) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x, y + HEADER, KID_W, KID_H - HEADER);
                    ctx.clip();
                    const bx = x + 18;
                    const bw = KID_W - 36;
                    text(kid.task, bx, y + HEADER + 22, 13, pal.muted);
                    // A new tool call on every other beat, staggered per agent so the three play a pattern.
                    const since = time - kid.at;
                    const n = Math.max(0, Math.floor((since + 0.01) / 1.5));
                    const into = since - n * 1.5;
                    const shift = (1 - E.outCubic(clamp(into / 0.22))) * 28;
                    const visible = Math.min(3, n + 1);
                    const full = n + 1 > 3;
                    for (let j = 0; j < visible + (full ? 1 : 0); j++) {
                        const index = n - visible + 1 + j - (full ? 1 : 0);
                        if (index < 0) {
                            continue;
                        }
                        const tool = kid.tools[index % kid.tools.length];
                        const newest = index === n;
                        const slot = j - (full ? 1 : 0);
                        const ry = y + HEADER + 36 + slot * 28 + (full ? shift : 0);
                        ctx.save();
                        ctx.globalAlpha *= newest ? E.outCubic(clamp(into / 0.2)) : full && j === 0 ? 1 - E.outCubic(clamp(into / 0.2)) : 1;
                        drawItem({ type: 'tool', tool: tool[0], label: tool[1], detail: tool[2], live: newest && !done }, bx, ry, bw, time);
                        ctx.restore();
                    }
                    ctx.restore();
                    if (done) {
                        const k2 = E.outBack(phase(time, kid.done, 0.35), 2);
                        ctx.save();
                        ctx.translate(x + KID_W - 60, y + KID_H - 26);
                        ctx.scale(k2, k2);
                        icon('circleCheck', -8, -7, 14, pal.idle);
                        text('Done', 10, 0.5, 13, pal.idle);
                        ctx.restore();
                    }
                }
                ctx.restore();
            }
        };
        // The canvas ground: neutral dots on a 24 pitch, which fade out when they get too dense. Never the accent.
        const worldDots = (x0, y0, x1, y1, scale) => {
            const pitch = 24;
            const alpha = smooth(5, 12, pitch * scale);
            if (alpha <= 0.01) {
                return;
            }
            ctx.fillStyle = `rgba(255,255,255,${(0.1 * alpha).toFixed(3)})`;
            const size = 1.4 / scale;
            for (let y = Math.floor(y0 / pitch) * pitch; y < y1; y += pitch) {
                for (let x = Math.floor(x0 / pitch) * pitch; x < x1; x += pitch) {
                    ctx.fillRect(x - size / 2, y - size / 2, size, size);
                }
            }
        };
        // Draws the canvas in a w x h view: world point (cx, cy) at the view's center (plus offY), zoom z.
        const canvasView = (w, h, time, cx, cy, z, offY, outer) => {
            rect(0, 0, w, h, pal.bg);
            ctx.save();
            ctx.translate(w / 2, h / 2 + offY);
            ctx.scale(z, z);
            ctx.translate(-cx, -cy);
            const x0 = cx - w / 2 / z;
            const y0 = cy - (h / 2 + offY) / z;
            worldDots(x0, y0, x0 + w / z, y0 + h / z, z * outer);
            drawWorld(time, z * outer < 0.5);
            ctx.restore();
        };

        /* The app window: the sidebar, the toolbar and the grid of views (`SplitGrid`: cells on a 1 px line). */
        const WIN = { w: 1312, h: 712, side: 248, bar: 48 };
        const GA = { x: 249, y: 49, w: 1063, h: 663 };
        const gridRect = (count, i, out) => {
            const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
            const rows = Math.ceil(count / cols);
            const cw = (GA.w - (cols - 1)) / cols;
            const ch = (GA.h - (rows - 1)) / rows;
            out.x = GA.x + (i % cols) * (cw + 1);
            out.y = GA.y + Math.floor(i / cols) * (ch + 1);
            out.w = cw;
            out.h = ch;
            return out;
        };
        const rowRect = (i, top, out) => {
            out.x = 8;
            out.y = top + i * 33;
            out.w = WIN.side - 16;
            out.h = 32;
            return out;
        };
        const lights = (x, y) => {
            circle(x, y, 6, '#ff5f57');
            circle(x + 20, y, 6, '#febc2e');
            circle(x + 40, y, 6, '#28c840');
        };
        const drawSidebar = (rows, waiting) => {
            rect(0, 0, WIN.side, WIN.h, pal.surface);
            rect(WIN.side, 0, 1, WIN.h, 'rgba(255,255,255,0.07)');
            lights(23, 24);
            text('Ruimte', 92, 24.5, 13, pal.faint, 600);
            icon('panel', WIN.side - 36, 16, 16, pal.muted);
            let top = 56;
            if (waiting.alpha > 0.01) {
                ctx.save();
                ctx.globalAlpha *= waiting.alpha;
                dot(22, top + 14, 'needs', 4);
                text('Needs you', 34, top + 14.5, 13, pal.faint, 500);
                text('1', WIN.side - 18, top + 14.5, 13, pal.faint, 500, SANS, 'right');
                fillRound(8, top + 30, WIN.side - 16, 32, 6, 'rgba(251,191,36,0.08)');
                glyph(waiting.view, 16, top + 39, 14, pal.muted);
                text(waiting.view.name, 40, top + 46.5, 14, pal.text, 500);
                dot(WIN.side - 22, top + 46, 'needs', 4);
                ctx.restore();
                top += 76 * waiting.alpha;
            }
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const r = rowRect(i, top, scratchRow);
                if (row.selected) {
                    fillRound(r.x, r.y, r.w, r.h, 6, pal.active);
                }
                glyph(row.view, r.x + 8, r.y + 9, 14, pal.muted);
                ctx.save();
                ctx.beginPath();
                ctx.rect(r.x, r.y, r.w - 24, r.h);
                ctx.clip();
                text(row.view.name, r.x + 32, r.y + 16.5, 14, row.open ? pal.text : pal.muted, 500);
                ctx.restore();
                if (row.status === 'idle') {
                    icon('circleCheck', r.x + r.w - 20, r.y + 10, 12, pal.idle);
                } else if (row.status) {
                    dot(r.x + r.w - 14, r.y + 16, row.status, 4);
                }
            }
            rect(0, WIN.h - 49, WIN.side, 1, 'rgba(255,255,255,0.07)');
            icon('plus', 18, WIN.h - 32, 14, pal.muted);
            text('View', 40, WIN.h - 24.5, 14, pal.muted);
            circle(WIN.side - 98, WIN.h - 25, 4, pal.idle);
            icon('chart', WIN.side - 76, WIN.h - 33, 16, pal.muted);
            icon('reload', WIN.side - 40, WIN.h - 33, 16, pal.muted);
        };
        const drawToolbar = () => {
            rect(GA.x, 0, GA.w, WIN.bar, pal.surface);
            rect(GA.x, WIN.bar - 1, GA.w, 1, 'rgba(255,255,255,0.07)');
            icon('laptop', GA.x + 18, 17, 14, pal.muted);
            fillRound(GA.x + 42, 16, 16, 16, 3, 'rgba(228,87,46,0.2)');
            text('N', GA.x + 50, 24.5, 12, '#e4572e', 600, SANS, 'center');
            text('nachtveld-web', GA.x + 66, 24.5, 14, pal.text, 500);
            font(14, 500);
            icon('chevronDown', GA.x + 72 + measure('nachtveld-web'), 17, 14, pal.muted);
            const right = GA.x + GA.w;
            icon('search', right - 32, 16, 16, pal.muted);
            rect(right - 50, 16, 1, 16, 'rgba(255,255,255,0.07)');
            icon('phone', right - 82, 16, 16, pal.muted);
            icon('branch', right - 114, 16, 16, pal.muted);
            icon('folder', right - 146, 16, 16, pal.muted);
            rect(right - 164, 16, 1, 16, 'rgba(255,255,255,0.07)');
        };
        // `CellToolbar.tsx`: 40 tall once the grid holds more than one view.
        const cellToolbar = (x, y, w, bar, view, focused, status) => {
            rect(x, y, w, bar, focused ? pal.surface : '#0e0e10');
            rect(x, y + bar - 1, w, 1, 'rgba(255,255,255,0.07)');
            const mid = y + bar / 2;
            glyph(view, x + 12, mid - 7, 14, pal.muted);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w - 60, bar);
            ctx.clip();
            text(view.name, x + 34, mid + 0.5, 13, focused ? pal.text : pal.muted, 500);
            ctx.restore();
            if (status) {
                if (status === 'idle') {
                    icon('circleCheck', x + w - 50, mid - 6, 12, pal.idle);
                } else {
                    dot(x + w - 44, mid, status, 4);
                }
            }
            icon('close', x + w - 26, mid - 7, 14, pal.faint);
        };
        const scratchRow = { x: 0, y: 0, w: 0, h: 0 };
        const scratchCell = { x: 0, y: 0, w: 0, h: 0 };
        const scratchFrom = { x: 0, y: 0, w: 0, h: 0 };

        // One app window: `cells` carry their own rect, alpha, toolbar and dim; `body` draws a view's content.
        const drawApp = (rows, waiting, cells, body, dimAll = 0) => {
            fillRound(0, 10, WIN.w, WIN.h, 12, 'rgba(0,0,0,0.45)');
            fillRound(0, 0, WIN.w, WIN.h, 12, pal.bg);
            ctx.save();
            R.roundRect(ctx, 0, 0, WIN.w, WIN.h, 12);
            ctx.clip();
            drawSidebar(rows, waiting);
            drawToolbar();
            rect(GA.x, GA.y, GA.w, GA.h, 'rgba(255,255,255,0.07)');
            for (const cell of cells) {
                if (cell.alpha <= 0.01 || cell.w < 2 || cell.h < 2) {
                    continue;
                }
                ctx.save();
                ctx.globalAlpha *= cell.alpha;
                if (cell.flying) {
                    fillRound(cell.x, cell.y + 6, cell.w, cell.h, 8, 'rgba(0,0,0,0.45)');
                }
                R.roundRect(ctx, cell.x, cell.y, cell.w, cell.h, cell.flying ? 8 : 0);
                ctx.fillStyle = pal.bg;
                ctx.fill();
                ctx.clip();
                const bar = Math.round(40 * cell.bar);
                ctx.save();
                ctx.translate(cell.x + (cell.lagX || 0), cell.y + bar + (cell.lagY || 0));
                ctx.beginPath();
                ctx.rect(-(cell.lagX || 0), -(cell.lagY || 0), cell.w, cell.h - bar);
                ctx.clip();
                body(cell, cell.w, cell.h - bar);
                ctx.restore();
                if (bar > 0) {
                    cellToolbar(cell.x, cell.y, cell.w, bar, cell.view, cell.focused, cell.status);
                }
                if (cell.dim > 0.01) {
                    rect(cell.x, cell.y, cell.w, cell.h, `rgba(13,13,16,${(0.72 * cell.dim).toFixed(3)})`);
                }
                if (cell.flying) {
                    strokeRound(cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1, 8, 'rgba(255,255,255,0.13)');
                }
                if (cell.ring > 0.01) {
                    ctx.globalAlpha *= cell.ring;
                    strokeRound(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2, 0, pal.needs, 2);
                }
                ctx.restore();
            }
            if (dimAll > 0.01) {
                rect(0, 0, GA.x, WIN.h, `rgba(13,13,16,${(0.6 * dimAll).toFixed(3)})`);
                rect(GA.x, 0, GA.w, WIN.bar, `rgba(13,13,16,${(0.6 * dimAll).toFixed(3)})`);
            }
            ctx.restore();
            strokeRound(0.5, 0.5, WIN.w - 1, WIN.h - 1, 12, 'rgba(255,255,255,0.1)');
        };
        // The window's camera: logical point (cx, cy) at the frame's center, a little above the caption.
        const CAM_Y = 496;
        const camera = (cx, cy, z) => {
            ctx.translate(960, CAM_Y);
            ctx.scale(z, z);
            ctx.translate(-cx, -cy);
        };

        /* Act one: the grid fills on the beat. The views, in the order they fly in. */
        const G1 = [
            { kind: 'chat', agent: 'claude', name: 'Launch the Nachtveld site', id: 'lead', status: 'running' },
            { kind: 'terminal', agent: 'codex', name: 'tests', id: 'tests', status: 'running' },
            { kind: 'browser', name: 'Line-up', url: 'localhost:3000/lineup', page: 'lineup', blocks: 5, born: 8 },
            { kind: 'drawing', name: 'Site map', born: 8.5 },
            { kind: 'canvas', name: 'nachtveld-web' },
            { kind: 'terminal', name: 'dev server', id: 'dev' },
            { kind: 'file', name: 'lineup.ts' },
            { kind: 'browser', name: 'Map', url: 'localhost:3000/map', page: 'map', blocks: 5, born: 10.75 },
            { kind: 'browser', name: 'Home', url: 'localhost:3000', page: 'home', blocks: 5, born: 11 }
        ];
        // Each step lands on a beat; a new cell leaves its row a little early so it arrives on the beat, not after it.
        const STEPS1 = [
            { at: 4, tally: 1, gap: 0 },
            { at: 6, tally: 2, gap: 0 },
            { at: 8, tally: 4, gap: 0.5 },
            { at: 10, tally: 9, gap: 0.25 }
        ];
        const EARLY = 0.2;
        const cells1 = G1.map((view, i) => ({ view, i, x: 0, y: 0, w: 0, h: 0, alpha: 0, bar: 0, focused: false, flying: false, lagX: 0, lagY: 0, dim: 0, ring: 0, status: view.status }));
        const targetOf = (step, i, out) => (i < step.tally ? gridRect(step.tally, i, out) : rowRect(i, 56, out));
        const layoutGrid1 = (time) => {
            let tally = 1;
            for (const step of STEPS1) {
                if (time >= step.at - EARLY) {
                    tally = step.tally;
                }
            }
            for (const cell of cells1) {
                const i = cell.i;
                const first = targetOf(STEPS1[0], i, scratchFrom);
                let x = first.x;
                let y = first.y;
                let w = first.w;
                let h = first.h;
                let softX = x;
                let softY = y;
                let alpha = i < 1 ? 1 : 0;
                let arc = 0;
                let flying = false;
                for (let k = 1; k < STEPS1.length; k++) {
                    const before = STEPS1[k - 1];
                    const step = STEPS1[k];
                    const from = targetOf(before, i, scratchFrom);
                    const fx = from.x;
                    const fy = from.y;
                    const fw = from.w;
                    const fh = from.h;
                    const to = targetOf(step, i, scratchCell);
                    const opening = i >= before.tally && i < step.tally;
                    const delay = opening ? (i - before.tally) * step.gap : 0;
                    const elapsed = time - step.at + EARLY - delay;
                    const eased = opening ? spring(elapsed, 17, 0.8) : spring(elapsed, 19, 0.74);
                    const soft = spring(elapsed - 0.04, 12, 0.7);
                    x += (to.x - fx) * eased;
                    y += (to.y - fy) * eased;
                    w += (to.w - fw) * eased;
                    h += (to.h - fh) * eased;
                    softX += (to.x - fx) * soft;
                    softY += (to.y - fy) * soft;
                    if (opening && elapsed > 0) {
                        const amount = clamp(eased);
                        flying = flying || elapsed < 0.4;
                        arc += Math.sin(Math.PI * amount) * -40;
                        alpha = smooth(0, 0.2, amount);
                    }
                }
                cell.x = x;
                cell.y = y + arc;
                cell.w = Math.max(0, w);
                cell.h = Math.max(0, h);
                cell.alpha = alpha;
                cell.flying = flying;
                cell.lagX = clamp((softX - x) * 0.4, -16, 16);
                cell.lagY = clamp((softY - y) * 0.4, -16, 16);
                cell.bar = i === 0 ? smooth(0, 0.3, time - STEPS1[1].at + EARLY) : flying ? 1 : smooth(0, 0.3, time - STEPS1[1].at + EARLY);
                cell.focused = i === Math.min(tally, 9) - 1;
            }
            return tally;
        };
        const rows1 = G1.map((view) => ({ view, open: false, selected: false, status: view.status }));
        const noWaiting = { alpha: 0, view: null };

        const body1 = (cell, w, h) => {
            const view = cell.view;
            const time = NOW;
            if (view.kind === 'chat') {
                rect(0, 0, w, h, pal.bg);
                const colW = Math.min(w - 36, 600);
                drawThread(leadItems(Math.min(time, 14), leadWords(time)), (w - colW) / 2, colW, 16, h - 16, time);
            } else if (view.kind === 'terminal') {
                terminalView(view, w, h, time);
            } else if (view.kind === 'browser') {
                const built = view.born === undefined ? 9 : clamp((time - view.born) / BEAT + 0.6, 0, view.blocks);
                browserView(view, w, h, time, built);
            } else if (view.kind === 'drawing') {
                drawingView(w, h, time, (time - view.born) / BEAT);
            } else if (view.kind === 'file') {
                fileView(w, h, time);
            } else if (view.kind === 'canvas') {
                const grow = cell.grow || 0;
                canvasView(w, h, time, MINI_CX, MINI_CY, miniZoom(w, h), 12 * grow, cell.outer || 1.25);
            }
        };

        /* Act one and two share the window: the grid fills, then the canvas cell swallows the grid. */
        const CANVAS_CELL = 4;
        const appCam = { x: 0, y: 0, z: 1 };
        const MINI_CX = -250;
        const MINI_CY = -10;
        const miniZoom = (w, h) => Math.min(w / 1000, h / 737);
        const canvasCam = (time) => {
            const z0 = miniZoom(GA.w, GA.h);
            const k1 = E.inOutCubic(phase(time, 14.0, 1.0));
            const k2 = E.inOutCubic(phase(time, 15.4, 1.3));
            const k3 = E.inOutSine(phase(time, 17.6, 6.4));
            let cx = lerp(MINI_CX, -200, k1);
            let cy = lerp(MINI_CY, 0, k1);
            let z = lerp(z0, 0.92, k1);
            cx = lerp(cx, -4, k2);
            cy = lerp(cy, 0, k2);
            z = lerp(z, 0.735, k2);
            cx = lerp(cx, 40, k3);
            z = lerp(z, 0.775, k3);
            return { cx, cy, z };
        };
        const actGrid = (time) => {
            const tally = layoutGrid1(time);
            // The swallow: the canvas cell grows over the whole grid, landing on the downbeat at 14.
            const grow = E.inOutCubic(phase(time, 13.4, 0.6));
            const push = E.inOutCubic(phase(time, 13.45, 0.9));
            for (const cell of cells1) {
                if (cell.i === CANVAS_CELL) {
                    cell.x = lerp(cell.x, GA.x, grow);
                    cell.y = lerp(cell.y, GA.y, grow);
                    cell.w = lerp(cell.w, GA.w, grow);
                    cell.h = lerp(cell.h, GA.h, grow);
                    cell.bar *= 1 - grow;
                    cell.grow = grow;
                    cell.focused = grow > 0.5 || cell.focused;
                } else {
                    cell.alpha *= 1 - smooth(0.25, 0.75, grow);
                }
                cell.outer = lerp(1.25, 1.82, push);
            }
            for (let i = 0; i < rows1.length; i++) {
                rows1[i].open = i < tally;
                rows1[i].selected = time < 13.4 ? i === tally - 1 : i === CANVAS_CELL;
            }
            appCam.x = lerp(WIN.w / 2, GA.x + GA.w / 2, push);
            appCam.y = lerp(WIN.h / 2, GA.y + GA.h / 2 + 22, push);
            appCam.z = lerp(1.25, 1.82, push);
            const order = cells1.slice().sort((a, b) => (a.flying ? 1 : 0) - (b.flying ? 1 : 0) || (a.i === CANVAS_CELL ? 1 : 0) - (b.i === CANVAS_CELL ? 1 : 0));
            ctx.save();
            camera(appCam.x, appCam.y, appCam.z);
            if (time < 14) {
                drawApp(rows1, noWaiting, order, body1);
            } else {
                drawApp(rows1, noWaiting, [cells1[CANVAS_CELL]], (cell, w, h) => {
                    const cam = canvasCam(time);
                    canvasView(w, h, time, cam.cx, cam.cy, cam.z, 12, appCam.z);
                });
            }
            ctx.restore();
        };

        /* The wordmark: Geist 600, a dotless i and the accent tittle drawn apart, measured from the font. */
        const WORD = ['R', 'u', 'ı', 'm', 't', 'e'];
        const WSIZE = 200;
        const WFONT = `600 ${WSIZE}px ${SANS}`;
        const WM = { adv: [], left: [], width: 0, xh: WSIZE * 0.54, tittle: { dx: 0, top: WSIZE * 0.72, w: WSIZE * 0.135, h: WSIZE * 0.13 } };
        const measureWord = () => {
            ctx.save();
            ctx.font = WFONT;
            let x = 0;
            for (let i = 0; i < WORD.length; i++) {
                WM.adv[i] = ctx.measureText(WORD[i]).width;
                WM.left[i] = x;
                x += WM.adv[i];
                if (i < WORD.length - 1) {
                    x += ctx.measureText(WORD[i] + WORD[i + 1]).width - WM.adv[i] - ctx.measureText(WORD[i + 1]).width;
                }
            }
            WM.width = x;
            const xm = ctx.measureText('x');
            if (xm.actualBoundingBoxAscent) {
                WM.xh = xm.actualBoundingBoxAscent;
            }
            ctx.restore();
            // The tittle is what the dotted i has and the dotless one does not.
            const probe = document.createElement('canvas');
            const scale = 2;
            const pw = Math.ceil(WM.adv[2] * scale) + 8;
            const ph = Math.ceil(WSIZE * 1.1 * scale);
            probe.width = pw;
            probe.height = ph;
            const pen = probe.getContext('2d', { willReadFrequently: true });
            const base = WSIZE * 0.95 * scale;
            pen.font = `600 ${WSIZE * scale}px ${SANS}`;
            pen.fillStyle = '#fff';
            pen.fillText('i', 4, base);
            const dotted = pen.getImageData(0, 0, pw, ph).data;
            pen.clearRect(0, 0, pw, ph);
            pen.fillText('ı', 4, base);
            const plain = pen.getImageData(0, 0, pw, ph).data;
            let x0 = pw;
            let x1 = -1;
            let y0 = ph;
            let y1 = -1;
            for (let y = 0; y < ph; y++) {
                for (let xx = 0; xx < pw; xx++) {
                    const k = (y * pw + xx) * 4 + 3;
                    if (dotted[k] > 128 && plain[k] < 64) {
                        x0 = Math.min(x0, xx);
                        x1 = Math.max(x1, xx);
                        y0 = Math.min(y0, y);
                        y1 = Math.max(y1, y);
                    }
                }
            }
            if (x1 > x0 && y1 > y0) {
                WM.tittle.w = (x1 - x0 + 1) / scale;
                WM.tittle.h = (y1 - y0 + 1) / scale;
                WM.tittle.dx = ((x0 + x1 + 1) / 2 - 4) / scale - WM.adv[2] / 2;
                WM.tittle.top = (base - y0) / scale;
            }
        };
        measureWord();
        const letterX = new Array(6).fill(0);
        const layoutWord = (cx, gaps) => {
            let total = 0;
            for (let i = 0; i < 5; i++) {
                total += gaps[i];
            }
            const start = cx - (WM.width + total) / 2;
            let acc = 0;
            for (let j = 0; j < 6; j++) {
                letterX[j] = start + WM.left[j] + acc + WM.adv[j] / 2;
                if (j < 5) {
                    acc += gaps[j];
                }
            }
        };
        const letter = (j, x, baseline, sx, sy, alpha, skew = 0) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x, baseline);
            ctx.transform(sx, 0, -skew * sy, sy, 0, 0);
            ctx.font = WFONT;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = pal.text;
            ctx.fillText(WORD[j], -WM.adv[j] / 2, 0);
            ctx.restore();
        };
        const tittle = (x, y, sx, sy, alpha, glow, color = pal.accent, radiusK = 0.2) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            if (glow > 0.01) {
                const halo = ctx.createRadialGradient(x, y, 0, x, y, WM.tittle.w * 2.4);
                halo.addColorStop(0, R.rgba(pal.accent, 0.4 * glow));
                halo.addColorStop(1, R.rgba(pal.accent, 0));
                ctx.fillStyle = halo;
                ctx.fillRect(x - WM.tittle.w * 2.4, y - WM.tittle.w * 2.4, WM.tittle.w * 4.8, WM.tittle.w * 4.8);
            }
            ctx.translate(x, y);
            ctx.scale(sx, sy);
            fillRound(-WM.tittle.w / 2, -WM.tittle.h / 2, WM.tittle.w, WM.tittle.h, Math.min(WM.tittle.w, WM.tittle.h) * radiusK, color);
            ctx.restore();
        };
        const tittleHome = (baseline) => ({ x: letterX[2] + WM.tittle.dx, y: baseline - (WM.tittle.top - WM.tittle.h / 2) });

        /* Act zero: the wordmark, on the first beats. */
        const WORD_CX = 960;
        const WORD_BASE = 596;
        const gapsNow = [0, 0, 0, 0, 0];
        const openWord = (time) => {
            // The tracking steps wider on each of the first beats, springing past each step.
            let gap = -10;
            for (const at of [0.5, 1, 1.5]) {
                gap += 26 * spring(time - at + 0.04, 30, 0.42);
            }
            gap -= 16 * E.inOutSine(phase(time, 2.98, 0.24));
            for (let i = 0; i < 5; i++) {
                gapsNow[i] = gap;
            }
            layoutWord(WORD_CX, gapsNow);
            const appear = E.outCubic(phase(time, 0, 0.16));
            const scatter = E.inCubic(phase(time, 3.2, 0.42));
            const gone = 1 - smooth(3.32, 3.58, time);
            const center = WORD_CX + WM.tittle.dx * 0;
            for (let j = 0; j < 6; j++) {
                const since = time - (2.5 + j * 0.05);
                let dy = 0;
                let sx = 1;
                let sy = 1;
                if (since > 0 && since < 0.36) {
                    const p = since / 0.36;
                    dy = -34 * 4 * p * (1 - p);
                    sy = 1 + 0.1 * Math.abs(1 - 2 * p);
                    sx = 1 / Math.sqrt(sy);
                } else if (since >= 0.36 && since < 1.2) {
                    const land = since - 0.36;
                    const wobble = Math.exp(-land * 10) * Math.cos(land * 24);
                    sy = 1 - 0.1 * wobble;
                    sx = 1 + 0.08 * wobble;
                }
                // The downbeat lands on every letter at once.
                const hit = time - 2;
                if (hit > 0 && hit < 1) {
                    const wobble = Math.exp(-hit * 9) * Math.cos(hit * 26);
                    sy *= 1 - 0.05 * wobble;
                    sx *= 1 + 0.04 * wobble;
                }
                const away = (letterX[j] - center) * scatter * 7;
                const stretch = 1 + scatter * 1.6;
                letter(j, letterX[j] + away, WORD_BASE + dy, sx * stretch, sy / Math.sqrt(stretch), appear * gone, 0);
            }
            // The tittle drops on the downbeat at 2: it falls, squashes on the stem, and stays when the letters go.
            const home = tittleHome(WORD_BASE);
            if (time >= 1.72) {
                const fall = clamp((time - 1.72) / 0.28);
                let y = home.y - 360 * (1 - fall * fall);
                let sx = 1;
                let sy = 1;
                if (fall < 1) {
                    sy = 1 + 0.5 * fall;
                    sx = 1 / Math.sqrt(sy);
                } else {
                    const land = time - 2;
                    const wobble = Math.exp(-land * 8) * Math.cos(land * 22);
                    sy = 1 - 0.38 * wobble;
                    sx = 1 + 0.32 * wobble;
                    y += (WM.tittle.h / 2) * (1 - sy);
                }
                const growK = E.inOutCubic(phase(time, 3.45, 0.55));
                if (growK <= 0) {
                    tittle(home.x, y, sx, sy, 1, fall >= 1 ? 0.5 + 0.5 * Math.exp(-(time - 2) * 3) : 0.3);
                } else {
                    // The tittle becomes the window: it opens to the window's size while it takes the window's color.
                    const tw = WM.tittle.w;
                    const th = WM.tittle.h;
                    const ww = WIN.w * 1.25;
                    const wh = WIN.h * 1.25;
                    const w = tw * Math.pow(ww / tw, growK);
                    const h = th * Math.pow(wh / th, growK);
                    const cx = lerp(home.x, 960, E.inOutSine(growK));
                    const cy = lerp(home.y, CAM_Y, E.inOutSine(growK));
                    const color = R.mix(pal.accent, pal.bg, smooth(0.3, 0.95, growK));
                    fillRound(cx - w / 2, cy - h / 2, w, h, lerp(Math.min(tw, th) * 0.2, 15, growK), color);
                    if (growK > 0.6) {
                        strokeRound(cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1, 15, `rgba(255,255,255,${(0.12 * smooth(0.6, 1, growK)).toFixed(3)})`);
                    }
                }
            }
        };

        /* Act three: a montage, one idea per bar, cut on the downbeat. */
        const shotFrame = (time, start) => {
            // Each shot punches in on its cut and drifts a hair while it plays.
            const since = time - start;
            return 1.045 - 0.045 * E.outExpo(clamp(since / 0.45)) + 0.012 * since;
        };
        const withScale = (cx, cy, s, fn) => {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(s, s);
            fn();
            ctx.restore();
        };
        const screenDots = (alpha = 1) => {
            ctx.fillStyle = `rgba(255,255,255,${(0.07 * alpha).toFixed(3)})`;
            for (let y = 12; y < 1080; y += 40) {
                for (let x = 20; x < 1920; x += 40) {
                    ctx.fillRect(x - 1, y - 1, 2, 2);
                }
            }
        };

        // A: draw a line from the brief to the map agent; the brief rides the line into the chat.
        const A_NOTE = { x: -404, y: -92, w: 262, h: 168 };
        const A_CHAT = { x: 24, y: -130, w: 380, h: 230 };
        const aTarget = { x: 0, y: 0, w: 1, h: 1 };
        const shotContext = (time) => {
            const s = 2.2 * shotFrame(time, 24);
            screenDots();
            withScale(960, 470, s, () => {
                node(A_NOTE.x, A_NOTE.y, A_NOTE.w, A_NOTE.h, { kind: 'note', title: 'Festival brief' });
                const lines = ['Nachtveld, 14 to 16 August', 'Two stages: Veld and Bos', 'Pages: line-up, tickets, map'];
                for (let i = 0; i < 3; i++) {
                    text(lines[i], A_NOTE.x + 14, A_NOTE.y + HEADER + 24 + i * 24, 14, pal.text);
                }
                const snapped = time >= 25;
                const status = 'running';
                node(A_CHAT.x, A_CHAT.y, A_CHAT.w, A_CHAT.h, { kind: 'chat', agent: 'claude', title: 'Festival map', status });
                const items = [{ type: 'user', text: 'Build /map with both stages and the routes.' }];
                if (time >= 25.45) {
                    items.push({ type: 'tool', tool: 'read', label: time < 25.95 ? 'Reading' : 'Read', detail: 'Festival brief', live: time < 25.95, alpha: E.outCubic(phase(time, 25.45, 0.2)) });
                }
                ctx.save();
                ctx.beginPath();
                ctx.rect(A_CHAT.x, A_CHAT.y + HEADER, A_CHAT.w, A_CHAT.h - HEADER);
                ctx.clip();
                drawThread(items, A_CHAT.x + 18, A_CHAT.w - 36, A_CHAT.y + HEADER + 16, A_CHAT.y + A_CHAT.h - 16, time);
                ctx.restore();
                // The cursor takes the note's edge and draws the line; it snaps to the chat on the beat.
                const port = { x: A_NOTE.x + A_NOTE.w + 9, y: A_NOTE.y + A_NOTE.h / 2 };
                const drop = { x: A_CHAT.x - 9, y: A_CHAT.y + A_CHAT.h / 2 };
                const drag = E.inOutCubic(phase(time, 24.3, 0.62));
                const cx = time < 24.3 ? lerp(port.x + 60, port.x, E.outCubic(phase(time, 24, 0.28))) : lerp(port.x, drop.x + 20, drag);
                const cy = time < 24.3 ? lerp(port.y + 70, port.y, E.outCubic(phase(time, 24, 0.28))) : lerp(port.y, drop.y + 12, drag) - Math.sin(Math.PI * drag) * 30;
                if (time >= 24.3) {
                    const flash = snapped ? Math.exp(-(time - 25) * 5) : 0;
                    const color = snapped ? R.mix(EDGE_HEX, pal.accent, flash) : pal.muted;
                    if (snapped) {
                        aTarget.x = A_CHAT.x;
                        aTarget.y = A_CHAT.y;
                        aTarget.w = A_CHAT.w;
                        aTarget.h = A_CHAT.h;
                        edge(A_NOTE, aTarget, snapped ? (flash > 0.05 ? color : EDGE_CONTEXT) : color, 2 + flash * 1.5, false);
                    } else {
                        ctx.beginPath();
                        ctx.moveTo(port.x, port.y);
                        const mx = (port.x + cx) / 2;
                        ctx.bezierCurveTo(mx, port.y, mx, cy, cx, cy);
                        ctx.strokeStyle = pal.muted;
                        ctx.lineWidth = 2;
                        ctx.lineCap = 'round';
                        ctx.stroke();
                    }
                    circle(port.x, port.y, 5, pal.bg);
                    ctx.beginPath();
                    ctx.arc(port.x, port.y, 5, 0, TAU);
                    ctx.strokeStyle = snapped ? EDGE_CONTEXT : pal.muted;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    // What the line carries: the brief's words, along the route into the chat.
                    if (snapped) {
                        const words = ['14 to 16 August', 'Veld', 'Bos'];
                        const points = routeBetween(A_NOTE, aTarget, routeScratch);
                        for (let i = 0; i < words.length; i++) {
                            const k = E.inOutSine(phase(time, 25.05 + i * 0.16, 0.5));
                            if (k <= 0 || k >= 1) {
                                continue;
                            }
                            const px = lerp(points[0][0], points[3][0], k);
                            const py = k < 0.5 ? points[0][1] : points[3][1];
                            const yy = lerp(points[0][1], points[3][1], smooth(0.35, 0.65, k));
                            font(12, 500);
                            const ww = measure(words[i]) + 16;
                            ctx.save();
                            ctx.globalAlpha *= Math.sin(Math.PI * k);
                            fillRound(px - ww / 2, yy - 11 + (py - py), ww, 22, 11, pal.hover);
                            strokeRound(px - ww / 2 + 0.5, yy - 10.5, ww - 1, 21, 10.5, 'rgba(255,255,255,0.13)');
                            text(words[i], px, yy + 0.5, 12, pal.text, 500, SANS, 'center');
                            ctx.restore();
                        }
                    }
                }
                const press = time >= 24.3 && time < 25 ? 1 : 0;
                cursor(cx, cy, 1.1, 1 - smooth(25.4, 25.8, time), press * 0.6);
            });
        };

        // B: the map agent's plan, a step checked on each beat.
        const PLAN_ITEMS = ['Place Veld and Bos on the map', 'Draw the walking routes', 'Add the map tiles', 'Test the map on a phone'];
        const shotPlan = (time) => {
            const s = 2.05 * shotFrame(time, 26);
            withScale(960, 470, s, () => {
                const w = 600;
                const x = -w / 2;
                const y = -205;
                const h = 400;
                fillRound(x, y + 4, w, h, 12, 'rgba(0,0,0,0.4)');
                fillRound(x, y, w, h, 12, pal.surface);
                strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, 12, 'rgba(255,255,255,0.13)');
                ctx.save();
                R.roundRect(ctx, x, y, w, h, 12);
                ctx.clip();
                rect(x, y + 39, w, 1, 'rgba(255,255,255,0.07)');
                text('Festival map', x + 14, y + 20, 12, pal.muted, 500);
                icon('close', x + w - 30, y + 12, 16, pal.muted);
                let done = 1;
                for (const at of [26.5, 27, 27.5]) {
                    if (time >= at) {
                        done++;
                    }
                }
                icon('checkCheck', x + 16, y + 58, 16, pal.muted);
                text('Festival map', x + 40, y + 66, 15, pal.text, 500);
                text('Both stages, the routes and the tiles for /map.', x + 16, y + 92, 13, pal.muted);
                text('Plan', x + 16, y + 118, 13, pal.muted);
                text(done + '/4 done', x + 54, y + 118, 13, pal.muted);
                fillRound(x + 16, y + 136, w - 32, 6, 3, pal.sunken);
                let fill = 1;
                for (const at of [26.5, 27, 27.5]) {
                    fill += E.outBack(phase(time, at, 0.3), 1.6);
                }
                fillRound(x + 16, y + 136, ((w - 32) * fill) / 4, 6, 3, pal.idle);
                rect(x, y + 158, w, 1, 'rgba(255,255,255,0.07)');
                icon('chevronDown', x + 16, y + 180, 14, pal.faint);
                text('Implementation', x + 38, y + 187, 14, pal.text, 500);
                text(done + '/4', x + w - 18, y + 187, 13, pal.muted, 400, SANS, 'right');
                for (let i = 0; i < 4; i++) {
                    const ry = y + 208 + i * 40;
                    const checkedAt = [0, 26.5, 27, 27.5][i];
                    const complete = time >= checkedAt;
                    const active = !complete && i === done;
                    if (active) {
                        fillRound(x + 8, ry, w - 16, 34, 6, 'rgba(21,93,252,0.14)');
                    }
                    const mx = x + 40;
                    const my = ry + 17;
                    if (complete) {
                        const pop = i === 0 ? 1 : E.outBack(phase(time, checkedAt, 0.28), 3);
                        ctx.save();
                        ctx.translate(mx, my);
                        ctx.scale(pop, pop);
                        icon('circleCheck', -8, -8, 16, pal.idle);
                        ctx.restore();
                        if (i > 0) {
                            clickRing(mx, my, time - checkedAt, 22, pal.idle);
                        }
                    } else if (active) {
                        icon('loader', mx - 8, my - 8, 16, pal.accent, time * TAU * 1.2);
                    } else {
                        icon('circle', mx - 8, my - 8, 16, pal.faint);
                    }
                    text(PLAN_ITEMS[i], mx + 20, my + 0.5, 15, complete ? pal.muted : pal.text);
                }
                ctx.restore();
            });
        };

        // C: the ticket shop writes, a word on every sixteenth.
        const STREAM = 'The checkout now takes a ticket type and a quantity. Next up: the order summary.';
        const shotStream = (time) => {
            const s = 2.15 * shotFrame(time, 28);
            withScale(960, 470, s, () => {
                const w = 620;
                const h = 340;
                const x = -w / 2;
                const y = -h / 2;
                node(x, y, w, h, { kind: 'chat', agent: 'claude', title: 'Ticket shop', status: 'running', plan: [2, 4], branch: 'ticket-shop' });
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y + HEADER, w, h - HEADER);
                ctx.clip();
                const words = (time - 28.12) / 0.125;
                const items = [
                    { type: 'tool', tool: 'read', label: 'Read', detail: 'src/pages/tickets.tsx' },
                    { type: 'tool', tool: 'edit', label: 'Edit', detail: 'src/tickets/checkout.ts' },
                    { type: 'text', text: STREAM, words }
                ];
                items.push({ type: 'working', seconds: 41, alpha: 1 });
                drawThread(items, x + 22, w - 44, y + HEADER + 18, y + h - 18, time);
                ctx.restore();
            });
        };

        // D: the edit behind it, the diff line by line on the eighths.
        const DIFF = [
            [' ', 'export function priceFor(ticket: Ticket) {'],
            ['-', '    return PRICES.weekend;'],
            ['+', '    const price = PRICES[ticket.kind];'],
            ['+', '    if (!price) {'],
            ['+', "        throw new Error('Unknown ticket');"],
            ['+', '    }'],
            ['+', '    return price * ticket.quantity;'],
            [' ', '}']
        ];
        const shotDiff = (time) => {
            const s = 2.05 * shotFrame(time, 30);
            withScale(960, 470, s, () => {
                const w = 640;
                const x = -w / 2;
                const y = -186;
                drawItem({ type: 'tool', tool: 'edit', label: 'Edit', detail: 'src/tickets/checkout.ts' }, x, y, w - 90, time);
                font(13, 400, MONO);
                const detailW = measure('src/tickets/checkout.ts');
                font(13);
                const lx = x + 30 + measure('Edit') + detailW + 12;
                text('+5', lx, y + 14.5, 13, pal.green, 500, MONO);
                text('-1', lx + 26, y + 14.5, 13, pal.red, 500, MONO);
                const top = y + 40;
                const lh = 30;
                fillRound(x, top, w, DIFF.length * lh + 20, 12, pal.sunken);
                strokeRound(x + 0.5, top + 0.5, w - 1, DIFF.length * lh + 19, 12, 'rgba(255,255,255,0.07)');
                ctx.save();
                R.roundRect(ctx, x, top, w, DIFF.length * lh + 20, 12);
                ctx.clip();
                for (let i = 0; i < DIFF.length; i++) {
                    const k = E.outCubic(clamp((time - 30 - i * 0.25 + 0.15) / 0.18));
                    if (k <= 0) {
                        continue;
                    }
                    const [sign, code] = DIFF[i];
                    const ly = top + 10 + i * lh;
                    ctx.save();
                    ctx.globalAlpha *= k;
                    if (sign !== ' ') {
                        rect(x, ly, w, lh, sign === '+' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)');
                        rect(x, ly, 3, lh, sign === '+' ? pal.green : pal.red);
                    }
                    text(sign === ' ' ? '' : sign, x + 16, ly + lh / 2 + 0.5, 14, sign === '+' ? pal.green : pal.red, 400, MONO);
                    text(code, x + 36 - (1 - k) * 10, ly + lh / 2 + 0.5, 14, sign === '-' ? 'rgba(214,214,222,0.6)' : pal.termFg, 400, MONO);
                    ctx.restore();
                }
                ctx.restore();
            });
        };

        /* Act four: the stop. A second grid, the team at work; one cell asks, and the beat waits for the answer. */
        const G2 = [
            { kind: 'chat', agent: 'claude', name: 'Launch the Nachtveld site', status: 'idle' },
            { kind: 'chat', agent: 'claude', name: 'Line-up page', status: 'idle' },
            { kind: 'terminal', agent: 'codex', name: 'tests', id: 'tests', status: 'running' },
            { kind: 'browser', name: 'Tickets', url: 'localhost:3000/tickets', page: 'tickets', blocks: 6 },
            { kind: 'chat', agent: 'claude', name: 'Ticket shop', status: 'running' },
            { kind: 'chat', agent: 'claude', name: 'Festival map', status: 'idle' }
        ];
        const cells2 = G2.map((view, i) => ({ view, i, x: 0, y: 0, w: 0, h: 0, alpha: 1, bar: 1, focused: false, flying: false, lagX: 0, lagY: 0, dim: 0, ring: 0, status: view.status }));
        for (const cell of cells2) {
            gridRect(6, cell.i, cell);
        }
        const rows2 = G2.map((view) => ({ view, open: true, selected: false, status: view.status }));
        const waiting2 = { alpha: 0, view: G2[4] };
        const ASK = 'Sell day tickets, or weekend only?';
        const OPTIONS = ['Day and weekend', 'Weekend only', 'Something else...'];
        const SHOP = 4;
        const cardRect = { x: 0, y: 0, w: 0, h: 0 };
        // Where the person's cursor goes, in the shop cell's own coordinates, filled in while the card draws.
        const targets = { option: { x: 0, y: 0 }, answer: { x: 0, y: 0 } };
        const promptCard = (x, y, w, time, open) => {
            const chosen = time >= 36;
            const press = Math.sin(Math.PI * phase(time, 36.95, 0.18));
            const h = 44 + 21 + 12 + 3 * 44 + 8 + 40;
            cardRect.x = x;
            cardRect.y = y;
            cardRect.w = w;
            cardRect.h = h;
            ctx.save();
            ctx.globalAlpha *= clamp(open * 1.5);
            ctx.translate(0, (1 - E.outCubic(open)) * 30);
            fillRound(x, y + 4, w, h, 16, 'rgba(0,0,0,0.4)');
            fillRound(x, y, w, h, 16, R.mix(pal.raised, pal.bg, 0.08, 0.98));
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, 16, 'rgba(255,255,255,0.1)');
            // The stack's header: whose question, and how many wait.
            dot(x + 16, y + 17, 'needs', 4);
            text('Ticket shop', x + 28, y + 17.5, 13, pal.text, 500);
            font(13, 500);
            text('Question', x + 36 + measure('Ticket shop'), y + 17.5, 13, pal.muted);
            text('1 of 1', x + w - 40, y + 17.5, 13, pal.muted, 400, SANS, 'right');
            icon('chevronRight', x + w - 30, y + 11, 12, pal.faint);
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(x, y + 34.5);
            ctx.lineTo(x + w, y + 34.5);
            ctx.stroke();
            ctx.restore();
            const stagger = (i) => E.outCubic(clamp((open - 0.25 - i * 0.12) / 0.5));
            let k = stagger(0);
            ctx.globalAlpha *= 1;
            ctx.save();
            ctx.globalAlpha *= k;
            icon('question', x + 14, y + 49, 16, pal.needs);
            text(ASK, x + 38, y + 57.5, 14, pal.text, 600);
            ctx.restore();
            for (let i = 0; i < 3; i++) {
                k = stagger(i + 1);
                const oy = y + 78 + i * 44 + (1 - k) * 8;
                const selected = chosen && i === 0;
                ctx.save();
                ctx.globalAlpha *= k;
                fillRound(x + 12, oy, w - 24, 36, 8, selected ? 'rgba(21,93,252,0.16)' : pal.hover);
                strokeRound(x + 12.5, oy + 0.5, w - 25, 35, 8, selected ? pal.accent : 'rgba(255,255,255,0.07)');
                if (selected) {
                    const pop = E.outBack(phase(time, 36, 0.25), 3);
                    ctx.save();
                    ctx.translate(x + 32, oy + 18);
                    ctx.scale(pop, pop);
                    icon('circleCheck', -8, -8, 16, pal.text);
                    ctx.restore();
                } else {
                    icon('circle', x + 24, oy + 10, 16, pal.muted);
                }
                text(OPTIONS[i], x + 50, oy + 18.5, 13, i === 2 ? pal.muted : pal.text);
                ctx.restore();
                if (i === 0) {
                    targets.option.x = x + 150;
                    targets.option.y = oy + 20;
                }
            }
            k = stagger(4);
            ctx.save();
            ctx.globalAlpha *= k;
            const bx = x + w - 12 - 96;
            const by = y + h - 40;
            ctx.translate(bx + 48, by + 14);
            ctx.scale(1 - press * 0.05, 1 - press * 0.05);
            fillRound(-48, -14, 96, 28, 6, chosen ? pal.text : 'rgba(236,236,241,0.35)');
            text('Answer', -8, 0.5, 13, pal.bg, 500, SANS, 'center');
            icon('arrowUp', 24, -8, 16, pal.bg);
            ctx.restore();
            targets.answer.x = bx + 50;
            targets.answer.y = by + 16;
            ctx.restore();
            return h;
        };
        const shopItems = (time) => {
            const items = [
                { type: 'user', text: 'Build /tickets with a cart and checkout.' },
                { type: 'tool', tool: 'edit', label: 'Edit', detail: 'src/tickets/checkout.ts' },
                { type: 'text', text: 'The checkout is ready for any ticket type. Before I add prices, one question.' }
            ];
            if (time >= 37.3) {
                items.push({ type: 'user', text: 'Day and weekend', alpha: E.outCubic(phase(time, 37.3, 0.3)) });
            }
            if (time >= 38) {
                items.push({ type: 'text', text: 'Adding a day ticket for each of the three days.', words: (time - 38.1) / 0.25 });
            }
            return items;
        };
        const body2 = (cell, w, h) => {
            const view = cell.view;
            const time = NOW;
            if (view.kind === 'terminal') {
                terminalView(view, w, h, time);
                return;
            }
            if (view.kind === 'browser') {
                browserView(view, w, h, time, time >= 38.5 ? 5 + clamp((time - 38.5) / 0.4) : 4);
                return;
            }
            rect(0, 0, w, h, pal.bg);
            const colW = Math.min(w - 36, 600);
            const cx = (w - colW) / 2;
            let items;
            if (cell.i === 0) {
                items = [
                    { type: 'user', text: LEAD_ASK },
                    { type: 'tool', tool: 'bash', label: 'Started', detail: '3 agents' },
                    { type: 'muted', text: 'Line-up page and Festival map are done. Waiting on Ticket shop.' }
                ];
            } else if (cell.i === 1) {
                items = [
                    { type: 'tool', tool: 'bash', label: 'Ran', detail: 'bun test lineup' },
                    { type: 'text', text: 'Done. The line-up shows both stages for all three days.' },
                    { type: 'done' }
                ];
            } else if (cell.i === 5) {
                items = [
                    { type: 'tool', tool: 'bash', label: 'Ran', detail: 'bun test map' },
                    { type: 'text', text: 'Done. Veld and Bos are on the map, with the walking route.' },
                    { type: 'done' }
                ];
            } else {
                const open = E.outCubic(clamp((time - 34.1) / 0.7)) * (1 - E.inCubic(phase(time, 37.1, 0.3)));
                const cardH = open > 0.001 ? 44 + 21 + 12 + 3 * 44 + 8 + 40 : 0;
                const threadBottom = h - 16 - (cardH + 12) * E.outCubic(clamp((time - 34.1) / 0.5)) * (1 - E.inOutCubic(phase(time, 37.1, 0.4)));
                const items2 = shopItems(time);
                if (time < 38 || time >= 38) {
                    const working = time < 32.5 || time >= 38;
                    if (working && time < 38) {
                        items2.push({ type: 'working', seconds: 52 });
                    }
                }
                drawThread(items2, cx, colW, 16, threadBottom, time);
                if (open > 0.001) {
                    promptCard(10, h - 10 - cardH, w - 20, time, open);
                }
                return;
            }
            drawThread(items, cx, colW, 16, h - 16, time);
        };
        const stopCam = { x: 0, y: 0, z: 1 };
        const shopCenter = { x: 0, y: 0 };
        const actStop = (time) => {
            const amber = smooth(32.45, 32.6, time) * (1 - smooth(37.9, 38.05, time));
            const dim = E.inOutSine(phase(time, 32.9, 1.1)) * (1 - E.outCubic(phase(time, 38, 0.35)));
            for (const cell of cells2) {
                cell.dim = cell.i === SHOP ? 0 : dim;
                cell.focused = cell.i === SHOP;
                cell.ring = cell.i === SHOP ? amber : 0;
                cell.status = cell.i === SHOP ? (amber > 0.5 ? 'needs' : 'running') : cell.view.status;
            }
            rows2[SHOP].status = cells2[SHOP].status;
            for (let i = 0; i < rows2.length; i++) {
                rows2[i].selected = i === SHOP;
            }
            waiting2.alpha = amber;
            // In: slow, not on the beat. Out: on the downbeat, fast.
            const push = E.inOutCubic(phase(time, 33.0, 1.4)) * (1 - E.outCubic(phase(time, 38, 0.45)));
            const shop = cells2[SHOP];
            shopCenter.x = shop.x + shop.w / 2;
            shopCenter.y = shop.y + shop.h / 2 + 8;
            stopCam.x = lerp(WIN.w / 2, shopCenter.x, push);
            stopCam.y = lerp(WIN.h / 2, shopCenter.y, push);
            stopCam.z = lerp(1.25, 2.4, push);
            ctx.save();
            camera(stopCam.x, stopCam.y, stopCam.z);
            drawApp(rows2, waiting2, cells2, body2, dim);
            ctx.restore();
            // The person's cursor, in window space: in from the corner, onto the first choice, onto Answer.
            const toScreen = (lx, ly, out) => {
                out.x = (lx - stopCam.x) * stopCam.z + 960;
                out.y = (ly - stopCam.y) * stopCam.z + CAM_Y;
                return out;
            };
            if (time > 34.8 && time < 38.2) {
                const base = shop.y + 40;
                const option = toScreen(shop.x + targets.option.x, base + targets.option.y, { x: 0, y: 0 });
                const answer = toScreen(shop.x + targets.answer.x, base + targets.answer.y, { x: 0, y: 0 });
                const arrive = E.inOutCubic(phase(time, 34.9, 0.95));
                const second = E.inOutCubic(phase(time, 36.3, 0.55));
                let x = lerp(1500, option.x, arrive);
                let y = lerp(1020, option.y, arrive);
                x = lerp(x, answer.x, second);
                y = lerp(y, answer.y, second);
                const press = Math.max(Math.sin(Math.PI * phase(time, 35.92, 0.16)), Math.sin(Math.PI * phase(time, 36.92, 0.16)));
                cursor(x, y, 1.9, E.outCubic(phase(time, 34.8, 0.2)) * (1 - smooth(37.4, 37.8, time)), press);
                clickRing(option.x, option.y, time - 36, 40, pal.text);
                clickRing(answer.x, answer.y, time - 37, 40, pal.text);
            }
        };

        /* Act five: computer use. The agent works in Calendar with a cursor of its own; the person's cursor stays in Ruimte. */
        const CAL = { x: 70, y: 150, s: 1.3, w: 720, h: 540 };
        const RW = { x: 975, y: 262, s: 1.48, w: 590, h: 440 };
        const DAYS = ['Mon 10', 'Tue 11', 'Wed 12', 'Thu 13', 'Fri 14'];
        const TITLE = 'Site goes live';
        const calEvent = (col, top, title, time, color, grow = 1) => {
            const colW = (CAL.w - 2) / 5;
            const x = 1 + col * colW + 8;
            const y = 48 + 34 + top;
            const w = colW - 16;
            ctx.save();
            ctx.translate(x + w / 2, y + 24);
            ctx.scale(grow, grow);
            ctx.translate(-x - w / 2, -y - 24);
            fillRound(x, y, w, 48, 6, R.rgba(color, 0.22));
            rect(x, y, 3, 48, color);
            text(title, x + 10, y + 16, 13, '#ffffff', 500);
            text(time, x + 10, y + 34, 12, 'rgba(255,255,255,0.6)');
            ctx.restore();
        };
        const typedTitle = (time) => {
            const n = Math.floor(clamp((time - 43) / 1.5) * TITLE.length);
            return TITLE.slice(0, n);
        };
        const drawCalendar = (time) => {
            ctx.save();
            ctx.translate(CAL.x, CAL.y);
            ctx.scale(CAL.s, CAL.s);
            fillRound(0, 14, CAL.w, CAL.h, 12, 'rgba(0,0,0,0.5)');
            fillRound(0, 0, CAL.w, CAL.h, 12, '#1e1e22');
            ctx.save();
            R.roundRect(ctx, 0, 0, CAL.w, CAL.h, 12);
            ctx.clip();
            rect(0, 47, CAL.w, 1, 'rgba(255,255,255,0.1)');
            lights(22, 24);
            text('August 2026', 88, 24.5, 15, '#ffffff', 600);
            const pressed = Math.sin(Math.PI * phase(time, 41.95, 0.16));
            ctx.save();
            ctx.translate(CAL.w - 70, 24);
            ctx.scale(1 - pressed * 0.06, 1 - pressed * 0.06);
            fillRound(-54, -14, 108, 28, 6, time >= 42 && time < 46.1 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)');
            icon('plus', -44, -7, 14, '#ffffff');
            text('New event', -24, 0.5, 13, '#ffffff');
            ctx.restore();
            const colW = (CAL.w - 2) / 5;
            for (let i = 0; i < 5; i++) {
                const x = 1 + i * colW;
                if (i > 0) {
                    rect(x, 48, 1, CAL.h - 48, 'rgba(255,255,255,0.06)');
                }
                text(DAYS[i], x + 12, 65, 13, 'rgba(255,255,255,0.6)');
            }
            rect(0, 82, CAL.w, 1, 'rgba(255,255,255,0.06)');
            calEvent(0, 40, 'Standup', '09:30', '#a78bfa');
            calEvent(2, 150, 'Line-up review', '11:00', '#34d399');
            calEvent(4, 250, 'Nachtveld day 1', '16:00', '#e4572e');
            if (time >= 46) {
                calEvent(1, 90, TITLE, '10:00', pal.running, E.outBack(phase(time, 46, 0.35), 2.2));
            }
            // The event sheet the agent fills in.
            const sheet = E.outCubic(phase(time, 42, 0.25)) * (1 - E.inCubic(phase(time, 46.05, 0.2)));
            if (sheet > 0.01) {
                ctx.save();
                ctx.globalAlpha *= sheet;
                ctx.translate(0, (1 - sheet) * -8);
                const sx = CAL.w - 300;
                const sy = 56;
                fillRound(sx, sy + 6, 284, 190, 12, 'rgba(0,0,0,0.45)');
                fillRound(sx, sy, 284, 190, 12, '#2a2a2f');
                strokeRound(sx + 0.5, sy + 0.5, 283, 189, 12, 'rgba(255,255,255,0.1)');
                text('Title', sx + 16, sy + 22, 13, 'rgba(255,255,255,0.6)');
                fillRound(sx + 16, sy + 36, 252, 32, 6, 'rgba(0,0,0,0.2)');
                strokeRound(sx + 16.5, sy + 36.5, 251, 31, 6, time >= 42.5 && time < 44.6 ? 'rgba(10,132,255,0.8)' : 'rgba(255,255,255,0.15)');
                const typed = typedTitle(time);
                text(typed, sx + 26, sy + 52.5, 13, '#ffffff');
                if (time >= 42.5 && time < 44.6 && R.fract(time * 2) < 0.6) {
                    font(13);
                    rect(sx + 27 + measure(typed), sy + 44, 1.5, 17, '#ffffff');
                }
                text('Tuesday 11', sx + 16, sy + 96, 13, 'rgba(255,255,255,0.6)');
                text('10:00', sx + 268, sy + 96, 13, 'rgba(255,255,255,0.6)', 400, SANS, 'right');
                const addPress = Math.sin(Math.PI * phase(time, 45.95, 0.16));
                ctx.save();
                ctx.translate(sx + 142, sy + 152);
                ctx.scale(1 - addPress * 0.05, 1 - addPress * 0.05);
                fillRound(-126, -16, 252, 32, 6, '#0a84ff');
                text('Add', 0, 0.5, 13, '#ffffff', 500, SANS, 'center');
                ctx.restore();
                ctx.restore();
            }
            ctx.restore();
            strokeRound(0.5, 0.5, CAL.w - 1, CAL.h - 1, 12, 'rgba(255,255,255,0.1)');
            ctx.restore();
        };
        const calPoint = (lx, ly, out) => {
            out.x = CAL.x + lx * CAL.s;
            out.y = CAL.y + ly * CAL.s;
            return out;
        };
        // The phantom's poses, each landing on a beat.
        const POSES = [
            { at: 40, x: 330, y: 300, think: 1, label: 'Looking at Calendar' },
            { at: 42, x: CAL.w - 70, y: 26, label: 'New event' },
            { at: 42.5, x: CAL.w - 150, y: 110, label: '', typed: true },
            { at: 45, x: CAL.w - 158, y: 210, label: 'Add' },
            { at: 47, x: 250, y: 250, think: 1, label: '' }
        ];
        const phantomPos = { x: 0, y: 0 };
        const drawPhantom = (time) => {
            let index = 0;
            for (let i = 0; i < POSES.length; i++) {
                if (time >= POSES[i].at - 0.5) {
                    index = i;
                }
            }
            const pose = POSES[index];
            const prev = POSES[Math.max(0, index - 1)];
            // It leaves half a beat early and lands on the beat, with no overshoot: a pointer that springs past reads as a slip.
            const k = index === 0 ? 1 : E.inOutCubic(phase(time, pose.at - 0.5, 0.5));
            const lx = lerp(prev.x, pose.x, k);
            const ly = lerp(prev.y, pose.y, k) - Math.sin(Math.PI * k) * 18;
            calPoint(lx, ly, phantomPos);
            const press = Math.max(Math.sin(Math.PI * phase(time, 41.95, 0.18)), Math.sin(Math.PI * phase(time, 45.95, 0.18)));
            let label = pose.label;
            let typed = false;
            if (index === 2) {
                label = typedTitle(time) || ' ';
                typed = true;
            }
            if (index === 4) {
                label = 'Added Site goes live';
            }
            const appear = E.outCubic(phase(time, 40.1, 0.3));
            ctx.save();
            ctx.globalAlpha *= appear;
            phantom(phantomPos.x, phantomPos.y, 1.9, pose.think && k > 0.5 ? 1 : 0, press, label, typed, 1);
            ctx.restore();
            if (time > 41.9) {
                clickRing(phantomPos.x, phantomPos.y, time - 42, 34, pal.accent);
            }
            if (time > 45.9) {
                clickRing(phantomPos.x, phantomPos.y, time - 46, 34, pal.accent);
            }
        };
        const sessionBar = (time) => {
            const s = 1.45;
            ctx.save();
            ctx.translate(960, 58);
            ctx.scale(s, s);
            const label = 'Ruimte is using Calendar in the background';
            font(14);
            const w = measure(label) + 150;
            const drop = E.outCubic(phase(time, 40, 0.4));
            ctx.translate(0, (1 - drop) * -40);
            fillRound(-w / 2, -18 + 3, w, 36, 10, 'rgba(0,0,0,0.4)');
            fillRound(-w / 2, -18, w, 36, 10, pal.raised);
            strokeRound(-w / 2 + 0.5, -17.5, w - 1, 35, 10, 'rgba(255,255,255,0.07)');
            ctx.save();
            ctx.translate(-w / 2 + 12, -8);
            ctx.scale(0.62, 0.62);
            ctx.translate(-1, -1);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.stroke(PHANTOM_ARROW);
            ctx.fillStyle = pal.accent;
            ctx.fill(PHANTOM_ARROW);
            ctx.restore();
            text(label, -w / 2 + 34, 0.5, 14, pal.text);
            const seconds = 12 + Math.floor(Math.max(0, time - 40));
            text('00:' + String(seconds).padStart(2, '0'), -w / 2 + 44 + measure(label), 0.5, 14, pal.faint);
            ctx.fillStyle = pal.muted;
            R.roundRect(ctx, w / 2 - 58, -7, 4, 14, 1.5);
            ctx.fill();
            R.roundRect(ctx, w / 2 - 50, -7, 4, 14, 1.5);
            ctx.fill();
            R.roundRect(ctx, w / 2 - 26, -7, 14, 14, 2.5);
            ctx.fill();
            ctx.restore();
        };
        // The person's own Ruimte window, in front: the canvas, where they move a node while the agent works.
        const R_CHAT = { x: 290, y: 80, w: 280, h: 150 };
        const R_DRAW = { x: 30, y: 250, w: 220, h: 150 };
        const drawRuimte = (time) => {
            ctx.save();
            ctx.translate(RW.x, RW.y);
            ctx.scale(RW.s, RW.s);
            fillRound(0, 14, RW.w, RW.h, 12, 'rgba(0,0,0,0.5)');
            fillRound(0, 0, RW.w, RW.h, 12, pal.bg);
            ctx.save();
            R.roundRect(ctx, 0, 0, RW.w, RW.h, 12);
            ctx.clip();
            rect(0, 0, RW.w, 44, pal.surface);
            rect(0, 43, RW.w, 1, 'rgba(255,255,255,0.07)');
            lights(22, 22);
            fillRound(84, 14, 16, 16, 3, 'rgba(228,87,46,0.2)');
            text('N', 92, 22.5, 12, '#e4572e', 600, SANS, 'center');
            text('nachtveld-web', 108, 22.5, 14, pal.text, 500);
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            for (let y = 56; y < RW.h; y += 20) {
                for (let x = 10; x < RW.w; x += 20) {
                    ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
                }
            }
            // The drag: picked up on the "and" of a beat, set down on the next, while the phantom moves on the beats.
            const drag = E.inOutCubic(phase(time, 45.25, 1.5));
            const dx = drag * 40;
            const dy = drag * -170;
            node(R_CHAT.x, R_CHAT.y, R_CHAT.w, R_CHAT.h, { kind: 'chat', agent: 'claude', title: 'Festival map', status: 'running' });
            ctx.save();
            ctx.beginPath();
            ctx.rect(R_CHAT.x, R_CHAT.y + HEADER, R_CHAT.w, R_CHAT.h - HEADER);
            ctx.clip();
            drawThread(
                [
                    { type: 'tool', tool: 'edit', label: 'Edit', detail: 'src/map/routes.ts' },
                    { type: 'working', seconds: 20 + Math.floor(time - 40) }
                ],
                R_CHAT.x + 16,
                R_CHAT.w - 32,
                R_CHAT.y + HEADER + 14,
                R_CHAT.y + R_CHAT.h - 12,
                time,
                10
            );
            ctx.restore();
            const lifted = time > 45.25 && time < 46.9 ? 1 : 0;
            const nx = R_DRAW.x + dx;
            const ny = R_DRAW.y + dy;
            if (lifted) {
                fillRound(nx, ny + 10, R_DRAW.w, R_DRAW.h, 11, 'rgba(0,0,0,0.35)');
            }
            node(nx, ny, R_DRAW.w, R_DRAW.h, { kind: 'drawing', title: 'Site map', border: lifted ? pal.accent : undefined, borderWidth: lifted ? 2 : 1 });
            ctx.save();
            ctx.beginPath();
            ctx.rect(nx, ny + HEADER, R_DRAW.w, R_DRAW.h - HEADER);
            ctx.clip();
            ctx.translate(nx, ny + HEADER);
            drawingView(R_DRAW.w, R_DRAW.h - HEADER, time, 9);
            ctx.restore();
            // The person's cursor, on the node's header.
            const rest = { x: 170, y: 330 };
            const come = E.inOutCubic(phase(time, 44.75, 0.5));
            const gx = R_DRAW.x + 150;
            const gy = R_DRAW.y + 20;
            let cx = lerp(rest.x, gx, come) + dx;
            let cy = lerp(rest.y, gy, come) + dy;
            const leave = E.inOutCubic(phase(time, 47.25, 0.6));
            cx = lerp(cx, cx + 70, leave);
            cy = lerp(cy, cy + 120, leave);
            ctx.restore();
            strokeRound(0.5, 0.5, RW.w - 1, RW.h - 1, 12, 'rgba(255,255,255,0.1)');
            const press = lifted ? 0.5 : 0;
            cursor(cx, cy, 1.25, 1, press);
            ctx.restore();
        };
        const actComputer = (time) => {
            screenDots(0.4);
            drawCalendar(time);
            drawRuimte(time);
            drawPhantom(time);
            sessionBar(time);
        };

        /* Act six: the phone. The approval comes to the lock screen, and a thumb answers it on the downbeat. */
        const PHONE = { x: 755, y: 70, w: 410, h: 850, r: 64 };
        const appIcon = (x, y, size) => {
            fillRound(x, y, size, size, size * 0.24, '#e9ecf1');
            const plane = (cx, cy, side, skew, radius) => {
                const corners = [
                    [cx - side / 2 + skew, cy - side / 2],
                    [cx + side / 2 + skew, cy - side / 2],
                    [cx + side / 2 - skew, cy + side / 2],
                    [cx - side / 2 - skew, cy + side / 2]
                ];
                ctx.beginPath();
                ctx.moveTo((corners[0][0] + corners[1][0]) / 2, corners[0][1]);
                for (let i = 1; i <= 4; i++) {
                    const corner = corners[i % 4];
                    const next = corners[(i + 1) % 4];
                    ctx.arcTo(corner[0], corner[1], next[0], next[1], radius);
                }
                ctx.closePath();
            };
            const side = size * 0.44;
            plane(x + size * 0.42, y + size * 0.42, side, side * 0.18, side * 0.18);
            ctx.fillStyle = pal.markDark;
            ctx.fill();
            plane(x + size * 0.58, y + size * 0.58, side, side * 0.18, side * 0.18);
            ctx.fillStyle = 'rgba(160,170,186,0.95)';
            ctx.fill();
        };
        const phoneTouch = { x: 0, y: 0 };
        const actPhone = (time) => {
            const enter = E.outCubic(phase(time, 50, 0.45));
            const { x, y, w, h, r } = PHONE;
            const oy = (1 - enter) * 60;
            ctx.save();
            ctx.globalAlpha *= enter;
            ctx.translate(0, oy);
            fillRound(x + 10, y + 30, w - 20, h, r, 'rgba(0,0,0,0.45)');
            rect(x - 4, y + 170, 4, 50, '#2a2a31');
            rect(x - 4, y + 240, 4, 80, '#2a2a31');
            rect(x + w, y + 220, 4, 110, '#2a2a31');
            fillRound(x, y, w, h, r, '#26262d');
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, r, 'rgba(255,255,255,0.14)');
            const sx = x + 12;
            const sy = y + 12;
            const sw = w - 24;
            const sh = h - 24;
            ctx.save();
            R.roundRect(ctx, sx, sy, sw, sh, r - 12);
            ctx.clip();
            const wall = ctx.createLinearGradient(sx, sy, sx + sw * 0.6, sy + sh);
            wall.addColorStop(0, '#16192a');
            wall.addColorStop(0.55, '#0e0f16');
            wall.addColorStop(1, '#0a0a0d');
            ctx.fillStyle = wall;
            ctx.fillRect(sx, sy, sw, sh);
            const expand = spring(time - 51, 13, 0.75);
            const sheet = clamp(expand) * (1 - E.inCubic(phase(time, 54.6, 0.35)));
            ctx.save();
            ctx.globalAlpha *= 1 - sheet * 0.55;
            text('Monday, August 10', sx + sw / 2, sy + 118, 20, 'rgba(255,255,255,0.75)', 500, SANS, 'center');
            text('9:41', sx + sw / 2, sy + 196, 104, '#e9ecf4', 600, SANS, 'center');
            ctx.restore();
            // The banner drops on the downbeat and springs into the approval.
            const drop = spring(time - 50.1, 14, 0.62);
            const bannerY = lerp(sy - 140, sy + 290, drop);
            const cardY = sy + 250;
            const bx = sx + 14;
            const bw = sw - 28;
            const bh = lerp(96, 318, clamp(expand));
            const by = lerp(bannerY, cardY, clamp(expand)) - E.inCubic(phase(time, 54.6, 0.35)) * 60;
            const alpha = clamp(drop * 3) * (1 - E.inCubic(phase(time, 54.6, 0.3)));
            if (alpha > 0.01) {
                ctx.save();
                ctx.globalAlpha *= alpha;
                fillRound(bx, by, bw, bh, lerp(24, 28, clamp(expand)), R.mix('#3a3a42', pal.raised, clamp(expand), 0.96));
                strokeRound(bx + 0.5, by + 0.5, bw - 1, bh - 1, lerp(24, 28, clamp(expand)), 'rgba(255,255,255,0.1)');
                const bannerK = 1 - clamp(expand * 2.5);
                if (bannerK > 0.01) {
                    ctx.save();
                    ctx.globalAlpha *= bannerK;
                    appIcon(bx + 16, by + 20, 44);
                    text('Launch the Nachtveld site', bx + 72, by + 34, 17, '#ffffff', 600);
                    text('Allow deploy to production?', bx + 72, by + 60, 17, 'rgba(255,255,255,0.78)');
                    text('now', bx + bw - 16, by + 34, 15, 'rgba(255,255,255,0.5)', 400, SANS, 'right');
                    ctx.restore();
                }
                const cardK = smooth(0.35, 0.9, expand);
                if (cardK > 0.01) {
                    ctx.save();
                    ctx.globalAlpha *= cardK;
                    const px = bx + 20;
                    const pw = bw - 40;
                    let py = by + 22;
                    icon('hand', px, py + 3, 22, pal.needs);
                    text('Run command', px + 34, py + 12, 19, pal.text, 600);
                    text('Launch the Nachtveld site', px + 34, py + 38, 16, pal.muted);
                    py += 64;
                    fillRound(px, py, pw, 84, 14, pal.sunken);
                    text('~/nachtveld-web', px + 16, py + 26, 16, pal.muted, 400, MONO);
                    text('bun run deploy', px + 16, py + 56, 17, pal.text, 400, MONO);
                    py += 104;
                    text('studio', px, py + 18, 15, pal.faint);
                    const allowed = time >= 54;
                    const press = Math.sin(Math.PI * phase(time, 53.92, 0.2));
                    text('Deny', px + pw - 170, py + 18.5, 17, pal.muted, 500, SANS, 'center');
                    ctx.save();
                    ctx.translate(px + pw - 62, py + 18);
                    ctx.scale(1 - press * 0.06, 1 - press * 0.06);
                    fillRound(-62, -22, 124, 44, 12, allowed ? R.mix(pal.text, pal.idle, E.outCubic(phase(time, 54, 0.25))) : pal.text);
                    icon('circleCheck', -48, -10, 20, pal.bg);
                    text(allowed ? 'Allowed' : 'Allow', 10, 0.5, 17, pal.bg, 600, SANS, 'center');
                    ctx.restore();
                    phoneTouch.x = px + pw - 52;
                    phoneTouch.y = py + 22 + oy;
                    ctx.restore();
                }
                ctx.restore();
            }
            // After: a quiet line that the deploy runs.
            const after = E.outCubic(phase(time, 54.9, 0.4));
            if (after > 0.01) {
                ctx.save();
                ctx.globalAlpha *= after;
                const ay = sy + 290 + (1 - after) * 16;
                fillRound(bx, ay, bw, 64, 22, 'rgba(58,58,66,0.86)');
                dot(bx + 26, ay + 32, 'running', 6);
                shine('Deploying to production', bx + 44, ay + 32.5, 17, time, 500);
                ctx.restore();
            }
            rect(sx + sw / 2 - 60, sy + sh - 14, 120, 5, 'rgba(255,255,255,0.55)');
            fillRound(sx + sw / 2 - 60, sy + 14, 120, 34, 17, '#000000');
            ctx.restore();
            ctx.restore();
            // The thumb: it comes in over the button a beat early, hovers, and presses on the downbeat.
            const come = E.outCubic(phase(time, 53, 0.5));
            const leave = E.inCubic(phase(time, 54.3, 0.4));
            const shown = come * (1 - leave);
            if (shown > 0.01) {
                const pressK = Math.sin(Math.PI * phase(time, 53.88, 0.28));
                const hover = (1 - come) * 70 + leave * 50;
                const radius = 40 * (1 + hover / 120) * (1 - pressK * 0.12);
                const tx = phoneTouch.x + hover * 0.6;
                const ty = phoneTouch.y + hover;
                ctx.save();
                ctx.globalAlpha *= shown;
                circle(tx + 4, ty + 8 + hover * 0.3, radius, `rgba(0,0,0,${(0.22 * (1 - pressK)).toFixed(3)})`);
                circle(tx, ty, radius, `rgba(255,255,255,${(0.22 + pressK * 0.16).toFixed(3)})`);
                ctx.beginPath();
                ctx.arc(tx, ty, radius, 0, TAU);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                clickRing(tx, ty, time - 54, radius + 34, '#ffffff');
                ctx.restore();
            }
        };

        /* Act seven: the grid folds into the wordmark. */
        const END_BASE = 540;
        const MINI = { w: 150, h: 96, gap: 10 };
        const MINI_STATUS = ['running', 'idle', 'running', 'running', 'needs', 'idle', 'running', 'idle', 'running'];
        const endGaps = [0, 0, 0, 0, 0];
        const actEnd = (time) => {
            layoutWord(960, endGaps);
            const home = tittleHome(END_BASE);
            const fold = E.inOutCubic(phase(time, 57, 0.5));
            const toDot = E.inOutCubic(phase(time, 57.5, 0.5));
            const gw = MINI.w * 3 + MINI.gap * 2;
            const gh = MINI.h * 3 + MINI.gap * 2;
            for (let i = 0; i < 9; i++) {
                const pop = E.outBack(clamp((time - 56 - i * 0.0625) / 0.22), 2);
                if (pop <= 0) {
                    continue;
                }
                const col = i % 3;
                const row = Math.floor(i / 3);
                let x = 960 - gw / 2 + col * (MINI.w + MINI.gap);
                let y = 470 - gh / 2 + row * (MINI.h + MINI.gap);
                let w = MINI.w;
                let h = MINI.h;
                let alpha = 1;
                if (i < 6) {
                    const tw = WM.adv[i] * 0.86;
                    const th = i === 0 || i === 4 ? WSIZE * 0.72 : WM.xh;
                    x = lerp(x, letterX[i] - tw / 2, fold);
                    y = lerp(y, END_BASE - th, fold);
                    w = lerp(w, tw, fold);
                    h = lerp(h, th, fold);
                    alpha = 1 - smooth(0.55, 1, fold);
                } else {
                    x = lerp(x, lerp(x, home.x - 30, fold * 0.6), 1);
                    const tx = home.x - WM.tittle.w / 2;
                    const ty = home.y - WM.tittle.h / 2;
                    x = lerp(x, tx, toDot);
                    y = lerp(y, ty, toDot);
                    w = lerp(w, WM.tittle.w, toDot);
                    h = lerp(h, WM.tittle.h, toDot);
                    alpha = 1 - smooth(0.6, 1, toDot);
                }
                ctx.save();
                ctx.globalAlpha *= alpha;
                ctx.translate(x + w / 2, y + h / 2);
                ctx.scale(pop, pop);
                ctx.translate(-x - w / 2, -y - h / 2);
                const radius = Math.min(10, w / 5, h / 5);
                fillRound(x, y, w, h, radius, pal.surface);
                ctx.save();
                R.roundRect(ctx, x, y, w, h, radius);
                ctx.clip();
                rect(x, y, w, Math.min(20, h * 0.2), pal.raised);
                const inner = 1 - Math.max(fold, toDot);
                if (inner > 0.05) {
                    ctx.globalAlpha *= inner;
                    for (let k = 0; k < 3; k++) {
                        rect(x + 12, y + 34 + k * 16, (w - 24) * (0.85 - ((i + k) % 3) * 0.2), 6, 'rgba(236,236,241,0.25)');
                    }
                }
                ctx.restore();
                circle(x + w - 12, y + Math.min(10, h * 0.1), Math.min(4, w / 10), STATUS[MINI_STATUS[i]]);
                strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, radius, 'rgba(255,255,255,0.12)');
                ctx.restore();
            }
            // The letters come in as their cells arrive; the dot lands on the downbeat at 58.
            for (let j = 0; j < 6; j++) {
                const k = smooth(0.45, 1, fold);
                const land = time - 57.5;
                let sy = 1;
                let sx = 1;
                if (land > 0) {
                    const wobble = Math.exp(-land * 9) * Math.cos(land * 24);
                    sy = 1 - 0.06 * wobble;
                    sx = 1 + 0.05 * wobble;
                }
                letter(j, letterX[j], END_BASE, sx, sy, k);
            }
            if (time >= 57.8) {
                const land = time - 58;
                let sx = 1;
                let sy = 1;
                if (land > 0) {
                    const wobble = Math.exp(-land * 8) * Math.cos(land * 22);
                    sy = 1 - 0.34 * wobble;
                    sx = 1 + 0.3 * wobble;
                }
                tittle(home.x, home.y + (WM.tittle.h / 2) * (1 - sy), sx, sy, smooth(57.8, 58, time), land > 0 ? 0.4 + 0.6 * Math.exp(-land * 2.5) : 0.4);
            }
            const tag = E.outCubic(phase(time, 58.05, 0.5));
            text('Space for AI Engineering.', 960, 690 + (1 - tag) * 14, 44, R.rgba(pal.text, tag), 600, SANS, 'center');
            const url = E.outCubic(phase(time, 58.35, 0.5));
            text('ruimte.app', 960, 758 + (1 - url) * 14, 28, R.rgba(pal.muted, url), 500, SANS, 'center');
        };

        /* Overlays: the caption that names what is on screen, and the beat, drawn as four steps. */
        const CAPTIONS = [
            [4.4, 7.8, 'Terminals, chats and browsers, side by side.'],
            [8.2, 13.5, 'Up to nine views. All of them running.'],
            [14.4, 17.8, 'One agent starts three more.'],
            [18.2, 23.6, 'Each with its own worktree and plan.'],
            [24.12, 25.88, 'Draw a line to share context.'],
            [26.12, 27.88, 'Follow the plan, step by step.'],
            [28.12, 29.88, 'Read along as it writes.'],
            [30.12, 31.88, 'See every change it makes.'],
            [33.2, 37.7, 'Agents ask. You decide.'],
            [38.2, 39.85, 'It carries on with your answer.'],
            [40.5, 44.6, 'The agent gets a cursor of its own.'],
            [45, 49.7, 'Yours stays free.'],
            [50.5, 55.7, 'Approve it from your phone.']
        ];
        const caption = (time) => {
            for (const [from, to, line] of CAPTIONS) {
                if (time < from - 0.01 || time > to + 0.01) {
                    continue;
                }
                const quick = to - from < 2;
                const fin = E.outCubic(clamp((time - from) / (quick ? 0.14 : 0.25)));
                const fout = 1 - E.inCubic(clamp((time - (to - (quick ? 0.12 : 0.25))) / (quick ? 0.12 : 0.25)));
                const k = fin * fout;
                ctx.save();
                // A soft floor under the words, so they read over anything.
                const floor = ctx.createLinearGradient(0, 930, 0, 1080);
                floor.addColorStop(0, 'rgba(13,13,16,0)');
                floor.addColorStop(1, `rgba(13,13,16,${(0.85 * k).toFixed(3)})`);
                ctx.fillStyle = floor;
                ctx.fillRect(0, 930, 1920, 150);
                text(line, 120, 1004 + (1 - fin) * 10, 32, R.rgba(pal.text, k), 500);
                ctx.restore();
            }
        };
        const meter = (time) => {
            const show = smooth(0, 0.2, time) * (1 - smooth(58.4, 59.2, time));
            if (show <= 0.01) {
                return;
            }
            const frozen = !beatLive(time) && time < LAST;
            const at = frozen ? Math.floor(STOP_FROM / BEAT) : Math.floor(time / BEAT + 1e-6);
            const since = frozen ? 0.2 : time - at * BEAT;
            const current = R.mod(at, 4);
            for (let i = 0; i < 4; i++) {
                const x = 1716 + i * 22;
                const y = 1004;
                const on = i === current;
                const size = i === 0 ? 12 : 8;
                let alpha = 0.14;
                if (on) {
                    alpha = frozen ? 0.4 : 0.3 + 0.65 * Math.exp(-since * 5);
                }
                const bump = on && !frozen ? 1 + 0.35 * Math.exp(-since * 10) : 1;
                ctx.save();
                ctx.globalAlpha = show;
                fillRound(x - (size * bump) / 2, y - (size * bump) / 2, size * bump, size * bump, 2.5, R.rgba(frozen && on ? pal.needs : pal.text, alpha));
                ctx.restore();
            }
        };

        return {
            draw(t) {
                NOW = t;
                LIVE = beatLive(t);
                // A kick on every beat, a bigger one on the downbeat: the frame breathes with the tempo.
                const n = Math.floor(t / BEAT + 1e-6);
                const since = t - n * BEAT;
                KICK = LIVE ? (n % 4 === 0 ? 1 : 0.35) * Math.exp(-since * 10) : 0;
                ctx.save();
                const s = 1 + 0.01 * KICK;
                ctx.translate(960, 500);
                ctx.scale(s, s);
                ctx.translate(-960, -500);
                if (t < 4.02) {
                    openWord(t);
                }
                if (t >= 3.85 && t < 24) {
                    ctx.save();
                    ctx.globalAlpha *= smooth(3.85, 4.02, t);
                    actGrid(t);
                    ctx.restore();
                } else if (t >= 24 && t < 26) {
                    shotContext(t);
                } else if (t >= 26 && t < 28) {
                    shotPlan(t);
                } else if (t >= 28 && t < 30) {
                    shotStream(t);
                } else if (t >= 30 && t < 32) {
                    shotDiff(t);
                } else if (t >= 32 && t < 40) {
                    const punch = 1.04 - 0.04 * E.outExpo(clamp((t - 32) / 0.45));
                    ctx.translate(960, 496);
                    ctx.scale(punch, punch);
                    ctx.translate(-960, -496);
                    actStop(t);
                } else if (t >= 40 && t < 50) {
                    const punch = 1.04 - 0.04 * E.outExpo(clamp((t - 40) / 0.45));
                    ctx.translate(960, 496);
                    ctx.scale(punch, punch);
                    ctx.translate(-960, -496);
                    actComputer(t);
                } else if (t >= 50 && t < 56) {
                    actPhone(t);
                } else if (t >= 56) {
                    actEnd(t);
                }
                ctx.restore();
                caption(t);
                meter(t);
            }
        };
    }
});
