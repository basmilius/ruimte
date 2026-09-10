import { DEFAULT_FONT_STACKS } from '@ruimte/drawing';

let loaded: Promise<void> | null = null;

/*
 * Kalam is the hand of a drawing, the second bundled face after Geist. It arrives with the first
 * drawing view rather than with the app, and the text is only measured once the face is really
 * there: measuring against the fallback would size every box wrong.
 */
export const loadDrawingFont = (): Promise<void> => {
    loaded ??= (async () => {
        await import('@fontsource/kalam/400.css');
        if (typeof document === 'undefined' || !document.fonts) {
            return;
        }
        await document.fonts.load(`400 20px ${DEFAULT_FONT_STACKS.hand}`).catch(() => undefined);
    })();
    return loaded;
};
