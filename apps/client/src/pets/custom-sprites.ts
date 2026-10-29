import { create } from 'zustand';
import { z } from 'zod';
import { PET_POSES, type PetPose } from '@/pets/pixel';
import { onPetSpritesChanged, PET_SPRITES_STORAGE_KEY } from '@/pets/sprites-key';
import { storedJson } from '@/state/stored-json';

/*
 * The bounds of a sprite a person adds. It lives in this client's storage beside the settings, which
 * every window of the app shares and which holds a few megabytes at most, so a sprite stays small, and
 * all strips together take no more than eight strips of the largest size.
 */
export const SHEET_LIMITS = { bytes: 64 * 1024, minFrame: 8, maxFrame: 256, maxFrames: 16, maxSprites: 8, nameLength: 40, allBytes: 8 * 64 * 1024 } as const;

/* Raster images only: an SVG can carry script and links, and a strip of pixel art needs neither. */
export const SHEET_TYPES = ['image/png', 'image/webp'] as const;

// What a stored image may start with, so a hand-edited key can still only ever hand an <img> a PNG or a WebP.
const DATA_URL = /^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/* A strip of square frames, left to right, played in a loop. See `README.md` beside this file. */
export interface PetStrip {
    /* The image itself, as a data URL, so nothing is read from disk again. */
    image: string;
    frameSize: number;
    frames: number;
}

/* Every state but standing, whose strip is the sprite's own. */
export type StripPose = Exclude<PetPose, 'stand'>;

/*
 * A figure a person added. Its own strip is the one it stands in, which every state without a strip of
 * its own plays, so a client from before strips per state reads it as the one strip it knew.
 */
export interface CustomPetSprite extends PetStrip {
    id: string;
    name: string;
    strips?: Partial<Record<StripPose, PetStrip>>;
}

export type SheetProblem = 'type' | 'bytes' | 'unreadable' | 'frame-small' | 'frame-large' | 'frames-whole' | 'frames-many' | 'full' | 'room' | 'storage';

/* The states with a strip of their own to give, in the order a person reads them. */
export const STRIP_POSES = PET_POSES.filter((pose): pose is StripPose => pose !== 'stand');

const StripSchema = z.object({
    image: z.string().regex(DATA_URL),
    frameSize: z.number().int().min(SHEET_LIMITS.minFrame).max(SHEET_LIMITS.maxFrame),
    frames: z.number().int().min(1).max(SHEET_LIMITS.maxFrames)
});

const SpriteSchema = StripSchema.extend({
    id: z.string().min(1),
    name: z.string(),
    // Strips this version cannot read are left out, and the figure stands in its own strip alone.
    strips: z.record(z.string(), z.unknown()).optional().catch(undefined)
});

/* What the bytes of an image say about it, read from its own header rather than from its name or what was stored beside it. */
export interface ImageFacts {
    type: 'png' | 'webp';
    bytes: number;
    width: number;
    height: number;
}

// The header of a PNG ends its size at byte 24, of a WebP at byte 30: forty characters of base64 hold both.
const HEAD_CHARACTERS = 40;

function little(head: string, at: number, length: number): number {
    let value = 0;
    for (let i = length - 1; i >= 0; i--) {
        value = value * 256 + head.charCodeAt(at + i);
    }
    return value;
}

function big(head: string, at: number): number {
    return little([...head.slice(at, at + 4)].reverse().join(''), 0, 4);
}

/*
 * The type, length and size of the image in a data URL, from its signature and its header, so a renamed
 * SVG or HTML file never gets in and a stored size cannot claim what the bytes are not. Null for
 * anything that is not a PNG or a WebP whose header reads.
 */
