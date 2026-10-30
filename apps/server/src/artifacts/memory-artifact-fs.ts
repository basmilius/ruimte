import { dirname } from 'node:path';
import { sha256, type ArtifactFs, type FileDigest } from './artifact-fs.ts';

function coded(code: string): Error {
    return Object.assign(new Error(code), { code });
}

// The store joins with the platform's separator; this disk keeps one form, so a test reads the same everywhere.
function slashed(path: string): string {
    return path.replaceAll('\\', '/');
}

/*
 * A disk in memory for the store's tests: what a stop between two steps leaves is what `fail` makes
 * the step throw, and a full disk is a `volume` with no room or a write that throws ENOSPC.
 */
export class MemoryArtifactFs implements ArtifactFs {
    readonly files = new Map<string, Uint8Array>();
    readonly folders = new Set<string>(['/']);
    space: { free: number; size: number } | null = { free: 1024 * 1024 * 1024 * 1024, size: 2048 * 1024 * 1024 * 1024 };
    /* Throws what it answers before the step runs; null lets the step through. */
    fail: (step: keyof ArtifactFs, path: string) => Error | null = () => null;

    put(path: string, content: string | Uint8Array): void {
        path = slashed(path);
        this.mkdirNow(dirname(path));
        this.files.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
    }

    async mkdir(path: string): Promise<void> {
        path = slashed(path);
        this.check('mkdir', path);
        this.mkdirNow(path);
    }

    async list(path: string): Promise<string[]> {
        path = slashed(path);
        this.check('list', path);
        const prefix = path.endsWith('/') ? path : `${path}/`;
        const names = new Set<string>();
        for (const entry of [...this.folders, ...this.files.keys()]) {
            if (entry.startsWith(prefix) && entry !== prefix) {
                names.add(entry.slice(prefix.length).split('/')[0]!);
            }
        }
        return [...names];
    }

    async readText(path: string): Promise<string | null> {
        path = slashed(path);
        this.check('readText', path);
        const bytes = this.files.get(path);
        return bytes === undefined ? null : new TextDecoder().decode(bytes);
    }

    async writeDurable(path: string, text: string): Promise<void> {
        path = slashed(path);
        this.check('writeDurable', path);
        this.requireFolder(dirname(path));
        this.files.set(path, new TextEncoder().encode(text));
    }

    async append(path: string, bytes: Uint8Array): Promise<void> {
        path = slashed(path);
        this.check('append', path);
        this.requireFolder(dirname(path));
        const before = this.files.get(path) ?? new Uint8Array();
        const next = new Uint8Array(before.byteLength + bytes.byteLength);
        next.set(before);
        next.set(bytes, before.byteLength);
        this.files.set(path, next);
    }

    async sizeOf(path: string): Promise<number | null> {
        path = slashed(path);
        this.check('sizeOf', path);
        return this.files.get(path)?.byteLength ?? null;
    }

    async copyIn(from: string, to: string): Promise<FileDigest> {
        from = slashed(from);
        to = slashed(to);
        this.check('copyIn', to);
        const bytes = this.files.get(from);
        if (bytes === undefined) {
            throw coded('ENOENT');
        }
        if (this.files.has(to)) {
            throw coded('EEXIST');
        }
        this.requireFolder(dirname(to));
        this.files.set(to, bytes.slice());
        return { size: bytes.byteLength, sha256: sha256(bytes) };
    }

    async digest(path: string): Promise<FileDigest> {
        path = slashed(path);
        this.check('digest', path);
        const bytes = this.files.get(path);
        if (bytes === undefined) {
            throw coded('ENOENT');
        }
        return { size: bytes.byteLength, sha256: sha256(bytes) };
    }

    async readHead(path: string, length: number): Promise<Uint8Array> {
        path = slashed(path);
        this.check('readHead', path);
        return (this.files.get(path) ?? new Uint8Array()).slice(0, length);
    }

    async readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
        path = slashed(path);
        this.check('readRange', path);
        return (this.files.get(path) ?? new Uint8Array()).slice(offset, offset + length);
    }

    async syncFile(path: string): Promise<void> {
        path = slashed(path);
        this.check('syncFile', path);
    }

    async syncDir(path: string): Promise<void> {
        path = slashed(path);
        this.check('syncDir', path);
    }

    async rename(from: string, to: string): Promise<void> {
        from = slashed(from);
        to = slashed(to);
        this.check('rename', from);
        if (this.files.has(to) || this.folders.has(to)) {
            throw coded('EEXIST');
        }
        this.requireFolder(dirname(to));
        if (this.files.has(from)) {
            this.files.set(to, this.files.get(from)!);
            this.files.delete(from);
            return;
        }
        if (!this.folders.has(from)) {
            throw coded('ENOENT');
        }
        const move = (entry: string): string | null => (entry === from ? to : entry.startsWith(`${from}/`) ? `${to}${entry.slice(from.length)}` : null);
        for (const folder of [...this.folders]) {
            const moved = move(folder);
            if (moved !== null) {
                this.folders.delete(folder);
                this.folders.add(moved);
            }
        }
        for (const [file, bytes] of [...this.files]) {
            const moved = move(file);
            if (moved !== null) {
                this.files.delete(file);
                this.files.set(moved, bytes);
            }
        }
    }

    async remove(path: string): Promise<void> {
        path = slashed(path);
        this.check('remove', path);
        for (const folder of [...this.folders]) {
            if (folder === path || folder.startsWith(`${path}/`)) {
                this.folders.delete(folder);
            }
        }
        for (const file of [...this.files.keys()]) {
            if (file === path || file.startsWith(`${path}/`)) {
                this.files.delete(file);
            }
        }
    }

    async volume(path: string): Promise<{ free: number; size: number } | null> {
        this.check('volume', path);
        return this.space;
    }

    private check(step: keyof ArtifactFs, path: string): void {
        const error = this.fail(step, path);
        if (error !== null) {
            throw error;
        }
    }

    private mkdirNow(path: string): void {
        for (let current = path; current !== '/' && !this.folders.has(current); current = dirname(current)) {
            this.folders.add(current);
        }
    }

    private requireFolder(path: string): void {
        if (!this.folders.has(path)) {
            throw coded('ENOENT');
        }
    }
}

export function diskFull(): Error {
    return coded('ENOSPC');
}
