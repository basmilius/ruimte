import { provideClientActions } from '@/action-port/perform';
import { createClientActionRegistry } from '@/actions/client-actions';
import { useDocument } from '@/state/document';

/*
 * The app loads its registry with the workspace; a unit test has it from the start (`bunfig.toml`). The DOM run
 * leaves it to the app, so a window there loads it the way a person's does.
 */
export const clientActions = createClientActionRegistry(useDocument);

provideClientActions(clientActions);