export function imageFacts(dataUrl: string): ImageFacts | null {
    const match = DATA_URL.exec(dataUrl);
    if (match === null) {
        return null;
    }
    const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = (payload.length / 4) * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
    let head: string;
    try {
        head = atob(payload.slice(0, Math.min(payload.length, HEAD_CHARACTERS)));
    } catch {
        return null;
    }
    if (match[1] === 'png') {
        if (!head.startsWith('\x89PNG\r\n\x1a\n') || head.slice(12, 16) !== 'IHDR' || head.length < 24) {
            return null;
        }
        return { type: 'png', bytes, width: big(head, 16), height: big(head, 20) };
    }
    if (!head.startsWith('RIFF') || head.slice(8, 12) !== 'WEBP' || head.length < 30) {
        return null;
    }
    const chunk = head.slice(12, 16);
    if (chunk === 'VP8X') {
        return { type: 'webp', bytes, width: little(head, 24, 3) + 1, height: little(head, 27, 3) + 1 };
    }
    if (chunk === 'VP8L' && head.charCodeAt(20) === 0x2f) {
        const bits = little(head, 21, 4);
        return { type: 'webp', bytes, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ' && head.slice(23, 26) === '\x9d\x01\x2a') {
        return { type: 'webp', bytes, width: little(head, 26, 2) & 0x3fff, height: little(head, 28, 2) & 0x3fff };
    }
    return null;
}

/*
 * A stored strip only when it is one an import would take now: a PNG or a WebP by its bytes, within the
 * byte limit, and cut the way it says it is. A hand-edited key gets nothing past this to an `<img>`.
 */
export function storedStripOf(entry: unknown): PetStrip | null {
    const strip = StripSchema.safeParse(entry).data;
    const facts = strip === undefined ? null : imageFacts(strip.image);
    if (strip === undefined || facts === null || facts.bytes > SHEET_LIMITS.bytes) {
        return null;
    }
    const layout = sheetLayout(facts.width, facts.height);
    if ('problem' in layout || layout.frameSize !== strip.frameSize || layout.frames !== strip.frames) {
        return null;
    }
    return { image: strip.image, frameSize: strip.frameSize, frames: strip.frames };
}

/*
 * A stored sprite only when its own strip passes. A strip of another state that does not pass drops
 * out alone, and that state plays the standing strip again; a state this version does not know is left out.
 */
export function storedSpriteOf(entry: unknown): CustomPetSprite | null {
    const sprite = SpriteSchema.safeParse(entry).data;
    const own = sprite === undefined ? null : storedStripOf(sprite);
    if (sprite === undefined || own === null) {
        return null;
    }
    const strips: Partial<Record<StripPose, PetStrip>> = {};
    for (const pose of STRIP_POSES) {
        const strip = sprite.strips?.[pose] === undefined ? null : storedStripOf(sprite.strips[pose]);
        if (strip !== null) {
            strips[pose] = strip;
        }
    }
    return { id: sprite.id, name: sprite.name.slice(0, SHEET_LIMITS.nameLength), ...own, ...(Object.keys(strips).length > 0 && { strips }) };
}

/* The bytes every strip of a sprite takes, as an import counts them. */
export function spriteBytes(sprite: CustomPetSprite): number {
    return [sprite, ...Object.values(sprite.strips ?? {})].reduce((sum, strip) => sum + (imageFacts(strip.image)?.bytes ?? 0), 0);
}

/* The sprites that pass, each id once, as many as may be kept and no larger together than an import allows: one that does not pass drops out alone. */
function keptSprites(entries: readonly unknown[]): CustomPetSprite[] {
    const kept: CustomPetSprite[] = [];
    let bytes = 0;
    for (const entry of entries) {
        const sprite = storedSpriteOf(entry);
        const size = sprite === null ? 0 : spriteBytes(sprite);
        // A second figure under an id already kept would be one choice twice, and removing one would remove both.
        if (sprite === null || kept.some((each) => each.id === sprite.id) || kept.length >= SHEET_LIMITS.maxSprites || bytes + size > SHEET_LIMITS.allBytes) {
            continue;
        }
        kept.push(sprite);
        bytes += size;
    }
    return kept;
}

const storedSprites = storedJson<CustomPetSprite[]>(PET_SPRITES_STORAGE_KEY, z.array(z.unknown()).transform(keptSprites));

/* The strip a state plays: its own, or the one the sprite stands in. */
export function stripFor(sprite: CustomPetSprite, pose: PetPose): { pose: PetPose; strip: PetStrip } {
    const own = pose === 'stand' ? undefined : sprite.strips?.[pose];
    return own === undefined ? { pose: 'stand', strip: sprite } : { pose, strip: own };
}

/* How a sheet of this size is cut: square frames as high as the image, as many as fit across it. */
export function sheetLayout(width: number, height: number): { frameSize: number; frames: number } | { problem: SheetProblem } {
    if (height < SHEET_LIMITS.minFrame) {
        return { problem: 'frame-small' };
    }
    if (height > SHEET_LIMITS.maxFrame) {
        return { problem: 'frame-large' };
    }
    if (width % height !== 0 || width === 0) {
        return { problem: 'frames-whole' };
    }
    const frames = width / height;
    if (frames > SHEET_LIMITS.maxFrames) {
        return { problem: 'frames-many' };
    }
    return { frameSize: height, frames };
}

interface PetSpritesStore {
    sprites: CustomPetSprite[];
    /* Adds a sprite, or puts it in the place of the one with its id. False when the storage refused it, which keeps nothing. */
    put(sprite: CustomPetSprite): boolean;
    remove(id: string): void;
    /* Reads what another window wrote. */
    reload(): void;
}

export const usePetSprites = create<PetSpritesStore>((set, get) => ({
    sprites: storedSprites.read() ?? [],
    put(sprite) {
        const sprites = get().sprites;
        const next = sprites.some((each) => each.id === sprite.id) ? sprites.map((each) => (each.id === sprite.id ? sprite : each)) : [...sprites, sprite];
        if (!storedSprites.write(next)) {
            return false;
        }
        forgetImages(next);
        set({ sprites: next });
        return true;
    },
    remove(id) {
        const next = get().sprites.filter((sprite) => sprite.id !== id);
        storedSprites.write(next);
        forgetImages(next);
        set({ sprites: next });
    },
    reload() {
        const next = storedSprites.read() ?? [];
        forgetImages(next);
        set({ sprites: next });
    }
}));

onPetSpritesChanged(() => usePetSprites.getState().reload());

export interface SheetFile {
    name: string;
    type: string;
    size: number;
}

export interface SheetReader {
    dataUrl(file: SheetFile): Promise<string>;
    size(dataUrl: string): Promise<{ width: number; height: number }>;
}

/*
 * Checks a file a person picked for a state. Only the file the system's open panel hands over is read,
 * never a folder, so the feature needs no access to anything else on the computer. Nothing is kept
 * until the sprite is saved.
 */
export async function readPetStrip(file: SheetFile, reader: SheetReader): Promise<{ strip: PetStrip } | { problem: SheetProblem }> {
    if (!(SHEET_TYPES as readonly string[]).includes(file.type)) {
        return { problem: 'type' };
    }
    if (file.size > SHEET_LIMITS.bytes) {
        return { problem: 'bytes' };
    }
    let image: string;
    let facts: ImageFacts | null;
    try {
        image = await reader.dataUrl(file);
        facts = imageFacts(image);
    } catch {
        return { problem: 'unreadable' };
    }
    if (facts === null) {
        return { problem: 'unreadable' };
    }
    if (facts.bytes > SHEET_LIMITS.bytes) {
        return { problem: 'bytes' };
    }
    // The size in the header is checked before anything decodes, so a small file that claims a huge image is never drawn out.
    const layout = sheetLayout(facts.width, facts.height);
    if ('problem' in layout) {
        return layout;
    }
    try {
        // The browser decodes it too, so a header that lies about the rest of the file is caught here.
        const decoded = await reader.size(image);
        if (decoded.width !== facts.width || decoded.height !== facts.height) {
            return { problem: 'unreadable' };
        }
    } catch {
        return { problem: 'unreadable' };
    }
    return { strip: { image, ...layout } };
}

/* The strips a person gave in the dialog, one per state, standing among them. */
export type PetStrips = Partial<Record<PetPose, PetStrip>>;

/* A sprite's strips by state, to start the dialog from. */
export function stripsOf(sprite: CustomPetSprite): PetStrips {
    return { stand: { image: sprite.image, frameSize: sprite.frameSize, frames: sprite.frames }, ...sprite.strips };
}

/*
 * The sprite a dialog previews, under an id of its own: while a figure is changed, its pets on the canvas
 * play the strips it has and the preview the ones it is getting, and neither takes the other's images.
 */
export function previewSpriteOf(id: string, strips: PetStrips): CustomPetSprite | null {
    return spriteOf(`${id}:preview`, '', strips);
}

/* The sprite the dialog's strips make, or null while it has none to stand in. */
export function spriteOf(id: string, name: string, strips: PetStrips): CustomPetSprite | null {
    const { stand, ...others } = strips;
    if (stand === undefined) {
        return null;
    }
    const kept = Object.fromEntries(STRIP_POSES.flatMap((pose) => (others[pose] === undefined ? [] : [[pose, others[pose]]])));
    return { id, name: name.trim().slice(0, SHEET_LIMITS.nameLength), ...stand, ...(Object.keys(kept).length > 0 && { strips: kept }) };
}

/*
 * Keeps a sprite a person made or changed. The limits are asked here, at the last moment, since another
 * window, or a second dialog in this one, may have taken the last place or the room while it was open.
 */
export function savePetSprite(sprite: CustomPetSprite): { sprite: CustomPetSprite } | { problem: SheetProblem } {
    const others = usePetSprites.getState().sprites.filter((each) => each.id !== sprite.id);
    if (others.length >= SHEET_LIMITS.maxSprites) {
        return { problem: 'full' };
    }
    if (others.reduce((sum, each) => sum + spriteBytes(each), spriteBytes(sprite)) > SHEET_LIMITS.allBytes) {
        return { problem: 'room' };
    }
    return usePetSprites.getState().put(sprite) ? { sprite } : { problem: 'storage' };
}

/* The browser's own reading of a picked file and of the image in it. */
export const browserSheetReader: SheetReader = {
    dataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')));
            reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
            reader.readAsDataURL(file as File);
        });
    },
    async size(dataUrl) {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
    }
};

