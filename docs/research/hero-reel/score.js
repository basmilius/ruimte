/* Score kit: instruments built from Web Audio nodes, rendered offline under a film. Times are seconds in the
   film. Every voice goes through a channel strip into the master (glue compression and a limiter). */
(() => {
    'use strict';

    const midi = (note) => 440 * Math.pow(2, (note - 69) / 12);
    // 'A3', 'C#4', 'Eb2' to a MIDI number.
    const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const note = (name) => {
        if (typeof name === 'number') {
            return name;
        }
        const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
        if (!match) {
            throw new Error('Bad note ' + name);
        }
        return 12 * (Number(match[3]) + 1) + NAMES[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    };
    const freq = (name) => midi(note(name));

    const create = (ac) => {
        const master = ac.createGain();
        master.gain.value = 0.9;
        const glue = ac.createDynamicsCompressor();
        glue.threshold.value = -14;
        glue.ratio.value = 3;
        glue.attack.value = 0.01;
        glue.release.value = 0.2;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -2;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.08;
        master.connect(glue).connect(limiter).connect(ac.destination);

        // A generated hall: decaying stereo noise, so no sample file is needed.
        const hall = (seconds = 2.6, decay = 3) => {
            const length = Math.round(ac.sampleRate * seconds);
            const buffer = ac.createBuffer(2, length, ac.sampleRate);
            const random = Reel.R.rng(77);
            for (let channel = 0; channel < 2; channel++) {
                const data = buffer.getChannelData(channel);
                for (let i = 0; i < length; i++) {
                    data[i] = (random() * 2 - 1) * Math.pow(1 - i / length, decay);
                }
            }
            const convolver = ac.createConvolver();
            convolver.buffer = buffer;
            const back = ac.createGain();
            back.gain.value = 0.5;
            convolver.connect(back).connect(master);
            return convolver;
        };
        const reverb = hall();

        // A bus per instrument group: its level, an optional sidechain duck, a reverb send.
        const bus = ({ gain = 0.8, send = 0.15, pan = 0 } = {}) => {
            const input = ac.createGain();
            const level = ac.createGain();
            level.gain.value = gain;
            const duck = ac.createGain();
            const panner = ac.createStereoPanner();
            panner.pan.value = pan;
            input.connect(duck).connect(level).connect(panner).connect(master);
            const sendGain = ac.createGain();
            sendGain.gain.value = send;
            panner.connect(sendGain).connect(reverb);
            return {
                input,
                level: level.gain,
                // Pumps the bus down on each time given, the way a kick would duck it.
                sidechain(times, depth = 0.6, release = 0.22) {
                    for (const time of times) {
                        duck.gain.setValueAtTime(1, Math.max(0, time - 0.005));
                        duck.gain.linearRampToValueAtTime(1 - depth, time + 0.01);
                        duck.gain.setTargetAtTime(1, time + 0.02, release / 3);
                    }
                },
                // Automates the level: [[time, gain], ...] with linear ramps between.
                automate(points) {
                    level.gain.setValueAtTime(points[0][1], points[0][0]);
                    for (const [time, value] of points.slice(1)) {
                        level.gain.linearRampToValueAtTime(value, time);
                    }
                }
            };
        };

        const noiseBuffer = (() => {
            const buffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
            const data = buffer.getChannelData(0);
            const random = Reel.R.rng(4);
            for (let i = 0; i < data.length; i++) {
                data[i] = random() * 2 - 1;
            }
            return buffer;
        })();
        const noise = (time, duration) => {
            const source = ac.createBufferSource();
            source.buffer = noiseBuffer;
            source.loop = true;
            source.start(time, 0);
            source.stop(time + duration + 0.05);
            return source;
        };
        const envelope = (param, time, { attack = 0.005, decay = 0.2, sustain = 0, release = 0.1, peak = 1, length = 0 }) => {
            param.setValueAtTime(0, time);
            param.linearRampToValueAtTime(peak, time + attack);
            param.setTargetAtTime(sustain * peak, time + attack, decay / 3);
            const end = time + Math.max(length, attack + decay);
            param.setTargetAtTime(0, end, release / 3);
            return end + release * 2;
        };

        const kick = (out, time, { gain = 1, pitch = 52, punch = 0.9 } = {}) => {
            const osc = ac.createOscillator();
            const amp = ac.createGain();
            osc.frequency.setValueAtTime(pitch * 4, time);
            osc.frequency.exponentialRampToValueAtTime(pitch, time + 0.07);
            const end = envelope(amp.gain, time, { attack: 0.002, decay: 0.45, peak: gain * punch });
            osc.connect(amp).connect(out.input);
            osc.start(time);
            osc.stop(end);
        };
        const snare = (out, time, { gain = 0.6, tone = 190, decay = 0.18 } = {}) => {
            const body = ac.createOscillator();
            body.frequency.value = tone;
            const bodyAmp = ac.createGain();
            envelope(bodyAmp.gain, time, { attack: 0.001, decay: 0.08, peak: gain * 0.5 });
            body.connect(bodyAmp).connect(out.input);
            body.start(time);
            body.stop(time + 0.3);
            const hiss = noise(time, decay * 2);
            const band = ac.createBiquadFilter();
            band.type = 'highpass';
            band.frequency.value = 1500;
            const hissAmp = ac.createGain();
            envelope(hissAmp.gain, time, { attack: 0.001, decay, peak: gain });
            hiss.connect(band).connect(hissAmp).connect(out.input);
        };
        const hat = (out, time, { gain = 0.25, decay = 0.05, open = false } = {}) => {
            const hiss = noise(time, open ? 0.5 : 0.15);
            const high = ac.createBiquadFilter();
            high.type = 'highpass';
            high.frequency.value = 7500;
            const amp = ac.createGain();
            envelope(amp.gain, time, { attack: 0.001, decay: open ? 0.35 : decay, peak: gain });
            hiss.connect(high).connect(amp).connect(out.input);
        };
        // A plucked synth: two detuned saws through a closing low-pass.
        const pluck = (out, time, name, { gain = 0.3, length = 0.25, bright = 3200, detune = 7 } = {}) => {
            const filter = ac.createBiquadFilter();
            filter.type = 'lowpass';
            filter.Q.value = 2;
            filter.frequency.setValueAtTime(bright, time);
            filter.frequency.setTargetAtTime(300, time, length / 2);
            const amp = ac.createGain();
            const end = envelope(amp.gain, time, { attack: 0.003, decay: length, sustain: 0.1, release: 0.15, peak: gain, length });
            for (const cents of [-detune, detune]) {
                const osc = ac.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.value = freq(name);
                osc.detune.value = cents;
                osc.connect(filter);
                osc.start(time);
                osc.stop(end);
            }
            filter.connect(amp).connect(out.input);
        };
        // A slow pad: a chord of detuned saws, soft low-pass, long attack and release.
        const pad = (out, time, notes, duration, { gain = 0.12, cutoff = 1400, attack = 1.2, release = 1.5 } = {}) => {
            const filter = ac.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = cutoff;
            filter.Q.value = 0.7;
            const amp = ac.createGain();
            amp.gain.setValueAtTime(0, time);
            amp.gain.linearRampToValueAtTime(gain, time + attack);
            amp.gain.setValueAtTime(gain, time + Math.max(attack, duration - 0.01));
            amp.gain.linearRampToValueAtTime(0, time + duration + release);
            for (const name of notes) {
                for (const cents of [-9, 0, 9]) {
                    const osc = ac.createOscillator();
                    osc.type = 'sawtooth';
                    osc.frequency.value = freq(name);
                    osc.detune.value = cents;
                    osc.connect(filter);
                    osc.start(time);
                    osc.stop(time + duration + release + 0.1);
                }
            }
            filter.connect(amp).connect(out.input);
            return filter;
        };
        const bass = (out, time, name, duration, { gain = 0.45, cutoff = 600 } = {}) => {
            const filter = ac.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = cutoff;
            const amp = ac.createGain();
            const end = envelope(amp.gain, time, { attack: 0.006, decay: 0.15, sustain: 0.7, release: 0.08, peak: gain, length: duration });
            const saw = ac.createOscillator();
            saw.type = 'sawtooth';
            saw.frequency.value = freq(name);
            const sub = ac.createOscillator();
            sub.frequency.value = freq(name) / 2;
            const subAmp = ac.createGain();
            subAmp.gain.value = 0.8;
            saw.connect(filter);
            sub.connect(subAmp).connect(filter);
            filter.connect(amp).connect(out.input);
            for (const osc of [saw, sub]) {
                osc.start(time);
                osc.stop(end);
            }
        };
        // A bell or glass tone: a sine with a quiet inharmonic partial.
        const bell = (out, time, name, { gain = 0.2, decay = 1.6 } = {}) => {
            for (const [ratio, level] of [[1, 1], [2.76, 0.25], [5.4, 0.08]]) {
                const osc = ac.createOscillator();
                osc.frequency.value = freq(name) * ratio;
                const amp = ac.createGain();
                const end = envelope(amp.gain, time, { attack: 0.002, decay: decay / ratio, peak: gain * level });
                osc.connect(amp).connect(out.input);
                osc.start(time);
                osc.stop(end);
            }
        };
        // Rising filtered noise into a moment.
        const riser = (out, time, duration, { gain = 0.25 } = {}) => {
            const hiss = noise(time, duration);
            const filter = ac.createBiquadFilter();
            filter.type = 'bandpass';
            filter.Q.value = 3;
            filter.frequency.setValueAtTime(300, time);
            filter.frequency.exponentialRampToValueAtTime(9000, time + duration);
            const amp = ac.createGain();
            amp.gain.setValueAtTime(0, time);
            amp.gain.linearRampToValueAtTime(gain, time + duration);
            amp.gain.linearRampToValueAtTime(0, time + duration + 0.03);
            hiss.connect(filter).connect(amp).connect(out.input);
        };
        // A soft low boom with a noise tail, for a reveal.
        const impact = (out, time, { gain = 0.7 } = {}) => {
            kick(out, time, { gain, pitch: 38, punch: 1 });
            const hiss = noise(time, 2);
            const filter = ac.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(4000, time);
            filter.frequency.exponentialRampToValueAtTime(200, time + 1.8);
            const amp = ac.createGain();
            envelope(amp.gain, time, { attack: 0.005, decay: 1.5, peak: gain * 0.35 });
            hiss.connect(filter).connect(amp).connect(out.input);
        };
        // A short UI tick for a click, a check or a key press.
        const tick = (out, time, { gain = 0.15, pitch = 2200 } = {}) => {
            const osc = ac.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(pitch, time);
            osc.frequency.exponentialRampToValueAtTime(pitch * 0.6, time + 0.04);
            const amp = ac.createGain();
            envelope(amp.gain, time, { attack: 0.001, decay: 0.05, peak: gain });
            osc.connect(amp).connect(out.input);
            osc.start(time);
            osc.stop(time + 0.2);
        };

        return { ac, master, reverb, bus, note, freq, kick, snare, hat, pluck, pad, bass, bell, riser, impact, tick, noise };
    };

    window.Score = { create, note, freq };
})();
