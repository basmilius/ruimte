import type { VoiceConfirmPayload, VoiceStartPayload, VoiceStartResult, VoiceStopPayload } from '@ruimte/contracts';
import { sendEvent, RequestError, type ClientConnection } from '../dispatcher.ts';
import type { IndexedPlace, ProjectIndex } from '../projects/project-index.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { voicePlace } from './project-reading.ts';
import { VoiceSession, type VoiceSessionDeps } from './voice-session.ts';

// Each session costs money by the minute and holds a sideband, so a machine runs a few at most.
export const MAX_VOICE_SESSIONS = 4;
// Starts remembered to answer a retry and keep a cancel; the oldest ended ones go first.
const START_MEMORY = 64;

interface StartRecord {
    clientId: string;
    sceneId: string;
    /* The fields of the start, so a retry with the same id but anything else is refused. */
    fingerprint: string;
    /* Null for a start a stop named before the start itself came. */
    session: VoiceSession | null;
    answer: Promise<VoiceStartResult> | null;
}

export interface VoiceSessionsDeps extends Omit<VoiceSessionDeps, 'emit' | 'places'> {
    index: Pick<ProjectIndex, 'folderOf' | 'viewsOf'>;
    projects: Pick<ProjectStore, 'list'>;
    /* A fresh session id; the daemon's, never a client's. */
    newId?: () => string;
}

function startKey(clientId: string, sceneId: string, startId: string): string {
    return `${clientId}\t${sceneId}\t${startId}`;
}

function fingerprintOf(payload: VoiceStartPayload): string {
    const { startId: _startId, sceneId: _sceneId, ...fields } = payload;
    return JSON.stringify(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)));
}

function notYours(): RequestError {
    return new RequestError('forbidden', 'Another screen started this Voice session');
}

/*
 * The Voice sessions of the daemon, each owned by the connection and the scene that started it, since the
 * scenes of an iPad share one link. Only that pair stops it or answers its questions and hears its events,
 * and a connection that goes takes its sessions with it: there is no resume yet.
 */
export class VoiceSessions {
    readonly #deps: VoiceSessionsDeps;
    readonly #sessions = new Map<string, VoiceSession>();
    readonly #starts = new Map<string, StartRecord>();

    constructor(deps: VoiceSessionsDeps) {
        this.#deps = deps;
    }

    /* Registered before its first await, so a stop that follows on the same link always finds it. */
    start(client: ClientConnection, payload: VoiceStartPayload): Promise<VoiceStartResult> {
        if (client.closed === true) {
            // Its channel's cleanup already ran, so nothing would end a session it started now.
            return Promise.reject(new RequestError('voice-cancelled', 'The link that asked for Voice is gone'));
        }
        const key = startKey(client.id, payload.sceneId, payload.startId);
        const fingerprint = fingerprintOf(payload);
        const known = this.#starts.get(key);
        if (known !== undefined) {
            if (known.fingerprint !== fingerprint && known.session !== null) {
                return Promise.reject(new RequestError('voice-start-conflict', 'This start id was used for another start'));
            }
            if (known.answer === null) {
                return Promise.reject(new RequestError('voice-cancelled', 'The Voice start was stopped'));
            }
            return known.answer;
        }
        const running = [...this.#sessions.values()].filter((session) => session.running);
        if (running.some((session) => session.owner.clientId === client.id && session.owner.sceneId === payload.sceneId)) {
            return Promise.reject(new RequestError('voice-busy', 'Voice already runs on this screen'));
        }
        if (running.length >= MAX_VOICE_SESSIONS) {
            return Promise.reject(new RequestError('voice-busy', 'Voice already runs on as many screens as this machine allows'));
        }
        let place: IndexedPlace | null = null;
        if (payload.projectId !== undefined) {
            place = voicePlace(this.#deps.index, payload.projectId, payload.viewId);
            if (place === null) {
                return Promise.reject(new RequestError('unknown-project', 'This machine has no project of that id'));
            }
        }
        const sessionId = (this.#deps.newId ?? (() => crypto.randomUUID()))();
        const { index, projects } = this.#deps;
        const session = new VoiceSession(
            { sessionId, payload, owner: { clientId: client.id, sceneId: payload.sceneId }, place },
            {
                ...this.#deps,
                places: {
                    summaries: () => projects.list(),
                    placeOf: (projectId, viewId) => voicePlace(index, projectId, viewId)
                },
                emit: (event, eventPayload) => {
                    // A connection that went hears nothing; a late event of an ended start goes nowhere.
                    if (client.closed !== true) {
                        sendEvent(client, event, eventPayload as never);
                    }
                }
            }
        );
        this.#sessions.set(sessionId, session);
        void session.ended.then(() => this.#sessions.delete(sessionId));
        const answer = session.start();
        this.#remember(key, { clientId: client.id, sceneId: payload.sceneId, fingerprint, session, answer });
        // The answer is the caller's; a stored copy must not count as unhandled when nobody retries.
        answer.catch(() => undefined);
        return answer;
    }

    async stop(client: ClientConnection, payload: VoiceStopPayload): Promise<{ stopped: boolean }> {
        if (payload.sessionId !== undefined) {
            const session = this.#sessions.get(payload.sessionId);
            if (session === undefined) {
                return { stopped: false };
            }
            if (session.owner.clientId !== client.id || session.owner.sceneId !== payload.sceneId) {
                throw notYours();
            }
            return this.#stopSession(session);
        }
        const key = startKey(client.id, payload.sceneId, payload.startId!);
        const known = this.#starts.get(key);
        if (known === undefined) {
            // A stop that overtook its start: the start, when it comes, is refused instead of minting.
            this.#remember(key, { clientId: client.id, sceneId: payload.sceneId, fingerprint: '', session: null, answer: null });
            return { stopped: false };
        }
        return known.session === null ? { stopped: false } : this.#stopSession(known.session);
    }

    async confirm(client: ClientConnection, payload: VoiceConfirmPayload): Promise<{ accepted: boolean }> {
        const session = this.#sessions.get(payload.sessionId);
        if (session === undefined) {
            return { accepted: false };
        }
        if (session.owner.clientId !== client.id || session.owner.sceneId !== payload.sceneId) {
            throw notYours();
        }
        return { accepted: await session.confirm(payload.token, payload.decision === 'confirm') };
    }

    /* The link of a client went: its sessions end, its starts with them, and nothing of it is kept. */
    channelClosed(clientId: string): void {
        for (const session of this.#sessions.values()) {
            if (session.owner.clientId === clientId) {
                void this.#stopSession(session);
            }
        }
        for (const [key, record] of this.#starts) {
            if (record.clientId === clientId) {
                this.#starts.delete(key);
            }
        }
    }

    /* On shutdown: every session ends at OpenAI before the daemon goes. */
    async stopAll(): Promise<void> {
        await Promise.all([...this.#sessions.values()].map((session) => this.#stopSession(session)));
    }

    get size(): number {
        return this.#sessions.size;
    }

    async #stopSession(session: VoiceSession): Promise<{ stopped: boolean }> {
        const stopped = session.running;
        await session.stop();
        return { stopped };
    }

    #remember(key: string, record: StartRecord): void {
        this.#starts.delete(key);
        if (this.#starts.size >= START_MEMORY) {
            const ended = [...this.#starts].find(([, candidate]) => candidate.session === null || !candidate.session.running);
            const oldest = ended?.[0] ?? this.#starts.keys().next().value;
            if (oldest !== undefined) {
                this.#starts.delete(oldest);
            }
        }
        this.#starts.set(key, record);
    }
}