// Per sprite and state, since a state without a strip of its own shares the one its sprite stands in.
const images = new Map<string, HTMLImageElement>();

function imageKey(id: string, pose: PetPose): string {
    return `${id}:${pose}`;
}

/* Lets go of the images of sprites and strips that went, and of one whose image another window replaced. */
function forgetImages(kept: readonly CustomPetSprite[]): void {
    const keep = new Map<string, string>();
    for (const sprite of kept) {
        for (const [pose, strip] of Object.entries(stripsOf(sprite))) {
            keep.set(imageKey(sprite.id, pose as PetPose), strip.image);
        }
    }
    for (const [key, image] of images) {
        if (keep.get(key) !== image.src) {
            images.delete(key);
        }
    }
}

/* Lets go of the images no kept sprite plays, such as the previews of a dialog that closed. */
export function forgetUnusedImages(): void {
    forgetImages(usePetSprites.getState().sprites);
}

function imageOf(id: string, pose: PetPose, strip: PetStrip): { image: HTMLImageElement } | 'decoding' | 'broken' {
    const key = imageKey(id, pose);
    let image = images.get(key);
    if (image === undefined || image.src !== strip.image) {
        image = new Image();
        image.src = strip.image;
        images.set(key, image);
    }
    if (!image.complete) {
        return 'decoding';
    }
    return image.naturalWidth === strip.frameSize * strip.frames && image.naturalHeight === strip.frameSize ? { image } : 'broken';
}

/*
 * The decoded image a sprite plays in a state and the strip it is, once per page for each image it had;
 * null while it still decodes, when what decoded is not the size the strip says, or when the page has no
 * images. A strip of its own that decoded to another size gives way to the standing one, so the pet
 * does not vanish in that state.
 */
export function spriteImage(sprite: CustomPetSprite, pose: PetPose): { image: HTMLImageElement; pose: PetPose; strip: PetStrip } | null {
    if (typeof Image === 'undefined') {
        return null;
    }
    const played = stripFor(sprite, pose);
    const decoded = imageOf(sprite.id, played.pose, played.strip);
    if (decoded === 'broken' && played.pose !== 'stand') {
        const standing = imageOf(sprite.id, 'stand', sprite);
        return typeof standing === 'object' ? { image: standing.image, pose: 'stand', strip: sprite } : null;
    }
    return typeof decoded === 'object' ? { image: decoded.image, ...played } : null;
}
