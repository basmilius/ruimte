import { provideClientActions } from '@/action-port/perform';
import { createClientActionRegistry } from '@/actions/client-actions';
import { useDocument } from '@/state/document';

/* The app loads its registry with the first action; a test has it from the start, so no click waits on an import. */
export const clientActions = createClientActionRegistry(useDocument);

provideClientActions(clientActions);
