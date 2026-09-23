import { ActionRegistry } from '@ruimte/actions';
import { CodedError } from '../coded-error.ts';
import type { ServerActionContext } from './context.ts';
import { linkActions } from './link-actions.ts';
import { nodeActions } from './node-actions.ts';
import { viewActions } from './view-actions.ts';

/*
 * What the daemon itself carries out, on the project file rather than on a client's stores. A client
 * has its own handlers for the same actions; an agent's `ruimte-context` call lands here.
 */
export const serverActions = new ActionRegistry<ServerActionContext>(
    { ...viewActions, ...nodeActions, ...linkActions },
    {
        previews: ['node.create'],
        // Every refusal the daemon raises is coded, with what to pick instead as its lines.
        refusalOf: (error) => (error instanceof CodedError ? { code: error.code, message: error.message, details: error.lines } : null)
    }
);
