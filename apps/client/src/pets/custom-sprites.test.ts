import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    forgetUnusedImages,
    imageFacts,
    previewSpriteOf,
    readPetStrip,
    savePetSprite,
    SHEET_LIMITS,
    sheetLayout,
    spriteImage,
    spriteOf,
    storedSpriteOf,
    stripFor,
    stripsOf,
    usePetSprites,
    type CustomPetSprite,
    type PetStrip,
    type SheetReader
} from '@/pets/custom-sprites';
import { drawnFrameKey, type PetLook } from '@/pets/paint';

function bytesOf(...parts: (string | number[])[]): string {
    return parts.map((part) => (typeof part === 'string' ? part : String.fromCharCode(...part))).join('');
}

function bigEndian(value: number): number[] {
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function littleEndian(value: number, length: number): number[] {
    return Array.from({ length }, (_, i) => (value >>> (8 * i)) & 255);
}

/* The start of a PNG of this size, padded to `length` bytes: enough for a header to read. */
function png(width: number, height: number, length = 64): string {
    const head = bytesOf('\x89PNG\r\n\x1a\n', bigEndian(13), 'IHDR', bigEndian(width), bigEndian(height), [8, 6, 0, 0, 0]);
    return `data:image/png;base64,${btoa(head.padEnd(length, '\0'))}`;
}

function webpLossless(width: number, height: number): string {
    const bits = (width - 1) | ((height - 1) << 14);
    const head = bytesOf('RIFF', littleEndian(40, 4), 'WEBP', 'VP8L', littleEndian(20, 4), [0x2f], littleEndian(bits, 4));
    return `data:image/webp;base64,${btoa(head.padEnd(48, '\0'))}`;
}

function webpExtended(width: number, height: number): string {
    const head = bytesOf(
        'RIFF',
        littleEndian(40, 4),
        'WEBP',
        'VP8X',
        littleEndian(10, 4),
        [0, 0, 0, 0],
        littleEndian(width - 1, 3),
        littleEndian(height - 1, 3)
    );
    return `data:image/webp;base64,${btoa(head.padEnd(48, '\0'))}`;
}

function webpLossy(width: number, height: number): string {
    const head = bytesOf(
        'RIFF',
        littleEndian(40, 4),
        'WEBP',
        'VP8 ',
        littleEndian(20, 4),
        [0, 0, 0],
        [0x9d, 0x01, 0x2a],
        littleEndian(width, 2),
        littleEndian(height, 2)
    );
    return `data:image/webp;base64,${btoa(head.padEnd(48, '\0'))}`;
}

const STRIP = png(64, 16);

function reader(dataUrl: string, size = { width: 64, height: 16 }): SheetReader {
    return { dataUrl: async () => dataUrl, size: async () => size };
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

// The unit run has no storage of its own, and a sprite the storage refuses is not kept.
beforeEach(() => {
    const items = new Map<string, string>();
    const storage = {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key)
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
});

afterEach(() => {
    for (const sprite of usePetSprites.getState().sprites) {
        usePetSprites.getState().remove(sprite.id);
    }
    if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
        Object.defineProperty(globalThis, 'localStorage', original);
    }
});

describe('how a strip is cut', () => {
    test('square frames as high as the image, side by side', () => {
        expect(sheetLayout(64, 16)).toEqual({ frameSize: 16, frames: 4 });
        expect(sheetLayout(32, 32)).toEqual({ frameSize: 32, frames: 1 });
    });

    test('refuses what is no whole number of frames, too small, too large or too long', () => {
        expect(sheetLayout(50, 16)).toEqual({ problem: 'frames-whole' });
        expect(sheetLayout(0, 16)).toEqual({ problem: 'frames-whole' });
        expect(sheetLayout(16, 4)).toEqual({ problem: 'frame-small' });
        expect(sheetLayout(512, 512)).toEqual({ problem: 'frame-large' });
        expect(sheetLayout(16 * (SHEET_LIMITS.maxFrames + 1), 16)).toEqual({ problem: 'frames-many' });
    });
});

describe('what the bytes of an image say', () => {
    test('a PNG and the three kinds of WebP give their type, length and size', () => {
        expect(imageFacts(STRIP)).toEqual({ type: 'png', bytes: 64, width: 64, height: 16 });
        expect(imageFacts(webpLossless(48, 16))).toMatchObject({ type: 'webp', width: 48, height: 16 });
        expect(imageFacts(webpExtended(300, 20))).toMatchObject({ type: 'webp', width: 300, height: 20 });
        expect(imageFacts(webpLossy(32, 32))).toMatchObject({ type: 'webp', width: 32, height: 32 });
    });

    test('nothing for an SVG, an HTML file with a PNG type, or a header that does not read', () => {
        expect(imageFacts(`data:image/png;base64,${btoa('<svg onload="x()"></svg>')}`)).toBeNull();
        expect(imageFacts(`data:image/png;base64,${btoa('<html><script></script></html>')}`)).toBeNull();
        expect(imageFacts(`data:image/svg+xml;base64,${STRIP.slice(STRIP.indexOf(',') + 1)}`)).toBeNull();
        expect(imageFacts(`data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n')}`)).toBeNull();
        expect(imageFacts('../../etc/passwd')).toBeNull();
    });
});

const FILE = { name: 'cat.png', type: 'image/png', size: 900 };
const STAND: PetStrip = { image: STRIP, frameSize: 16, frames: 4 };
const WORK: PetStrip = { image: png(32, 16), frameSize: 16, frames: 2 };

function sprite(id: string, strips: Partial<Record<'walk' | 'work' | 'wait' | 'sleep' | 'stopped', PetStrip>> = {}): CustomPetSprite {
    return spriteOf(id, id, { stand: STAND, ...strips })!;
}

describe('a picked file', () => {
    test('is read as a strip, and nothing is kept before the figure is saved', async () => {
        expect(await readPetStrip(FILE, reader(STRIP))).toEqual({ strip: STAND });
        expect(usePetSprites.getState().sprites).toEqual([]);
    });

    test('is refused when it is an SVG, too large, not an image, cut wrong or decodes to another size', async () => {
        expect(await readPetStrip({ ...FILE, type: 'image/svg+xml' }, reader(STRIP))).toEqual({ problem: 'type' });
        expect(await readPetStrip({ ...FILE, size: SHEET_LIMITS.bytes + 1 }, reader(STRIP))).toEqual({ problem: 'bytes' });
        expect(await readPetStrip(FILE, reader(png(64, 16, SHEET_LIMITS.bytes + 3)))).toEqual({ problem: 'bytes' });
        expect(await readPetStrip(FILE, reader(`data:image/png;base64,${btoa('<html>')}`))).toEqual({ problem: 'unreadable' });
        expect(await readPetStrip(FILE, reader(png(50, 16), { width: 50, height: 16 }))).toEqual({ problem: 'frames-whole' });
        expect(await readPetStrip(FILE, reader(STRIP, { width: 32, height: 16 }))).toEqual({ problem: 'unreadable' });
    });

    test('is never decoded when its header claims a size outside the limits', async () => {
        let decoded = false;
        const huge: SheetReader = {
            dataUrl: async () => png(30000, 30000),
            size: async () => {
                decoded = true;
                return { width: 30000, height: 30000 };
            }
        };
        expect(await readPetStrip(FILE, huge)).toEqual({ problem: 'frame-large' });
        expect(decoded).toBe(false);
    });
});

describe('a figure of strips per state', () => {
    test('needs a strip to stand in, and keeps the others by state under its name', () => {
        expect(spriteOf('a', 'Cat', { work: WORK })).toBeNull();
        expect(spriteOf('a', '  Cat  ', { stand: STAND, work: WORK })).toEqual({ id: 'a', name: 'Cat', ...STAND, strips: { work: WORK } });
        expect(spriteOf('a', 'x'.repeat(60), { stand: STAND })?.name).toHaveLength(SHEET_LIMITS.nameLength);
        expect(stripsOf(sprite('a', { work: WORK }))).toEqual({ stand: STAND, work: WORK });
    });

    test('plays its own strip in a state that has one, and the standing strip in every other', () => {
        const cat = sprite('a', { work: WORK, stopped: WORK });
        expect(stripFor(cat, 'work')).toEqual({ pose: 'work', strip: WORK });
        expect(stripFor(cat, 'stopped')).toEqual({ pose: 'stopped', strip: WORK });
        for (const pose of ['stand', 'walk', 'wait', 'sleep'] as const) {
            expect(stripFor(cat, pose)).toEqual({ pose: 'stand', strip: cat });
        }
    });

    test('is kept under its id, changed in place, and becomes a choice another window reads back', () => {
        expect(savePetSprite(sprite('c1'))).toEqual({ sprite: sprite('c1') });
        expect(savePetSprite(sprite('c1', { work: WORK }))).toEqual({ sprite: sprite('c1', { work: WORK }) });
        usePetSprites.setState({ sprites: [] });
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites).toEqual([sprite('c1', { work: WORK })]);
    });

    test('a figure the storage refuses is not kept, since it would be gone after a reload', () => {
        Reflect.deleteProperty(globalThis, 'localStorage');
        expect(savePetSprite(sprite('c1'))).toEqual({ problem: 'storage' });
        expect(usePetSprites.getState().sprites).toEqual([]);
    });

    test('is refused once the client keeps as many as it may, though one already kept still changes', () => {
        for (let i = 0; i < SHEET_LIMITS.maxSprites; i++) {
            savePetSprite(sprite(`c${i}`));
        }
        expect(savePetSprite(sprite('more'))).toEqual({ problem: 'full' });
        expect(savePetSprite(sprite('c0', { work: WORK }))).toEqual({ sprite: sprite('c0', { work: WORK }) });
    });

    test('is refused when all strips together would take more room than eight of the largest', () => {
        const large: PetStrip = { image: png(64, 16, SHEET_LIMITS.bytes), frameSize: 16, frames: 4 };
        const full = (id: string) => spriteOf(id, id, { stand: large, walk: large, work: large, wait: large })!;
        expect(savePetSprite(full('a'))).toEqual({ sprite: full('a') });
        expect(savePetSprite(full('b'))).toEqual({ sprite: full('b') });
        expect(savePetSprite(sprite('c'))).toEqual({ problem: 'room' });
    });
});

