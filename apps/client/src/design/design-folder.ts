import { designPlaces, type ProjectView } from '@ruimte/contracts';

/* The two places design folders live, relative to the project folder: one person's, and the team's. */
export const DESIGN_FOLDERS = ['.ruimte/private/designs', '.ruimte/designs'] as const;

/* A folder name a person reads back in a path: the name in lowercase words joined by dashes. */
export function designSlug(name: string): string {
    const slug = name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug === '' ? 'design' : slug;
}

/*
 * The name of the folder a new design keeps its files in: one no other design of the project has and
 * none that is there on disk on either side, which a removed design leaves behind, so a new design never
 * opens on another's files.
 */
export function freeDesignFolder(views: readonly ProjectView[], name: string, onDisk: readonly string[] = []): string {
    const taken = new Set([...designPlaces(views).map((design) => design.path), ...onDisk]);
    const base = designSlug(name);

    if (!taken.has(base)) {
        return base;
    }

    let number = 2;

    while (taken.has(`${base}-${number}`)) {
        number++;
    }

    return `${base}-${number}`;
}
