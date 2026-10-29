import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/pets/animals';
import { drawnFrameKey, paintPet, petPainter, type PetLook } from '@/pets/paint';
import type { PetFrame, PetMood } from '@/pets/pet-state';
import {
    bowColors,
    DRAWN_CYCLE,
    paintParts,
    PET_POSES,
    SPRITE_COLUMNS,
    SPRITE_ROWS,
    type BowColors,
    type DrawnSprite,
    type PaintTarget,
    type PetPose
} from '@/pets/pixel';

const STILL_STRIP: PetLook = { kind: 'sheet', sprite: { id: 'still', name: 'Still', image: 'data:image/png;base64,AAAA', frameSize: 16, frames: 1 } };
const BUDDY: PetLook = { kind: 'drawn', sprite: CLAUDE_BUDDY };

function paintsOver(look: PetLook, mood: PetMood, ticks: number, done: (frame: PetFrame) => boolean = () => true): PetFrame[] {
    const painted: PetFrame[] = [];
    const tick = petPainter(look, mood, false, (frame) => {
        const finished = done(frame);
        if (finished) {
            painted.push(frame);
        }
        return finished;
    });
    for (let i = 0; i < ticks; i++) {
        tick(i);
    }
    return painted;
}

describe('a pet paints only a picture that changed', () => {
    test('a strip of one frame paints once, however many beats go by', () => {
        for (const mood of ['idle', 'working', 'stopped', 'visiting'] as const) {
            expect(paintsOver(STILL_STRIP, mood, 60)).toHaveLength(1);
        }
    });

    test('a strip of one frame that waits paints each step of its jump, and once more only for the next jump', () => {
        const painted = paintsOver(STILL_STRIP, 'waiting', 8);
        // Two ticks on the ground in a row draw one picture.
        expect(painted.map((frame) => frame.lift)).toEqual([0, 2, 3, 4, 3, 2, 0]);
    });

    test('a strip that waits, snoozed, paints its bubble once and stands still', () => {
        const painted = paintsOver(STILL_STRIP, 'snoozed', 40);
        expect(painted).toHaveLength(1);
        expect(painted[0].bubble).toBe(true);
    });

    test('a paint that could not finish, a strip still decoding, is tried again on the next beat', () => {
        let calls = 0;
        const painted = paintsOver(STILL_STRIP, 'idle', 10, () => {
            calls += 1;
            return calls > 1;
        });
        expect(calls).toBe(2);
        expect(painted).toHaveLength(1);
    });

    test('a built-in figure at rest paints once per frame of its own, not once per beat', () => {
        // Asleep it moves every fourth beat, so 48 beats are 12 frames of its own.
        expect(paintsOver(BUDDY, 'idle', 48)).toHaveLength(12);
    });

    test('a built-in figure looks the same a cycle later, which is why the key may wrap there', () => {
        for (const sprite of [CLAUDE_BUDDY, CODEX_BUDDY, FOX_SPRITE, FROG_SPRITE]) {
            for (const pose of PET_POSES) {
                for (let frame = 0; frame < DRAWN_CYCLE; frame++) {
                    expect(sprite.poses[pose](frame + DRAWN_CYCLE)).toEqual(sprite.poses[pose](frame));
                }
            }
        }
        const frame: PetFrame = { pose: 'work', frame: 3, lift: 0, bubble: false };
        expect(drawnFrameKey(BUDDY, frame)).toBe(drawnFrameKey(BUDDY, { ...frame, frame: 3 + DRAWN_CYCLE }));
    });
});

describe('a figure with strips per state', () => {
    // Standing has one frame, working its own strip of three.
    const STRIPS: PetLook = {
        kind: 'sheet',
        sprite: { ...STILL_STRIP.sprite, strips: { work: { image: 'data:image/png;base64,BBBB', frameSize: 16, frames: 3 } } }
    };

    test('a state with a strip of its own paints each of its frames', () => {
        expect(paintsOver(STRIPS, 'working', 9)).toHaveLength(9);
        expect(drawnFrameKey(STRIPS, { pose: 'work', frame: 1, lift: 0, bubble: false })).toBe(
            drawnFrameKey(STRIPS, { pose: 'work', frame: 4, lift: 0, bubble: false })
        );
    });

    test('a state without one plays the standing strip of one frame, and so paints once', () => {
        for (const mood of ['idle', 'stopped', 'visiting'] as const) {
            expect(paintsOver(STRIPS, mood, 40)).toHaveLength(1);
        }
    });
});

