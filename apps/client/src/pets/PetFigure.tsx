import { useEffect, useRef } from 'react';
import { BEAM_MS, BEAM_SPREAD, beamPixels, beamStyleOf, type BeamCell, type BeamStyle } from '@/pets/beam';
import { usePrefersStill } from '@/pets/figure-support';
import { PAINT_CELL, PAINT_SIZE, paintPet, petPainter, type PetLook } from '@/pets/paint';
import { petFrame, WORLD_CELL, type PetMood } from '@/pets/pet-state';
import { bowColors, PAINT_COLUMNS, PAINT_ROWS, type BowColors, type PetPose } from '@/pets/pixel';
import { BEAM_LIGHT } from '@/pets/sprite-colors';
import { onPetTick } from '@/pets/ticker';
import { useSettings } from '@/state/settings';

/* The paint a beam draws on, with room around the figure for the pixels that fly in from the sides. */
const BEAM_SIZE = { w: (PAINT_COLUMNS + BEAM_SPREAD.x * 2) * PAINT_CELL, h: (PAINT_ROWS + BEAM_SPREAD.y * 2) * PAINT_CELL } as const;

/* The filled cells of one frame of a figure, read back from its paint. */
function cellsOf(look: PetLook, mood: PetMood, crowded: boolean, bow: BowColors | null): BeamCell[] {
    const source = document.createElement('canvas');
    source.width = PAINT_SIZE.w;
    source.height = PAINT_SIZE.h;
    const context = source.getContext('2d');

    if (context === null) {
        return [];
    }

    paintPet(context, look, petFrame(mood, 0, true), crowded, bow);
    const pixels = context.getImageData(0, 0, PAINT_SIZE.w, PAINT_SIZE.h).data;
    const cells: BeamCell[] = [];

    for (let y = 0; y < PAINT_ROWS; y++) {
        for (let x = 0; x < PAINT_COLUMNS; x++) {
            // A cell is one color, so its middle says it.
            const at = ((y * PAINT_CELL + PAINT_CELL / 2) * PAINT_SIZE.w + x * PAINT_CELL + PAINT_CELL / 2) * 4;

            if (pixels[at + 3] > 0) {
                cells.push({ x, y, color: `rgba(${pixels[at]}, ${pixels[at + 1]}, ${pixels[at + 2]}, ${pixels[at + 3] / 255})` });
            }
        }
    }

    return cells;
}

/*
 * A pet coming or going (`teleport.ts`), in the way picked in Settings, Pets, Teleport (`beam.ts`). A
 * paint of its own, wider than the figure for pixels that stray, for the short while it runs on its own clock.
 */
function PetBeam({
    look,
    mood,
    crowded,
    accent,
    beam,
    cell
}: {
    look: PetLook;
    mood: PetMood;
    crowded: boolean;
    accent?: string;
    beam: 'in' | 'out';
    cell: number;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const setting = useSettings((s) => s.petsBeam);
    // The beam's own start and style, kept over a render that paints it again, so it never begins anew halfway or changes its way.
    const started = useRef<number | null>(null);
    const picked = useRef<BeamStyle | null>(null);

    useEffect(() => {
        const context = ref.current?.getContext('2d') ?? null;

        if (context === null) {
            return;
        }

        picked.current ??= beamStyleOf(setting, Math.random());
        const style = picked.current;
        const cells = cellsOf(look, mood, crowded, accent === undefined ? null : bowColors(accent));
        // The light is the app's accent, read once for the beam.
        const light = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || BEAM_LIGHT.fallback;
        let frame = 0;

        const draw = (time: number): void => {
            started.current ??= time;
            const progress = Math.min(1, (time - started.current) / BEAM_MS);
            context.clearRect(0, 0, BEAM_SIZE.w, BEAM_SIZE.h);

            for (const pixel of beamPixels(style, cells, beam === 'in' ? progress : 1 - progress)) {
                context.globalAlpha = pixel.alpha;
                context.fillStyle = pixel.color === 'accent' ? light : pixel.color;
                context.fillRect((pixel.x + BEAM_SPREAD.x) * PAINT_CELL, (pixel.y + BEAM_SPREAD.y) * PAINT_CELL, PAINT_CELL, PAINT_CELL);
            }

            context.globalAlpha = 1;

            if (progress < 1) {
                frame = requestAnimationFrame(draw);
            }
        };

        frame = requestAnimationFrame(draw);

        return () => cancelAnimationFrame(frame);
    }, [look, mood, crowded, accent, beam, setting]);

    return (
        <canvas
            ref={ref}
            width={BEAM_SIZE.w}
            height={BEAM_SIZE.h}
            className="pointer-events-none absolute block"
            style={{
                left: -BEAM_SPREAD.x * cell,
                top: -BEAM_SPREAD.y * cell,
                width: (PAINT_COLUMNS + BEAM_SPREAD.x * 2) * cell,
                height: (PAINT_ROWS + BEAM_SPREAD.y * 2) * cell,
                imageRendering: 'pixelated'
            }}
            aria-hidden
        />
    );
}

/*
 * A canvas of its own that repaints on the shared beat, so React renders a pet only when its mood or
 * look changes, and the beat paints only a frame that differs from the one before it. A kid (`small`)
 * is the same paint shown at half the size. While it comes or goes (`beam`) the beam stands in its place.
 */
export function PetFigure({
    look,
    mood,
    crowded,
    accent,
    walking,
    small = false,
    pose,
    beam,
    cell
}: {
    look: PetLook;
    mood: PetMood;
    crowded: boolean;
    accent?: string;
    walking?: () => boolean;
    small?: boolean;

    /* Only for a preview of one state: that pose, whatever the mood. */
    pose?: PetPose;

    /* Whether it is on its way in or out, from `useTeleport`. */
    beam?: 'in' | 'out';

    /* Only for a small picture in the settings: the pixels a cell takes, below a kid's one. */
    cell?: number;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const still = usePrefersStill();
    const beaming = beam !== undefined && !still;
    const size = cell ?? (small ? WORLD_CELL / 2 : WORLD_CELL);

    useEffect(() => {
        const context = ref.current?.getContext('2d') ?? null;

        if (context === null) {
            return;
        }

        const colors = accent === undefined ? null : bowColors(accent);

        return onPetTick(petPainter(look, mood, still, (frame) => paintPet(context, look, frame, crowded, colors), walking, pose));
    }, [look, mood, still, crowded, accent, walking, pose]);

    return (
        <span className="relative block" style={{ width: PAINT_COLUMNS * size, height: PAINT_ROWS * size }}>
            <canvas
                ref={ref}
                width={PAINT_SIZE.w}
                height={PAINT_SIZE.h}
                className="block size-full"
                style={{ imageRendering: 'pixelated', visibility: beaming ? 'hidden' : undefined }}
                aria-hidden
            />
            {beaming && <PetBeam look={look} mood={mood} crowded={crowded} accent={accent} beam={beam} cell={size} />}
        </span>
    );
}
