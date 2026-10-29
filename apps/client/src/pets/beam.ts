import { BEAM_LIGHT } from '@/pets/sprite-colors';

/* How long a pet takes to come or to go. */
export const BEAM_MS = 650;

/* How far a pixel may stray from its place while it beams, in cells: across the width, and up or down. */
export const BEAM_SPREAD = { x: 20, y: 5 } as const;

/*
 * The ways a pet comes and goes, which a person picks in Settings, Pets, Teleport (`petsBeam`): it gathers
 * out of scattered pixels, is drawn by a scanning line, rains down in pixels, is beamed in a column of
 * light, or rises out of a ring. Going is the same way played back.
 */
export const BEAM_STYLES = ['gather', 'scan', 'rain', 'transporter', 'portal'] as const;

export type BeamStyle = (typeof BEAM_STYLES)[number];

/* A style, or a new one picked for every beam. */
export type BeamSetting = BeamStyle | 'random';

export const BEAM_SETTINGS: readonly BeamSetting[] = [...BEAM_STYLES, 'random'];

/* A cell of the figure, in cells of its paint. */
export interface BeamCell {
    x: number;
    y: number;
    color: string;
}

/* A pixel to paint at one moment of a beam: in the figure's own color, the accent for the light, or white for a flash. */
export interface BeamPixel {
    x: number;
    y: number;
    color: string | 'accent';
    alpha: number;
}

const WHITE = BEAM_LIGHT.flash;

/* A number from 0 to 1 that is the same for a cell every time, so a pixel goes out the way it came in. */
function scatter(index: number, salt: number): number {
    const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;

    return value - Math.floor(value);
}

function clamp(share: number): number {
    return Math.min(1, Math.max(0, share));
}

/* The pixels scattered across the width pull into place, and flash once the figure is whole. */
function gather(cells: readonly BeamCell[], share: number): BeamPixel[] {
    const pull = clamp(share / 0.85);
    // Scattered, a pixel fades to nothing, so one that flew apart is gone when the beam ends.
    const fade = clamp(share / 0.2);
    const flash = share > 0.85 && share < 1 ? 0.5 * (1 - (share - 0.85) / 0.15) : 0;

    return cells.flatMap((cell, index) => {
        const fromX = cell.x + Math.round((scatter(index, 7) - 0.5) * 2 * BEAM_SPREAD.x);
        const fromY = cell.y + Math.round((scatter(index, 8) - 0.5) * 2 * BEAM_SPREAD.y);
        const at = { x: Math.round(fromX + (cell.x - fromX) * pull), y: Math.round(fromY + (cell.y - fromY) * pull) };
        const pixel = { ...at, color: cell.color, alpha: fade * (0.3 + 0.7 * pull) };

        return flash > 0 ? [pixel, { ...at, color: WHITE, alpha: flash }] : [pixel];
    });
}

/* A bright line runs down the figure and leaves its rows drawn behind it. */
function scan(cells: readonly BeamCell[], share: number, top: number, bottom: number, left: number, right: number): BeamPixel[] {
    const row = top + Math.floor(clamp(share) * (bottom - top + 1));
    const drawn = cells.filter((cell) => cell.y < row).map((cell) => ({ ...cell, alpha: 1 }));

    if (share <= 0 || share >= 1) {
        return drawn;
    }

    const line = Array.from({ length: right - left + 1 }, (_, i) => ({ x: left + i, y: row, color: 'accent', alpha: 0.9 }));

    return [...drawn, ...line];
}

/* The pixels fall one by one from above into place. */
function rain(cells: readonly BeamCell[], share: number, top: number): BeamPixel[] {
    return cells.flatMap((cell, index) => {
        const fall = clamp((share - scatter(index, 1) * 0.55) / 0.45);

        if (fall <= 0) {
            return [];
        }

        const drop = Math.round((1 - fall) * (cell.y - top + BEAM_SPREAD.y * 2));

        return [{ x: cell.x, y: cell.y - drop, color: cell.color, alpha: 0.35 + 0.65 * fall }];
    });
}

/* A column of light widens over the spot, the pixels flicker on in it, and the light fades. */
function transporter(cells: readonly BeamCell[], share: number, top: number, bottom: number, middle: number): BeamPixel[] {
    const width = Math.round(2 + 22 * clamp(share / 0.4));
    // The light comes up at the start and dies down at the end, so nothing is left when the beam is done either way.
    const light = 0.35 * clamp(share / 0.1) * (1 - clamp((share - 0.65) / 0.35));
    const pixels: BeamPixel[] = [];

    for (let x = Math.round(middle - width / 2); x < Math.round(middle + width / 2); x++) {
        for (let y = top - BEAM_SPREAD.y; y <= bottom; y++) {
            pixels.push({ x, y, color: 'accent', alpha: light });
        }
    }

    cells.forEach((cell, index) => {
        if (scatter(index, 3) < clamp((share - 0.2) / 0.6)) {
            pixels.push({ ...cell, alpha: 1 });
        }
    });

    return pixels;
}

/* A ring opens on the edge under the figure, the figure rises out of it, and the ring closes. */
function portal(cells: readonly BeamCell[], share: number, top: number, bottom: number, middle: number): BeamPixel[] {
    const open = share < 0.25 ? clamp(share / 0.25) : share > 0.8 ? 1 - clamp((share - 0.8) / 0.2) : 1;
    const rise = Math.round((1 - clamp((share - 0.2) / 0.6)) * (bottom - top + 1));
    const pixels: BeamPixel[] = cells.filter((cell) => cell.y + rise <= bottom).map((cell) => ({ ...cell, y: cell.y + rise, alpha: 1 }));
    const half = Math.round(11 * open);

    if (half === 0) {
        return pixels;
    }

    for (let x = middle - half; x <= middle + half; x++) {
        pixels.push({ x, y: bottom, color: 'accent', alpha: 1 });

        if (Math.abs(x - middle) < half - 1) {
            pixels.push({ x, y: bottom + 1, color: 'accent', alpha: 0.5 });
        }
    }

    return pixels;
}

/* What a beam paints at a share of its way in (0 not there, 1 whole): one list of pixels, in cells of the figure's paint. */
export function beamPixels(style: BeamStyle, cells: readonly BeamCell[], share: number): BeamPixel[] {
    if (cells.length === 0) {
        return [];
    }

    const top = Math.min(...cells.map((cell) => cell.y));
    const bottom = Math.max(...cells.map((cell) => cell.y));
    const left = Math.min(...cells.map((cell) => cell.x));
    const right = Math.max(...cells.map((cell) => cell.x));
    const middle = Math.round((left + right) / 2);

    switch (style) {
        case 'scan':
            return scan(cells, share, top, bottom, left, right);
        case 'rain':
            return rain(cells, share, top);
        case 'transporter':
            return transporter(cells, share, top, bottom, middle);
        case 'portal':
            return portal(cells, share, top, bottom, middle);
        default:
            return gather(cells, share);
    }
}

/* The style of one beam: the one picked, or for Random one of all of them, by a number from 0 to 1. */
export function beamStyleOf(setting: BeamSetting, pick: number): BeamStyle {
    return setting === 'random' ? BEAM_STYLES[Math.min(BEAM_STYLES.length - 1, Math.floor(pick * BEAM_STYLES.length))] : setting;
}