describe('a sprite read back from storage', () => {
    const good = { id: 'ok', name: 'ok', image: STRIP, frameSize: 16, frames: 4 };

    test('passes only as an import would take it now', () => {
        expect(storedSpriteOf(good)).toEqual(good);
        expect(storedSpriteOf({ ...good, image: webpLossless(32, 16), frames: 2 })).toEqual({ ...good, image: webpLossless(32, 16), frames: 2 });
    });

    test('drops other bytes behind a PNG type', () => {
        expect(storedSpriteOf({ ...good, image: `data:image/png;base64,${btoa('<svg onload="x()"></svg>')}` })).toBeNull();
    });

    test('drops a type that is no PNG or WebP, and anything that is no data URL', () => {
        expect(storedSpriteOf({ ...good, image: 'data:image/svg+xml;base64,PHN2Zz4=' })).toBeNull();
        expect(storedSpriteOf({ ...good, image: '../../etc/passwd' })).toBeNull();
    });

    test('drops an image over the byte limit', () => {
        expect(storedSpriteOf({ ...good, image: png(64, 16, SHEET_LIMITS.bytes + 3) })).toBeNull();
    });

    test('drops a sprite whose image is not cut the way it says', () => {
        expect(storedSpriteOf({ ...good, frames: 2 })).toBeNull();
        expect(storedSpriteOf({ ...good, frameSize: 32 })).toBeNull();
    });

    test('drops an image whose own size is outside the limits, whatever is stored beside it', () => {
        expect(storedSpriteOf({ ...good, image: png(4096, 256 * 2), frameSize: 16, frames: 4 })).toBeNull();
        expect(storedSpriteOf({ ...good, image: png(16 * 20, 16), frames: 4 })).toBeNull();
        expect(storedSpriteOf({ ...good, image: png(4, 4), frameSize: 16, frames: 4 })).toBeNull();
    });

    test('keeps the ones that pass and drops the rest of a hand-edited key', () => {
        localStorage.setItem(
            'ruimte.pets.sprites',
            JSON.stringify([
                good,
                { ...good, id: 'liar', frames: 1 },
                { ...good, id: 'big', image: png(64, 16, SHEET_LIMITS.bytes + 3) },
                { id: 'path', image: '../x' }
            ])
        );
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.id)).toEqual(['ok']);
    });

    test('of a client from before strips per state is a figure that stands in its one strip and plays it in every state', () => {
        const legacy = storedSpriteOf(good)!;
        expect(legacy).toEqual(good);
        expect(stripsOf(legacy)).toEqual({ stand: STAND });
        for (const pose of ['stand', 'walk', 'work', 'wait', 'sleep', 'stopped'] as const) {
            expect(stripFor(legacy, pose)).toEqual({ pose: 'stand', strip: legacy });
        }
    });

    test('keeps the strips of other states that pass, and drops one that does not, or a state it does not know, alone', () => {
        const entry = {
            ...good,
            strips: {
                work: WORK,
                wait: { ...WORK, frames: 3 },
                sleep: { ...WORK, image: `data:image/png;base64,${btoa('<svg onload="x()"></svg>')}` },
                dance: WORK,
                stand: WORK
            }
        };
        expect(storedSpriteOf(entry)).toEqual({ ...good, strips: { work: WORK } });
        expect(storedSpriteOf({ ...good, strips: { wait: 'nope' } })).toEqual(good);
    });

    test('a figure whose strips this version cannot read stands in its own strip alone', () => {
        for (const strips of ['nope', null, [], 3]) {
            expect(storedSpriteOf({ ...good, strips })).toEqual(good);
        }
    });

    test('keeps a name no longer than an import would, and each id once', () => {
        expect(storedSpriteOf({ ...good, name: 'x'.repeat(500) })?.name).toHaveLength(SHEET_LIMITS.nameLength);
        localStorage.setItem('ruimte.pets.sprites', JSON.stringify([good, { ...good, name: 'twin' }]));
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.name)).toEqual(['ok']);
    });

    test('drops a figure whose standing strip does not pass, whatever its other strips are', () => {
        expect(storedSpriteOf({ ...good, frames: 2, strips: { work: WORK } })).toBeNull();
    });

    test('keeps no more figures, nor more room, than an import would', () => {
        const large: PetStrip = { image: png(64, 16, SHEET_LIMITS.bytes), frameSize: 16, frames: 4 };
        const many = Array.from({ length: SHEET_LIMITS.maxSprites + 2 }, (_, i) => ({ ...good, id: `c${i}` }));
        localStorage.setItem('ruimte.pets.sprites', JSON.stringify(many));
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites).toHaveLength(SHEET_LIMITS.maxSprites);

        const heavy = { id: 'heavy', name: 'heavy', ...large, strips: { walk: large, work: large, wait: large, sleep: large, stopped: large } };
        localStorage.setItem('ruimte.pets.sprites', JSON.stringify([heavy, { ...heavy, id: 'second' }, good]));
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.id)).toEqual(['heavy', 'ok']);
    });
});

