import { installWorkspaceRegistries } from '@/wiring/workspace-registries';
import { installWorkspaceSurfaces } from '@/wiring/workspace-surfaces';

/*
 * What only a workspace needs, wired when its chunk loads (`App.tsx`), in the DOM tests too: the start
 * screen never imports it, so it stays out of the entry chunk.
 */
export function installWorkspace(): void {
    installWorkspaceRegistries();
    installWorkspaceSurfaces();
}
