import type { ActionCall } from '@ruimte/actions';
import { VerbRefusal, type CanvasHost, type ProjectHost, type VerbCall } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';

export interface ServerActionContext {
    host: CanvasHost;
    /* Where the caller stands, looked up by its id before the action runs: project, folder and canvas. */
    place: IndexedPlace;
    /* Set only for the voice actor, so a handler open to Voice and an agent tells the two apart. */
    voice?: VoiceCaller;
}

/*
 * Who a Voice session run by the daemon acts for, as the daemon itself set it when the session started:
 * a client never names an owner, a project or a right of its own, and nothing here comes from the model.
 */
export interface VoiceCaller {
    sessionId: string;
    /* The connection and the scene that started the session; only they stop it or answer its questions. */
    owner: { clientId: string; sceneId: string };
    projectId: string;
    /* IANA, the clock of the person's phone. */
    timeZone: string;
    /* RUIMTE_EXPERIMENTAL_VOICE_WRITES: Voice may prompt and start chats too. */
    writes: boolean;
}

export type VoiceActionContext = ServerActionContext & { voice: VoiceCaller };

export type ServerActionCall = ActionCall<ServerActionContext>;

/*
 * The host an action writes through when the caller named a revision. Only the first write is held to
 * it, under the lock that write takes: every later one of the same action follows from the first.
 */
function heldTo(host: CanvasHost, expected: number): CanvasHost {
    let first = true;
    const { projects } = host;
    const held: ProjectHost = {
        locate: (id) => projects.locate(id),
        read: (projectId) => projects.read(projectId),
        revision: (projectId) => projects.revision(projectId),
        showView: (projectId, viewId, by) => projects.showView(projectId, viewId, by),
        machineOfNode: (nodeId) => projects.machineOfNode(nodeId),
        mutate: (projectId, apply, expectedRev) => {
            const checked = first ? expected : expectedRev;
            first = false;
            return projects.mutate(projectId, apply, checked);
        }
    };
    return { ...host, projects: held };
}

/* A caller no project places still reads what is linked into it; any action that needs a project refuses as the verbs always did. */
function contextOf(host: CanvasHost, place: IndexedPlace | null): ServerActionContext {
    if (place !== null) {
        return { host, place };
    }
    return {
        host,
        get place(): IndexedPlace {
            throw new VerbRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
        }
    };
}

/* Whoever calls the daemon's actions is a session or a chat of a project, so the actor is an agent under that id. */
export function serverActionCall(host: CanvasHost, place: IndexedPlace | null, caller: string, dryRun = false, expectedRevision?: number): ServerActionCall {
    return {
        actor: { kind: 'agent', id: caller },
        context: contextOf(expectedRevision === undefined ? host : heldTo(host, expectedRevision), place),
        dryRun,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
    };
}

/* The actor id of a Voice session, apart from every node id, which is what a lineage or a claim is kept under. */
export function voiceActorId(sessionId: string): string {
    return `voice:${sessionId}`;
}

/*
 * The call of a Voice session. Its place is the project the session started in, with the canvas on the
 * phone's screen or else the project's first, so an action lands where an agent of that canvas would.
 */
export function voiceActionCall(host: CanvasHost, place: IndexedPlace, voice: VoiceCaller): ActionCall<VoiceActionContext> {
    return {
        actor: { kind: 'voice', id: voiceActorId(voice.sessionId) },
        context: { host, place, voice }
    };
}

/* The caller in the shape the canvas helpers take, which ask who it is and who made what. */
export function verbCallOf(call: ServerActionCall): VerbCall {
    return { caller: call.actor.id, host: call.context.host };
}
