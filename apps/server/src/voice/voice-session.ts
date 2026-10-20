import { ACTION_DEFINITIONS, type ActionDomain, type ActionName } from '@ruimte/actions';
import type {
    VoiceActivityEntry,
    VoiceActivityEvent,
    VoiceActivityKind,
    VoiceError,
    VoicePhase,
    VoiceStartPayload,
    VoiceStartResult,
    VoiceStatusEvent
} from '@ruimte/contracts';
import { contextChunks, daemonVoiceTools, liveSessionBody, VoiceCompletionDelivery, VoiceToolLoop, type LiveEvent } from '@ruimte/voice';
import { CodedError } from '@adecore/agents';
import type { CanvasHost } from '../canvas/verb.ts';
import { voiceActionCall, type ServerActionContext, type VoiceCaller } from '../actions/context.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { voicePolicy } from './action-policy.ts';
import type { VoiceClock } from './clock.ts';
import { LiveError, type OpenAiLive } from './openai-live.ts';
import { phonePrompts } from './prompts.ts';
import { projectContext, timeContext } from './session-context.ts';
import type { LiveSideband } from './sideband.ts';
import { VoiceToolExecutor, type VoiceActionRunner } from './tool-executor.ts';
import { VoiceFollower, type VoiceFollowActivity, type VoiceFollowChats } from './voice-follower.ts';

/* From the start request to the answer the phone connects with; past it the session runs on the person's audio alone. */
export const VOICE_START_DEADLINE_MS = 20_000;
/* How often the model hears the time on the phone, as the desktop's window tells it. */
export const VOICE_CLOCK_MS = 60_000;
/* A burst of changes to the project gives one new context, not one per write. */
export const VOICE_CONTEXT_DEBOUNCE_MS = 250;

/* What a session needs of the daemon, so a test hands in fakes for every part. */
export interface VoiceSessionDeps {
    live: OpenAiLive;
    /* The key from `$RUIMTE_HOME/voice`, read at every start; null when none is set. */
    key(): Promise<string | null>;
    clock: VoiceClock;
    /*
     * Keeps the project loaded while the session runs, as a hold that starts no launches, and lets go of it
     * after. `changed` hears every change of the project's file meanwhile, the way a client holding it would.
     */
    holds: { hold(holder: string, projectId: string, changed: () => void): void; letGo(holder: string, projectId: string): void };
    runner: VoiceActionRunner<ServerActionContext>;
    host: CanvasHost;
    /* The daemon's chats, which the session follows once it prompted or started one. */
    chats: VoiceFollowChats;
    /* Only to the connection and scene that started the session. */
    emit(event: 'voice.status', payload: VoiceStatusEvent): void;
    emit(event: 'voice.activity', payload: VoiceActivityEvent): void;
}

export interface VoiceSessionStart {
    sessionId: string;
    payload: VoiceStartPayload;
    owner: { clientId: string; sceneId: string };
    place: IndexedPlace;
    writes: boolean;
}

const TIMELINE: Partial<Record<ActionDomain, VoiceActivityKind>> = {
    workspace: 'view',
    views: 'view',
    communicate: 'chat',
    sessions: 'chat',
    agents: 'chat',
    plans: 'chat'
};

/* A coded failure as the phone hears it; anything else says only that the start failed. */
function voiceErrorOf(error: unknown): VoiceError {
    return error instanceof CodedError
        ? { code: error.code, message: error.message }
        : { code: 'voice-failed', message: 'Voice could not start on this machine' };
}

/*
 * One Voice session run by the daemon: `starting` until the sideband is attached, `active` while the phone
 * talks, then `stopping` and `closed` or `failed`, never back. Every step of a start checks after its await
 * that the session still starts, so a stop, the deadline or a lost link in between leaves nothing behind:
 * a session minted too late is closed again, and the phone never gets an answer for it.
 */