describe('the images a figure plays', () => {
    // The unit run has no images: this one decodes at once to the size its source was given here.
    const sizes = new Map<string, { width: number; height: number }>();
    let made = 0;
    class FakeImage {
        src = '';
        complete = true;
        constructor() {
            made += 1;
        }
        get naturalWidth(): number {
            return sizes.get(this.src)?.width ?? 0;
        }
        get naturalHeight(): number {
            return sizes.get(this.src)?.height ?? 0;
        }
    }
    const NEW_STAND: PetStrip = { image: png(16, 16), frameSize: 16, frames: 1 };

    beforeEach(() => {
        made = 0;
        sizes.clear();
        sizes.set(STAND.image, { width: 64, height: 16 });
        sizes.set(WORK.image, { width: 32, height: 16 });
        sizes.set(NEW_STAND.image, { width: 16, height: 16 });
        Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, 'Image');
        forgetUnusedImages();
    });

    test('a preview of a figure being changed keeps its own images, so the pets on the canvas keep theirs', () => {
        const kept = sprite('cat');
        savePetSprite(kept);
        const preview = previewSpriteOf('cat', { stand: NEW_STAND })!;
        expect(preview.id).not.toBe(kept.id);

        const onCanvas = spriteImage(kept, 'stand')!.image;
        const inDialog = spriteImage(preview, 'stand')!.image;
        // Beat after beat, each finds the image it made: nothing is made again and neither waits on a decode.
        for (let beat = 0; beat < 4; beat++) {
            expect(spriteImage(kept, 'stand')!.image).toBe(onCanvas);
            expect(spriteImage(preview, 'stand')!.image).toBe(inDialog);
        }
        expect(made).toBe(2);
    });

    test('the images of a preview go once the dialog closes, and those of a kept figure stay', () => {
        const kept = sprite('cat');
        savePetSprite(kept);
        const onCanvas = spriteImage(kept, 'stand')!.image;
        spriteImage(previewSpriteOf('cat', { stand: NEW_STAND })!, 'stand');
        forgetUnusedImages();
        expect(spriteImage(kept, 'stand')!.image).toBe(onCanvas);
        expect(made).toBe(2);
        spriteImage(previewSpriteOf('cat', { stand: NEW_STAND })!, 'stand');
        expect(made).toBe(3);
    });

    test('a strip of its own that decodes to another size than it says gives way to the standing one', () => {
        const cat = sprite('cat', { work: WORK });
        expect(spriteImage(cat, 'work')).toMatchObject({ pose: 'work', strip: WORK });
        sizes.set(WORK.image, { width: 48, height: 16 });
        const lying = sprite('liar', { work: WORK });
        expect(spriteImage(lying, 'work')).toMatchObject({ pose: 'stand', strip: lying });
        // A standing strip that does not fit has nothing to give way to.
        sizes.set(STAND.image, { width: 8, height: 8 });
        expect(spriteImage(sprite('broken'), 'stand')).toBeNull();
    });

    test('a pet whose own strip gave way to the standing one plays every frame of that one', () => {
        const still: PetStrip = { image: png(16, 16), frameSize: 16, frames: 1 };
        sizes.set(still.image, { width: 48, height: 16 });
        const look: PetLook = { kind: 'sheet', sprite: sprite('liar', { work: still }) };
        const keys = new Set([0, 1, 2, 3].map((frame) => drawnFrameKey(look, { pose: 'work', frame, lift: 0, bubble: false })));
        expect(keys.size).toBe(STAND.frames);
    });
});
