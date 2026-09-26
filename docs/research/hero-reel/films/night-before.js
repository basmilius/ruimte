/* The Night Before: Nachtveld opens tomorrow at 12:00, and the work goes on while its person sleeps. */
Film.define({
    id: 'night-before',
    title: 'The Night Before',
    duration: 60,
    // The evening, the lid, the night canvas, the phone, back to the canvas, dawn, the morning app, the grid, the card.
    cuts: [4.9, 15.0, 21.45, 27.7, 33.55, 39.1, 42.7, 48.95, 56.8],
    // 96 BPM, a bar every 2.5 s, so bar lines fall on the cuts. The night is D minor (i, VI, III, VII); the morning
    // lifts into its relative F major (IV, I, V, vi) and the end card resolves on F. A clock ticks on every beat
    // from the moment the hour shows until the site is live.
    score(kit) {
        const BEAT = 60 / 96;
        const BAR = BEAT * 4;
        const CHORDS = {
            Dm: { pad: ['A3', 'C4', 'D4', 'F4'], bass: 'D2', arp: ['A4', 'C5', 'D5', 'F5'] },
            Bb: { pad: ['A3', 'Bb3', 'D4', 'F4'], bass: 'Bb1', arp: ['F4', 'A4', 'Bb4', 'D5'] },
            F: { pad: ['A3', 'C4', 'E4', 'F4'], bass: 'F2', arp: ['F4', 'A4', 'C5', 'E5'] },
            C: { pad: ['G3', 'C4', 'E4', 'G4'], bass: 'C2', arp: ['E4', 'G4', 'C5', 'E5'] },
            Gm: { pad: ['A3', 'Bb3', 'D4', 'G4'], bass: 'G1', arp: ['D4', 'G4', 'Bb4', 'D5'] }
        };
        // [start, chord, pad cutoff]: dark through the night, opening up with the morning.
        const PROGRESSION = [
            [0, 'Dm', 700],
            [5, 'Dm', 1000],
            [7.5, 'Bb', 1050],
            [10, 'F', 1150],
            [12.5, 'C', 1150],
            [15, 'Dm', 1000],
            [17.5, 'Bb', 900],
            [20, 'Gm', 850],
            [22.5, 'Dm', 800],
            [25, 'Bb', 800],
            [27.5, 'Gm', 700],
            [30, 'Gm', 700],
            [32.5, 'F', 900],
            [35, 'Bb', 950],
            [37.5, 'C', 1100],
            [40, 'F', 1500],
            [42.5, 'Bb', 1700],
            [45, 'C', 1800],
            [47.5, 'Dm', 1800],
            [50, 'Bb', 2000],
            [52.5, 'C', 2000],
            [55, 'Bb', 1900],
            [56.25, 'C', 1900]
        ];
        const chordAt = (time) => {
            let current = PROGRESSION[0];
            for (const row of PROGRESSION) {
                if (row[0] <= time + 0.001) {
                    current = row;
                }
            }
            return CHORDS[current[1]];
        };

        const pads = kit.bus({ gain: 0.5, send: 0.4, pan: -0.05 });
        const low = kit.bus({ gain: 0.55, send: 0.08 });
        const clock = kit.bus({ gain: 0.5, send: 0.12, pan: 0.15 });
        const keys = kit.bus({ gain: 0.55, send: 0.35, pan: 0.1 });
        const bells = kit.bus({ gain: 0.6, send: 0.5, pan: -0.1 });
        const drums = kit.bus({ gain: 0.6, send: 0.06 });
        const fx = kit.bus({ gain: 0.6, send: 0.3 });

        /* Pads: one per bar, overlapping so every change is a crossfade. The end chord is its own. */
        for (let i = 0; i < PROGRESSION.length; i++) {
            const [start, name, cutoff] = PROGRESSION[i];
            const end = i + 1 < PROGRESSION.length ? PROGRESSION[i + 1][0] : 57;
            kit.pad(pads, start, CHORDS[name].pad, end - start + 0.3, { gain: 0.1, cutoff, attack: start === 0 ? 2.2 : 0.9, release: 1.1 });
        }
        pads.automate([[0, 0.4], [5, 0.5], [18.4, 0.5], [19.6, 0.34], [22.9, 0.3], [23.6, 0.24], [27.7, 0.24], [28.6, 0.15], [33.3, 0.15], [34.3, 0.22], [37.1, 0.26], [37.6, 0.34], [39.2, 0.36], [40.4, 0.56], [48.9, 0.64], [56.6, 0.64], [57.0, 0.8], [60, 0.8]]);

        /* Bass: whole bars while someone is at the desk, gone while the lid is shut and the agent waits. */
        const bassSpans = [[5, 18.5], [37.5, 56.8]];
        for (const [from, to] of bassSpans) {
            for (let time = from; time < to - 0.01; time += BAR) {
                const length = Math.min(BAR, to - time) - 0.08;
                kit.bass(low, time, chordAt(time).bass, length, { gain: time >= 40 ? 0.34 : 0.26, cutoff: time >= 40 ? 520 : 380 });
            }
        }

        /* The clock: a tick and a softer tock on every beat, from the hour until the site is live. */
        for (let beat = Math.ceil(3.3 / BEAT); beat * BEAT < 55.5; beat++) {
            const time = beat * BEAT;
            const phoneHush = time > 28 && time < 33.6 ? 0.6 : 1;
            kit.tick(clock, time, { gain: (beat % 2 === 0 ? 0.05 : 0.035) * phoneHush, pitch: beat % 2 === 0 ? 2600 : 1900 });
            // Hours pass in a few seconds: the clock ticks twice as fast through each time-lapse.
            const lapse = (time > 23.1 && time < 26.2) || (time > 34.5 && time < 36.9);
            if (lapse) {
                kit.tick(clock, time + BEAT / 2, { gain: 0.028, pitch: 2250 });
            }
        }

        /* Build-box at work: a quiet eighth-note arpeggio over the chord, stopping on the limit, back on the reset. */
        const arpSpans = [[10.6, 17.5, 0.045], [18.9, 22.9, 0.05], [37.3, 40, 0.055], [49.0, 55.5, 0.04]];
        for (const [from, to, gain] of arpSpans) {
            let step = Math.ceil(from / (BEAT / 2));
            for (; step * (BEAT / 2) < to; step++) {
                const time = step * (BEAT / 2);
                const notes = chordAt(time).arp;
                const order = [0, 2, 1, 3, 2, 1, 3, 2];
                kit.pluck(keys, time, notes[order[step % 8]], { gain, length: 0.16, bright: 1700, detune: 5 });
            }
        }

        /* The wordmark: a glint as the gaps open, the slam, and the hour appearing. */
        kit.bell(bells, 0.61, 'A5', { gain: 0.07, decay: 2 });
        kit.kick(fx, 2.74, { gain: 0.3, pitch: 46, punch: 1 });
        kit.bell(bells, 2.74, 'D5', { gain: 0.16, decay: 2.6 });
        kit.bell(bells, 2.74, 'A5', { gain: 0.06, decay: 2 });
        kit.bell(bells, 3.3, 'F5', { gain: 0.07, decay: 1.6 });

        /* The context line and the split: pressed, snapped, the words travel, three agents go out. */
        kit.tick(keys, 6.45, { gain: 0.06, pitch: 1800 });
        kit.pluck(keys, 7.45, 'D5', { gain: 0.12, length: 0.3, bright: 2600 });
        kit.bell(bells, 7.45, 'A5', { gain: 0.1, decay: 2 });
        const chipNotes = ['F5', 'A5', 'Bb5', 'D6'];
        for (let i = 0; i < chipNotes.length; i++) {
            kit.pluck(keys, 7.62 + i * 0.16, chipNotes[i], { gain: 0.05, length: 0.12, bright: 3000 });
        }
        kit.riser(fx, 8.7, 1.0, { gain: 0.05 });
        const delegate = [[9.7, 'C5'], [9.92, 'F5'], [10.14, 'A5']];
        for (const [time, name] of delegate) {
            kit.pluck(keys, time, name, { gain: 0.13, length: 0.35, bright: 2800 });
            kit.bell(bells, time, name, { gain: 0.06, decay: 1.4 });
        }
        for (const time of [10.9, 11.7, 12.3, 13.5, 14.4, 19.8, 20.4]) {
            kit.tick(keys, time, { gain: 0.06, pitch: 3600 });
        }

        /* The lid shuts; build-box's note appears. */
        kit.kick(fx, 18.62, { gain: 0.32, pitch: 42, punch: 1 });
        kit.bell(bells, 18.95, 'F5', { gain: 0.06, decay: 1.8 });
        kit.riser(fx, 20.6, 1.1, { gain: 0.06 });

        /* The limit: the arpeggio stops, a low note under the ring clock, the switch that will wake it. */
        kit.bass(low, 22.9, 'D2', 1.9, { gain: 0.13, cutoff: 240 });
        kit.bell(bells, 22.95, 'E5', { gain: 0.08, decay: 2.4 });
        kit.bell(bells, 24.5, 'A5', { gain: 0.07, decay: 1.6 });
        kit.bass(low, 25, 'Bb1', 2.3, { gain: 0.11, cutoff: 220 });

        /* The question on the canvas, then the phone on the nightstand: the chime, the tap, the answer. */
        kit.pluck(keys, 26.1, 'A4', { gain: 0.09, length: 0.35, bright: 2000 });
        kit.pluck(keys, 26.4, 'E5', { gain: 0.09, length: 0.5, bright: 2000 });
        kit.bass(low, 27.5, 'G1', 4.9, { gain: 0.08, cutoff: 200 });
        kit.bass(low, 32.5, 'F1', 4.9, { gain: 0.1, cutoff: 220 });
        kit.bell(bells, 28.75, 'D5', { gain: 0.05, decay: 1.4 });
        kit.bell(bells, 29.05, 'Bb5', { gain: 0.1, decay: 1.6 });
        kit.bell(bells, 29.2, 'D6', { gain: 0.07, decay: 1.6 });
        kit.pluck(keys, 30.35, 'G4', { gain: 0.06, length: 0.3, bright: 1600 });
        kit.tick(keys, 31.8, { gain: 0.07, pitch: 2000 });
        kit.pluck(keys, 32.0, 'C5', { gain: 0.1, length: 0.4, bright: 2200 });
        kit.bell(bells, 32.02, 'F5', { gain: 0.09, decay: 2.2 });
        kit.bell(bells, 32.55, 'A5', { gain: 0.05, decay: 1.8 });

        /* Hours pass on the ring clock; a rise into 03:00 and the agent picks up where it stopped. */
        kit.riser(fx, 35.7, 1.4, { gain: 0.07 });
        kit.tick(keys, 37.1, { gain: 0.07, pitch: 2800 });
        kit.bell(bells, 37.3, 'E5', { gain: 0.1, decay: 2.2 });
        kit.bell(bells, 37.3, 'G5', { gain: 0.06, decay: 2 });

        /* Morning: a rise into the lid opening, the chord opens, a soft pulse joins with the app. */
        kit.riser(fx, 38.9, 1.4, { gain: 0.09 });
        kit.bell(bells, 40.3, 'C6', { gain: 0.07, decay: 2.6 });
        kit.bell(bells, 40.3, 'F5', { gain: 0.09, decay: 2.8 });
        kit.bell(bells, 42.7, 'A5', { gain: 0.06, decay: 2 });
        const stack = [[45.9, 'C5'], [46.15, 'E5'], [46.4, 'G5']];
        for (const [time, name] of stack) {
            kit.pluck(keys, time, name, { gain: 0.1, length: 0.28, bright: 2600 });
        }
        kit.riser(fx, 47.9, 1.05, { gain: 0.08 });
        kit.impact(fx, 48.95, { gain: 0.22 });
        kit.bell(bells, 48.95, 'D6', { gain: 0.06, decay: 2 });
        kit.tick(keys, 51.0, { gain: 0.08, pitch: 2600 });
        kit.bell(bells, 51.15, 'G5', { gain: 0.06, decay: 1.6 });
        kit.tick(keys, 54.75, { gain: 0.09, pitch: 2600 });
        kit.bell(bells, 55.55, 'C6', { gain: 0.08, decay: 2 });
        kit.bell(bells, 55.7, 'E6', { gain: 0.05, decay: 2 });

        const kicks = [];
        for (let time = 42.5; time < 56.8; time += BEAT * 2) {
            kicks.push(time);
            kit.kick(drums, time, { gain: time < 48.9 ? 0.4 : 0.5, pitch: 50 });
        }
        for (let time = 45 + BEAT / 2; time < 56.8; time += BEAT) {
            kit.hat(drums, time, { gain: time < 48.9 ? 0.05 : 0.08 });
        }
        for (let time = 48.75 + BEAT; time < 56.8; time += BEAT * 2) {
            kit.snare(drums, time, { gain: 0.14, tone: 210, decay: 0.12 });
        }
        pads.sidechain(kicks, 0.3, 0.3);
        low.sidechain(kicks, 0.4, 0.2);

        /* The end card: the whole thing lands on F, the dot bounces twice, and it rings out before 60 s. */
        kit.riser(fx, 55.9, 1.08, { gain: 0.1 });
        kit.impact(fx, 57.0, { gain: 0.4 });
        kit.pad(pads, 57.0, ['F3', 'A3', 'C4', 'E4', 'G4'], 1.4, { gain: 0.1, cutoff: 1800, attack: 0.05, release: 1.4 });
        kit.bass(low, 57.0, 'F1', 1.4, { gain: 0.34, cutoff: 420 });
        kit.bell(bells, 57.0, 'C5', { gain: 0.12, decay: 2.6 });
        kit.bell(bells, 58.37, 'A5', { gain: 0.1, decay: 1.4 });
        kit.bell(bells, 58.66, 'F5', { gain: 0.06, decay: 1.1 });
    },
    create(v) {
        const { R } = v;
        const pal = R.pal;
        const E = R.ease;
        const phase = R.phase;
        const clamp = R.clamp;
        const lerp = R.lerp;
        const TAU = R.TAU;
        const PI = Math.PI;
        const main = v.ctx;
        // Swapped to the laptop's screen buffer while the app is drawn into it.
        let ctx = main;
        const SANS = R.fonts.display;
        const MONO = R.fonts.mono;
        const HAND = R.fonts.hand;
        const GROUND = pal.bg;

        const hexMix = (from, to, amount) => {
            const x = R.hexToRgb(from);
            const y = R.hexToRgb(to);
            return '#' + x.map((channel, i) => Math.round(lerp(channel, y[i], amount)).toString(16).padStart(2, '0')).join('');
        };
        const EDGE_CONTEXT = hexMix(pal.accent, GROUND, 0.45);
        const ACCENT_SOFT = hexMix(pal.accent, pal.surface, 0.84);

        /* ---------- The app's own kit, measured the way apps/site/src/components/app draws it. ---------- */
        const ring = (cx, cy, rad) => `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0`;
        const box = (x, y, wide, tall, rad) =>
            `M${x + rad} ${y}h${wide - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${tall - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}h${-(wide - 2 * rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}v${-(tall - 2 * rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}z`;
        // Lucide's own paths (24 unit box, 1.75 stroke), so a glyph reads as the app's glyph.
        const ICONS = {
            terminal: ['M12 19h8', 'm4 17 6-6-6-6'],
            chat: ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'],
            browser: [ring(12, 12, 10), 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
            drawing: [
                'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
                'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
                'm2.3 2.3 7.286 7.286',
                ring(11, 11, 2)
            ],
            canvas: [box(3, 3, 7, 7, 1), box(14, 3, 7, 7, 1), box(14, 14, 7, 7, 1), box(3, 14, 7, 7, 1)],
            circle: [ring(12, 12, 10)],
            circleCheck: [ring(12, 12, 10), 'm16 9-5.5 5.5L8 12'],
            question: ['M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
            hand: [
                'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
                'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
                'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
                'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'
            ],
            eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', ring(12, 12, 3)],
            close: ['M18 6 6 18', 'm6 6 12 12'],
            maximize: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'],
            chevronLeft: ['m15 18-6-6 6-6'],
            chevronRight: ['m9 18 6-6-6-6'],
            chevronDown: ['m6 9 6 6 6-6'],
            plus: ['M5 12h14', 'M12 5v14'],
            minus: ['M5 12h14'],
            lock: [box(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 10 0v4'],
            lockOpen: [box(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 9.9-1'],
            reload: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
            arrowLeft: ['m12 19-7-7 7-7', 'M19 12H5'],
            arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
            externalLink: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
            server: [box(2, 2, 20, 8, 2), box(2, 14, 20, 8, 2), 'M6 6h.01', 'M6 18h.01'],
            laptop: ['M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z', 'M20.054 15.987H3.946'],
            gitMerge: [ring(18, 18, 3), ring(6, 6, 3), 'M6 21V9a9 9 0 0 0 9 9'],
            gitBranch: ['M6 3v12', ring(18, 6, 3), ring(6, 18, 3), 'M18 9a9 9 0 0 1-9 9'],
            panelLeft: [box(3, 3, 18, 18, 2), 'M9 3v18', 'm16 15-3-3 3-3'],
            search: [ring(11, 11, 8), 'm21 21-4.3-4.3'],
            folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
            tablet: [box(3, 8, 10, 14, 2), 'M7 8V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-4', 'M8 18h.01'],
            chart: ['M5 21v-6', 'M12 21V3', 'M19 21V9'],
            settings: [
                'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
                ring(12, 12, 3)
            ],
            layout: [box(3, 3, 18, 7, 1), box(3, 14, 9, 7, 1), box(16, 14, 5, 7, 1)],
            edit: ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z']
        };
        const pathCache = new Map();
        const pathsOf = (name) => {
            let list = pathCache.get(name);
            if (!list) {
                list = ICONS[name].map((svg) => new Path2D(svg));
                pathCache.set(name, list);
            }
            return list;
        };
        // x, y is the glyph's top left; size its box, as Lucide's `size`.
        const icon = (name, x, y, size, color, weight = 1.75) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(size / 24, size / 24);
            ctx.strokeStyle = color;
            ctx.lineWidth = weight;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const path of pathsOf(name)) {
                ctx.stroke(path);
            }
            ctx.restore();
        };
        const MARKS = {
            claude: new Path2D('m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'),
            codex: new Path2D('M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.554 5.554 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.019.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.001zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z')
        };
        // Marks are filled once into a bitmap: the rasterizer can stall on these paths at some transforms.
        const markCache = new Map();
        const mark = (kind, x, y, size, color) => {
            const key = kind + color;
            let sprite = markCache.get(key);
            if (!sprite) {
                sprite = document.createElement('canvas');
                sprite.width = 128;
                sprite.height = 128;
                const pen = sprite.getContext('2d');
                pen.scale(128 / 24, 128 / 24);
                pen.fillStyle = color;
                pen.fill(MARKS[kind]);
                markCache.set(key, sprite);
            }
            ctx.drawImage(sprite, x, y, size, size);
        };
        const setFont = (size, weight = 400, family = SANS) => {
            ctx.font = weight + ' ' + size + 'px ' + family;
        };
        // Widths are kept only once the fonts are in, or a fallback's measure would stick.
        const widths = new Map();
        const measure = (text) => {
            const key = ctx.font + '|' + text;
            let width = widths.get(key);
            if (width === undefined) {
                width = ctx.measureText(text).width;
                if (!document.fonts || document.fonts.status === 'loaded') {
                    widths.set(key, width);
                }
            }
            return width;
        };
        const label = (text, x, y, size, color, weight = 400, family = SANS, align = 'left') => {
            setFont(size, weight, family);
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(text, x, y);
            return measure(text);
        };
        const wraps = new Map();
        const wrap = (text, width) => {
            const key = ctx.font + '|' + width + '|' + text;
            let lines = wraps.get(key);
            if (lines) {
                return lines;
            }
            lines = [];
            let line = '';
            for (const word of text.split(' ')) {
                const next = line ? line + ' ' + word : word;
                if (line && measure(next) > width) {
                    lines.push(line);
                    line = word;
                } else {
                    line = next;
                }
            }
            if (line) {
                lines.push(line);
            }
            if (!document.fonts || document.fonts.status === 'loaded') {
                wraps.set(key, lines);
            }
            return lines;
        };
        // The client's `.shine`: muted words with a light that runs over them every 1.6 s.
        const shine = (text, x, y, size, now, weight = 400, family = SANS) => {
            setFont(size, weight, family);
            const width = measure(text);
            const sweep = R.fract(now / 1.6);
            const center = x + width * (1.7 - 2.4 * sweep);
            const band = Math.max(16, width * 0.34);
            const gradient = ctx.createLinearGradient(center - band, 0, center + band, 0);
            gradient.addColorStop(0, pal.muted);
            gradient.addColorStop(0.5, pal.text);
            gradient.addColorStop(1, pal.muted);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = gradient;
            ctx.fillText(text, x, y);
            return width;
        };
        const STATUS = { running: pal.running, needs: pal.needs, idle: pal.idle, error: pal.error, paused: pal.faint };
        const STATUS_LABEL = { running: 'Running', needs: 'Needs you', idle: 'Idle', paused: 'Paused' };
        const pulseOf = (status, now) => (status === 'running' ? 0.75 + 0.25 * Math.cos((now * TAU) / 2) : 1);
        const disc = (x, y, radius, color) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, TAU);
            ctx.fillStyle = color;
            ctx.fill();
        };
        const circleLine = (x, y, radius, color, width) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, TAU);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();
        };
        const statusDot = (x, y, status, now, radius = 4) => {
            if (status === 'paused') {
                circleLine(x, y, radius - 0.6, pal.faint, 1.2);
                return;
            }
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * pulseOf(status, now);
            disc(x, y, radius, STATUS[status]);
            ctx.globalAlpha = keep;
        };
        const fillRound = (x, y, wide, tall, rad, color) => {
            R.roundRect(ctx, x, y, wide, tall, rad);
            ctx.fillStyle = color;
            ctx.fill();
        };
        const strokeRound = (x, y, wide, tall, rad, color, width = 1) => {
            R.roundRect(ctx, x, y, wide, tall, rad);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();
        };
        // `StatusPill`: a sunken capsule with the dot and the word, its right edge at `right`.
        const pill = (right, y, status, now, size = 12) => {
            setFont(size, 400);
            const word = STATUS_LABEL[status];
            const width = measure(word) + size * 1.95;
            const height = size * 1.62;
            fillRound(right - width, y - height / 2, width, height, height / 2, pal.sunken);
            statusDot(right - width + size * 0.72, y, status, now, size / 3.25);
            label(word, right - width + size * 1.2, y + 0.5, size, pal.muted);
            return width;
        };
        // `NodeFrame`: an 11 radius frame, a 39 tall raised header, a hairline border.
        const HEADER = 39;
        const nodeFrame = (x, y, wide, tall, opts = {}) => {
            const ground = opts.kind === 'terminal' ? pal.termBg : pal.surface;
            fillRound(x - 1, y + 2, wide + 2, tall + 3, 12, 'rgba(0,0,0,0.22)');
            fillRound(x, y + 1, wide, tall + 1, 11, 'rgba(0,0,0,0.25)');
            fillRound(x, y, wide, tall, 11, ground);
            ctx.save();
            R.roundRect(ctx, x, y, wide, tall, 11);
            ctx.clip();
            ctx.fillStyle = pal.raised;
            ctx.fillRect(x, y, wide, HEADER);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + HEADER - 1, wide, 1);
            ctx.restore();
            strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, 10.5, opts.border || 'rgba(255,255,255,0.08)', 1);
        };
        const nodeHeader = (x, y, wide, opts, now) => {
            const mid = y + HEADER / 2;
            if (opts.agent) {
                mark(opts.agent, x + 10, mid - 7, 14, pal.muted);
            } else {
                icon(opts.kind, x + 10, mid - 7, 14, pal.muted);
            }
            let right = x + wide - 4;
            icon('close', right - 21, mid - 7, 14, pal.muted);
            icon('maximize', right - 49, mid - 7, 14, pal.muted);
            right -= 60;
            if (opts.status) {
                right -= pill(right, mid, opts.status, now, 12) + 8;
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 30, y, Math.max(0, right - x - 30), HEADER);
            ctx.clip();
            label(opts.title, x + 34, mid + 0.5, 13, pal.text, 500);
            ctx.restore();
        };
        // Lucide `circle-check`: the ring draws, then the tick, as `progress` runs 0..1. x, y is its center.
        const circleCheck = (x, y, size, color, progress = 1, lineWidth = 1.5) => {
            const unit = size / 24;
            const around = clamp(progress / 0.55);
            const tick = clamp((progress - 0.45) / 0.55);
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = color;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (around > 0) {
                ctx.beginPath();
                ctx.arc(x, y, 10 * unit, -PI / 2, -PI / 2 + TAU * around);
                ctx.stroke();
            }
            if (tick > 0) {
                const first = 2.83 / 8.49;
                ctx.beginPath();
                ctx.moveTo(x - 3 * unit, y);
                if (tick < first) {
                    const frac = tick / first;
                    ctx.lineTo(x + (-3 + 2 * frac) * unit, y + 2 * frac * unit);
                } else {
                    const frac = (tick - first) / (1 - first);
                    ctx.lineTo(x - 1 * unit, y + 2 * unit);
                    ctx.lineTo(x + (-1 + 4 * frac) * unit, y + (2 - 4 * frac) * unit);
                }
                ctx.stroke();
            }
        };
        const tick = (x, y, size, color, width = 1.5) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + size * 0.35, y + size * 0.35);
            ctx.lineTo(x + size, y - size * 0.4);
            ctx.stroke();
        };
        const loader = (x, y, radius, now, color) => {
            const spin = now * TAU * 1.1;
            ctx.beginPath();
            ctx.arc(x, y, radius, spin, spin + TAU * 0.72);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();
        };
        // The person's own pointer, black with a white rim, tip at x, y.
        const CURSOR = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');
        const cursor = (x, y, scale = 1, alpha = 1) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x - 1.5 * scale, y - 1.5 * scale);
            ctx.scale(scale, scale);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.translate(0, 1);
            ctx.fill(CURSOR);
            ctx.translate(0, -1);
            ctx.fillStyle = '#000000';
            ctx.fill(CURSOR);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.lineJoin = 'round';
            ctx.stroke(CURSOR);
            ctx.restore();
        };
        const spring = (elapsed, omega = 12, zeta = 0.6) => {
            if (elapsed <= 0) {
                return 0;
            }
            const damped = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * elapsed) * (Math.cos(damped * elapsed) + ((zeta * omega) / damped) * Math.sin(damped * elapsed));
        };
        const io = (x) => E.inOutCubic(x);
        const sine = (x) => E.inOutSine(x);
        // How much of something shows inside a window of film time, with its own fade in and out.
        const shown = (t, from, to, fadeIn = 0.35, fadeOut = 0.35) => E.outCubic(clamp((t - from) / fadeIn)) * (1 - E.inCubic(clamp((t - (to - fadeOut)) / fadeOut)));
        const FLOAT_FILL = 'rgba(24,24,28,0.9)';
        const floatCard = (x, y, wide, tall, rad) => {
            fillRound(x, y + 8, wide, tall, rad, 'rgba(0,0,0,0.28)');
            fillRound(x, y + 2, wide, tall, rad, 'rgba(0,0,0,0.3)');
            fillRound(x, y, wide, tall, rad, FLOAT_FILL);
            strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, rad - 0.5, 'rgba(255,255,255,0.08)');
        };

        /* ---------- Routes: a connector as the client routes it, sampled so a chip can ride it. ---------- */
        const makeRoute = (size = 96) => ({ xs: new Float32Array(size), ys: new Float32Array(size), ls: new Float32Array(size), n: 0, length: 0 });
        const routePush = (route, x, y) => {
            const i = route.n;
            route.xs[i] = x;
            route.ys[i] = y;
            route.ls[i] = i === 0 ? 0 : route.ls[i - 1] + Math.hypot(x - route.xs[i - 1], y - route.ys[i - 1]);
            route.n = i + 1;
            route.length = route.ls[i];
        };
        // Out of the right side of one box, one rail midway, into the left side of the other; corners rounded.
        const routeAcross = (route, ax, ay, bx, by, corner = 14) => {
            route.n = 0;
            routePush(route, ax, ay);
            const mid = (ax + bx) / 2;
            const dy = by - ay;
            if (Math.abs(dy) < 0.5) {
                routePush(route, bx, by);
                return route;
            }
            const rad = Math.min(corner, Math.abs(dy) / 2, Math.abs(bx - ax) / 4);
            const sy = Math.sign(dy);
            const corners = [
                [mid - rad, ay, mid, ay, mid, ay + sy * rad],
                [mid, by - sy * rad, mid, by, mid + rad, by]
            ];
            for (const [x0, y0, cx, cy, x1, y1] of corners) {
                routePush(route, x0, y0);
                for (let k = 1; k <= 8; k++) {
                    const frac = k / 8;
                    const inv = 1 - frac;
                    routePush(route, inv * inv * x0 + 2 * inv * frac * cx + frac * frac * x1, inv * inv * y0 + 2 * inv * frac * cy + frac * frac * y1);
                }
            }
            routePush(route, bx, by);
            return route;
        };
        const at = { x: 0, y: 0, ax: 1, ay: 0 };
        const routeAt = (route, pos) => {
            pos = clamp(pos, 0, route.length);
            let i = 1;
            while (i < route.n - 1 && route.ls[i] < pos) {
                i++;
            }
            const l0 = route.ls[i - 1];
            const span = route.ls[i] - l0 || 1;
            const frac = clamp((pos - l0) / span);
            const dx = route.xs[i] - route.xs[i - 1];
            const dy = route.ys[i] - route.ys[i - 1];
            at.x = route.xs[i - 1] + dx * frac;
            at.y = route.ys[i - 1] + dy * frac;
            const len = Math.hypot(dx, dy) || 1;
            at.ax = dx / len;
            at.ay = dy / len;
            return at;
        };
        const strokeRoute = (route, s0, s1) => {
            if (s1 <= s0) {
                return;
            }
            ctx.beginPath();
            routeAt(route, s0);
            ctx.moveTo(at.x, at.y);
            for (let i = 1; i < route.n; i++) {
                if (route.ls[i] > s0 && route.ls[i] < s1) {
                    ctx.lineTo(route.xs[i], route.ys[i]);
                }
            }
            routeAt(route, s1);
            ctx.lineTo(at.x, at.y);
            ctx.stroke();
        };
        // The marker at a connector's head: a ring filled with the ground, so the line ends in a socket.
        const headDot = (x, y, color, alpha = 1) => {
            ctx.save();
            ctx.globalAlpha *= alpha;
            disc(x, y, 5, GROUND);
            ctx.lineWidth = 2;
            ctx.strokeStyle = color;
            ctx.stroke();
            ctx.restore();
        };

        /* ---------- The story's clock. ---------- */
        // [film second, minutes since Thursday 00:00, 1 when the stretch before it is a time-lapse].
        const CLOCK = [
            [0, 1320, 0],
            [5.4, 1320, 0],
            [14.6, 1351, 0],
            [17.4, 1360, 0],
            [19.3, 1363, 0],
            [21.9, 1540, 1],
            [23.0, 1541, 0],
            [26.4, 1575, 1],
            [34.4, 1576, 0],
            [37.1, 1620, 1],
            [38.4, 1622, 0],
            [40.4, 1890, 1],
            [48.8, 1894, 0],
            [49.8, 1895, 0],
            [53.8, 2157, 1],
            [55.3, 2158, 0],
            [60, 2158, 0]
        ];
        const OPENS = 1440 + 12 * 60;
        const minutesAt = (t) => {
            for (let i = 1; i < CLOCK.length; i++) {
                const [t1, m1, lapse] = CLOCK[i];
                if (t <= t1) {
                    const [t0, m0] = CLOCK[i - 1];
                    const k = (t - t0) / (t1 - t0);
                    return lerp(m0, m1, lapse ? sine(k) : k);
                }
            }
            return CLOCK[CLOCK.length - 1][1];
        };
        const hhmm = (minutes) => {
            const whole = Math.floor(minutes) % 1440;
            return String(Math.floor(whole / 60)).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0');
        };
        const untilOpen = (minutes) => {
            const left = Math.max(0, OPENS - Math.floor(minutes));
            const hours = Math.floor(left / 60);
            return hours > 0 ? hours + 'h ' + String(left % 60).padStart(2, '0') + 'm' : (left % 60) + 'm';
        };

        /* ---------- The project, nachtveld-web, as it sits on build-box's canvas. ---------- */
        const SKETCH = { x: 0, y: 40, w: 340, h: 290 };
        const TESTS = { x: 0, y: 356, w: 340, h: 232 };
        const LEAD = { x: 450, y: 60, w: 400, h: 360 };
        const KID_X = 960;
        const KID_W = 340;
        const KID_H = 250;
        const KIDS = [
            { title: 'Line-up page', y: -150, steps: ['Read the artist list', 'Group by day and stage', 'Set times per stage'], done: [11.7, 13.5, 20.4], file: 'src/pages/lineup.tsx', out: 9.7 },
            { title: 'Ticket shop', y: 116, steps: ['Read the ticket brief', 'Build the checkout', 'Ticket types'], done: [12.3, 14.4, 39.2], file: 'src/pages/tickets.tsx', out: 9.92 },
            { title: 'Festival map', y: 382, steps: ['Read the sketch', 'Draw Veld and Bos', 'Routes, food and bars'], done: [10.9, 19.8, 39.0], file: 'src/pages/map.tsx', out: 10.14 }
        ];
        const LIMIT = 22.9;
        const RESUME = 37.3;
        const CLICK = 37.1;
        const ASK = 26.1;
        const ANSWERED = 32.3;
        const MORNING = 39.4;
        const ALLOW = 54.75;

        /* The context line: pressed on the sketch, dragged, let go on the lead. */
        const PRESS = 6.45;
        const SNAP = 7.45;
        const CHIPS = 7.62;
        const READ = 8.5;
        const WRITE = 8.95;
        const STARTED = 9.45;
        const WAITING = 12.2;
        const PORT_A = { x: SKETCH.x + SKETCH.w + 9, y: SKETCH.y + SKETCH.h / 2 };
        const PORT_B = { x: LEAD.x - 9, y: LEAD.y + LEAD.h / 2 };
        const contextRoute = routeAcross(makeRoute(), PORT_A.x, PORT_A.y, PORT_B.x, PORT_B.y);
        const CHIP_WORDS = ['Veld', 'Bos', 'Food', 'Entrance'];
        const taskRoutes = KIDS.map(() => makeRoute());

        // The hand-drawn map of the grounds, in the sketch node's own coordinates, wobbling like a pen.
        const handPath = (points, closed, seed) => {
            const path = new Path2D();
            const jitter = (i, axis) => (R.hash(seed * 31.7 + i * 7.3 + axis * 3.1) - 0.5) * 2.2;
            path.moveTo(points[0][0] + jitter(0, 0), points[0][1] + jitter(0, 1));
            const count = closed ? points.length + 1 : points.length;
            for (let i = 1; i < count; i++) {
                const p = points[i % points.length];
                const q = points[(i - 1) % points.length];
                const mx = (p[0] + q[0]) / 2 + jitter(i, 2) * 1.4;
                const my = (p[1] + q[1]) / 2 + jitter(i, 3) * 1.4;
                path.quadraticCurveTo(mx, my, p[0] + jitter(i, 0), p[1] + jitter(i, 1));
            }
            return path;
        };
        const blob = (cx, cy, rx, ry, count, seed) => {
            const points = [];
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * TAU;
                const wobble = 1 + (R.hash(seed + i * 1.7) - 0.5) * 0.08;
                points.push([cx + Math.cos(angle) * rx * wobble, cy + Math.sin(angle) * ry * wobble]);
            }
            return handPath(points, true, seed);
        };
        const rectPath = (x, y, wide, tall, seed) =>
            handPath(
                [
                    [x, y],
                    [x + wide, y + 1],
                    [x + wide - 1, y + tall],
                    [x + 1, y + tall - 1]
                ],
                true,
                seed
            );
        const SKETCH_LINES = [
            blob(170, 160, 150, 100, 18, 3),
            rectPath(46, 86, 100, 46, 5),
            rectPath(202, 100, 86, 42, 7),
            rectPath(96, 180, 66, 34, 9),
            handPath(
                [
                    [178, 284],
                    [178, 244]
                ],
                false,
                11
            ),
            handPath(
                [
                    [170, 252],
                    [178, 242],
                    [186, 252]
                ],
                false,
                12
            )
        ];
        const SKETCH_TREES = [blob(268, 176, 8, 8, 7, 21), blob(292, 190, 9, 9, 7, 22), blob(246, 198, 7, 7, 7, 23), blob(300, 164, 7, 7, 7, 24)];
        const SKETCH_PATHS = [
            handPath(
                [
                    [176, 238],
                    [150, 200],
                    [110, 160],
                    [96, 138]
                ],
                false,
                31
            ),
            handPath(
                [
                    [182, 238],
                    [210, 200],
                    [236, 168],
                    [244, 148]
                ],
                false,
                32
            )
        ];

        /* The tests terminal: Codex keeps the suite green all night; every line has the time it came in. */
        const TEST_FILES = [
            ['lineup', 6],
            ['tickets', 12],
            ['map', 11],
            ['nav', 4],
            ['home', 7],
            ['stages', 5],
            ['checkout', 9]
        ];
        const TEST_LINES = [
            { at: -1, kind: 'cmd', text: '$ codex' },
            { at: -1, kind: 'prompt', text: '> Keep the tests green tonight.' },
            { at: -1, kind: 'dim', text: '- bun test --watch' }
        ];
        {
            let index = 0;
            const push = (time, kind, text, extra) => {
                TEST_LINES.push({ at: time, kind, time: hhmm(minutesAt(Math.max(0, time))), text, extra });
            };
            const results = (from, to, step) => {
                for (let time = from; time < to; time += step) {
                    const [file, count] = TEST_FILES[index % TEST_FILES.length];
                    index++;
                    push(time, 'pass', file + '.test.ts', count + ' passed');
                }
            };
            results(-0.9, 5, 0.3);
            results(5.3, 15, 0.9);
            results(15, 21.6, 0.36);
            push(21.62, 'fail', 'tickets.test.ts', '1 failed');
            push(21.75, 'dim', 're-running tickets.test.ts');
            push(21.88, 'pass', 'tickets.test.ts', '12 passed');
            results(22.1, 39.6, 0.5);
            results(40.2, 48.7, 1.4);
            for (let k = 0; k < 7; k++) {
                const [file, count] = TEST_FILES[(k + 2) % TEST_FILES.length];
                push(51.25 + k * 0.14, 'pass', file + '.test.ts', count + ' passed');
            }
            push(52.35, 'total', '218 passed, 0 failed');
        }
        const linesUntil = (t) => {
            let count = 0;
            while (count < TEST_LINES.length && TEST_LINES[count].at <= t) {
                count++;
            }
            return count;
        };

        /* ---------- Node bodies. ---------- */
        const testLine = (line, x, y, alpha) => {
            ctx.globalAlpha = alpha;
            setFont(12, 400, MONO);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            if (line.kind === 'cmd' || line.kind === 'prompt') {
                ctx.fillStyle = line.kind === 'cmd' ? pal.termFg : pal.cyan;
                ctx.fillText(line.text, x, y);
            } else if (line.kind === 'dim') {
                ctx.fillStyle = pal.termDim;
                ctx.fillText(line.time ? line.time + '  ' + line.text : line.text, x, y);
            } else if (line.kind === 'total') {
                ctx.fillStyle = pal.termDim;
                ctx.fillText(line.time, x, y);
                tick(x + 46, y, 8, pal.green, 1.5);
                ctx.fillStyle = pal.green;
                setFont(12, 700, MONO);
                ctx.fillText(line.text, x + 62, y);
            } else {
                ctx.fillStyle = pal.termDim;
                ctx.fillText(line.time, x, y);
                if (line.kind === 'pass') {
                    tick(x + 46, y, 8, pal.green, 1.5);
                } else {
                    ctx.strokeStyle = pal.red;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x + 46, y - 3.5);
                    ctx.lineTo(x + 53, y + 3.5);
                    ctx.moveTo(x + 53, y - 3.5);
                    ctx.lineTo(x + 46, y + 3.5);
                    ctx.stroke();
                }
                ctx.fillStyle = pal.termFg;
                ctx.fillText(line.text, x + 62, y);
                ctx.fillStyle = line.kind === 'pass' ? pal.termDim : pal.red;
                ctx.fillText(line.extra, x + 62 + measure(line.text) + 10, y);
            }
            ctx.globalAlpha = 1;
        };
        // The newest line at the bottom; `back` scrolls up through the scrollback, in lines.
        const terminalLines = (t, x, y, wide, tall, back = 0, lineH = 17) => {
            const count = linesUntil(t);
            const rows = Math.floor((tall - 12) / lineH);
            const newest = count - 1;
            const bottom = y + tall - 10 - lineH / 2;
            const offset = back - Math.floor(back);
            const first = Math.floor(back);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, wide, tall);
            ctx.clip();
            for (let k = -1; k <= rows; k++) {
                const index = newest - first - k;
                if (index < 0 || index >= count) {
                    continue;
                }
                const line = TEST_LINES[index];
                const arrive = clamp((t - line.at) / 0.18);
                testLine(line, x + 10, bottom - (k - offset) * lineH + (1 - arrive) * 4, arrive);
            }
            // The caret on the prompt line, in the accent like the site draws it.
            if (back < 0.05) {
                const blink = R.fract(t / 1.05) < 0.6 ? 1 : 0.25;
                ctx.globalAlpha = blink;
                fillRound(x + 10, bottom + lineH - 7, 7, 13, 1, pal.accent);
                ctx.globalAlpha = 1;
            }
            ctx.restore();
            if (back > 0.05) {
                const total = Math.max(rows + 1, count);
                const thumb = Math.max(18, (tall - 16) * (rows / total));
                const along = (back / Math.max(1, total - rows)) * (tall - 16 - thumb);
                fillRound(x + wide - 7, y + tall - 8 - thumb - along, 4, thumb, 2, 'rgba(255,255,255,' + (0.28 * clamp(back / 1.5)).toFixed(3) + ')');
            }
        };

        const drawSketch = (t) => {
            const { x, y, w, h } = SKETCH;
            nodeFrame(x, y, w, h);
            nodeHeader(x, y, w, { kind: 'drawing', title: 'Map sketch' }, t);
            ctx.save();
            ctx.translate(x, y);
            ctx.beginPath();
            ctx.rect(0, HEADER, w, h - HEADER);
            ctx.clip();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(236,236,241,0.78)';
            ctx.lineWidth = 1.8;
            for (const path of SKETCH_LINES) {
                ctx.stroke(path);
            }
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = 'rgba(236,236,241,0.55)';
            for (const path of SKETCH_TREES) {
                ctx.stroke(path);
            }
            ctx.setLineDash([5, 6]);
            ctx.strokeStyle = 'rgba(236,236,241,0.5)';
            for (const path of SKETCH_PATHS) {
                ctx.stroke(path);
            }
            ctx.setLineDash([]);
            label('Veld', 96, 110, 18, pal.text, 700, HAND, 'center');
            label('Bos', 245, 122, 18, pal.text, 700, HAND, 'center');
            label('Food', 129, 198, 15, 'rgba(236,236,241,0.85)', 400, HAND, 'center');
            label('Entrance', 190, 272, 15, 'rgba(236,236,241,0.85)', 400, HAND);
            label('trees', 300, 214, 13, 'rgba(236,236,241,0.6)', 400, HAND, 'center');
            ctx.restore();
        };

        const drawTests = (t, back = 0) => {
            const { x, y, w, h } = TESTS;
            nodeFrame(x, y, w, h, { kind: 'terminal' });
            nodeHeader(x, y, w, { agent: 'codex', title: 'tests', status: 'running' }, t + 0.7);
            terminalLines(t, x, y + HEADER, w, h - HEADER, back);
        };

        /* The lead chat: what it says depends on the hour. */
        const toolRow = (x, y, name, verb, detail, live, alpha, now, wide) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.globalAlpha = alpha;
            icon(name, x, y - 6, 12, live ? pal.accent : pal.muted);
            const verbWidth = live ? shine(verb, x + 20, y + 0.5, 13, now) : label(verb, x + 20, y + 0.5, 13, pal.muted);
            label(detail, x + 28 + verbWidth, y + 0.5, 13, pal.faint, 400, MONO);
            if (wide) {
                icon('chevronRight', x + wide - 14, y - 6, 12, pal.faint);
            }
            ctx.globalAlpha = 1;
        };
        const bubble = (text, right, y, maxWidth, alpha) => {
            if (alpha <= 0.01) {
                return 0;
            }
            setFont(14, 400);
            const lines = wrap(text, maxWidth - 28);
            let widest = 0;
            for (const line of lines) {
                widest = Math.max(widest, measure(line));
            }
            const wide = widest + 28;
            const tall = lines.length * 21 + 20;
            ctx.globalAlpha = alpha;
            fillRound(right - wide, y, wide, tall, 16, pal.active);
            for (let i = 0; i < lines.length; i++) {
                label(lines[i], right - wide + 14, y + 20.5 + i * 21, 14, pal.text);
            }
            ctx.globalAlpha = 1;
            return tall;
        };
        // An assistant reply streams in whole words, without a bubble.
        const streamText = (text, x, y, width, start, t, perWord = 0.06) => {
            setFont(14, 400);
            const lines = wrap(text, width);
            let shownWords = Math.floor((t - start) / perWord) + 1;
            for (let i = 0; i < lines.length; i++) {
                const words = lines[i].split(' ');
                const take = Math.max(0, Math.min(words.length, shownWords));
                shownWords -= words.length;
                if (take > 0) {
                    label(words.slice(0, take).join(' '), x, y + 10.5 + i * 21, 14, pal.text);
                }
            }
            return lines.length * 21;
        };
        const leadStatus = (t) => {
            if (t >= ALLOW) {
                return 'running';
            }
            if (t >= MORNING) {
                return 'needs';
            }
            return t < WAITING ? 'running' : null;
        };
        const drawLead = (t, dx = 0) => {
            const x = LEAD.x + dx;
            const y = LEAD.y;
            const { w, h } = LEAD;
            const status = leadStatus(t);
            nodeFrame(x, y, w, h, { border: status === 'needs' ? R.rgba(pal.needs, 0.35) : undefined });
            nodeHeader(x, y, w, { agent: 'claude', title: 'Launch the Nachtveld site', status }, t);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y + HEADER, w, h - HEADER);
            ctx.clip();
            const left = x + 18;
            const inner = w - 36;
            let cursorY = y + HEADER + 16;
            if (t < MORNING) {
                cursorY += bubble('Line-up, tickets and the map are still to do. We open at 12:00.', x + w - 18, cursorY, inner * 0.84, 1) + 14;
                const read = E.outCubic(clamp((t - READ) / 0.35));
                toolRow(left, cursorY + 14, 'eye', 'Read linked context', 'Map sketch', t < WRITE, read, t, inner);
                cursorY += 28 * read + 10 * read;
                if (t >= WRITE) {
                    cursorY += streamText('Three agents, each in its own worktree and with a plan of its own.', left, cursorY, inner, WRITE, t) + 12;
                }
                const started = E.outCubic(clamp((t - STARTED) / 0.35));
                toolRow(left, cursorY + 14, 'terminal', 'Started', '3 agents', false, started, t, inner);
                cursorY += 40 * started;
                const waiting = clamp((t - WAITING) / 0.4);
                if (waiting > 0) {
                    ctx.globalAlpha = waiting;
                    ctx.globalAlpha = waiting * (0.55 + 0.3 * Math.sin((t * TAU) / 3.2));
                    disc(left + 4, cursorY + 14, 3.5, pal.faint);
                    ctx.globalAlpha = waiting;
                    label('Waiting on 3 tasks', left + 16, cursorY + 14.5, 13, pal.faint);
                    ctx.globalAlpha = 1;
                }
            } else {
                toolRow(left, cursorY + 14, 'gitMerge', 'Merged', 'lineup, tickets', false, 1, t, inner);
                cursorY += 40;
                cursorY += streamText('Line-up and tickets are in main and green. The map worktree conflicts in src/nav.tsx.', left, cursorY, inner, -10, t) + 16;
                if (t < ALLOW) {
                    fillRound(left - 4, cursorY, inner + 8, 34, 8, R.rgba(pal.needs, 0.1));
                    icon('hand', left + 4, cursorY + 9, 16, pal.needs);
                    label('Allow deploy to production?', left + 28, cursorY + 17.5, 13, pal.text, 500);
                } else {
                    shine('Deploying', left + 16, cursorY + 17.5, 13, t);
                    disc(left + 4, cursorY + 17, 3.5, pal.running);
                }
            }
            ctx.restore();
        };

        /* A child agent: its plan on top, what it is doing below. */
        const kidPose = (k, t) => {
            const kid = KIDS[k];
            const elapsed = t - kid.out;
            const amount = spring(elapsed, 8.5, 0.62);
            const cy = kid.y + KID_H / 2;
            const fromX = LEAD.x + LEAD.w;
            const fromY = LEAD.y + LEAD.h / 2;
            const flat = clamp(amount);
            // Out on an arc: across first, then down or up into its slot, with the spring's overshoot on x.
            return {
                x: lerp(fromX, KID_X, amount),
                cy: lerp(fromY, cy, E.outCubic(flat)) + Math.sin(PI * flat) * (cy - fromY) * 0.12,
                scale: lerp(0.3, 1, flat),
                alpha: clamp(elapsed / 0.12),
                landed: elapsed > 0.9
            };
        };
        const stepsDone = (kid, t) => {
            let value = 0;
            for (const at of kid.done) {
                value += t >= at ? 1 : 0;
            }
            return t >= MORNING ? 3 : value;
        };
        const kidStatus = (k, t) => {
            const kid = KIDS[k];
            if (t >= MORNING || t >= kid.done[2]) {
                return 'idle';
            }
            if (k === 1 && t >= ASK && t < ANSWERED) {
                return 'needs';
            }
            if (k === 2 && t >= LIMIT && t < RESUME) {
                return 'paused';
            }
            return 'running';
        };
        const OPTIONS = ['Day and weekend', 'Weekend only', 'Something else...'];
        const drawKid = (k, t) => {
            const kid = KIDS[k];
            if (t < kid.out) {
                return;
            }
            const pose = kidPose(k, t);
            const status = kidStatus(k, t);
            const x = KID_X;
            const y = kid.y;
            ctx.save();
            ctx.globalAlpha *= pose.alpha;
            ctx.translate(pose.x, pose.cy);
            ctx.scale(pose.scale, pose.scale);
            ctx.translate(-x, -(y + KID_H / 2));
            nodeFrame(x, y, KID_W, KID_H, { border: status === 'needs' ? R.rgba(pal.needs, 0.4) : undefined });
            nodeHeader(x, y, KID_W, { agent: 'claude', title: kid.title, status }, t + k * 0.4);
            const since = t - kid.out;
            const planIn = E.outCubic(clamp((since - 0.55) / 0.35));
            const done = stepsDone(kid, t);
            // Plan header with its bar.
            ctx.globalAlpha = planIn;
            const px = x + 16;
            label('Plan', px, y + 60, 13, pal.muted);
            label(done + '/3 done', px + 36, y + 60, 13, pal.muted);
            fillRound(px + 116, y + 57.5, KID_W - 148, 5, 2.5, pal.sunken);
            let fill = 0;
            for (const at of kid.done) {
                fill += t >= MORNING ? 1 : E.outCubic(clamp((t - at) / 0.5));
            }
            if (fill > 0.01) {
                fillRound(px + 116, y + 57.5, (KID_W - 148) * (fill / 3), 5, 2.5, pal.idle);
            }
            const activeIndex = status === 'idle' ? -1 : done;
            for (let i = 0; i < 3; i++) {
                const rowIn = E.outCubic(clamp((since - 0.7 - i * 0.1) / 0.3));
                if (rowIn <= 0) {
                    continue;
                }
                ctx.globalAlpha = rowIn;
                const ry = y + 88 + i * 24;
                const finished = t >= MORNING || t >= kid.done[i];
                if (finished) {
                    const popSince = t - kid.done[i];
                    const pop = popSince > 0 && popSince < 0.32 ? 1 + 0.28 * Math.sin((popSince / 0.32) * PI) : 1;
                    ctx.save();
                    ctx.translate(px + 7, ry);
                    ctx.scale(pop, pop);
                    circleCheck(0, 0, 14, pal.idle, t >= MORNING ? 1 : clamp(popSince / 0.38), 1.5);
                    ctx.restore();
                } else if (i === activeIndex && status === 'running') {
                    loader(px + 7, ry, 5.5, t, pal.running);
                } else {
                    circleLine(px + 7, ry, 5.5, pal.faint, 1.3);
                }
                label(kid.steps[i], px + 22 + (1 - rowIn) * 6, ry + 0.5, 13, finished ? pal.muted : pal.text);
            }
            ctx.globalAlpha = planIn;
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x + 12, y + 158, KID_W - 24, 1);
            drawKidActivity(k, t, x, y, status, planIn);
            ctx.restore();
        };

        const drawKidActivity = (k, t, x, y, status, alpha) => {
            const kid = KIDS[k];
            const px = x + 16;
            const ay = y + 182;
            ctx.globalAlpha = alpha;
            if (status === 'idle') {
                const since = t >= MORNING ? 9 : t - kid.done[2];
                circleCheck(px + 6, ay, 14, pal.idle, clamp(since / 0.4), 1.5);
                label('Task done', px + 20, ay + 0.5, 13, pal.idle);
                toolRow(px, ay + 30, 'edit', 'Edited', kid.file, false, alpha, t, 0);
                return;
            }
            if (k === 2 && t >= LIMIT - 0.2 && t < RESUME + 0.6) {
                drawLimit(t, x, y, alpha);
                return;
            }
            if (k === 1 && t >= ASK - 0.1 && t < ANSWERED + 0.2) {
                drawAsk(t, x, y, alpha);
                return;
            }
            if (k === 1 && t >= ANSWERED) {
                bubble('Day and weekend', x + KID_W - 16, ay - 16, 200, alpha);
                ctx.globalAlpha = alpha;
                disc(px + 4, ay + 34, 3.5, pal.running);
                shine('Working', px + 16, ay + 34.5, 13, t);
                return;
            }
            const resumed = k === 2 && t >= RESUME;
            disc(px + 4, ay, 3.5, pal.running);
            shine(resumed ? 'Picking up where it stopped' : 'Working', px + 16, ay + 0.5, 13, t + k * 0.3);
            toolRow(px, ay + 30, 'edit', 'Editing', kid.file, false, alpha, t, 0);
        };

        /* The limit: the dot leaves its pill, a ring clock counts to the reset, and at 03:00 it closes. */
        const MARK_COUNT = 48;
        const drawLimit = (t, x, y, alpha) => {
            const px = x + 16;
            const ay = y + 182;
            const into = clamp((t - LIMIT) / 0.3);
            const outOf = clamp((t - RESUME) / 0.35);
            // Working fades as the limit comes; the words come back with the reset.
            if (t < LIMIT) {
                ctx.globalAlpha = alpha * (1 - into);
                disc(px + 4, ay, 3.5, pal.running);
                shine('Working', px + 16, ay + 0.5, 13, t);
            }
            if (t >= RESUME) {
                ctx.globalAlpha = alpha * outOf;
                disc(px + 4, ay - 8, 3.5, pal.running);
                shine('Picking up where it stopped', px + 16, ay - 7.5, 13, t);
            }
            ctx.globalAlpha = alpha * into * (1 - outOf);
            label('Usage limit reached.', px, ay - 8, 13, pal.text);
            const open = E.outCubic(clamp((t - LIMIT - 0.35) / 0.55)) * (1 - E.inOutCubic(clamp((t - RESUME - 0.1) / 0.5)));
            if (open <= 0.01) {
                ctx.globalAlpha = 1;
                return;
            }
            const cx = px + 22;
            const cy = y + 222;
            const radius = 18;
            const minutes = minutesAt(t);
            const marks = t >= CLICK ? MARK_COUNT : clamp((minutes - 1540) / 80) * MARK_COUNT;
            const clickSince = t - CLICK;
            const bounce = clickSince > 0 ? 0.06 * Math.exp(-clickSince * 7) * Math.sin(clickSince * 26) : 0;
            ctx.save();
            ctx.globalAlpha = alpha * open;
            ctx.translate(cx, cy);
            ctx.scale((0.6 + 0.4 * open) * (1 + bounce), (0.6 + 0.4 * open) * (1 + bounce));
            circleLine(0, 0, radius + 5, 'rgba(255,255,255,0.05)', 1);
            ctx.lineCap = 'round';
            for (let i = 0; i < MARK_COUNT; i++) {
                const appear = clamp((t - LIMIT - 0.5 - (i / MARK_COUNT) * 0.5) / 0.2);
                if (appear <= 0) {
                    continue;
                }
                const angle = -PI / 2 + (i / MARK_COUNT) * TAU;
                const passed = marks - i;
                const major = i % 12 === 0;
                const fresh = passed > 0 && passed < 1.6 ? 1 - (passed - 0.3) / 1.3 : 0;
                const inner = radius - (major ? 5 : 3) + Math.max(0, fresh) * 1.2;
                const outer = radius + Math.max(0, fresh) * 1.2;
                let color = passed > 0 ? R.mix(pal.muted, pal.text, Math.max(0, fresh)) : 'rgba(255,255,255,0.14)';
                if (clickSince > 0 && clickSince < 0.8) {
                    color = R.mix(pal.running, pal.muted, clamp(clickSince / 0.8));
                }
                ctx.strokeStyle = color;
                ctx.lineWidth = major ? 1.5 : 1;
                ctx.globalAlpha = alpha * open * appear;
                ctx.beginPath();
                ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
                ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
                ctx.stroke();
            }
            ctx.globalAlpha = alpha * open;
            if (marks > 0.01) {
                const end = -PI / 2 + (marks / MARK_COUNT) * TAU;
                ctx.beginPath();
                ctx.arc(0, 0, radius - 8, -PI / 2, end);
                ctx.strokeStyle = clickSince > 0 ? R.mix(pal.running, pal.muted, clamp(clickSince / 1.2) * 0.5) : 'rgba(236,236,241,0.5)';
                ctx.lineWidth = 2;
                ctx.stroke();
                if (clickSince < 0) {
                    disc(Math.cos(end) * (radius - 8), Math.sin(end) * (radius - 8), 2, pal.text);
                }
            }
            if (clickSince > 0 && clickSince < 0.7) {
                ctx.globalAlpha = alpha * (1 - clickSince / 0.7) * 0.8;
                circleLine(0, 0, radius + E.outCubic(clickSince / 0.7) * 14, pal.running, 1.5);
            }
            ctx.restore();
            // The time and the reset beside it, then the switch that makes the reset matter.
            const textIn = clamp((t - LIMIT - 0.6) / 0.35) * (1 - clamp((t - RESUME) / 0.3));
            ctx.globalAlpha = alpha * textIn;
            label(hhmm(minutes), cx + 34, cy - 7, 18, t >= CLICK ? pal.text : R.mix(pal.text, pal.muted, 0.15), 500, MONO);
            label('resets 03:00', cx + 35, cy + 12, 11, pal.muted, 400, MONO);
            const sx = x + KID_W - 142;
            const sy = cy - 8;
            fillRound(sx, sy, 26, 15, 7.5, pal.accent);
            fillRound(sx + 13, sy + 2, 11, 11, 5.5, '#ffffff');
            label('Resume at reset', sx + 33, sy + 8, 12, pal.text);
            // The one beat that says why it will wake: a ring around the switch.
            const hint = phase(t, 24.4, 1.1);
            if (hint > 0 && hint < 1) {
                ctx.globalAlpha = alpha * textIn * Math.sin(PI * hint) * 0.9;
                strokeRound(sx - 5, sy - 5, 36, 25, 12.5, R.rgba(pal.accent, 0.9), 1.5);
                ctx.globalAlpha = alpha * textIn * (1 - hint) * 0.5 * (hint > 0.4 ? 1 : 0);
                strokeRound(sx - 5 - hint * 8, sy - 5 - hint * 8, 36 + hint * 16, 25 + hint * 16, 12.5 + hint * 8, R.rgba(pal.accent, 0.8), 1);
            }
            ctx.globalAlpha = 1;
        };

        /* The question, as a prompt card inside the chat: it covers the plan while it waits. */
        const drawAsk = (t, x, y, alpha) => {
            const grow = E.outBack(clamp((t - ASK) / 0.45), 1.4) * (1 - E.inCubic(clamp((t - ANSWERED) / 0.2)));
            if (grow <= 0.01) {
                return;
            }
            const cx = x + 10;
            const cy = y + 76;
            const cw = KID_W - 20;
            const ch = 164;
            ctx.save();
            ctx.globalAlpha = alpha * clamp(grow);
            ctx.translate(cx + cw / 2, cy + ch);
            ctx.scale(1, 0.9 + 0.1 * grow);
            ctx.translate(-(cx + cw / 2), -(cy + ch));
            fillRound(cx, cy + 3, cw, ch, 12, 'rgba(0,0,0,0.3)');
            fillRound(cx, cy, cw, ch, 12, pal.raised);
            strokeRound(cx + 0.5, cy + 0.5, cw - 1, ch - 1, 11.5, R.rgba(pal.needs, 0.25));
            icon('question', cx + 12, cy + 12, 16, pal.needs);
            label('Sell day tickets, or weekend only?', cx + 36, cy + 20.5, 13, pal.text, 600);
            for (let i = 0; i < 3; i++) {
                const rowIn = E.outCubic(clamp((t - ASK - 0.2 - i * 0.08) / 0.3));
                ctx.globalAlpha = alpha * clamp(grow) * rowIn;
                const ry = cy + 40 + i * 32 + (1 - rowIn) * 4;
                fillRound(cx + 10, ry, cw - 20, 27, 8, pal.hover);
                strokeRound(cx + 10.5, ry + 0.5, cw - 21, 26, 7.5, 'rgba(255,255,255,0.07)');
                icon('circle', cx + 19, ry + 6.5, 14, pal.muted);
                label(OPTIONS[i], cx + 41, ry + 14, 13, i === 2 ? pal.muted : pal.text);
            }
            ctx.restore();
            ctx.globalAlpha = 1;
        };

        /* Edges: the context line from the sketch, the task lines to the children. */
        const drawContextEdge = (t) => {
            if (t < PRESS) {
                return;
            }
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (t < SNAP) {
                const tip = cursorWorld(t);
                const c1x = PORT_A.x + 50;
                const c2x = tip.x - 40;
                ctx.beginPath();
                ctx.moveTo(PORT_A.x, PORT_A.y);
                ctx.bezierCurveTo(c1x, PORT_A.y, c2x, tip.y, tip.x, tip.y);
                ctx.strokeStyle = pal.muted;
                ctx.lineWidth = 2;
                ctx.stroke();
                disc(PORT_A.x, PORT_A.y, 4, pal.muted);
                return;
            }
            // Snapped: the line settles into its rail and takes the context color, with one flash of accent.
            const flash = 1 - clamp((t - SNAP) / 0.6);
            ctx.strokeStyle = R.mix(EDGE_CONTEXT, pal.accent, flash);
            ctx.lineWidth = 2 + flash * 1.5;
            strokeRoute(contextRoute, 0, contextRoute.length);
            headDot(PORT_B.x, PORT_B.y, R.mix(EDGE_CONTEXT, pal.accent, flash));
            if (flash > 0) {
                ctx.globalAlpha = flash * 0.6;
                circleLine(PORT_B.x, PORT_B.y, 5 + (1 - flash) * 18, pal.accent, 1.5);
                ctx.globalAlpha = 1;
            }
            // What the sketch says travels along the line as words, on small arcs.
            for (let i = 0; i < CHIP_WORDS.length; i++) {
                const start = CHIPS + i * 0.17;
                const k = clamp((t - start) / 0.75);
                if (k <= 0 || k >= 1) {
                    if (k >= 1 && t - start - 0.75 < 0.35) {
                        const land = (t - start - 0.75) / 0.35;
                        ctx.globalAlpha = (1 - land) * 0.5;
                        circleLine(PORT_B.x, PORT_B.y, 5 + land * 10, pal.accent, 1.2);
                        ctx.globalAlpha = 1;
                    }
                    continue;
                }
                const along = sine(k);
                const pos = routeAt(contextRoute, along * contextRoute.length);
                const lift = Math.sin(PI * along) * (i % 2 ? 16 : -16);
                const word = CHIP_WORDS[i];
                setFont(11, 500, MONO);
                const wide = measure(word) + 12;
                ctx.globalAlpha = clamp(k * 6) * clamp((1 - k) * 6);
                fillRound(pos.x - wide / 2, pos.y + lift - 8, wide, 16, 8, hexMix(pal.accent, GROUND, 0.55));
                label(word, pos.x, pos.y + lift + 0.5, 11, '#dbe6ff', 500, MONO, 'center');
                ctx.globalAlpha = 1;
            }
        };
        const drawTaskEdges = (t) => {
            const ax = LEAD.x + LEAD.w + 9;
            const ay = LEAD.y + LEAD.h / 2;
            for (let k = 0; k < KIDS.length; k++) {
                const kid = KIDS[k];
                if (t < kid.out) {
                    continue;
                }
                const pose = kidPose(k, t);
                const route = routeAcross(taskRoutes[k], ax, ay, pose.x - 9 * pose.scale, pose.cy, 14);
                const finished = kidStatus(k, t) === 'idle';
                ctx.save();
                ctx.globalAlpha *= pose.alpha;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = EDGE_CONTEXT;
                ctx.lineWidth = 2;
                ctx.setLineDash(finished ? [] : [6, 6]);
                ctx.lineDashOffset = finished ? 0 : -t * 14;
                strokeRoute(route, 0, route.length);
                ctx.setLineDash([]);
                headDot(pose.x - 9 * pose.scale, pose.cy, EDGE_CONTEXT);
                ctx.restore();
            }
        };

        /* The cursor that draws the line: over the sketch, pressed at its port, dragged along an arc, let go. */
        const cursorWorld = (t) => {
            const hoverX = 250;
            const hoverY = 250;
            if (t < PRESS - 0.5) {
                return { x: hoverX, y: hoverY };
            }
            if (t < PRESS) {
                const k = io(clamp((t - PRESS + 0.5) / 0.5));
                return { x: lerp(hoverX, PORT_A.x, k), y: lerp(hoverY, PORT_A.y, k) + Math.sin(PI * k) * 10 };
            }
            const k = io(clamp((t - PRESS - 0.1) / (SNAP - PRESS - 0.18)));
            return { x: lerp(PORT_A.x, PORT_B.x, k), y: lerp(PORT_A.y, PORT_B.y, k) - Math.sin(PI * k) * 36 };
        };
        const drawCursorWorld = (t, zoom) => {
            const alpha = shown(t, 5.6, 8.4, 0.4, 0.5);
            if (alpha <= 0.01) {
                return;
            }
            let pos = cursorWorld(t);
            if (t > SNAP) {
                const k = io(clamp((t - SNAP - 0.1) / 0.7));
                pos = { x: PORT_B.x + k * 30, y: PORT_B.y + k * 40 };
            }
            const press = Math.sin(PI * phase(t, PRESS - 0.08, 0.2)) + Math.sin(PI * phase(t, SNAP - 0.1, 0.2)) * 0.6;
            cursor(pos.x, pos.y, (1.15 / zoom) * (1 - press * 0.1), alpha);
        };

        /* The whole canvas at one moment: edges under nodes, as the client draws them. */
        const drawWorld = (t, zoom, back = 0) => {
            drawTaskEdges(t);
            drawContextEdge(t);
            drawSketch(t);
            drawTests(t, back);
            let recoil = 0;
            for (const kid of KIDS) {
                recoil -= Math.sin(PI * phase(t, kid.out - 0.02, 0.28)) * 5;
            }
            // The lead gives a small push toward the line when the context lands on it.
            recoil -= Math.sin(PI * phase(t, SNAP, 0.3)) * 3;
            drawLead(t, recoil);
            for (let k = 0; k < KIDS.length; k++) {
                drawKid(k, t);
            }
            if (t < 9) {
                drawCursorWorld(t, zoom);
            }
        };

        /* ---------- The app window: sidebar, toolbar, and a canvas or a grid of views. ---------- */
        const APP_W = 1280;
        const APP_H = 720;
        const SIDE = 248;
        const BAR = 48;
        let dotFade = 1;
        const dotGrid = (area, cam) => {
            const pitch = 24 * cam.z;
            if (pitch < 8 || dotFade <= 0.01) {
                return;
            }
            const alpha = 0.085 * clamp((pitch - 8) / 8) * dotFade;
            const size = clamp(1.1 * cam.z, 0.9, 1.8);
            const ox = area.x + area.w / 2 - cam.x * cam.z;
            const oy = area.y + area.h / 2 - cam.y * cam.z;
            const x0 = area.x + R.mod(ox - area.x, pitch);
            const y0 = area.y + R.mod(oy - area.y, pitch);
            ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(4) + ')';
            ctx.beginPath();
            for (let y = y0; y < area.y + area.h; y += pitch) {
                for (let x = x0; x < area.x + area.w; x += pitch) {
                    ctx.rect(x - size / 2, y - size / 2, size, size);
                }
            }
            ctx.fill();
        };
        // `bare` draws only the nodes and lines, for the moment the canvas grows out of something else.
        const canvasView = (t, area, cam, back = 0, bare = false) => {
            ctx.save();
            if (!bare) {
                ctx.beginPath();
                ctx.rect(area.x, area.y, area.w, area.h);
                ctx.clip();
                ctx.fillStyle = GROUND;
                ctx.fillRect(area.x, area.y, area.w, area.h);
                dotGrid(area, cam);
            }
            ctx.translate(area.x + area.w / 2, area.y + area.h / 2);
            ctx.scale(cam.z, cam.z);
            ctx.translate(-cam.x, -cam.y);
            drawWorld(t, cam.z, back);
            ctx.restore();
        };
        const sidebarRows = (t, gridOpen) => {
            const morning = t >= MORNING;
            const rows = [
                { icon: 'canvas', name: 'nachtveld-web', selected: !gridOpen },
                { mark: 'claude', name: 'Launch the Nachtveld site', status: leadStatus(t), nested: true },
                { mark: 'claude', name: 'Line-up page', status: kidStatus(0, t), nested: true, hidden: t < KIDS[0].out },
                { mark: 'claude', name: 'Ticket shop', status: kidStatus(1, t), nested: true, hidden: t < KIDS[1].out },
                { mark: 'claude', name: 'Festival map', status: kidStatus(2, t), nested: true, hidden: t < KIDS[2].out, beside: gridOpen },
                { mark: 'codex', name: 'tests', status: 'running', nested: true, beside: gridOpen },
                { icon: 'drawing', name: 'Map sketch', nested: true },
                'separator',
                { icon: 'browser', name: 'Map preview', beside: gridOpen }
            ];
            if (morning) {
                rows[2].status = 'idle';
            }
            return rows;
        };
        const rowGlyph = (row, x, y) => {
            if (row.mark) {
                mark(row.mark, x, y, 14, pal.muted);
            } else {
                icon(row.icon, x, y, 14, pal.muted);
            }
        };
        // Where each sidebar row sits, so a view can fly out of it into the grid.
        const rowTops = [];
        const sidebar = (t, dx, gridOpen, needsIn) => {
            ctx.save();
            ctx.translate(dx, 0);
            ctx.fillStyle = pal.surface;
            ctx.fillRect(0, 0, SIDE, APP_H);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(SIDE - 1, 0, 1, APP_H);
            const lights = ['#ff5f57', '#febc2e', '#28c840'];
            for (let k = 0; k < 3; k++) {
                disc(23 + k * 20, 24, 6, lights[k]);
            }
            label('Ruimte', 92, 24.5, 13, pal.faint, 600);
            icon('panelLeft', SIDE - 32, 16, 16, pal.muted);
            let y = 56;
            // What waits on the person comes first, as the client's sidebar puts it.
            if (needsIn > 0.01) {
                const waiting = [
                    { mark: 'claude', name: 'Launch the Nachtveld site', status: t < ALLOW ? 'needs' : 'running' },
                    { mark: 'claude', name: 'Festival map', status: 'needs' }
                ];
                const tall = (30 + waiting.length * 33 + 12) * needsIn;
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, y, SIDE, tall);
                ctx.clip();
                ctx.globalAlpha = needsIn;
                statusDot(24, y + 15, 'needs', t, 4);
                label('Needs you', 34, y + 15.5, 13, pal.faint, 500);
                label(String(waiting.length), SIDE - 18, y + 15.5, 13, pal.faint, 500, SANS, 'right');
                for (let i = 0; i < waiting.length; i++) {
                    const ry = y + 30 + i * 33;
                    rowGlyph(waiting[i], 16, ry + 9);
                    label(waiting[i].name, 40, ry + 16.5, 14, pal.muted, 500);
                    statusDot(SIDE - 22, ry + 16, waiting[i].status, t, 4);
                }
                ctx.restore();
                ctx.globalAlpha = 1;
                y += tall;
            }
            const rows = sidebarRows(t, gridOpen);
            rowTops.length = 0;
            for (const row of rows) {
                if (row === 'separator') {
                    ctx.fillStyle = 'rgba(255,255,255,0.03)';
                    ctx.fillRect(0, y + 12, SIDE, 1);
                    y += 24;
                    continue;
                }
                if (row.hidden) {
                    continue;
                }
                rowTops.push({ name: row.name, y });
                if (row.selected) {
                    fillRound(8, y, SIDE - 16, 32, 6, pal.active);
                }
                const indent = row.nested ? 16 : 0;
                rowGlyph(row, 16 + indent, y + 9);
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, y, SIDE - 36, 32);
                ctx.clip();
                label(row.name, 40 + indent, y + 16.5, 14, row.selected || row.beside ? pal.text : pal.muted, row.nested ? 400 : 500);
                ctx.restore();
                if (row.status === 'idle') {
                    circleCheck(SIDE - 22, y + 16, 12, pal.idle, 1, 1.4);
                } else if (row.status) {
                    statusDot(SIDE - 22, y + 16, row.status, t, 4);
                }
                y += 33;
            }
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(0, APP_H - 49, SIDE, 1);
            icon('plus', 18, APP_H - 32, 14, pal.muted);
            label('View', 40, APP_H - 24.5, 14, pal.muted);
            disc(SIDE - 88, APP_H - 25, 4, pal.idle);
            icon('chart', SIDE - 70, APP_H - 33, 16, pal.muted);
            icon('settings', SIDE - 36, APP_H - 33, 16, pal.muted);
            ctx.restore();
        };
        const toolbar = (t, x, dy) => {
            ctx.save();
            ctx.translate(0, dy);
            ctx.fillStyle = pal.surface;
            ctx.fillRect(x, 0, APP_W - x, BAR);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, BAR - 1, APP_W - x, 1);
            icon('server', x + 16, 17, 14, pal.muted);
            fillRound(x + 38, 16, 16, 16, 3, R.rgba(pal.magenta, 0.2));
            label('N', x + 46, 24.5, 11, pal.magenta, 600, SANS, 'center');
            const nameWidth = label('nachtveld-web', x + 62, 24.5, 14, pal.text, 500);
            label('build-box', x + 70 + nameWidth, 24.5, 13, pal.faint);
            setFont(13);
            icon('chevronDown', x + 76 + nameWidth + measure('build-box'), 17, 14, pal.muted);
            const right = APP_W - 8;
            icon('search', right - 24, 16, 16, pal.muted);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(right - 40, 16, 1, 16);
            icon('tablet', right - 72, 16, 16, pal.muted);
            icon('gitBranch', right - 104, 16, 16, pal.muted);
            icon('folder', right - 136, 16, 16, pal.muted);
            ctx.fillRect(right - 152, 16, 1, 16);
            ctx.restore();
        };
        // The dock of a canvas view: what waits and works, then add, zoom and lock.
        const dock = (t, area, alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            let waiting = 0;
            let working = 0;
            let finished = 0;
            for (let k = 0; k < KIDS.length; k++) {
                if (t < KIDS[k].out) {
                    continue;
                }
                const status = kidStatus(k, t);
                if (status === 'idle') {
                    finished++;
                } else if (status === 'needs') {
                    waiting++;
                } else if (status === 'running') {
                    working++;
                }
            }
            const lead = leadStatus(t);
            if (lead === 'needs') {
                waiting++;
            } else if (lead === 'running') {
                working++;
            }
            working++;
            if (t >= MORNING && t < ALLOW) {
                waiting = 2;
            }
            const wide = 420;
            const x = area.x + area.w / 2 - wide / 2;
            const y = area.y + area.h - 56;
            ctx.save();
            ctx.globalAlpha = alpha;
            floatCard(x, y, wide, 40, 12);
            let cx = x + 10;
            if (waiting > 0) {
                statusDot(cx + 8, y + 20, 'needs', t, 4);
                label(String(waiting), cx + 18, y + 20.5, 13, pal.text, 500);
                cx += 40;
            }
            statusDot(cx + 8, y + 20, 'running', t, 4);
            label(String(working), cx + 18, y + 20.5, 13, pal.muted, 500);
            cx += 40;
            circleCheck(cx + 8, y + 20, 12, pal.idle, 1, 1.4);
            label(String(finished), cx + 18, y + 20.5, 13, pal.muted, 500);
            cx += 40;
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(cx, y + 12, 1, 16);
            icon('plus', cx + 12, y + 12, 16, pal.muted);
            ctx.fillRect(cx + 40, y + 12, 1, 16);
            icon('minus', cx + 52, y + 12, 16, pal.muted);
            label('100%', cx + 100, y + 20.5, 13, pal.muted, 400, SANS, 'center');
            icon('plus', cx + 128, y + 12, 16, pal.muted);
            icon('maximize', cx + 156, y + 12, 16, pal.muted);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(cx + 184, y + 12, 1, 16);
            icon('lockOpen', cx + 196, y + 12, 16, pal.muted);
            ctx.restore();
        };

        /* The stack of what waits on the person, above the dock (`PromptStack.tsx`). */
        const STACK = [
            { status: 'idle', title: 'Line-up page', meta: 'Claude · 01:52', glyph: 'circleCheck', head: 'Task done, merged into main', lands: 45.9 },
            { status: 'needs', title: 'Festival map', meta: 'Claude · 04:12', glyph: 'gitMerge', head: 'Merge conflict in src/nav.tsx', lands: 46.15 },
            { status: 'needs', title: 'Launch the Nachtveld site', meta: 'Claude · 07:02', glyph: 'hand', head: 'Allow deploy to production?', lands: 46.4 }
        ];
        const CARD_W = 420;
        const CARD_H = 206;
        const button = (text, right, y, variant, press = 0, glyph = null) => {
            setFont(13, 500);
            const wide = measure(text) + (glyph ? 42 : 20);
            const x = right - wide;
            ctx.save();
            ctx.translate(x + wide / 2, y + 14);
            ctx.scale(1 - press * 0.06, 1 - press * 0.06);
            if (variant === 'inverse') {
                fillRound(-wide / 2, -14, wide, 28, 6, pal.text);
            }
            const color = variant === 'inverse' ? pal.bg : pal.muted;
            if (glyph) {
                icon(glyph, -wide / 2 + 10, -8, 16, color);
            }
            label(text, -wide / 2 + (glyph ? 32 : 10), 0.5, 13, color, 500);
            ctx.restore();
            return wide;
        };
        // One card of the stack at 0, 0; `count` and `index` for its pager.
        const stackCard = (card, t, index, count, full, press) => {
            fillRound(-2, 6, CARD_W + 4, CARD_H + 4, 17, 'rgba(0,0,0,0.25)');
            fillRound(0, 2, CARD_W, CARD_H, 16, 'rgba(0,0,0,0.3)');
            fillRound(0, 0, CARD_W, CARD_H, 16, pal.raised);
            ctx.save();
            R.roundRect(ctx, 0, 0, CARD_W, CARD_H, 16);
            ctx.clip();
            statusDot(16, 16, card.status, t, 4);
            const titleWidth = label(card.title, 28, 16.5, 13, pal.text, 500);
            label(card.meta, 36 + titleWidth, 16.5, 12, pal.muted);
            if (count > 1) {
                const text = index + 1 + ' of ' + count;
                setFont(12);
                const tw = measure(text);
                icon('chevronRight', CARD_W - 24, 10, 12, pal.muted);
                label(text, CARD_W - 28, 16.5, 12, pal.muted, 400, SANS, 'right');
                icon('chevronLeft', CARD_W - 44 - tw, 10, 12, pal.faint);
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, 32.5);
            ctx.lineTo(CARD_W, 32.5);
            ctx.stroke();
            ctx.setLineDash([]);
            const top = 44;
            const color = card.status === 'idle' ? pal.idle : pal.needs;
            if (card.glyph === 'circleCheck') {
                circleCheck(20, top + 10, 16, color, 1, 1.6);
            } else {
                icon(card.glyph, 12, top + 2, 16, color);
            }
            label(card.head, 36, top + 10.5, 14, pal.text, 600);
            if (full) {
                label('1 request waiting', 36, top + 29.5, 12, pal.muted);
                const boxY = top + 48;
                fillRound(12, boxY, CARD_W - 24, 56, 12, pal.sunken);
                label('~/nachtveld-web', 24, boxY + 18, 12, pal.muted, 400, MONO);
                label('bun run deploy --prod', 24, boxY + 37, 13, pal.text, 400, MONO);
                const by = boxY + 70;
                let right = CARD_W - 12;
                right -= button('Allow', right, by, 'inverse', press, 'circleCheck') + 6;
                right -= button('Deny', right, by, 'ghost') + 6;
                button('Always allow', right, by, 'ghost');
            }
            ctx.restore();
            strokeRound(0.5, 0.5, CARD_W - 1, CARD_H - 1, 15.5, 'rgba(255,255,255,0.1)');
        };
        // The stack as it stands at t: cards land one by one, fan out, fold back behind the newest.
        const stackAllowAt = () => {
            return { x: 0, y: 0 };
        };
        const stack = (t, area, s) => {
            if (s.stack <= 0.01) {
                return null;
            }
            const cx = area.x + area.w / 2;
            const baseY = area.y + area.h - 72 - CARD_H + s.stackDrop;
            const fan = s.fan;
            let allow = null;
            for (let i = 0; i < STACK.length; i++) {
                const card = STACK[i];
                const arrive = s.instant ? 1 : spring(t - card.lands, 9, 0.62);
                if (arrive <= 0.001) {
                    continue;
                }
                const depth = STACK.length - 1 - i;
                const spacing = lerp(10, 62, fan);
                const scale = 1 - depth * lerp(0.05, 0.035, fan);
                const y = baseY - depth * spacing + (1 - clamp(arrive)) * 120 - (arrive > 1 ? (arrive - 1) * 30 : 0);
                const dim = depth * lerp(0.4, 0.16, fan);
                ctx.save();
                ctx.globalAlpha = s.stack * clamp(arrive * 3);
                ctx.translate(cx, y);
                ctx.scale(scale, scale);
                ctx.rotate((1 - clamp(arrive)) * (i % 2 ? 0.08 : -0.08));
                ctx.translate(-CARD_W / 2, 0);
                const front = depth === 0;
                stackCard(card, t, i, STACK.length, front, front ? s.press : 0);
                if (dim > 0.001) {
                    fillRound(0, 0, CARD_W, CARD_H, 16, 'rgba(12,12,15,' + clamp(dim).toFixed(3) + ')');
                }
                ctx.restore();
                if (front) {
                    allow = { x: cx + (CARD_W / 2 - 12 - 40) * scale, y: y + (44 + 48 + 70 + 14) * scale };
                }
            }
            return allow;
        };

        /* ---------- Grid views: browser, tests and the merge, side by side. ---------- */
        const GRID_VIEWS = [
            { name: 'Map preview', icon: 'browser' },
            { name: 'Festival map', mark: 'claude' },
            { name: 'tests', mark: 'codex' }
        ];
        const gridSlot = (area, i) => {
            const half = Math.floor((area.w - 1) / 2);
            if (i === 0) {
                return { x: area.x, y: area.y, w: half, h: area.h };
            }
            const top = Math.floor((area.h - 1) / 2);
            return i === 1 ? { x: area.x + half + 1, y: area.y, w: area.w - half - 1, h: top } : { x: area.x + half + 1, y: area.y + top + 1, w: area.w - half - 1, h: area.h - top - 1 };
        };
        const cellBar = (view, x, y, wide, focused, status, t) => {
            fillRound(x, y, wide, 40, 0, focused ? pal.surface : '#0e0e10');
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + 39, wide, 1);
            rowGlyph(view, x + 12, y + 13);
            label(view.name, x + 34, y + 20.5, 13, focused ? pal.text : pal.muted, 500);
            if (status === 'idle') {
                circleCheck(x + wide - 48, y + 20, 12, pal.idle, 1, 1.4);
            } else if (status) {
                statusDot(x + wide - 48, y + 20, status, t, 4);
            }
            icon('close', x + wide - 30, y + 13, 14, pal.muted);
        };
        const mapPage = (x, y, wide, tall, t, built) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, wide, tall);
            ctx.clip();
            ctx.fillStyle = '#0f1024';
            ctx.fillRect(x, y, wide, tall);
            const reveal = (at) => E.outCubic(clamp((built - at) / 0.3));
            ctx.globalAlpha = reveal(0);
            label('NACHTVELD', x + 24, y + 30, 16, '#f5f0ff', 700);
            const links = ['Line-up', 'Tickets', 'Map'];
            for (let i = 0; i < 3; i++) {
                label(links[i], x + wide - 190 + i * 64, y + 30, 13, i === 2 ? '#f0abfc' : 'rgba(245,240,255,0.7)', 500);
            }
            ctx.globalAlpha = reveal(0.1);
            label('Festival map', x + 24, y + 78, 26, '#f5f0ff', 700);
            label('14 to 16 August', x + 24, y + 106, 13, 'rgba(245,240,255,0.65)');
            // The grounds, drawn from the sketch: the field, Veld, Bos in the trees, food, the entrance.
            ctx.globalAlpha = reveal(0.2);
            const mx = x + 24;
            const my = y + 130;
            const mw = wide - 48;
            const mh = tall - 150;
            fillRound(mx, my, mw, mh, 14, '#16183a');
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(mx + mw / 2, my + mh / 2, mw * 0.44, mh * 0.42, 0, 0, TAU);
            ctx.fillStyle = '#1c2a3a';
            ctx.fill();
            ctx.restore();
            ctx.globalAlpha = reveal(0.3);
            ctx.setLineDash([6, 6]);
            ctx.strokeStyle = 'rgba(245,240,255,0.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(mx + mw * 0.52, my + mh * 0.92);
            ctx.quadraticCurveTo(mx + mw * 0.4, my + mh * 0.6, mx + mw * 0.26, my + mh * 0.36);
            ctx.moveTo(mx + mw * 0.54, my + mh * 0.92);
            ctx.quadraticCurveTo(mx + mw * 0.64, my + mh * 0.62, mx + mw * 0.72, my + mh * 0.42);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = reveal(0.4);
            fillRound(mx + mw * 0.12, my + mh * 0.18, mw * 0.28, mh * 0.18, 8, '#e879f9');
            label('Veld', mx + mw * 0.26, my + mh * 0.27, 15, '#1a0b24', 700, SANS, 'center');
            fillRound(mx + mw * 0.6, my + mh * 0.26, mw * 0.24, mh * 0.16, 8, '#a78bfa');
            label('Bos', mx + mw * 0.72, my + mh * 0.34, 15, '#140c2a', 700, SANS, 'center');
            ctx.fillStyle = '#2f5a45';
            for (let k = 0; k < 7; k++) {
                ctx.beginPath();
                ctx.arc(mx + mw * (0.64 + (k % 4) * 0.06), my + mh * (0.5 + Math.floor(k / 4) * 0.1 + (k % 2) * 0.03), 7, 0, TAU);
                ctx.fill();
            }
            fillRound(mx + mw * 0.3, my + mh * 0.56, mw * 0.18, mh * 0.12, 6, '#f0abfc');
            label('Food', mx + mw * 0.39, my + mh * 0.62, 12, '#2a0f30', 700, SANS, 'center');
            label('Entrance', mx + mw * 0.53, my + mh * 0.97, 12, 'rgba(245,240,255,0.8)', 500, SANS, 'center');
            ctx.restore();
            ctx.globalAlpha = 1;
        };
        const browserCell = (x, y, wide, tall, t) => {
            const live = t >= 55.1;
            ctx.fillStyle = pal.raised;
            ctx.fillRect(x, y, wide, 37);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y + 36, wide, 1);
            icon('arrowLeft', x + 10, y + 11, 14, pal.muted);
            icon('arrowRight', x + 38, y + 11, 14, pal.muted);
            icon('reload', x + 66, y + 11, 14, pal.muted);
            fillRound(x + 92, y + 5, wide - 132, 27, 6, pal.sunken);
            icon('lock', x + 102, y + 12.5, 12, pal.muted);
            let url = 'localhost:3000/map';
            if (live) {
                const typed = Math.floor(clamp((t - 55.1) / 0.35) * 17);
                url = 'nachtveld.app/map'.slice(0, Math.max(1, typed));
            }
            label(url, x + 122, y + 19, 14, pal.text);
            icon('externalLink', x + wide - 30, y + 11, 14, pal.muted);
            const loads = [49.45, 55.5];
            for (const start of loads) {
                const k = phase(t, start, 0.55);
                if (k > 0 && k < 1) {
                    ctx.fillStyle = R.rgba(pal.accent, 0.16);
                    ctx.fillRect(x, y + 35, wide, 2);
                    ctx.fillStyle = pal.accent;
                    ctx.fillRect(x + (k * 1.3 - 0.3) * wide, y + 35, wide / 3, 2);
                }
            }
            let built = t - 49.95;
            if (t >= 55.5) {
                built = Math.min(built, (t - 55.85) * 1.5);
            }
            mapPage(x, y + 37, wide, tall - 37, t, built);
        };
        const MERGE_COLS = [
            { head: 'ours', sub: 'main', lines: ['nav(', "  link('/lineup'),", "  link('/tickets'),", ')'], mark: 2 },
            { head: 'base', sub: '', lines: ['nav(', "  link('/lineup'),", ')'], mark: -1 },
            { head: 'theirs', sub: 'festival-map', lines: ['nav(', "  link('/lineup'),", "  link('/map'),", ')'], mark: 2 }
        ];
        const RESULT = ['nav(', "  link('/lineup'),", "  link('/tickets'),", "  link('/map'),", ')'];
        const ACCEPT = 51.0;
        const mergeCell = (x, y, wide, tall, t) => {
            ctx.fillStyle = GROUND;
            ctx.fillRect(x, y, wide, tall);
            const resolved = t >= ACCEPT + 0.15;
            label('Resolve conflicts', x + 14, y + 22, 14, pal.text, 600);
            setFont(14, 600);
            label('src/nav.tsx', x + 22 + measure('Resolve conflicts'), y + 22, 12, pal.muted, 400, MONO);
            const statusText = resolved ? 'All resolved' : '1 conflict left';
            setFont(12);
            const sw = measure(statusText);
            disc(x + wide - 24 - sw, y + 22, 4, resolved ? pal.idle : pal.needs);
            label(statusText, x + wide - 14, y + 22.5, 12, pal.muted, 400, SANS, 'right');
            const colW = (wide - 28 - 12) / 3;
            const colY = y + 40;
            const colH = 88;
            for (let c = 0; c < 3; c++) {
                const col = MERGE_COLS[c];
                const cx = x + 14 + c * (colW + 6);
                fillRound(cx, colY, colW, colH, 8, pal.sunken);
                strokeRound(cx + 0.5, colY + 0.5, colW - 1, colH - 1, 7.5, 'rgba(255,255,255,0.07)');
                const headWidth = label(col.head, cx + 8, colY + 12, 11, pal.text, 500);
                if (col.sub) {
                    label(col.sub, cx + 14 + headWidth, colY + 12, 10.5, pal.faint, 400, MONO);
                }
                ctx.save();
                ctx.beginPath();
                ctx.rect(cx, colY, colW, colH);
                ctx.clip();
                for (let i = 0; i < col.lines.length; i++) {
                    const ly = colY + 30 + i * 15;
                    if (i === col.mark) {
                        ctx.fillStyle = R.rgba(pal.green, 0.12);
                        ctx.fillRect(cx + 1, ly - 7, colW - 2, 14);
                        ctx.fillStyle = pal.green;
                        ctx.fillRect(cx + 1, ly - 7, 2, 14);
                    }
                    label(col.lines[i], cx + 8, ly, 10.5, i === col.mark ? pal.text : pal.muted, 400, MONO);
                }
                ctx.restore();
            }
            const ry = colY + colH + 8;
            const rh = tall - (ry - y) - 10;
            fillRound(x + 14, ry, wide - 28, rh, 8, pal.sunken);
            strokeRound(x + 14.5, ry + 0.5, wide - 29, rh - 1, 7.5, 'rgba(255,255,255,0.07)');
            label('result', x + 22, ry + 12, 11, pal.text, 500);
            label('src/nav.tsx', x + 62, ry + 12, 10.5, pal.faint, 400, MONO);
            for (let i = 0; i < RESULT.length; i++) {
                const ly = ry + 30 + i * 15;
                const proposed = i === 2 || i === 3;
                if (proposed) {
                    if (!resolved) {
                        ctx.strokeStyle = R.rgba(pal.accent, 0.9);
                        ctx.fillStyle = R.rgba(pal.accent, 0.12);
                        ctx.setLineDash([3, 3]);
                        if (i === 2) {
                            fillRound(x + 18, ly - 8, wide - 36, 30, 4, R.rgba(pal.accent, 0.12));
                            strokeRound(x + 18.5, ly - 7.5, wide - 37, 29, 4, R.rgba(pal.accent, 0.8));
                        }
                        ctx.setLineDash([]);
                    } else {
                        const settle = clamp((t - ACCEPT - 0.15) / 0.4);
                        ctx.fillStyle = R.rgba(pal.green, 0.12 * (1 - settle * 0.5));
                        ctx.fillRect(x + 15, ly - 7, wide - 30, 14);
                        ctx.fillStyle = pal.green;
                        ctx.fillRect(x + 15, ly - 7, 2, 14);
                    }
                }
                label(String(i + 1), x + 24, ly, 10.5, pal.faint, 400, MONO);
                label(RESULT[i], x + 40, ly, 10.5, proposed && !resolved ? '#c8d7ff' : pal.text, 400, MONO);
                if (proposed && resolved && i === 2) {
                    tick(x + wide - 34, ly + 7, 9, pal.green, 1.6);
                }
            }
            if (!resolved) {
                const bx = x + wide - 92;
                const by = ry + 30 + 2 * 15 - 1;
                mark('claude', bx - 62, by - 6, 12, pal.muted);
                label('proposed', bx - 46, by + 0.5, 11, pal.muted);
                const press = Math.sin(PI * phase(t, ACCEPT - 0.1, 0.2));
                ctx.save();
                ctx.translate(bx + 32, by);
                ctx.scale(1 - press * 0.08, 1 - press * 0.08);
                fillRound(-30, -11, 60, 22, 6, pal.text);
                label('Accept', 0, 0.5, 12, pal.bg, 500, SANS, 'center');
                ctx.restore();
            }
            return { x: x + wide - 60, y: ry + 30 + 2 * 15 - 1 };
        };
        const flyFrom = (area, i) => {
            const names = ['Map preview', 'Festival map', 'tests'];
            const row = rowTops.find((entry) => entry.name === names[i]);
            const y = row ? row.y : 200;
            return { x: 8, y, w: SIDE - 16, h: 32 };
        };
        const grid = (t, area, amount, s) => {
            if (amount <= 0.001) {
                return null;
            }
            ctx.save();
            ctx.globalAlpha = clamp(amount * 3);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(area.x, area.y, area.w, area.h);
            ctx.restore();
            let accept = null;
            for (let i = 0; i < 3; i++) {
                const to = gridSlot(area, i);
                const from = flyFrom(area, i);
                const k = s.instantGrid ? 1 : spring(t - (s.gridAt + i * 0.12), 10, 0.72);
                const flat = clamp(k);
                const x = lerp(from.x, to.x, k);
                const y = lerp(from.y, to.y, k);
                const wide = Math.max(4, lerp(from.w, to.w, k));
                const tall = Math.max(4, lerp(from.h, to.h, k));
                if (flat <= 0.001) {
                    continue;
                }
                ctx.save();
                ctx.globalAlpha = clamp(flat * 4);
                const flying = flat < 0.98;
                if (flying) {
                    fillRound(x, y + 4, wide, tall, 8, 'rgba(0,0,0,0.4)');
                }
                R.roundRect(ctx, x, y, wide, tall, flying ? 8 * (1 - flat) : 0);
                ctx.fillStyle = GROUND;
                ctx.fill();
                ctx.clip();
                // The content keeps its final size while the frame grows around it.
                const inner = { x: x, y: y + 40, w: to.w, h: to.h - 40 };
                const view = GRID_VIEWS[i];
                let status = null;
                if (i === 0) {
                    browserCell(inner.x, inner.y, inner.w, inner.h, t);
                } else if (i === 1) {
                    const spot = mergeCell(inner.x, inner.y, inner.w, inner.h, t);
                    status = t >= ACCEPT + 0.15 ? 'idle' : 'needs';
                    accept = spot;
                } else {
                    ctx.fillStyle = pal.termBg;
                    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
                    terminalLines(t, inner.x, inner.y, inner.w, inner.h, 0, 18);
                    status = t >= 52.35 ? 'idle' : 'running';
                }
                cellBar(view, x, y, wide, s.focus === i, status, t);
                if (flying) {
                    strokeRound(x + 0.5, y + 0.5, wide - 1, tall - 1, 8 * (1 - flat), 'rgba(255,255,255,0.13)');
                }
                ctx.restore();
            }
            return accept;
        };

        /* The window at one moment. Everything is drawn in app units (1280 x 720) under the current transform. */
        const drawApp = (t, s) => {
            const c = s.chrome;
            const area = { x: SIDE * c, y: BAR * c, w: APP_W - SIDE * c, h: APP_H - BAR * c };
            if (!s.bare) {
                ctx.fillStyle = GROUND;
                ctx.fillRect(0, 0, APP_W, APP_H);
            }
            if (s.grid < 1) {
                canvasView(t, area, s.cam, s.back || 0, s.bare);
                dock(t, area, c * (1 - s.grid));
            }
            let spots = { accept: null, allow: null };
            if (c > 0.001) {
                sidebar(t, -SIDE * (1 - c), s.grid > 0.5, s.needs || 0);
                toolbar(t, area.x, -BAR * (1 - c));
            }
            if (s.grid > 0) {
                spots.accept = grid(t, area, s.grid, s);
            }
            spots.allow = stack(t, area, s);
            return spots;
        };

        /* ---------- The laptop, in a small perspective of its own: the lid turns about the hinge. ---------- */
        const SCREEN_W = 760;
        const SCREEN_H = 427.5;
        const BEZEL = 14;
        const CHIN = 22;
        const LID_L = SCREEN_H + BEZEL + CHIN;
        const LID_W = SCREEN_W + BEZEL * 2;
        const DECK_W = LID_W * 1.05;
        const CENTER = CHIN + SCREEN_H / 2;
        // The eye sits a little above the lid's top edge, so the deck reads from above.
        const EYE = LID_L * 1.1;
        const DEPTH = LID_L * 4;
        const appBuffer = document.createElement('canvas');
        appBuffer.width = 1920;
        appBuffer.height = 1080;
        const appCtx = appBuffer.getContext('2d', { willReadFrequently: true });
        // Projects a point on the lid (x across, s up from the hinge) with the lid at angle phi (0 upright, PI/2 shut).
        const proj = { x: 0, y: 0, k: 1 };
        const project = (x, up, toward) => {
            const depth = DEPTH - toward;
            const k = DEPTH / depth;
            proj.x = x * k;
            proj.y = -(up - EYE) * k - (EYE - CENTER);
            proj.k = k;
            return proj;
        };
        const lidPoint = (x, s, phi) => project(x, s * Math.cos(phi), s * Math.sin(phi));
        const quad = (points) => {
            ctx.beginPath();
            ctx.moveTo(points[0], points[1]);
            ctx.lineTo(points[2], points[3]);
            ctx.lineTo(points[4], points[5]);
            ctx.lineTo(points[6], points[7]);
            ctx.closePath();
        };
        const tmpQuad = new Float32Array(8);
        const deckQuad = (x0, x1, z0, z1) => {
            project(x0, 0, z0);
            tmpQuad[0] = proj.x;
            tmpQuad[1] = proj.y;
            project(x1, 0, z0);
            tmpQuad[2] = proj.x;
            tmpQuad[3] = proj.y;
            project(x1, 0, z1);
            tmpQuad[4] = proj.x;
            tmpQuad[5] = proj.y;
            project(x0, 0, z1);
            tmpQuad[6] = proj.x;
            tmpQuad[7] = proj.y;
            quad(tmpQuad);
        };
        // `lit` 0..1 is how bright the screen is; `phi` the lid. Drawn about the screen's center at the origin.
        const drawLaptop = (phi, lit, glow) => {
            const hingeY = project(0, 0, 0).y;
            // Shadow and the light of the screen on the desk.
            const front = project(0, 0, LID_L).y;
            ctx.save();
            ctx.translate(0, (hingeY + front) / 2 + 10);
            ctx.scale(1, 0.18);
            const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, DECK_W * 0.75);
            shadow.addColorStop(0, 'rgba(0,0,0,0.55)');
            shadow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = shadow;
            ctx.fillRect(-DECK_W, -DECK_W, DECK_W * 2, DECK_W * 2);
            ctx.restore();
            if (glow > 0.01) {
                ctx.save();
                ctx.translate(0, hingeY + 40);
                ctx.scale(1, 0.3);
                const light = ctx.createRadialGradient(0, 0, 0, 0, 0, DECK_W * 0.9);
                light.addColorStop(0, 'rgba(120,140,220,' + (0.1 * glow).toFixed(3) + ')');
                light.addColorStop(1, 'rgba(120,140,220,0)');
                ctx.fillStyle = light;
                ctx.fillRect(-DECK_W * 1.2, -DECK_W, DECK_W * 2.4, DECK_W * 2);
                ctx.restore();
            }
            // The deck: aluminum, a keyboard well and a trackpad, seen from a little above.
            const half = DECK_W / 2;
            // Its front edge has a thickness of its own.
            const lipA = project(-half, 0, LID_L);
            const lipAx = lipA.x;
            const lipAy = lipA.y;
            const lipB = project(half, 0, LID_L);
            tmpQuad.set([lipAx, lipAy, lipB.x, lipB.y, lipB.x - 4, lipB.y + 12, lipAx + 4, lipAy + 12]);
            quad(tmpQuad);
            ctx.fillStyle = '#131316';
            ctx.fill();
            deckQuad(-half, half, 0, LID_L);
            const deckGradient = ctx.createLinearGradient(0, project(0, 0, 0).y, 0, lipAy);
            deckGradient.addColorStop(0, '#222228');
            deckGradient.addColorStop(1, '#2c2c33');
            ctx.fillStyle = deckGradient;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.stroke();
            deckQuad(-half * 0.86, half * 0.86, LID_L * 0.07, LID_L * 0.55);
            ctx.fillStyle = '#17171b';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.lineWidth = 1.2;
            for (let row = 1; row < 6; row++) {
                const z = LID_L * (0.07 + (0.48 * row) / 6);
                const a = project(-half * 0.86, 0, z);
                const ax = a.x;
                const ay = a.y;
                const b = project(half * 0.86, 0, z);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
            for (let col = 1; col < 14; col++) {
                const xk = -half * 0.86 + (half * 1.72 * col) / 14;
                const a = project(xk, 0, LID_L * 0.07);
                const ax = a.x;
                const ay = a.y;
                const b = project(xk, 0, LID_L * 0.55);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
            deckQuad(-half * 0.22, half * 0.22, LID_L * 0.62, LID_L * 0.93);
            ctx.fillStyle = '#26262c';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.stroke();
            deckQuad(-half, half, LID_L - 3, LID_L);
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fill();
            // The lid: seen from the front while it faces us, its shell once it has turned past the eye.
            const lw = LID_W / 2;
            const top = lidPoint(0, LID_L, phi).y;
            const facing = top < hingeY - 0.5;
            const corners = [lidPoint(-lw, 0, phi), lidPoint(lw, 0, phi), lidPoint(lw, LID_L, phi), lidPoint(-lw, LID_L, phi)];
            tmpQuad[0] = -lw * corners[0].k;
            tmpQuad[1] = lidPoint(-lw, 0, phi).y;
            const p0 = lidPoint(-lw, 0, phi);
            const q0 = [p0.x, p0.y];
            const p1 = lidPoint(lw, 0, phi);
            const q1 = [p1.x, p1.y];
            const p2 = lidPoint(lw, LID_L, phi);
            const q2 = [p2.x, p2.y];
            const p3 = lidPoint(-lw, LID_L, phi);
            const q3 = [p3.x, p3.y];
            tmpQuad.set([q0[0], q0[1], q1[0], q1[1], q2[0], q2[1], q3[0], q3[1]]);
            quad(tmpQuad);
            ctx.fillStyle = facing ? '#0b0b0e' : '#2a2a31';
            ctx.fill();
            ctx.strokeStyle = facing ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();
            if (!facing) {
                // The closed lid's own front edge, then a soft sheen across the shell.
                const edge = [q3[0], q3[1], q2[0], q2[1], q2[0], q2[1] + 7, q3[0], q3[1] + 7];
                ctx.save();
                tmpQuad.set(edge);
                quad(tmpQuad);
                ctx.fillStyle = '#18181c';
                ctx.fill();
                ctx.restore();
                tmpQuad.set([q0[0], q0[1], q1[0], q1[1], q2[0], q2[1], q3[0], q3[1]]);
                const sheen = ctx.createLinearGradient(0, q0[1], 0, q2[1]);
                sheen.addColorStop(0, 'rgba(255,255,255,0.0)');
                sheen.addColorStop(1, 'rgba(255,255,255,0.05)');
                ctx.fillStyle = sheen;
                quad(tmpQuad);
                ctx.fill();
                return;
            }
            // The screen, drawn in strips so each band takes its own width in the perspective.
            const bright = lit * Math.pow(Math.max(0, Math.cos(phi)), 0.6);
            if (bright <= 0.01) {
                return;
            }
            const strips = phi < 0.001 ? 1 : 72;
            ctx.save();
            ctx.globalAlpha = bright;
            for (let i = 0; i < strips; i++) {
                const s0 = CHIN + (SCREEN_H * i) / strips;
                const s1 = CHIN + (SCREEN_H * (i + 1)) / strips;
                const a = lidPoint(0, s0, phi);
                const ay = a.y;
                const ak = a.k;
                const b = lidPoint(0, s1, phi);
                const wide = (SCREEN_W / 2) * (ak + b.k);
                const srcY0 = 1080 * (1 - (i + 1) / strips);
                const srcH = 1080 / strips;
                ctx.drawImage(appBuffer, 0, srcY0, 1920, srcH, -wide / 2, b.y, wide, ay - b.y + (strips > 1 ? 0.6 : 0));
            }
            ctx.restore();
            // The glass: a faint sheen, and the room's dark folding in as it turns away.
            ctx.save();
            ctx.globalAlpha = 1;
            const dim = 1 - bright;
            if (dim > 0.01 && bright > 0.01) {
                ctx.fillStyle = 'rgba(8,8,10,' + (dim * 0.7).toFixed(3) + ')';
                const s0 = lidPoint(-SCREEN_W / 2, CHIN, phi);
                const x0 = s0.x;
                const y0 = s0.y;
                const s1 = lidPoint(SCREEN_W / 2, CHIN, phi);
                const x1 = s1.x;
                const y1 = s1.y;
                const s2 = lidPoint(SCREEN_W / 2, CHIN + SCREEN_H, phi);
                const x2 = s2.x;
                const y2 = s2.y;
                const s3 = lidPoint(-SCREEN_W / 2, CHIN + SCREEN_H, phi);
                tmpQuad.set([x0, y0, x1, y1, x2, y2, s3.x, s3.y]);
                quad(tmpQuad);
                ctx.fill();
            }
            ctx.restore();
        };
        const screenRectAt = () => ({ x: -SCREEN_W / 2, y: -SCREEN_H / 2, w: SCREEN_W, h: SCREEN_H });

        /* build-box: the Linux server that holds the sessions. */
        const drawServer = (t, x, y, scale, alpha, busy) => {
            if (alpha <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            const wide = 300;
            const tall = 150;
            ctx.save();
            ctx.translate(0, tall / 2 + 18);
            ctx.scale(1, 0.14);
            const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, wide * 0.8);
            shadow.addColorStop(0, 'rgba(0,0,0,0.6)');
            shadow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = shadow;
            ctx.fillRect(-wide, -wide, wide * 2, wide * 2);
            ctx.restore();
            // Top face, then the front.
            ctx.beginPath();
            ctx.moveTo(-wide / 2, -tall / 2);
            ctx.lineTo(wide / 2, -tall / 2);
            ctx.lineTo(wide / 2 - 16, -tall / 2 - 30);
            ctx.lineTo(-wide / 2 + 16, -tall / 2 - 30);
            ctx.closePath();
            ctx.fillStyle = '#222228';
            ctx.fill();
            fillRound(-wide / 2, -tall / 2, wide, tall, 10, '#18181c');
            strokeRound(-wide / 2 + 0.5, -tall / 2 + 0.5, wide - 1, tall - 1, 9.5, 'rgba(255,255,255,0.1)');
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            for (let i = 0; i < 7; i++) {
                fillRound(10, -tall / 2 + 26 + i * 14, wide / 2 - 30, 5, 2.5, 'rgba(0,0,0,0.5)');
            }
            // Power, and the activity light that flickers while sessions run.
            disc(-wide / 2 + 28, -tall / 2 + 30, 5, pal.idle);
            const flicker = busy * (R.hash(Math.floor(t * 9)) > 0.35 ? 1 : 0.25);
            disc(-wide / 2 + 48, -tall / 2 + 30, 5, R.rgba(pal.running, 0.25 + 0.75 * flicker));
            if (flicker > 0.5) {
                const glow = ctx.createRadialGradient(-wide / 2 + 48, -tall / 2 + 30, 0, -wide / 2 + 48, -tall / 2 + 30, 18);
                glow.addColorStop(0, R.rgba(pal.running, 0.35));
                glow.addColorStop(1, R.rgba(pal.running, 0));
                ctx.fillStyle = glow;
                ctx.fillRect(-wide / 2 + 30, -tall / 2 + 12, 36, 36);
            }
            label('build-box', -wide / 2 + 22, tall / 2 - 44, 20, pal.text, 500, MONO);
            label('npx ruimte', -wide / 2 + 22, tall / 2 - 20, 16, pal.faint, 400, MONO);
            ctx.restore();
        };

        /* The note build-box keeps while nobody looks: every session, still running. */
        const PANEL_ROWS = [
            { mark: 'claude', name: 'Launch the Nachtveld site' },
            { mark: 'claude', name: 'Line-up page', kid: 0 },
            { mark: 'claude', name: 'Ticket shop', kid: 1 },
            { mark: 'claude', name: 'Festival map', kid: 2 },
            { mark: 'codex', name: 'tests' }
        ];
        const drawPanel = (t, x, y, alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            const wide = 600;
            const tall = 330;
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(x - wide / 2, y + (1 - alpha) * 12);
            floatCard(0, 0, wide, tall, 16);
            fillRound(24, 24, 52, 52, 12, pal.sunken);
            icon('laptop', 36, 36, 28, pal.muted);
            label('Window closed', 96, 38, 22, pal.text, 500);
            label('build-box keeps 5 sessions running', 96, 64, 19, pal.muted);
            for (let i = 0; i < PANEL_ROWS.length; i++) {
                const row = PANEL_ROWS[i];
                const ry = 116 + i * 42;
                mark(row.mark, 26, ry - 10, 20, pal.muted);
                label(row.name, 60, ry, 20, pal.text);
                let detail = 'Working';
                let status = 'running';
                if (row.kid !== undefined) {
                    status = kidStatus(row.kid, t);
                    detail = status === 'idle' ? 'Task done' : 'Working';
                } else if (row.mark === 'claude') {
                    detail = 'Waiting on ' + KIDS.filter((kid, k) => kidStatus(k, t) !== 'idle').length + ' tasks';
                    status = null;
                } else {
                    let passed = 0;
                    const count = linesUntil(t);
                    for (let k = 0; k < count; k++) {
                        passed += TEST_LINES[k].kind === 'pass' ? 1 : 0;
                    }
                    detail = passed * 7 + ' passed';
                }
                label(detail, wide - 56, ry, 17, status === 'idle' ? pal.idle : pal.muted, 400, MONO, 'right');
                if (status === 'idle') {
                    circleCheck(wide - 32, ry, 18, pal.idle, clamp((t - KIDS[row.kid].done[2]) / 0.4), 1.8);
                } else if (status) {
                    statusDot(wide - 32, ry, status, t + i * 0.3, 6);
                } else {
                    ctx.globalAlpha = alpha * 0.6;
                    disc(wide - 32, ry, 6, pal.faint);
                    ctx.globalAlpha = alpha;
                }
            }
            ctx.restore();
            return { x: x - wide / 2 + 60, y: y + 116 + 3 * 42 };
        };

        /* ---------- The phone on the nightstand. ---------- */
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
        const appIcon = (x, y, size) => {
            fillRound(x, y, size, size, size * 0.24, '#e9ecf1');
            const side = size * 0.44;
            plane(x + size * 0.42, y + size * 0.42, side, side * 0.18, side * 0.18);
            ctx.fillStyle = pal.markDark;
            ctx.fill();
            plane(x + size * 0.58, y + size * 0.58, side, side * 0.18, side * 0.18);
            ctx.fillStyle = 'rgba(160,170,186,0.95)';
            ctx.fill();
        };
        const PHONE = { w: 170, h: 346, r: 32 };
        const P = {
            wake: 28.75,
            banner: 29.05,
            expand: 30.35,
            thumb: 31.15,
            press: 31.8,
            chosen: 32.0,
            dismiss: 32.55,
            sleep: 33.3
        };
        const springy = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.exp(-k * 6.5) * Math.cos(k * 9.5) * (1 - k * 0.2));
        const drawPhone = (t) => {
            const { w, h, r } = PHONE;
            const x = -w / 2;
            const y = -h / 2;
            const lit = E.outCubic(clamp((t - P.wake) / 0.35)) * (1 - E.inOutCubic(clamp((t - P.sleep) / 0.5)));
            // The body lies on the nightstand; its shadow falls a little down and right.
            fillRound(x + 6, y + 14, w, h, r, 'rgba(0,0,0,0.45)');
            fillRound(x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5, '#2c2c33');
            fillRound(x, y, w, h, r, '#141417');
            strokeRound(x + 0.5, y + 0.5, w - 1, h - 1, r - 0.5, 'rgba(255,255,255,0.1)');
            const sx = x + 6;
            const sy = y + 6;
            const sw = w - 12;
            const sh = h - 12;
            ctx.save();
            R.roundRect(ctx, sx, sy, sw, sh, r - 5);
            ctx.clip();
            ctx.fillStyle = '#040406';
            ctx.fillRect(sx, sy, sw, sh);
            if (lit > 0.01) {
                ctx.globalAlpha = lit;
                const wall = ctx.createLinearGradient(sx, sy, sx + sw * 0.6, sy + sh);
                wall.addColorStop(0, '#171a2c');
                wall.addColorStop(0.55, '#0e0f17');
                wall.addColorStop(1, '#0a0a0d');
                ctx.fillStyle = wall;
                ctx.fillRect(sx, sy, sw, sh);
                const expand = springy(phase(t, P.expand, 0.75));
                const sheet = clamp(E.outCubic(phase(t, P.expand, 0.35))) * (1 - E.outCubic(phase(t, P.dismiss + 0.05, 0.4)));
                const cx = sx + sw / 2;
                ctx.save();
                ctx.translate(cx, sy + 104);
                const shrink = 1 - sheet * 0.06;
                ctx.scale(shrink, shrink);
                label('Friday, August 14', 0, -50, 11, R.rgba('#ffffff', (0.75 - sheet * 0.4) * lit), 500, SANS, 'center');
                label('02:15', 0, -8, 46, R.rgba('#e9ecf4', (0.95 - sheet * 0.55) * lit), 600, SANS, 'center');
                ctx.restore();
                if (sheet > 0.01) {
                    ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * sheet).toFixed(3) + ')';
                    ctx.fillRect(sx, sy, sw, sh);
                }
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                disc(cx - 50, sy + sh - 40, 15, 'rgba(255,255,255,0.1)');
                disc(cx + 50, sy + sh - 40, 15, 'rgba(255,255,255,0.1)');
                let target = null;
                if (t >= P.banner) {
                    const drop = springy(phase(t, P.banner, 0.7));
                    const dismiss = E.inCubic(phase(t, P.dismiss, 0.32));
                    const rect = {
                        x: lerp(sx + 7, sx + 5, expand),
                        w: lerp(sw - 14, sw - 10, expand),
                        y: lerp(lerp(sy - 70, sy + 142, drop), sy + 70, expand) - dismiss * 40,
                        h: lerp(54, 176, expand)
                    };
                    ctx.save();
                    ctx.globalAlpha = lit * clamp(drop * 3) * (1 - dismiss);
                    if (expand < 0.5) {
                        const reveal = 1 - expand * 2;
                        fillRound(rect.x, rect.y, rect.w, rect.h, 14, 'rgba(58,58,66,0.9)');
                        strokeRound(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 13.5, 'rgba(255,255,255,0.08)');
                        ctx.globalAlpha *= reveal;
                        appIcon(rect.x + 9, rect.y + 13, 24);
                        label('Ticket shop', rect.x + 41, rect.y + 19, 12, '#ffffff', 600);
                        label('now', rect.x + rect.w - 9, rect.y + 19, 11, 'rgba(255,255,255,0.45)', 400, SANS, 'right');
                        label('Sell day tickets, or', rect.x + 41, rect.y + 34, 11.5, 'rgba(255,255,255,0.75)');
                        label('weekend only?', rect.x + 41, rect.y + 47, 11.5, 'rgba(255,255,255,0.75)');
                    } else {
                        fillRound(rect.x, rect.y, rect.w, rect.h, lerp(14, 20, expand), R.mix('#3a3a42', pal.raised, clamp((expand - 0.5) * 2), 0.97));
                        strokeRound(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 19.5, 'rgba(255,255,255,0.07)');
                        target = phoneQuestion(t, rect);
                    }
                    ctx.restore();
                }
                ctx.fillStyle = '#000000';
                fillRound(cx - 26, sy + 9, 52, 15, 7.5, '#000000');
                fillRound(cx - 28, sy + sh - 9, 56, 4, 2, R.rgba('#ffffff', 0.55 * lit));
                ctx.globalAlpha = 1;
                ctx.restore();
                if (target) {
                    drawThumb(t, target);
                }
            } else {
                ctx.restore();
            }
            // The glass catches the room a little even when dark.
            ctx.save();
            R.roundRect(ctx, sx, sy, sw, sh, r - 5);
            ctx.clip();
            const glare = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh * 0.7);
            glare.addColorStop(0, 'rgba(255,255,255,0)');
            glare.addColorStop(0.5, 'rgba(255,255,255,0.04)');
            glare.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glare;
            ctx.fillRect(sx, sy, sw, sh);
            ctx.restore();
            return lit;
        };
        const phoneQuestion = (t, rect) => {
            const x = rect.x + 12;
            const top = rect.y;
            const width = rect.w - 24;
            const open = P.expand + 0.15;
            const stagger = (i) => E.outCubic(phase(t, open + 0.12 + i * 0.06, 0.3));
            const keep = ctx.globalAlpha;
            ctx.globalAlpha = keep * stagger(0);
            disc(x + 4, top + 19, 3, pal.needs);
            label('Ticket shop asks', x + 13, top + 19.5, 11, pal.muted);
            label('Sell day tickets, or', x, top + 40, 13, pal.text, 600);
            label('weekend only?', x, top + 57, 13, pal.text, 600);
            const pressed = Math.sin(PI * phase(t, P.press, 0.22));
            const chosen = E.outCubic(phase(t, P.chosen - 0.1, 0.35));
            let target = null;
            for (let i = 0; i < 3; i++) {
                ctx.globalAlpha = keep * stagger(i + 1);
                const oy = top + 84 + i * 28 + (1 - stagger(i + 1)) * 5;
                const isChoice = i === 0;
                if (isChoice && chosen > 0) {
                    const grow = E.outBack(Math.min(1, chosen * 2), 2);
                    fillRound(x - 4 + (1 - grow) * 6, oy - 12, width + 8 - (1 - grow) * 12, 24, 7, R.rgba('#ffffff', 0.09 * Math.min(1, chosen * 2)));
                }
                if (isChoice && pressed > 0) {
                    fillRound(x - 4, oy - 12, width + 8, 24, 7, R.rgba('#ffffff', 0.06 * pressed));
                }
                circleLine(x + 6, oy, 5.5, isChoice && chosen > 0.3 ? pal.text : 'rgba(255,255,255,0.3)', 1.3);
                if (isChoice && chosen > 0.3) {
                    disc(x + 6, oy, 2.8 * E.outBack(clamp((chosen - 0.3) * 2.5), 2.5), pal.text);
                }
                label(OPTIONS[i], x + 19, oy + 0.5, 12, i === 2 ? pal.faint : pal.text);
                if (isChoice) {
                    target = { x: x + 58, y: oy };
                }
            }
            ctx.globalAlpha = keep;
            return target;
        };
        const drawThumb = (t, target) => {
            const come = E.outCubic(phase(t, P.thumb, 0.5));
            const leave = E.inCubic(phase(t, P.chosen + 0.1, 0.35));
            const amount = come * (1 - leave);
            if (amount <= 0.01) {
                return;
            }
            // It hovers above the glass, then sinks onto it: the press is anticipated before it lands.
            const press = phase(t, P.press - 0.08, 0.3);
            const down = Math.sin(PI * press);
            const hover = (1 - come) * 22 + leave * 16;
            const radius = 21 * (1 + hover / 40) * (1 - down * 0.12);
            const tx = target.x + hover * 0.6;
            const ty = target.y + hover;
            ctx.save();
            ctx.globalAlpha = amount;
            disc(tx + 2, ty + 4 + hover * 0.3, radius, 'rgba(0,0,0,' + (0.22 * (1 - down)).toFixed(3) + ')');
            disc(tx, ty, radius, 'rgba(255,255,255,' + (0.22 + down * 0.16).toFixed(3) + ')');
            circleLine(tx, ty, radius, 'rgba(255,255,255,0.5)', 1.2);
            const ripple = phase(t, P.press + 0.05, 0.5);
            if (ripple > 0 && ripple < 1) {
                circleLine(tx, ty, radius + E.outCubic(ripple) * 20, 'rgba(255,255,255,' + (0.5 * (1 - ripple)).toFixed(3) + ')', 1.5);
            }
            ctx.restore();
        };
        const scenePhone = (t) => {
            const lit = E.outCubic(clamp((t - P.wake) / 0.35)) * (1 - E.inOutCubic(clamp((t - P.sleep) / 0.5)));
            // The nightstand: a wide dark plane, with the phone's own light spilling on it.
            ctx.save();
            const top = ctx.createLinearGradient(0, 0, 0, 1080);
            top.addColorStop(0, '#0b0b0e');
            top.addColorStop(1, '#111015');
            ctx.fillStyle = top;
            ctx.fillRect(0, 0, 1920, 1080);
            ctx.strokeStyle = 'rgba(255,255,255,0.018)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 14; i++) {
                ctx.beginPath();
                const baseY = 60 + i * 76;
                ctx.moveTo(0, baseY);
                for (let x = 0; x <= 1920; x += 160) {
                    ctx.lineTo(x, baseY + R.noise(x * 0.002, i * 0.7) * 22);
                }
                ctx.stroke();
            }
            if (lit > 0.01) {
                const glow = ctx.createRadialGradient(960, 560, 60, 960, 560, 700);
                glow.addColorStop(0, 'rgba(110,125,210,' + (0.16 * lit).toFixed(3) + ')');
                glow.addColorStop(1, 'rgba(110,125,210,0)');
                ctx.fillStyle = glow;
                ctx.fillRect(0, 0, 1920, 1080);
            }
            ctx.translate(960, 560);
            ctx.rotate(-0.07);
            const drift = (t - 28) * 0.006;
            ctx.scale(2.25 + drift, 2.25 + drift);
            drawPhone(t);
            ctx.restore();
            // The room stays dark at the edges.
            vignette(0.55);
        };

        /* ---------- Film furniture: vignette, clock, captions, title and end card. ---------- */
        const vignetteGradient = main.createRadialGradient(960, 540, 380, 960, 540, 1150);
        vignetteGradient.addColorStop(0, 'rgba(0,0,0,0)');
        vignetteGradient.addColorStop(1, 'rgba(0,0,0,1)');
        const vignette = (amount) => {
            if (amount <= 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha = amount;
            ctx.fillStyle = vignetteGradient;
            ctx.fillRect(0, 0, 1920, 1080);
            ctx.restore();
        };
        const CAPTIONS = [
            [6.35, 9.05, 'Draw a line. Share the context.'],
            [9.9, 13.7, 'Three agents. Three worktrees. Three plans.'],
            [17.3, 21.3, 'Close the lid. The work goes on.'],
            [23.5, 26.3, 'Out of usage? It waits for the reset.'],
            [29.2, 33.3, 'Agents ask. You answer from bed.'],
            [35.4, 38.8, 'At 03:00 it picks up where it stopped.'],
            [42.9, 45.6, 'Everything where you left it.'],
            [45.95, 48.7, 'Three things wait for you.'],
            [49.9, 53.6, 'Browser, tests and merge, side by side.'],
            [54.9, 56.9, 'Green. Live at 11:58.']
        ];
        const scrim = main.createLinearGradient(0, 820, 0, 1080);
        scrim.addColorStop(0, 'rgba(13,13,16,0)');
        scrim.addColorStop(1, 'rgba(13,13,16,0.86)');
        const drawCaption = (t) => {
            for (const [from, to, text] of CAPTIONS) {
                const amount = shown(t, from, to, 0.4, 0.4);
                if (amount <= 0.001) {
                    continue;
                }
                ctx.save();
                ctx.globalAlpha = amount;
                ctx.fillStyle = scrim;
                ctx.fillRect(0, 820, 1920, 260);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha = amount;
                label(text, 960, 1002 + (1 - amount) * 10, 30, pal.text, 500, SANS, 'center');
                ctx.restore();
            }
        };
        // The clock rides at the top of the frame from the first shot to the last: the tension of the night.
        const HUD_Y = 48;
        const drawHud = (t, alpha) => {
            if (alpha <= 0.01) {
                return;
            }
            const minutes = minutesAt(t);
            const time = hhmm(minutes);
            const rest = 'Nachtveld opens in ' + untilOpen(minutes);
            setFont(28, 500, MONO);
            const timeWidth = measure('00:00');
            setFont(20, 400);
            const restWidth = measure(rest);
            const wide = 28 + timeWidth + 26 + restWidth + 28;
            const x = 960 - wide / 2;
            ctx.save();
            ctx.globalAlpha = alpha;
            fillRound(x, HUD_Y - 27, wide, 54, 27, 'rgba(0,0,0,0.3)');
            fillRound(x, HUD_Y - 28, wide, 56, 28, 'rgba(24,24,28,0.92)');
            strokeRound(x + 0.5, HUD_Y - 27.5, wide - 1, 55, 27.5, 'rgba(255,255,255,0.1)');
            label(time, x + 28, HUD_Y + 1, 28, pal.text, 500, MONO);
            disc(x + 28 + timeWidth + 13, HUD_Y + 1, 2.5, pal.faint);
            const urgent = clamp((minutes - 2100) / 50);
            label(rest, x + 28 + timeWidth + 26, HUD_Y + 1, 20, R.mix(pal.muted, pal.text, urgent));
            ctx.restore();
        };
        const drawTitleClock = (t) => {
            const inAmount = E.outCubic(clamp((t - 3.25) / 0.6));
            if (inAmount <= 0.01 || t > 5.8) {
                return;
            }
            // From the middle of the frame up into the clock's place at the top, shrinking as it goes.
            const move = io(clamp((t - 4.55) / 0.9));
            setFont(28, 500, MONO);
            const smallWidth = measure('00:00');
            setFont(20, 400);
            const rest = 'Nachtveld opens in 14h 00m';
            const wide = 28 + smallWidth + 26 + measure(rest) + 28;
            const hudX = 960 - wide / 2 + 28 + smallWidth / 2;
            const size = lerp(170, 28, move);
            const x = lerp(960, hudX, move);
            const y = lerp(470, HUD_Y + 1, move) + (1 - inAmount) * 16;
            ctx.save();
            ctx.globalAlpha = inAmount * (1 - clamp((t - 5.35) / 0.1));
            label('22:00', x, y, size, pal.text, 500, MONO, 'center');
            const sub = inAmount * (1 - clamp((t - 4.45) / 0.35));
            ctx.globalAlpha = sub;
            label('Nachtveld opens in 14 hours.', 960, 600 + (1 - E.outCubic(clamp((t - 3.6) / 0.6))) * 10, 40, pal.muted, 500, SANS, 'center');
            label('Thursday, August 13', 960, 330 - (1 - inAmount) * 6, 24, pal.faint, 500, SANS, 'center');
            ctx.restore();
        };

        const word = v.take('letterspace', { width: 1300, options: { word: 'Ruimte' } });
        const WORD_X = 960 - 650;
        // The take's readout under the word is its own; the film keeps the ground clean there.
        const drawWord = (y, alpha) => {
            word.draw(ctx, WORD_X, y, 1300, alpha);
            const baseline = y + (286 / 500) * 1160.7;
            ctx.fillStyle = GROUND;
            ctx.fillRect(560, baseline + 110, 800, 50);
        };
        // The take's clock, remapped: in on the squeeze, the gaps open, a quick hold, then the slam.
        const wordLocal = (t) => {
            if (t < 1.9) {
                return 0.85 + t;
            }
            if (t < 2.25) {
                return lerp(2.75, 4.95, (t - 1.9) / 0.35);
            }
            return 4.95 + (t - 2.25);
        };
        let endSeeked = false;

        /* ---------- Cameras. ---------- */
        const camKeys = (keys, t) => {
            if (t <= keys[0][0]) {
                return { x: keys[0][1], y: keys[0][2], z: keys[0][3] };
            }
            for (let i = 1; i < keys.length; i++) {
                const [t1, x1, y1, z1] = keys[i];
                if (t <= t1) {
                    const [t0, x0, y0, z0] = keys[i - 1];
                    const k = sine(clamp((t - t0) / (t1 - t0)));
                    // Zoom eases in log space, so a push in feels even from the first frame to the last.
                    return { x: lerp(x0, x1, k), y: lerp(y0, y1, k), z: Math.exp(lerp(Math.log(z0), Math.log(z1), k)) };
                }
            }
            const last = keys[keys.length - 1];
            return { x: last[1], y: last[2], z: last[3] };
        };
        const CAM_EVENING = [
            [4.9, 470, 205, 1.22],
            [6.0, 420, 200, 1.34],
            [8.7, 410, 205, 1.36],
            [11.0, 860, 250, 0.84],
            [13.8, 890, 250, 0.88],
            [15.0, 650, 245, 0.7]
        ];
        const CAM_NIGHT = [
            [21.5, 1130, 512, 1.9],
            [26.3, 1130, 512, 1.9],
            [27.4, 1130, 246, 1.9],
            [34.2, 1130, 246, 1.9],
            [35.3, 1130, 512, 1.9],
            [37.8, 1130, 512, 1.92],
            [39.8, 980, 330, 1.25]
        ];
        const CAM_MORNING = [
            [42.7, 650, 245, 0.7],
            [44.0, 190, 470, 1.35],
            [45.3, 190, 470, 1.38],
            [46.6, 650, 250, 0.7]
        ];
        const CLOSED_CAM = { x: 650, y: 245, z: 0.7 };
        // The Festival map row in build-box's note, and the same node's title on the night canvas, in film pixels.
        const ROW_AT = { x: 1180, y: 422 };
        const NODE_TITLE = { x: 960 + (994 - 1130) * 1.9 * 1.5, y: 540 + (401.5 - 512) * 1.9 * 1.5 };

        /* ---------- Scenes. ---------- */
        // A scene may be placed inside another one for a moment (a match cut); `base` is where it sits.
        let base = null;
        const resetBase = () => {
            if (base) {
                ctx.setTransform(base);
            } else {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
        };
        const setFilm = (fx, fy, fz) => {
            resetBase();
            ctx.translate(960, 540);
            ctx.scale(1.5 * fz, 1.5 * fz);
            ctx.translate(-fx, -fy);
        };
        const stateEvening = (t) => ({
            chrome: io(clamp((t - 13.9) / 1.1)),
            cam: camKeys(CAM_EVENING, t),
            grid: 0,
            stack: 0
        });
        const sceneEvening = (t) => {
            setFilm(640, 360, 1);
            drawApp(t, stateEvening(t));
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        };
        const renderToBuffer = (t, state) => {
            const keep = ctx;
            ctx = appCtx;
            ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
            drawApp(t, state);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            // Settle the buffer before it is sampled: left queued, the renderer can stall for seconds on it.
            appCtx.getImageData(0, 0, 1, 1);
            ctx = keep;
        };
        // The laptop's place in the frame: screen center, and how big it is against its own size.
        const laptopAt = (centerX, centerY, scale, phi, lit, glow) => {
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.scale(scale, scale);
            drawLaptop(phi, lit, glow);
            ctx.restore();
        };
        const FULL = 1920 / SCREEN_W;
        const sceneLaptopNight = (t) => {
            renderToBuffer(t, { chrome: 1, cam: stateEvening(Math.min(t, 15)).cam, grid: 0, stack: 0 });
            const pull = io(clamp((t - 15.0) / 1.6));
            const scale = Math.exp(lerp(Math.log(FULL), Math.log(0.86), pull));
            // The camera eases back and a little right, so build-box can come into the frame beside it.
            const drift = io(clamp((t - 18.4) / 1.4));
            const cx = lerp(960, 760, pull) - drift * 110;
            const cy = lerp(540, 430, pull) + drift * 20;
            const closeK = clamp((t - 17.5) / 1.1);
            // The lid drops slowly, then its own weight takes it, and it settles with a small bounce.
            let phi = (PI / 2) * E.inQuad(closeK) * 0.35 + (PI / 2) * 0.65 * E.inOutCubic(closeK);
            const settle = t - 18.6;
            if (settle > 0) {
                phi = PI / 2 - Math.abs(Math.sin(settle * 20)) * Math.exp(-settle * 9) * 0.03;
            }
            const lit = 1 - clamp((t - 18.35) / 0.25);
            const serverIn = E.outCubic(clamp((t - 16.0) / 1.2));
            const serverX = lerp(1900, 1480, serverIn) - drift * 60;
            // The line between them: dots travel while the window is open, and it goes when the lid shuts.
            const link = serverIn * (1 - clamp((t - 18.3) / 0.5));
            ctx.save();
            laptopAt(cx, cy, scale, Math.min(phi, PI / 2), lit, lit * pull);
            ctx.restore();
            if (link > 0.01) {
                const ax = cx + (SCREEN_W / 2 + 40) * scale;
                const ay = cy + 60 * scale;
                const bx = serverX - 170;
                const by = 660;
                ctx.save();
                ctx.globalAlpha = link * 0.8;
                ctx.setLineDash([3, 7]);
                ctx.strokeStyle = 'rgba(236,236,241,0.35)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - 60, bx, by);
                ctx.stroke();
                ctx.setLineDash([]);
                for (let k = 0; k < 3; k++) {
                    const along = R.fract(t * 0.6 + k / 3);
                    const rest = 1 - along;
                    const px = rest * rest * ax + 2 * rest * along * ((ax + bx) / 2) + along * along * bx;
                    const py = rest * rest * ay + 2 * rest * along * (Math.min(ay, by) - 60) + along * along * by;
                    disc(px, py, 3.5, R.rgba(pal.running, 0.9 * Math.sin(PI * along)));
                }
                ctx.restore();
            }
            drawServer(t, serverX, 660, 1, serverIn, 1);
            const panelIn = E.outCubic(clamp((t - 18.9) / 0.5));
            return drawPanel(t, serverX, 180, panelIn);
        };
        const sceneNight = (t) => {
            const settle = E.inOutSine(clamp((t - 22.4) / 0.6));
            dotFade = settle;
            setFilm(640, 360, 1);
            drawApp(t, { chrome: 0, cam: camKeys(CAM_NIGHT, t), grid: 0, stack: 0, bare: base !== null });
            resetBase();
            dotFade = 1;
            if (base) {
                return;
            }
            vignette(0.5 * settle);
            // Where this canvas lives tonight.
            ctx.save();
            ctx.globalAlpha *= settle;
            floatCard(56, 22, 214, 52, 26);
            icon('server', 80, 36, 24, pal.muted);
            label('build-box', 116, 48.5, 20, pal.text, 500, MONO);
            disc(246, 48, 5, pal.idle);
            ctx.restore();
        };
        const sceneLaptopMorning = (t) => {
            renderToBuffer(t, { chrome: 1, cam: CLOSED_CAM, grid: 0, stack: 0, needs: 1 });
            const openK = clamp((t - 40.3) / 1.15);
            const phi = (PI / 2) * (1 - E.inOutCubic(openK));
            const lit = E.outCubic(clamp((t - 40.75) / 0.5));
            const push = io(clamp((t - 41.6) / 1.1));
            const scale = Math.exp(lerp(Math.log(0.86), Math.log(FULL), push));
            const cx = 960;
            const cy = lerp(470, 540, push);
            // A little dawn, low behind the desk.
            ctx.save();
            const dawn = ctx.createRadialGradient(960, 760, 50, 960, 760, 900);
            dawn.addColorStop(0, 'rgba(150,120,90,' + (0.08 * (1 - push)).toFixed(3) + ')');
            dawn.addColorStop(1, 'rgba(150,120,90,0)');
            ctx.fillStyle = dawn;
            ctx.fillRect(0, 0, 1920, 1080);
            ctx.restore();
            laptopAt(cx, cy, scale, phi, lit, lit);
        };
        const stateMorning = (t) => {
            const gridAt = 48.95;
            const fan = io(clamp((t - 46.7) / 0.5)) * (1 - io(clamp((t - 48.3) / 0.45)));
            const stackHide = io(clamp((t - 48.55) / 0.45));
            const stackBack = E.outCubic(clamp((t - 53.85) / 0.5));
            const stackAway = io(clamp((t - ALLOW - 0.2) / 0.45));
            return {
                chrome: 1,
                cam: camKeys(CAM_MORNING, t),
                back: E.inOutCubic(clamp((t - 43.4) / 1.6)) * 22 * (1 - io(clamp((t - 45.4) / 0.8))),
                grid: E.inOutSine(clamp((t - gridAt) / 0.55)),
                gridAt,
                focus: t < 50.2 ? 0 : t < 51.4 ? 1 : 2,
                needs: t < ALLOW + 0.3 ? 1 : 1 - clamp((t - ALLOW - 0.3) / 0.4),
                stack: t < 48.5 ? 1 : t < 53.8 ? 1 - stackHide : stackBack * (1 - stackAway),
                stackDrop: t < 53.8 ? stackHide * 140 : (1 - stackBack) * 140 + stackAway * 60,
                fan,
                instant: t > 48.5,
                press: Math.sin(PI * phase(t, ALLOW - 0.1, 0.22))
            };
        };
        const filmMorning = (t) => {
            // The frame leans in toward the stack while it fans, then gives the grid the whole window.
            const lean = io(clamp((t - 46.3) / 1.0)) * (1 - io(clamp((t - 48.3) / 0.7)));
            const toAllow = io(clamp((t - 53.9) / 0.8)) * (1 - io(clamp((t - 55.2) / 1.0)));
            const z = 1 + lean * 0.22 + toAllow * 0.12;
            const fx = lerp(640, 748, lean) + toAllow * 100;
            const fy = lerp(360, 470, lean) + toAllow * 110;
            return { x: fx, y: fy, z };
        };
        const cursorMorning = (t, spots) => {
            const path = [
                [50.0, 1150, 700],
                [50.85, spots.accept ? spots.accept.x : 1100, spots.accept ? spots.accept.y : 200],
                [51.6, spots.accept ? spots.accept.x + 60 : 1150, spots.accept ? spots.accept.y + 160 : 380],
                [54.35, spots.allow ? spots.allow.x - 20 : 900, spots.allow ? spots.allow.y + 60 : 700],
                [54.7, spots.allow ? spots.allow.x : 900, spots.allow ? spots.allow.y : 640],
                [55.8, spots.allow ? spots.allow.x + 80 : 980, spots.allow ? spots.allow.y + 120 : 760]
            ];
            const alpha = shown(t, 49.9, 56.2, 0.3, 0.4);
            if (alpha <= 0.01) {
                return;
            }
            let x = path[0][1];
            let y = path[0][2];
            for (let i = 1; i < path.length; i++) {
                const [t1, x1, y1] = path[i];
                const [t0, x0, y0] = path[i - 1];
                if (t >= t0) {
                    const k = io(clamp((t - t0) / Math.min(0.7, t1 - t0)));
                    x = lerp(x0, x1, k) + Math.sin(PI * k) * 14;
                    y = lerp(y0, y1, k) - Math.sin(PI * k) * 18;
                }
            }
            const press = Math.max(Math.sin(PI * phase(t, ACCEPT - 0.1, 0.2)), Math.sin(PI * phase(t, ALLOW - 0.1, 0.22)));
            cursor(x, y, 0.85 * (1 - press * 0.12), alpha);
        };
        const sceneMorning = (t) => {
            const cam = filmMorning(t);
            setFilm(cam.x, cam.y, cam.z);
            const s = stateMorning(t);
            const spots = drawApp(t, s);
            cursorMorning(t, spots);
            // Deployed: a quiet toast in the corner of the window.
            const toast = shown(t, 55.55, 57.5, 0.35, 0.3);
            if (toast > 0.01) {
                ctx.save();
                ctx.globalAlpha = toast;
                const tx = APP_W - 300;
                const ty = APP_H - 84 + (1 - toast) * 10;
                floatCard(tx, ty, 280, 60, 10);
                circleCheck(tx + 24, ty + 22, 16, pal.idle, clamp((t - 55.6) / 0.45), 1.6);
                label('Deployed to production', tx + 42, ty + 22.5, 14, pal.text);
                label('nachtveld.app, 11:58', tx + 42, ty + 42.5, 13, pal.muted);
                ctx.restore();
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        };
        const sceneEnd = (t) => {
            if (!endSeeked) {
                word.seek(6.15);
                endSeeked = true;
            } else {
                word.tick(1 / 30);
            }
            const lift = E.outCubic(clamp((t - 57.0) / 0.6));
            drawWord(-170 + (1 - lift) * 12, lift);
            const tag = E.outCubic(clamp((t - 57.55) / 0.6));
            ctx.save();
            ctx.globalAlpha = tag;
            label('Space for AI Engineering.', 960, 640 + (1 - tag) * 10, 56, pal.text, 600, SANS, 'center');
            const url = E.outCubic(clamp((t - 58.0) / 0.6));
            ctx.globalAlpha = url;
            label('ruimte.app', 960, 722 + (1 - url) * 8, 28, pal.muted, 500, SANS, 'center');
            ctx.restore();
        };
        // A dissolve that also works for scenes that do not fill their own ground.
        const dissolve = (amount) => {
            if (amount <= 0.001) {
                return;
            }
            ctx.save();
            ctx.globalAlpha = amount;
            ctx.fillStyle = GROUND;
            ctx.fillRect(0, 0, 1920, 1080);
            ctx.restore();
        };
        const layer = (amount, drawScene) => {
            if (amount <= 0.001) {
                return;
            }
            if (amount >= 0.999) {
                drawScene();
                return;
            }
            dissolve(amount);
            ctx.save();
            ctx.globalAlpha = amount;
            drawScene();
            ctx.restore();
        };

        return {
            draw(t, dt) {
                ctx = main;
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.imageSmoothingEnabled = true;
                /* 0:00 the word, then the hour. */
                if (t < 3.9) {
                    word.tick(Math.max(0, wordLocal(t) - word.t));
                    const out = E.inOutCubic(clamp((t - 3.0) / 0.7));
                    drawWord(-110 - out * 40, E.outCubic(clamp(t / 0.45)) * (1 - out));
                }
                drawTitleClock(t);
                /* 0:05 evening on the canvas, pulling back into the laptop at 0:15. */
                if (t >= 4.9 && t < 15.0) {
                    const amount = E.inOutSine(clamp((t - 4.9) / 0.8));
                    if (amount < 1) {
                        ctx.save();
                        ctx.globalAlpha = amount;
                        sceneEvening(t);
                        ctx.restore();
                        drawTitleClock(t);
                    } else {
                        sceneEvening(t);
                    }
                }
                /* 0:15 the lid closes; build-box keeps going. */
                const dive = io(clamp((t - 21.45) / 0.95));
                if (t >= 15.0 && t < 22.4) {
                    ctx.save();
                    ctx.globalAlpha = 1 - E.inOutSine(clamp(dive / 0.34));
                    if (dive > 0) {
                        // Into the row of the Festival map, which becomes the node itself.
                        const scale = 1 + dive * 1.6;
                        ctx.translate(ROW_AT.x, ROW_AT.y);
                        ctx.scale(scale, scale);
                        ctx.translate(-ROW_AT.x, -ROW_AT.y);
                    }
                    sceneLaptopNight(t);
                    ctx.restore();
                }
                /* 0:22 night on the canvas: the limit, the question, the reset. */
                const nightIn = t < 22.4 ? E.inOutSine(clamp((dive - 0.12) / 0.4)) : 1;
                const phoneIn = E.inOutSine(clamp((t - 27.7) / 0.7)) * (1 - E.inOutSine(clamp((t - 33.55) / 0.7)));
                const dawnIn = E.inOutSine(clamp((t - 39.1) / 1.0));
                if (t >= 21.45 && t < 40.1 && phoneIn < 0.999) {
                    if (t < 22.4) {
                        const grow = dive * (1 + 1.6 * dive);
                        const size = lerp(0.54 * (1 + 1.6 * dive), 1, dive);
                        base = new DOMMatrix()
                            .translate(lerp(ROW_AT.x, NODE_TITLE.x, dive), lerp(ROW_AT.y, NODE_TITLE.y, dive))
                            .scale(grow > 0 ? size : 0.54)
                            .translate(-NODE_TITLE.x, -NODE_TITLE.y);
                    }
                    layer(nightIn * (1 - dawnIn), () => sceneNight(t));
                    base = null;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                }
                if (phoneIn > 0.001) {
                    layer(phoneIn, () => scenePhone(t));
                }
                /* 0:40 morning: the lid opens, everything is where it was. */
                if (t >= 39.1 && t < 42.7) {
                    layer(dawnIn, () => sceneLaptopMorning(t));
                }
                if (t >= 42.7 && t < 57.3) {
                    sceneMorning(t);
                }
                /* 0:57 the end card. */
                if (t >= 56.8) {
                    const amount = E.inOutSine(clamp((t - 56.8) / 0.5));
                    dissolve(amount);
                    if (t >= 57.0) {
                        sceneEnd(t);
                    }
                }
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                const hud = E.outCubic(clamp((t - 5.3) / 0.25)) * (1 - E.inOutSine(clamp((t - 56.7) / 0.4)));
                drawHud(t, hud);
                drawCaption(t);
                // Flush the frame: the software renderer otherwise piles up queued frames and stalls.
                main.getImageData(0, 0, 1, 1);
            }
        };
    }
});
