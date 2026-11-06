import { extensionPermissionProblems } from './extension-permissions.ts';
import { clashingPackPath, EXTENSION_API_VERSION, ExtensionManifestSchema, ExtensionPackSchema, isSafePackPath, type ExtensionManifest } from './extension.ts';

export type ExtensionPackProblemCode = 'pack-unreadable' | 'pack-manifest' | 'pack-api' | 'pack-path';

export interface ExtensionPackProblem {
    code: ExtensionPackProblemCode;
    message: string;
}

/* The gunzip of the runtime that reads the pack: Node's `gunzipSync`, a browser's `DecompressionStream`. */
export type PackGunzip = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

export type ExtensionPackReading =
    | {
          ok: true;
          manifest: ExtensionManifest;
          // Every file of the pack by its path, in base64 as the pack holds it.
          files: Readonly<Record<string, string>>;
      }
    | ({ ok: false } & ExtensionPackProblem);

/*
 * What a manifest must meet wherever it comes from: the API version of this Ruimte, and permissions it knows. Refused
 * when it comes in, never when it loads, so one already installed keeps working on a Ruimte that knows less.
 */
export function extensionManifestProblem(manifest: ExtensionManifest, subject: string = manifest.id): ExtensionPackProblem | null {
    if (manifest.api !== EXTENSION_API_VERSION) {
        return { code: 'pack-api', message: `${subject} needs API ${manifest.api}; this Ruimte has ${EXTENSION_API_VERSION}` };
    }

    const problems = extensionPermissionProblems(manifest.permissions);

    return problems.length > 0 ? { code: 'pack-manifest', message: `${subject}: ${problems.join('; ')}` } : null;
}

function utf8Of(base64: string): string {
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

const UNREADABLE: ExtensionPackReading = { ok: false, code: 'pack-unreadable', message: 'This is not an extension pack' };

function readUnzipped(unzipped: Uint8Array): ExtensionPackReading {
    let parsed: unknown;

    try {
        parsed = JSON.parse(new TextDecoder().decode(unzipped));
    } catch {
        return UNREADABLE;
    }

    const pack = ExtensionPackSchema.safeParse(parsed);

    if (!pack.success) {
        return UNREADABLE;
    }

    const outside = Object.keys(pack.data.files).find((path) => !isSafePackPath(path));

    if (outside !== undefined) {
        return { ok: false, code: 'pack-path', message: `The pack names a path outside itself: ${outside}` };
    }

    const clash = clashingPackPath(Object.keys(pack.data.files));

    if (clash !== null) {
        return { ok: false, code: 'pack-path', message: `The pack names ${clash} twice, in another case` };
    }

    const raw = pack.data.files['manifest.json'];
    let json: unknown;

    try {
        json = raw === undefined ? undefined : JSON.parse(utf8Of(raw));
    } catch {
        json = undefined;
    }

    const manifest = ExtensionManifestSchema.safeParse(json);

    if (!manifest.success) {
        return { ok: false, code: 'pack-manifest', message: 'The pack has no valid manifest.json' };
    }

    const problem = extensionManifestProblem(manifest.data);

    return problem === null ? { ok: true, manifest: manifest.data, files: pack.data.files } : { ok: false, ...problem };
}

/*
 * A `.rex` read whole before anything of it is used or written: gunzip, the JSON of the pack, paths that stay inside
 * their folder, a valid `manifest.json`, and the checks of `extensionManifestProblem`. A gunzip that answers at once
 * gives the reading at once, so a caller that queues its change after it keeps its place in line.
 */
export function readExtensionPack(bytes: Uint8Array, gunzip: (bytes: Uint8Array) => Uint8Array): ExtensionPackReading;
export function readExtensionPack(bytes: Uint8Array, gunzip: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<ExtensionPackReading>;
export function readExtensionPack(bytes: Uint8Array, gunzip: PackGunzip): ExtensionPackReading | Promise<ExtensionPackReading> {
    try {
        const unzipped = gunzip(bytes);

        return unzipped instanceof Uint8Array ? readUnzipped(unzipped) : unzipped.then(readUnzipped, () => UNREADABLE);
    } catch {
        return UNREADABLE;
    }
}