export class VoiceSession {
    readonly id: string;
    readonly owner: { clientId: string; sceneId: string };
    readonly #deps: VoiceSessionDeps;
    readonly #start: VoiceSessionStart;
    readonly #abort = new AbortController();
    readonly #holder: string;
    #phase: VoicePhase = 'starting';
    #seq = 0;
    #error: VoiceError | undefined;
    #sideband: LiveSideband | null = null;
    #loop: VoiceToolLoop | null = null;
    #executor: VoiceToolExecutor<ServerActionContext> | null = null;
    #delivery: VoiceCompletionDelivery | null = null;
    #follower: VoiceFollower | null = null;
    #cancelDeadline: (() => void) | null = null;
    #cancelClock: (() => void) | null = null;
    #cancelContext: (() => void) | null = null;
    #heardStart = false;
    #ending: Promise<void> | null = null;
    #settle!: () => void;
    /* Settles once the session is closed or failed, whatever ended it. */
    readonly ended = new Promise<void>((resolve) => {
        this.#settle = resolve;
    });

    constructor(start: VoiceSessionStart, deps: VoiceSessionDeps) {
        this.id = start.sessionId;
        this.owner = start.owner;
        this.#start = start;
        this.#deps = deps;
        this.#holder = `voice:${start.sessionId}`;
    }

    get phase(): VoicePhase {
        return this.#phase;
    }

    /* Starting or active: what a stop still ends and a channel that goes takes with it. */
    get running(): boolean {
        return this.#phase === 'starting' || this.#phase === 'active';
    }

