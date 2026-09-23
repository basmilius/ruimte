import { ActionRegistry } from '@ruimte/actions';
import { CodedError } from '../coded-error.ts';
import { agentActions } from './agent-actions.ts';
import { browserActions } from './browser-actions.ts';
import type { ServerActionContext } from './context.ts';
import { contextActions } from './context-actions.ts';
import { diagramActions } from './diagram-actions.ts';
import { linkActions } from './link-actions.ts';
import { nodeActions } from './node-actions.ts';
import { operationActions } from './operation-actions.ts';
import { planActions } from './plan-actions.ts';
import { checkProjectRevision } from './revision.ts';
import { startActions } from './start-actions.ts';
import { taskActions } from './task-actions.ts';
import { viewActions } from './view-actions.ts';
import { worktreeActions } from './worktree-actions.ts';

/*
 * What the daemon itself carries out, on the project file rather than on a client's stores. A client
 * has its own handlers for the same actions; an agent's `ruimte-context` call lands here.
 */
export const serverActions = new ActionRegistry<ServerActionContext>(
    {
        ...viewActions,
        ...nodeActions,
        ...linkActions,
        ...agentActions,
        ...startActions,
        ...operationActions,
        ...taskActions,
        ...planActions,
        ...diagramActions,
        ...browserActions,
        ...worktreeActions,
        ...contextActions
    },
    {
        previews: ['node.create', 'plan.create', 'agent.start', 'team.start'],
        checkRevision: checkProjectRevision,
        // Every refusal the daemon raises is coded, with what to pick instead as its lines.
        refusalOf: (error) => (error instanceof CodedError ? { code: error.code, message: error.message, details: error.lines } : null)
    }
);
