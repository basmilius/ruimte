import type { ActionCall } from '@ruimte/actions';
import { callerKind } from '../canvas/tasks.ts';
import { VerbRefusal, type CanvasHost, type ProjectHost, type VerbCall } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { VoiceFollowHost } from '../voice/voice-follower.ts';

export interface ServerActionContext {
    host: CanvasHost;
    /* Where the caller stands, looked up by its id before the action runs: project, folder and canvas. */
    place: IndexedPlace;
    /*
     * Where the caller itself stands, set only when `place` is another project `--project` reached:
     * whatever judges the caller (its kind, whether it is a chat) reads this one, never `place`.
     */
    origin?: IndexedPlace;
    /* Set only for the voice actor, so a handler open to Voice and an agent tells the two apart. */
    voice?: VoiceCaller;
}

/* A project in use on this machine, as Voice lists it and moves to it. */
export interface VoiceOpenProject {
    projectId: string;
    name: string;
    folder: string;
}

/* The projects of this machine a Voice session moves between; the session keeps which one is current. */
interface VoiceProjectFocus {
    machine: { id: string; label: string };
    /* The machine's projects in use, the most recently opened first. */
    open(): Promise<VoiceOpenProject[]>;
    /* Lets go of the current project and holds this one; refuses a project that is not in use here. */
    switchTo(projectId: string): Promise<VoiceOpenProject>;
}

/*
 * Who a Voice session run by the daemon acts for, as the daemon itself set it when the session started:
 * a client never names an owner, a project or a right of its own, and nothing here comes from the model.
 * Only the current project moves, and only to another project in use on this machine.
 */
export interface VoiceCaller {
    sessionId: string;
    /* The connection and the scene that started the session; only they stop it or answer its questions. */
    owner: { clientId: string; sceneId: string };
    /* The project the session works in now; null while it works in none. */
    projectId: string | null;
    /* Absent in a test that moves nowhere. */
    projects?: VoiceProjectFocus;
    /* IANA, the clock of the person's phone. */
    timeZone: string;
    /* Follows what a prompt or a start set going, so the session tells the person when it ends; absent in a test that follows nothing. */
    follow?: VoiceFollowHost;
}

export type VoiceActionContext = ServerActionContext & { voice: VoiceCaller };

export type ServerActionCall = ActionCall<ServerActionContext>;

/* A service of the host that a machine may not have, refused with `code` where it has none. */
export function hostService<Key extends keyof CanvasHost>(context: ServerActionContext, key: Key, code: string, message: string): NonNullable<CanvasHost[Key]> {
    const service = context.host[key];
    if (!service) {
        throw new VerbRefusal(code, message);
    }

    return service;
}

/* The kind of node the caller is, or null when it is no node of this project. */
export async function callerNodeKind({ host, place, origin }: ServerActionContext, caller: string): Promise<string | null> {
    return callerKind(await host.projects.read((origin ?? place).projectId), caller) ?? host.hiddenAgents?.get(caller)?.node.kind ?? null;
}

/* What the caller is, as a refusal says it to a caller that is no chat. */
export function youAre(kind: string | null): string {
    return kind === null ? 'not a node of this project' : `a ${kind}`;
}

/* Refuses a caller that is no AI chat, with `refusal` given what it is instead. */
export async function requireChatCaller(context: ServerActionContext, caller: string, refusal: (you: string) => VerbRefusal): Promise<void> {
    const kind = await callerNodeKind(context, caller);
    if (kind !== 'chat') {
        throw refusal(youAre(kind));
    }
}

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

/* A caller no project places still reads what is linked into it; an action that needs a project refuses. */
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

/*
 * Whoever calls the daemon's actions is a session or a chat of a project, so the actor is an agent under that id.
 * `origin` is the caller's own place when `place` is another project `--project` reached.
 */
export function serverActionCall(
    host: CanvasHost,
    place: IndexedPlace | null,
    caller: string,
    dryRun = false,
    expectedRevision?: number,
    origin?: IndexedPlace
): ServerActionCall {
    const context = contextOf(expectedRevision === undefined ? host : heldTo(host, expectedRevision), place);
    if (origin !== undefined) {
        context.origin = origin;
    }

    return {
        actor: { kind: 'agent', id: caller },
        context,
        dryRun,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
    };
}

const VOICE_ACTOR_PREFIX = 'voice:';

/* The actor id of a Voice session, apart from every node id, which is what a lineage or a claim is kept under. */
function voiceActorId(sessionId: string): string {
    return `${VOICE_ACTOR_PREFIX}${sessionId}`;
}

/* Whether an opener in the lineage is a Voice session, which no project places. */
export function isVoiceActor(id: string): boolean {
    return id.startsWith(VOICE_ACTOR_PREFIX);
}

/*
 * The call of a Voice session. Its place is the current project of the session, with the canvas on the
 * phone's screen or else the project's first, so an action lands where an agent of that canvas would.
 * Without a current project, an action that needs one refuses and says how to pick one.
 */
export function voiceActionCall(host: CanvasHost, place: IndexedPlace | null, voice: VoiceCaller): ActionCall<VoiceActionContext> {
    const actor = { kind: 'voice' as const, id: voiceActorId(voice.sessionId) };
    if (place !== null) {
        return { actor, context: { host, place, voice } };
    }
    return {
        actor,
        context: {
            host,
            voice,
            get place(): IndexedPlace {
                throw noVoiceProject();
            }
        }
    };
}

export function noVoiceProject(): VerbRefusal {
    return new VerbRefusal('no-project', 'Voice works in no project now; list the projects of this machine and switch to one first');
}

/* The caller in the shape the canvas helpers take, which ask who it is and who made what. */
export function verbCallOf(call: ServerActionCall): VerbCall {
    return { caller: call.actor.id, host: call.context.host };
}
