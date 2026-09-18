import { create } from 'zustand';

const STORAGE_KEY = 'ruimte.browser-stream-scale';
const MAX_STREAM_SCALE = 2;

const normalizedScale = (value: number): number => Math.round(Math.min(MAX_STREAM_SCALE, Math.max(1, Number.isFinite(value) ? value : 1)) * 100) / 100;

export const browserStreamScaleLimit = (): number => normalizedScale(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

export const clampBrowserStreamScale = (scale: number, limit: number): number => Math.min(normalizedScale(scale), normalizedScale(limit));

export const browserStreamScaleOptions = (limit: number): number[] => {
    const maximum = normalizedScale(limit);
    const options = [1];
    for (let scale = 1.5; scale < maximum; scale += 0.5) {
        options.push(scale);
    }
    if (maximum > 1 && options.at(-1) !== maximum) {
        options.push(maximum);
    }
    return options;
};

const readScale = (): number => {
    try {
        return normalizedScale(Number(localStorage.getItem(STORAGE_KEY) ?? 1));
    } catch {
        return 1;
    }
};

const persistScale = (scale: number): void => {
    try {
        localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
        // Storage that refuses keeps the choice for this session only.
    }
};

interface BrowserStreamQualityStore {
    scale: number;
    setScale(scale: number): void;
}

export const useBrowserStreamQuality = create<BrowserStreamQualityStore>((set) => ({
    scale: readScale(),
    setScale(scale) {
        const next = normalizedScale(scale);
        persistScale(next);
        set({ scale: next });
    }
}));
