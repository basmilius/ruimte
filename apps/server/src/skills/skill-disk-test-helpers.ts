import { join, sep } from 'node:path';
import type { SkillDisk, SkillFiles } from './skill-disk.ts';

/*
 * A skill disk held in memory: every file by its whole path, and which kinds of writes fail. Paths are
 * this platform's, as on the real disk, and only the names inside a folder use slashes.
 */
export class MemorySkillDisk implements SkillDisk {
    readonly files = new Map<string, string>();
    readonly failing = new Set<'replaceFolder' | 'writeText' | 'remove'>();

    /* The files of one folder by their path inside it, as `readFolder` answers them. */
    folder(path: string): Record<string, string> {
        const prefix = `${join(path)}${sep}`;

        return Object.fromEntries(
            [...this.files].flatMap(([file, text]) => (file.startsWith(prefix) ? [[file.slice(prefix.length).split(sep).join('/'), text]] : []))
        );
    }

    async readFolder(path: string): Promise<SkillFiles | null> {
        const files = this.folder(path);

        return Object.keys(files).length === 0 ? null : files;
    }

    async readText(path: string): Promise<string | null> {
        return this.files.get(join(path)) ?? null;
    }

    async replaceFolder(path: string, files: SkillFiles): Promise<void> {
        this.fail('replaceFolder');
        this.drop(path);

        for (const [name, text] of Object.entries(files)) {
            this.files.set(join(path, ...name.split('/')), text);
        }
    }

    async writeText(path: string, text: string): Promise<void> {
        this.fail('writeText');
        this.files.set(join(path), text);
    }

    async remove(path: string): Promise<void> {
        this.fail('remove');
        this.drop(path);
    }

    private fail(kind: 'replaceFolder' | 'writeText' | 'remove'): void {
        if (this.failing.has(kind)) {
            throw new Error(`${kind} fails on this disk`);
        }
    }

    private drop(path: string): void {
        const folder = join(path);

        for (const file of [...this.files.keys()]) {
            if (file === folder || file.startsWith(`${folder}${sep}`)) {
                this.files.delete(file);
            }
        }
    }
}
