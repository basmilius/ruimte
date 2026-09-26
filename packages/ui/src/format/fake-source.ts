import type { FormatSource } from './locale.ts';
import { FORMAT_LANGUAGE } from './regions.ts';

export interface FakeFormatSource extends FormatSource {
    set(settings: { language?: string; region?: string }): void;
}

/* A source a test sets by hand: English, the region of the language, and no system locale of a shell. */
export const fakeFormatSource = (): FakeFormatSource => {
    let language = 'en';
    let region: string = FORMAT_LANGUAGE;
    return {
        language: () => language,
        region: () => region,
        subscribe: () => () => {},
        set: (settings) => {
            language = settings.language ?? language;
            region = settings.region ?? region;
        }
    };
};
