import type { ActionCall } from '@ruimte/actions';
import type { CanvasHost, VerbCall } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';

export interface ServerActionContext {
    host: CanvasHost;
    /* Where the caller stands, looked up by its id before the action runs: project, folder and canvas. */
    place: IndexedPlace;
}

export type ServerActionCall = ActionCall<ServerActionContext>;

/* Whoever calls the daemon's actions is a session or a chat of a project, so the actor is an agent under that id. */
export const serverActionCall = (host: CanvasHost, place: IndexedPlace, caller: string, dryRun = false): ServerActionCall => ({
    actor: { kind: 'agent', id: caller },
    context: { host, place },
    dryRun
});

/* The caller in the shape the canvas helpers take, which ask who it is and who made what. */
export const verbCallOf = (call: ServerActionCall): VerbCall => ({ caller: call.actor.id, host: call.context.host });
