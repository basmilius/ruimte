import { NODE_ACCENT_NAMES, type NodeAccent } from '@ruimte/contracts';

export type AccentId = NodeAccent;

/*
 * Tailwind's 600 ramp without the grays, in sRGB hex rather than the oklch Tailwind writes them in:
 * an accent reaches xterm as a literal color and its parser knows no oklch. The names and their
 * order (Tailwind's own, which is the hue wheel) come from contracts, because the daemon refuses a
 * `--color` against the same set; only the paint is the client's.
 */
const ACCENT_COLORS: Record<AccentId, string> = {
    red: '#e7000b',
    orange: '#f54900',
    amber: '#e17100',
    yellow: '#d08700',
    lime: '#5ea500',
    green: '#00a63e',
    emerald: '#009966',
    teal: '#009689',
    cyan: '#0092b8',
    sky: '#0084d1',
    blue: '#155dfc',
    indigo: '#4f39f6',
    violet: '#7f22fe',
    purple: '#9810fa',
    fuchsia: '#c800de',
    pink: '#e60076',
    rose: '#ec003f'
};

export const NODE_ACCENTS: readonly { id: AccentId; label: string; color: string }[] = NODE_ACCENT_NAMES.map((id) => ({
    id,
    label: `${id[0]!.toUpperCase()}${id.slice(1)}`,
    color: ACCENT_COLORS[id]
}));

/* The five a settings row shows in the open, blue (the one Ruimte carries) first. The rest of the
   wheel sits behind the overflow beside them, which wears the accent itself once one is picked. */
export const FEATURED_ACCENTS: readonly AccentId[] = ['blue', 'violet', 'rose', 'amber', 'teal'];

export const accentColor = (id: string | null | undefined): string | undefined => NODE_ACCENTS.find((entry) => entry.id === id)?.color;

export const isFeatured = (id: string): boolean => FEATURED_ACCENTS.some((featured) => featured === id);
