import { spriteImage, stripFor, type CustomPetSprite } from '@/pets/custom-sprites';
import { bubbleCell, petFrame, type PetFrame, type PetMood } from '@/pets/pet-state';
import {
    BUBBLE_ROWS,
    bubble,
    DRAWN_CYCLE,
    JUMP_ROWS,
    PAINT_COLUMNS,
    PAINT_ROWS,
    paintCells,
    paintParts,
    SPRITE_COLUMNS,
    SPRITE_ROWS,
    type BowColors,
    type DrawnSprite,
    type PetPose
} from '@/pets/pixel';

/* A built-in figure, or a strip a person added. */
export type PetLook = { kind: 'drawn'; sprite: DrawnSprite } | { kind: 'sheet'; sprite: CustomPetSprite };

/* Backing pixels a cell takes, twice the world's, so a pet stays sharp at twice the zoom. */
export const PAINT_CELL = 4;

export const PAINT_SIZE = { w: PAINT_COLUMNS * PAINT_CELL, h: PAINT_ROWS * PAINT_CELL } as const;

// The sprite stands on the bottom of the paint, the jump and the bubble above it.
const GROUND = BUBBLE_ROWS + JUMP_ROWS;

/* A strip's frame is square and as high as a built-in figure, in the middle of its width. */
const SHEET_CELLS = SPRITE_ROWS;
const SHEET_LEFT = (SPRITE_COLUMNS - SHEET_CELLS) / 2;

/*
 * What a frame puts on screen, so two ticks that would draw the same picture paint once. A strip counts
 * the frames of the one it plays, which is the standing one where its own decoded to another size.
 */
export function drawnFrameKey(look: PetLook, frame: PetFrame): string {
    if (look.kind === 'drawn') {
        return `${look.sprite.id}:${frame.pose}:${frame.frame % DRAWN_CYCLE}:${frame.lift}:${frame.bubble}`;
    }
    const played = spriteImage(look.sprite, frame.pose) ?? stripFor(look.sprite, frame.pose);
    return `${look.sprite.id}:${frame.pose}:${played.pose}:${frame.frame % played.strip.frames}:${frame.lift}:${frame.bubble}`;
}

/*
 * What a pet does on each beat: work out its frame and paint it only when the picture changes. A paint
 * that could not finish (a strip that still decodes) says so, and the next beat tries again.
 */
export function petPainter(
    look: PetLook,
    mood: PetMood,
    still: boolean,
    paint: (frame: PetFrame) => boolean,
    walking: () => boolean = () => false,
    shown?: PetPose
): (tick: number) => void {
    let painted: string | null = null;
    return (tick) => {
        // A preview of one state shows that pose whatever the mood, on its first frame with reduced motion. Walking
        // is asked on every beat, since a pet along the bottom of the screen starts and stops without its mood changing.
        const frame: PetFrame =
            shown !== undefined
                ? { pose: shown, frame: still ? 0 : tick, lift: 0, bubble: false }
                : !still && walking()
                  ? { pose: 'walk', frame: tick, lift: 0, bubble: false }
                  : petFrame(mood, tick, still);
        const key = drawnFrameKey(look, frame);
        if (key !== painted && paint(frame)) {
            painted = key;
        }
    };
}

/*
 * One frame of a pet, with its bubble when it waits on you, over its head or, where a node lies there,
 * beside it, and a bow in its node's color when the node has one. A strip gets no bow: nothing says
 * where its head is. False when a strip's image is not decoded yet.
 */
export function paintPet(context: CanvasRenderingContext2D, look: PetLook, frame: PetFrame, crowded: boolean, bow: BowColors | null = null): boolean {
    context.clearRect(0, 0, PAINT_SIZE.w, PAINT_SIZE.h);
    const top = GROUND - frame.lift;
    let complete = true;
    if (look.kind === 'drawn') {
        paintParts(context, look.sprite, look.sprite.poses[frame.pose](frame.frame), { x: 0, y: top }, PAINT_CELL, bow);
    } else {
        complete = paintSheet(context, look.sprite, frame, top);
    }
    if (frame.bubble) {
        const at = bubbleCell(frame.lift, crowded);
        paintCells(context, bubble(at.x, at.y), PAINT_CELL);
    }
    return complete;
}

/*
 * A state plays its own strip, or the one the sprite stands in. A stopped agent without a strip of its
 * own tips that one over and fades it; the other states only change the pace.
 */
function paintSheet(context: CanvasRenderingContext2D, sprite: CustomPetSprite, frame: PetFrame, top: number): boolean {
    const played = spriteImage(sprite, frame.pose);
    if (played === null) {
        return false;
    }
    const { image } = played;
    const { frameSize, frames } = played.strip;
    const size = SHEET_CELLS * PAINT_CELL;
    const left = SHEET_LEFT * PAINT_CELL;
    const y = top * PAINT_CELL;
    const source = (frame.frame % frames) * frameSize;
    context.imageSmoothingEnabled = false;
    if (frame.pose !== 'stopped' || played.pose === 'stopped') {
        context.drawImage(image, source, 0, frameSize, frameSize, left, y, size, size);
        return true;
    }
    context.save();
    context.globalAlpha = 0.6;
    context.translate(left + size / 2, y + size / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(image, source, 0, frameSize, frameSize, -size / 2, -size / 2, size, size);
    context.restore();
    return true;
}
