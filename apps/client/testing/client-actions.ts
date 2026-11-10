import { provideClientActions } from '@/action-port/perform';
import { createClientActionRegistry } from '@/actions/client-actions';
import { useDocument } from '@/state/document';

/*
 * The app loads its registry with the workspace. A unit test of the actions themselves imports this to have it at
 * once; no run preloads it, so a window loads it the way a person's does.
 */
export const clientActions = createClientActionRegistry(useDocument);

provideClientActions(clientActions);
