import { designPlaces, freeSlug, type ProjectView } from '@ruimte/contracts';

/*
 * The name of the folder a new design keeps its files in: one no other design of the project has and
 * none that is there on disk on either side, which a removed design leaves behind, so a new design never
 * opens on another's files.
 */
export function freeDesignFolder(views: readonly ProjectView[], name: string, onDisk: readonly string[] = []): string {
    const taken = new Set([...designPlaces(views).map((design) => design.path), ...onDisk]);
    return freeSlug(name, 'design', taken);
}
