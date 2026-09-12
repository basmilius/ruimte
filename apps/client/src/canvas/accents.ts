/*
 * Tailwind's 600 ramp without the grays, in sRGB hex rather than the oklch Tailwind writes them in:
 * an accent reaches xterm as a literal color and its parser knows no oklch. The order is Tailwind's
 * own, which is the hue wheel, so a grid of these reads as one.
 */
export const NODE_ACCENTS = [
    { id: 'red', label: 'Red', color: '#e7000b' },
    { id: 'orange', label: 'Orange', color: '#f54900' },
    { id: 'amber', label: 'Amber', color: '#e17100' },
    { id: 'yellow', label: 'Yellow', color: '#d08700' },
    { id: 'lime', label: 'Lime', color: '#5ea500' },
    { id: 'green', label: 'Green', color: '#00a63e' },
    { id: 'emerald', label: 'Emerald', color: '#009966' },
    { id: 'teal', label: 'Teal', color: '#009689' },
    { id: 'cyan', label: 'Cyan', color: '#0092b8' },
    { id: 'sky', label: 'Sky', color: '#0084d1' },
    { id: 'blue', label: 'Blue', color: '#155dfc' },
    { id: 'indigo', label: 'Indigo', color: '#4f39f6' },
    { id: 'violet', label: 'Violet', color: '#7f22fe' },
    { id: 'purple', label: 'Purple', color: '#9810fa' },
    { id: 'fuchsia', label: 'Fuchsia', color: '#c800de' },
    { id: 'pink', label: 'Pink', color: '#e60076' },
    { id: 'rose', label: 'Rose', color: '#ec003f' }
] as const;

export type AccentId = (typeof NODE_ACCENTS)[number]['id'];

/* The five a settings row shows in the open, blue (the one Ruimte carries) first. The rest of the
   wheel sits behind the overflow beside them, which wears the accent itself once one is picked. */
export const FEATURED_ACCENTS: readonly AccentId[] = ['blue', 'violet', 'rose', 'amber', 'teal'];

export const accentColor = (id: string | null | undefined): string | undefined => NODE_ACCENTS.find((entry) => entry.id === id)?.color;

export const isFeatured = (id: string): boolean => FEATURED_ACCENTS.some((featured) => featured === id);
