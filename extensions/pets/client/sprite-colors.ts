/*
 * The paint of the built-in pets and the bubble over a pet that waits on you. Pixel art is drawn
 * into a 2D canvas that no theme reaches, so these are colors as such, not tokens, and a pet looks
 * the same on a light and a dark canvas.
 */

export const BUDDY_CLAUDE = { outline: '#542b1b', body: '#e9823e', light: '#ffb366', shade: '#c66030', ink: '#231610' } as const;

export const BUDDY_CODEX = { outline: '#141c22', body: '#46525b', light: '#71818a', shade: '#303b43', ink: '#3ee08f' } as const;

export const FOX = { outline: '#4a1f10', body: '#d8703a', shade: '#b0532a', cream: '#f7e4c6', ink: '#1b110d', pink: '#ef9f86', sock: '#3a1a10' } as const;

export const FROG = { outline: '#0e2414', body: '#3ea65a', shade: '#2a7a3f', cream: '#bfe486', ink: '#070b08', white: '#f3f7ec', spot: '#25693a' } as const;

export const PROPS = {
    outline: '#1f2430',
    metal: '#5b6474',
    key: '#3a414e',
    screen: '#a6aebb',
    glow: '#7dd3fc',
    glowBright: '#bae6fd',
    terminal: '#526374',
    terminalText: '#85e4b1',
    terminalKey: '#c9f3d9',
    shades: '#11151b',
    sleep: '#cfd6ff',
    cloud: '#a3a9b4',
    cloudShade: '#6b7280'
} as const;

/* Black with an orange mark, as asked, and a light rim so it still reads on a dark canvas. */
export const BUBBLE = { ground: '#000000', rim: '#f4f4f5', mark: '#ff9f1a' } as const;

/* The flash of a figure that came whole (`beam.ts`), and the light of a beam where the app's accent cannot be read. */
export const BEAM_LIGHT = { flash: '#ffffff', fallback: '#ffffff' } as const;
