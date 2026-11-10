import { CodedError } from '@adecore/agents';
import { ActionRegistry, type ActionHandlers, type ActionName } from '@ruimte/actions';
import type { ServerActionContext } from './context.ts';
import { checkProjectRevision } from './revision.ts';

export type ServerActions = ActionRegistry<ServerActionContext>;

/* What a feature gives the registry: the handlers of its actions, and which of them preview. */
interface ActionSource {
    readonly actions?: ActionHandlers<ServerActionContext>;
    readonly previews?: readonly ActionName[];
}

/*
 * What the daemon itself carries out, on the project file rather than on a client's stores. A client
 * has its own handlers for the same actions; an agent's tool call lands here. The wiring makes one
 * from the agent features and the `CanvasHost` carries it, so no module reaches the registry by importing it.
 */
export function createServerActions(sources: readonly ActionSource[]): ServerActions {
    return new ActionRegistry<ServerActionContext>(Object.assign({}, ...sources.map((source) => source.actions ?? {})), {
        previews: sources.flatMap((source) => source.previews ?? []),
        checkRevision: checkProjectRevision,
        // Every refusal the daemon raises is coded, with what to pick instead as its lines.
        refusalOf: (error) => (error instanceof CodedError ? { code: error.code, message: error.message, details: error.lines } : null)
    });
}