describe('a preview of one state', () => {
    test('shows that pose whatever the mood, and holds its first frame with reduced motion', () => {
        const shown = (still: boolean): PetFrame[] => {
            const painted: PetFrame[] = [];
            const tick = petPainter(
                BUDDY,
                'idle',
                still,
                (frame) => painted.push(frame) > 0,
                () => false,
                'walk'
            );
            for (let i = 0; i < 6; i++) {
                tick(i);
            }
            return painted;
        };
        expect(shown(false).map((frame) => [frame.pose, frame.frame])).toEqual([0, 1, 2, 3, 4, 5].map((frame) => ['walk', frame]));
        expect(shown(true)).toEqual([{ pose: 'walk', frame: 0, lift: 0, bubble: false }]);
    });
});

describe('a stopped figure of your own', () => {
    class FakeImage {
        src = '';
        complete = true;
        naturalWidth = 16;
        naturalHeight = 16;
    }
    const STOPPED = { image: 'data:image/png;base64,CCCC', frameSize: 16, frames: 1 };

    function rotations(look: PetLook): number {
        let turned = 0;
        const context = {
            clearRect() {},
            drawImage() {},
            save() {},
            restore() {},
            translate() {},
            fillRect() {},
            rotate() {
                turned += 1;
            }
        } as unknown as CanvasRenderingContext2D;
        expect(paintPet(context, look, { pose: 'stopped', frame: 0, lift: 0, bubble: false }, false)).toBe(true);
        return turned;
    }

    beforeEach(() => Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage }));
    afterEach(() => Reflect.deleteProperty(globalThis, 'Image'));

    test('stands as its own stopped strip draws it, and tips the standing strip over without one', () => {
        expect(rotations({ kind: 'sheet', sprite: { ...STILL_STRIP.sprite, id: 'own', strips: { stopped: STOPPED } } })).toBe(0);
        expect(rotations({ kind: 'sheet', sprite: { ...STILL_STRIP.sprite, id: 'fallback' } })).toBe(1);
    });
});

describe('a pet on a colored node wears a bow in its color', () => {
    const RED = '#e7000b';

    function colorsPainted(sprite: DrawnSprite, pose: PetPose, bow: BowColors | null): Set<string> {
        const colors = new Set<string>();
        const target: PaintTarget = {
            fillStyle: '',
            fillRect() {
                colors.add(String(target.fillStyle));
            }
        };
        paintParts(target, sprite, sprite.poses[pose](0), { x: 0, y: 0 }, 1, bow);
        return colors;
    }

    test('every pose of every built-in figure has a place for the bow, on its head and inside its grid', () => {
        for (const sprite of [CLAUDE_BUDDY, CODEX_BUDDY, FOX_SPRITE, FROG_SPRITE]) {
            for (const pose of PET_POSES) {
                const cells = sprite.poses[pose](0).bow ?? [];
                expect(cells.length).toBeGreaterThan(0);
                expect(cells.every((cell) => cell.x >= 0 && cell.y >= 0 && cell.x + cell.w <= SPRITE_COLUMNS && cell.y + cell.h <= SPRITE_ROWS)).toBe(true);
            }
        }
    });

    test('the bow is painted in three tones of the color, and not at all without one', () => {
        const bow = bowColors(RED);
        expect(bow).toEqual({ base: RED, light: '#ef5960', shade: '#a20008' });
        const painted = colorsPainted(CLAUDE_BUDDY, 'stand', bow);
        expect([bow!.base, bow!.light, bow!.shade].every((color) => painted.has(color))).toBe(true);
        expect(colorsPainted(CLAUDE_BUDDY, 'stand', null).has(RED)).toBe(false);
    });

    test('a color that is no hex gives no bow', () => {
        expect(bowColors('var(--accent)')).toBeNull();
    });
});
