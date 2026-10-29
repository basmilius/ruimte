import { isPathBelow } from '@ruimte/contracts';

/* A directory change invalidates its descendants; old or incomplete events invalidate every reader. */
export function pathAffected(path: string, changedPaths: readonly string[] | undefined): boolean {
    return changedPaths === undefined || changedPaths.some((changed) => changed === path || isPathBelow(changed, path));
}
