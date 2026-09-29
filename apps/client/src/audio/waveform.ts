/* How many bars a level meter draws. One number, because two meters of different widths read as two different microphones. */
export const WAVEFORM_BAND_COUNT = 40;

export const SPEECH_SPECTRUM_BAND_COUNT = 5;

/* Logarithmic bands separate the voice's low tones and higher consonants without amplifying silence. */
export const spectrumBands = (decibels: Float32Array, sampleRate: number): number[] => {
    const binHz = sampleRate / (decibels.length * 2);
    const lowHz = 100;
    const highHz = Math.min(6000, sampleRate / 2);
    return Array.from({ length: SPEECH_SPECTRUM_BAND_COUNT }, (_, index) => {
        const from = Math.max(1, Math.floor((lowHz * (highHz / lowHz) ** (index / SPEECH_SPECTRUM_BAND_COUNT)) / binHz));
        const to = Math.min(decibels.length, Math.max(from + 1, Math.ceil((lowHz * (highHz / lowHz) ** ((index + 1) / SPEECH_SPECTRUM_BAND_COUNT)) / binHz)));
        let peak = -Infinity;
        for (let bin = from; bin < to; bin++) {
            peak = Math.max(peak, decibels[bin] ?? -Infinity);
        }
        return Math.min(1, Math.max(0, (peak + 70) / 50));
    });
};

/* Bars fall slower than they rise, so a voice reads as a voice instead of as a flicker. */
export const easeBands = (previous: readonly number[], next: readonly number[]): number[] =>
    next.map((level, index) => {
        const before = previous[index] ?? 0;
        return before + (level - before) * (level > before ? 0.38 : 0.16);
    });
