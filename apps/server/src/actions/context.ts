import type { ActionCall } from '@ruimte/actions';
import { VerbRefusal, type CanvasHost, type VerbCall } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';

export interface ServerActionContext {
    host: CanvasHost;
    /* Where the caller stands, looked up by its id before the action runs: project, folder and canvas. */
    place: IndexedPlace;
}

export type ServerActionCall = ActionCall<ServerActionContext>;

/*
 * The host an action writes through when the caller named a revision. Only the first write is held to
 * it, under the lock that write takes: every later one of the same action follows from the first.
 */
const heldTo = (host: CanvasHost, expected: number): CanvasHost => {
    let first = true;
    const held: CanvasHost = Object.create(host);
    held.mutate = (projectId, apply, expectedRev) => {
        const checked = first ? expected : expectedRev;
        first = false;
        return host.mutate(projectId, apply, checked);
    };
    return held;
};

/* A caller no project places still reads what is linked into it; any action that needs a project refuses as the verbs always did. */
const contextOf = (host: CanvasHost, place: IndexedPlace | null): ServerActionContext => {
    if (place !== null) {
        return { host, place };
    }
    return {
        host,
        get place(): IndexedPlace {
            throw new VerbRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
        }
    };
};

/* Whoever calls the daemon's actions is a session or a chat of a project, so the actor is an agent under that id. */
export const serverActionCall = (
    host: CanvasHost,
    place: IndexedPlace | null,
    caller: string,
    dryRun = false,
    expectedRevision?: number
): ServerActionCall => ({
    actor: { kind: 'agent', id: caller },
    context: contextOf(expectedRevision === undefined ? host : heldTo(host, expectedRevision), place),
    dryRun,
    ...(expectedRevision === undefined ? {} : { expectedRevision })
});

/* The caller in the shape the canvas helpers take, which ask who it is and who made what. */
export const verbCallOf = (call: ServerActionCall): VerbCall => ({ caller: call.actor.id, host: call.context.host });
