import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { ProjectSettingsSchema, type ProjectSettings } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';
import { PROJECT_DIR } from './project-files.ts';

export const SETTINGS_FILE = 'settings.json';

const settingsPath = (folder: string): string => join(folder, PROJECT_DIR, SETTINGS_FILE);

/* The file as an object, whatever keys it has; a file that is missing or not an object reads as empty. */
const readRaw = async (folder: string): Promise<Record<string, unknown>> => {
    let text: string;
    try {
        text = await readFile(settingsPath(folder), 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return {};
        }
        throw e;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
};

/* What the file says, field by field: a field that does not parse reads as absent rather than failing the whole file. */
export const readProjectSettings = async (folder: string): Promise<ProjectSettings> => {
    const raw = await readRaw(folder);
    const worktrees = ProjectSettingsSchema.shape.worktrees.safeParse(raw.worktrees);
    return worktrees.success && worktrees.data !== undefined ? { worktrees: worktrees.data } : {};
};

/*
 * A shared path as the settings keep it: relative to the project folder, with forward slashes and no
 * trailing one. Null for a path that leaves the folder or names the folder itself.
 */
export const sharedPathOf = (path: string): string | null => {
    const trimmed = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (trimmed === '' || isAbsolute(trimmed)) {
        return null;
    }
    const normalized = normalize(trimmed).replace(/\\/g, '/');
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('.git')) {
        return null;
    }
    return normalized;
};

const writes = new Map<string, Promise<unknown>>();

/*
 * Writes the fields a patch names and keeps every other key of the file, one write at a time per
 * folder so two clients never read the same file and drop each other's field.
 */
export const updateProjectSettings = (folder: string, patch: ProjectSettings): Promise<ProjectSettings> => {
    const next = (writes.get(folder) ?? Promise.resolve()).then(async () => {
        const raw = await readRaw(folder);
        if (patch.worktrees !== undefined) {
            const current = typeof raw.worktrees === 'object' && raw.worktrees !== null ? (raw.worktrees as Record<string, unknown>) : {};
            const share =
                patch.worktrees.share === undefined ? undefined : [...new Set(patch.worktrees.share.map(sharedPathOf).filter((path) => path !== null))];
            raw.worktrees = { ...current, ...(share === undefined ? {} : { share }) };
        }
        await mkdir(join(folder, PROJECT_DIR), { recursive: true });
        await writeAtomic(settingsPath(folder), `${JSON.stringify(raw, null, 4)}\n`, 0o644);
        return await readProjectSettings(folder);
    });
    writes.set(
        folder,
        next.catch(() => undefined)
    );
    return next;
};