    get status(): VoiceStatusEvent {
        return {
            sessionId: this.id,
            sceneId: this.owner.sceneId,
            seq: this.#seq,
            phase: this.#phase,
            ...(this.#error === undefined ? {} : { error: this.#error })
        };
    }

    /* Answers once the daemon can run tools, with the answer to the phone's offer; throws a coded error otherwise. */
    async start(): Promise<VoiceStartResult> {
        const { live, clock } = this.#deps;
        const { payload, writes } = this.#start;
        this.#deps.holds.hold(this.#holder, this.#start.place.projectId, () => this.#projectChanged());
        this.#cancelDeadline = clock.after(VOICE_START_DEADLINE_MS, () => {
            void this.#end('failed', { code: 'voice-start-timeout', message: 'Voice did not start in time' });
        });
        const signal = this.#abort.signal;
        try {
            const key = await this.#whileStarting(this.#deps.key());
            if (key === null) {
                throw new LiveError('voice-no-key', 'No OpenAI key for Voice is set on this machine');
            }
            const tools = daemonVoiceTools({ writes });
            const body = liveSessionBody({ language: payload.language, voice: payload.voice, ...phonePrompts(writes), tools, sdp: payload.sdp });
            const minting = live.mint(key, body, signal);
            // A mint that answers once the start ended would stay open at OpenAI, so it is closed again.
            minting.then(
                (answer) => {
                    if (this.#phase !== 'starting') {
                        void live.close(key, answer.session.id);
                    }
                },
                () => undefined
            );
            const answer = await this.#whileStarting(minting);
            const attaching = live.attach(key, answer.session.id, { event: (event) => this.#heard(event), lost: () => this.#lost() }, signal);
            // Without a sideband nothing ends the minted session but one more attach; with one, the sideband does.
            attaching.then(
                (sideband) => {
                    if (this.#phase !== 'starting') {
                        void sideband.close();
                    }
                },
                () => void live.close(key, answer.session.id)
            );
            const sideband = await this.#whileStarting(attaching);
            this.#sideband = sideband;
            // The reports go one append at a time against their acks, the same queue the desktop's window uses.
            this.#delivery = new VoiceCompletionDelivery((event) => this.#sideband?.send(event) ?? false, {
                language: payload.language,
                timer: (run, ms) => clock.after(ms, run)
            });
            this.#follower = new VoiceFollower({
                chats: this.#deps.chats,
                delivery: this.#delivery,
                clock,
                activity: (entry) => this.#followed(entry)
            });
            this.#executor = new VoiceToolExecutor({
                sessionId: this.id,
                runner: this.#deps.runner,
                policy: voicePolicy({ writes }),
                tools,
                call: () => voiceActionCall(this.#deps.host, this.#start.place, this.#caller()),
                live: () => this.#phase === 'active',
                stateOf: () => this.#deps.host.projects.revision(this.#start.place.projectId),
                observer: {
                    started: (callId, name) => this.#activity(callId, name, 'running'),
                    finished: (callId, name, ok) => this.#activity(callId, name, ok ? 'completed' : 'failed')
                }
            });
            const executor = this.#executor;
            this.#loop = new VoiceToolLoop(
                (event) => void this.#sideband?.send(event),
                (name, args, callId) => executor.execute(name, args, callId),
                {
                    toolNames: new Set(tools.map((tool) => tool.name))
                }
            );
            this.#cancelDeadline();
            this.#cancelDeadline = null;
            this.#phaseTo('active');
            // The session runs at OpenAI from the mint on, so what the model should know goes in at once.
            void this.#sendContext();
            this.#tick();
            return { sessionId: this.id, sdp: answer.transport.sdp, status: this.status };
        } catch (e) {
            if (this.#phase === 'starting') {
                await this.#end('failed', voiceErrorOf(e));
            }
            throw this.#refusal(e);
        }
    }

    /*
     * What a start waits on, given up the moment the session ends, whether or not the work itself listens to
     * the abort. Its value only counts while the session still starts.
     */
    #whileStarting<Value>(work: Promise<Value>): Promise<Value> {
        const signal = this.#abort.signal;
        return new Promise((resolve, reject) => {
            const onAbort = (): void => reject(this.#refusal(null));
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
            work.then(
                (value) => {
                    signal.removeEventListener('abort', onAbort);
                    if (this.#phase === 'starting') {
                        resolve(value);
                    } else {
                        onAbort();
                    }
                },
                (error: unknown) => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                }
            );
        });
    }

    /* Ends the session, a start too; it answers once the sideband let go. */
    stop(): Promise<void> {
        return this.#end('closed');
    }

    /* The person's answer from the phone to an action that asked first. */
    async confirm(token: string, approved: boolean): Promise<boolean> {
        if (this.#phase !== 'active' || this.#executor === null) {
            return false;
        }
        const output = await this.#executor.confirm(token, approved);
        if (output.code === 'unknown-confirmation') {
            return false;
        }
        // The answer came from the phone, past the model, so the model hears what became of it.
        const said = typeof output.message === 'string' ? output.message : output.ok === true ? 'It was done.' : 'It was not done.';
        this.#delivery?.report(
            `confirm:${token}`,
            'confirmations',
            `Ruimte confirmation event. On the phone the user ${approved ? 'confirmed' : 'cancelled'} the action that asked first. Result: ${said}`,
            'The confirmation event just supplied is the user’s answer from the phone. Tell the user briefly what became of the action. Do not wait for another user message.'
        );
        return true;
    }

    #caller(): VoiceCaller {
        return {
            sessionId: this.id,
            owner: this.owner,
            projectId: this.#start.place.projectId,
            timeZone: this.#start.payload.timeZone,
            writes: this.#start.writes,
            ...(this.#follower === null ? {} : { follow: this.#follower })
        };
    }

    /* The error a start answers with once the session ended under it: why it ended, or the error that ended it. */
    #refusal(error: unknown): CodedError {
        if (this.#error !== undefined) {
            return new LiveError(this.#error.code, this.#error.message);
        }
        if (this.#phase === 'stopping' || this.#phase === 'closed') {
            return new LiveError('voice-cancelled', 'The Voice start was stopped');
        }
        const coded = voiceErrorOf(error);
        return new LiveError(coded.code, coded.message);
    }

    #heard(event: LiveEvent): void {
        if (this.#phase !== 'active' || this.#sideband === null) {
            return;
        }
        if (this.#sideband.foreign(event)) {
            // Only the daemon answers tools and steers the session; a phone that does is not this app.
            void this.#end('failed', { code: 'voice-foreign-client', message: 'Another client tried to steer this Voice session' });
            return;
        }
        if (event.type === 'session.closed') {
            void this.#end('closed');
            return;
        }
        if (event.type === 'session.started' && !this.#heardStart) {
            // As the desktop does once its peer is up; a sideband may hear it once the phone connects.
            this.#heardStart = true;
            void this.#sendContext();
        }
        this.#delivery?.handle(event);
        this.#loop?.handle(event);
    }

    #lost(): void {
        if (this.#sideband !== null && this.running) {
            void this.#end('failed', { code: 'voice-sideband-lost', message: 'The machine lost its link to the Voice session' });
        }
    }

    #activity(callId: string, name: ActionName, status: VoiceActivityEntry['status']): void {
        if (this.#phase !== 'active') {
            return;
        }
        const definition = ACTION_DEFINITIONS[name];
        this.#seq += 1;
        this.#deps.emit('voice.activity', {
            sessionId: this.id,
            sceneId: this.owner.sceneId,
            seq: this.#seq,
            entry: {
                id: callId.slice(0, 128) || 'call',
                at: this.#deps.clock.now(),
                kind: TIMELINE[definition.domain] ?? 'node',
                status,
                label: definition.title,
                detail: ''
            }
        });
    }

    /* Quiet context in appends under the byte bound; never the commentary that makes the model speak. */
    #append(text: string): void {
        for (const content of contextChunks(text)) {
            this.#sideband?.send({ type: 'session.thinking.append', event_id: crypto.randomUUID(), delegation_id: null, content });
        }
    }

    async #sendContext(): Promise<void> {
        try {
            const context = await projectContext(this.#deps.host, this.#start.place, this.#deps.clock.now(), this.#start.payload.timeZone);
            if (this.#phase === 'active') {
                this.#append(context);
            }
        } catch {
            // A project that cannot be read now is read again on its next change; the session goes on without.
        }
    }

    #tick(): void {
        this.#cancelClock = this.#deps.clock.after(VOICE_CLOCK_MS, () => {
            if (this.#phase !== 'active') {
                return;
            }
            this.#append(timeContext(this.#deps.clock.now(), this.#start.payload.timeZone));
            this.#tick();
        });
    }

    #projectChanged(): void {
        if (this.#phase !== 'active') {
            return;
        }
        this.#cancelContext?.();
        this.#cancelContext = this.#deps.clock.after(VOICE_CONTEXT_DEBOUNCE_MS, () => {
            this.#cancelContext = null;
            void this.#sendContext();
        });
    }

    /* A step of a chat the session follows, in the phone's timeline. */
    #followed(entry: VoiceFollowActivity): void {
        if (this.#phase !== 'active') {
            return;
        }
        this.#seq += 1;
        this.#deps.emit('voice.activity', {
            sessionId: this.id,
            sceneId: this.owner.sceneId,
            seq: this.#seq,
            entry: { id: entry.id.slice(0, 128), at: this.#deps.clock.now(), kind: 'chat', status: entry.status, label: entry.label.slice(0, 200), detail: '' }
        });
    }

    #phaseTo(phase: VoicePhase): void {
        this.#phase = phase;
        this.#seq += 1;
        this.#deps.emit('voice.status', this.status);
    }

    #end(outcome: 'closed' | 'failed', error?: VoiceError): Promise<void> {
        if (this.#ending !== null) {
            return this.#ending;
        }
        this.#error = error;
        this.#ending = (async () => {
            this.#phaseTo('stopping');
            this.#cancelDeadline?.();
            this.#cancelDeadline = null;
            this.#cancelClock?.();
            this.#cancelContext?.();
            this.#abort.abort();
            this.#loop?.reset();
            // What Voice started keeps running; only the telling of it ends with the session.
            this.#follower?.stop();
            // A token the session was given ends with it, so nobody answers a question Voice asked after it went.
            this.#executor?.forget();
            this.#delivery?.clear();
            const sideband = this.#sideband;
            this.#sideband = null;
            try {
                await sideband?.close();
            } finally {
                this.#deps.holds.letGo(this.#holder, this.#start.place.projectId);
                this.#phaseTo(outcome);
                this.#settle();
            }
        })();
        return this.#ending;
    }
}
