import type { SkillDisk, SkillFiles } from './skill-disk.ts';

/* A skill disk held in memory: every file by its whole path, and which kinds of writes fail. */
export class MemorySkillDisk implements SkillDisk {
    readonly files = new Map<string, string>();
    readonly failing = new Set<'replaceFolder' | 'writeText' | 'remove'>();

    /* The files of one folder by their path inside it, as `readFolder` answers them. */
    folder(path: string): Record<string, string> {
        const prefix = `${path}/`;

        return Object.fromEntries([...this.files].flatMap(([file, text]) => (file.startsWith(prefix) ? [[file.slice(prefix.length), text]] : [])));
    }

    async readFolder(path: string): Promise<SkillFiles | null> {
        const files = this.folder(path);

        return Object.keys(files).length === 0 ? null : files;
    }

    async readText(path: string): Promise<string | null> {
        return this.files.get(path) ?? null;
    }

    async replaceFolder(path: string, files: SkillFiles): Promise<void> {
        this.fail('replaceFolder');
        this.drop(path);

        for (const [name, text] of Object.entries(files)) {
            this.files.set(`${path}/${name}`, text);
        }
    }

    async writeText(path: string, text: string): Promise<void> {
        this.fail('writeText');
        this.files.set(path, text);
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
        for (const file of [...this.files.keys()]) {
            if (file === path || file.startsWith(`${path}/`)) {
                this.files.delete(file);
            }
        }
    }
}
