import { useChats } from '@adecore/agents-react/state';
import { messageOf } from '@adecore/ui';
import { localTimeZone } from '@adecore/ui/format';
import { isCanvasView, isOpenableView, sessionStatus, type AgentStatus } from '@ruimte/contracts';
import {
    chatRunsTurn,
    FollowedTurn,
    settledPrompt,
    SETTLED_COMMENTARY,
    terminalWaits,
    timeContext,
    VoiceCompletionDelivery,
    VoiceSessionWatch,
    waitingPrompt,
    WAITING_COMMENTARY,
    type LiveEvent,
    type VoiceChatCompletion,
    type VoiceChatFollowUp,
    type VoiceChatState,
    type VoiceSessionChange,
    type VoiceWatchedSession
} from '@ruimte/voice';
import i18next from 'i18next';
import { MicrophoneMonitor, WaveformMonitor } from '@/audio/microphone';
import { microphoneFailureText } from '@/audio/microphone-failure';
import { claimMicrophone } from '@/audio/ownership';
import { silentBands } from '@/audio/waveform';
import { focusedCanvas } from '@/state/canvas';
import { subscribeChatStatuses } from '@/state/chats';
import { activeViewOf, useDocument } from '@/state/document';
import { endpointById } from '@/state/endpoints';
import { splitKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { pool, transportFor } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';
import { followedState } from '@/voice/chat-follow-up';
import { finishVoiceDiagnostics, noteVoiceError, startVoiceDiagnostics, voiceDeliveryObserver, voiceDiagnosticsObserver } from '@/voice/diagnostics-log';
import { currentVoiceDomains } from '@/voice/domains';
import { LiveSession } from '@/voice/live-session';
import { voicePreferencesForStart } from '@/voice/machine-preferences';
import { ResponseToolLoop } from '@/voice/response-tool-loop';
import { addTranscriptDelta, nextVoiceTimelineOrder, useVoice, type VoiceAction, type VoiceActionKind } from '@/voice/state';
import { VoiceToolQueue } from '@/voice/tool-queue';
import { bypassesQueue, executeVoiceTool } from '@/voice/tools';
import { voiceWorkspaceRevision } from '@/voice/workspace-context';
import { chatClientFor } from '@/workspace/connections';

let session: LiveSession | null = null;
let releaseMicrophone: (() => void) | null = null;
let microphone: MicrophoneMonitor | null = null;
let outputWaveform: WaveformMonitor | null = null;
let completionDelivery: VoiceCompletionDelivery | null = null;
let toolQueue: VoiceToolQueue | null = null;
let toolLoop: ResponseToolLoop | null = null;
let unsubscribeDocument: (() => void) | null = null;
let unsubscribeProject: (() => void) | null = null;
const followUpReleases = new Map<string, () => void>();
const readingFollowUps = new Set<string>();
let unsubscribeChats: (() => void) | null = null;
let unsubscribeStatuses: (() => void) | null = null;
let sessionWatch: VoiceSessionWatch | null = null;
let waits = 0;
let contextTimer: number | null = null;
let clockTimer: number | null = null;
const undo = new Map<string, () => void>();
const chatFollowUps = new Map<string, VoiceChatFollowUp>();
const followedTurns = new Map<string, FollowedTurn>();

function failureText(error: unknown): string {
    return messageOf(error, i18next.t('voice:error.start'));
}

function temporalContext(): string {
    return timeContext(Date.now(), localTimeZone() ?? null);
}

function workspaceContext(): string {
    const document = useDocument.getState();
    const active = activeViewOf(document);
    const project = useProject.getState().current?.name ?? i18next.t('voice:untitledProject');
    const views = document.views
        .filter(isOpenableView)
        .map((view) => `${view.name} (${view.kind})`)
        .join(', ');
    if (!active || !isCanvasView(active)) {
        return `${temporalContext()} Ruimte context. Project: ${project}. Active view: ${active ? `${active.name} (${active.kind})` : 'none'}. Views: ${views || 'none'}.`;
    }
    const canvas = focusedCanvas().getState();
    const selected = canvas.selection.map((id) => canvas.nodes[id]?.title ?? id).join(', ');
    const visible = Object.values(canvas.nodes)
        .slice(0, 30)
        .map((node) => `${node.title} (${node.kind})`)
        .join(', ');
    return `${temporalContext()} Ruimte context. Project: ${project}. Active canvas: ${active.name}. Views: ${views || 'none'}. Canvas nodes: ${visible || 'none'}. Selected: ${selected || 'none'}.`;
}

function appendContext(): void {
    session?.send({ type: 'session.thinking.append', delegation_id: null, content: workspaceContext() });
}

function appendTime(): void {
    session?.send({ type: 'session.thinking.append', delegation_id: null, content: temporalContext() });
}

function dropFollowUp(id: string): void {
    chatFollowUps.delete(id);
    followedTurns.delete(id);
    followUpReleases.get(id)?.();
    followUpReleases.delete(id);
}

function reportCompletion(id: string, followUp: VoiceChatFollowUp, completion: VoiceChatCompletion): void {
    if (chatFollowUps.get(id) !== followUp || !completionDelivery) {
        return;
    }
    completionDelivery.enqueue(followUp, completion);
    dropFollowUp(id);
}

function statusOf(session: VoiceWatchedSession): AgentStatus | undefined {
    return sessionStatus(useSessions.getState().byKey[session.key]);
}

/* A terminal's status says when it waits or ended; a chat's turn is followed on its own (`followStep`). */
function reportChange(session: VoiceWatchedSession, change: VoiceSessionChange): void {
    if (!completionDelivery) {
        return;
    }
    if (change === 'needs-you') {
        const asked = terminalWaits(useSessions.getState().byKey[session.key]?.agent?.requests);
        completionDelivery.report(`${session.key}:waits:${++waits}`, session.key, waitingPrompt(session, asked), WAITING_COMMENTARY);
        return;
    }
    completionDelivery.report(`${session.key}:${change}:${++waits}`, session.key, settledPrompt(session, change), SETTLED_COMMENTARY);
}

function observeSession(session: VoiceWatchedSession, status: AgentStatus | undefined): void {
    const change = sessionWatch?.observe(session.key, status) ?? null;
    if (change) {
        reportChange(session, change);
    }
}

function checkSessions(): void {
    for (const session of sessionWatch?.sessions() ?? []) {
        observeSession(session, statusOf(session));
    }
}

function watchSession(session: VoiceWatchedSession): void {
    const change = sessionWatch?.watch(session, statusOf(session)) ?? null;
    if (change) {
        reportChange(session, change);
    }
}

/* What this window knows of a followed chat: its thread when it holds it, else the status the machine told every client. */
function followedChat(followUp: VoiceChatFollowUp): VoiceChatState | null {
    const held = useChats.getState().byKey[followUp.key];
    if (held) {
        return followedState(held, followUp.turnId);
    }
    const info = useChats.getState().statusByKey[followUp.key]?.info;
    return info ? { items: [], info } : null;
}

/* One look at a followed turn: told once when it settles, and once for each time it starts to wait on the person. */
function followStep(id: string, followUp: VoiceChatFollowUp, chat: VoiceChatState): void {
    const step = followedTurns.get(id)?.observe(chat);
    if (step?.kind === 'settled') {
        reportCompletion(id, followUp, step.completion);
    } else if (step?.kind === 'waits') {
        completionDelivery?.report(
            `${id}:waits:${step.count}`,
            followUp.key,
            waitingPrompt(
                { key: followUp.key, kind: 'chat', name: followUp.chat, ...(followUp.project === undefined ? {} : { project: followUp.project }) },
                step.waits
            ),
            WAITING_COMMENTARY
        );
    }
}

/* Called whenever a chat's status or thread moved, which is all that can change what Voice tells; a chat this window holds no thread of is read once it stops running. */
function followChats(): void {
    for (const [id, followUp] of chatFollowUps) {
        const chat = followedChat(followUp);
        if (chat === null) {
            readFollowUp(id, followUp);
            continue;
        }
        followStep(id, followUp, chat);
        if (chatFollowUps.get(id) === followUp && !useChats.getState().byKey[followUp.key] && !chatRunsTurn(chat.info, followUp.turnId)) {
            readFollowUp(id, followUp);
        }
    }
}

/* The chat as the machine holds it, for a chat no status or thread of this window says anything about, as after a project switch. */
function readFollowUp(id: string, followUp: VoiceChatFollowUp): void {
    if (readingFollowUps.has(id)) {
        return;
    }
    const { endpointId, id: chatId } = splitKey(followUp.key);
    const transport = transportFor(endpointId);
    const client = chatClientFor(endpointId);
    if (!client || transport?.status !== 'open') {
        return;
    }
    readingFollowUps.add(id);
    void (async () => {
        const known = useChats.getState().statusByKey[followUp.key]?.info;
        const info = known ?? (await transport.request('chat.list', {})).chats.find((chat) => chat.chatId === chatId);
        if (!info || chatFollowUps.get(id) !== followUp) {
            return;
        }
        if (chatRunsTurn(info, followUp.turnId)) {
            followStep(id, followUp, { items: [], info });
            return;
        }
        const snapshot = await client.inspect(chatId);
        const items = Object.fromEntries(snapshot.items.map((item) => [item.id, item]));
        followStep(id, followUp, followedState({ info: snapshot.info, items, order: snapshot.items.map((item) => item.id) }, followUp.turnId));
    })()
        .catch((error: unknown) => console.debug('[voice] reading a followed chat failed', error))
        .finally(() => readingFollowUps.delete(id));
}

function cancelChatFollowUps(key: string): void {
    for (const [id, followUp] of chatFollowUps) {
        if (followUp.key === key) {
            dropFollowUp(id);
        }
    }
    completionDelivery?.cancelChat(key);
}

function trackChatFollowUp(followUp: VoiceChatFollowUp): void {
    const id = `${followUp.key}:${followUp.turnId}`;
    followUpReleases.get(id)?.();
    const endpoint = endpointById(splitKey(followUp.key).endpointId);
    if (endpoint) {
        followUpReleases.set(id, pool.hold(endpoint));
    }
    chatFollowUps.set(id, followUp);
    followedTurns.set(id, new FollowedTurn(followUp.turnId));
    followChats();
}

function addAction(kind: VoiceActionKind, label: string, detail: string, undoAction?: () => void): void {
    const action: VoiceAction = {
        id: crypto.randomUUID(),
        order: nextVoiceTimelineOrder(),
        kind,
        status: 'completed',
        label,
        detail,
        undoable: undoAction !== undefined
    };
    if (undoAction) {
        undo.set(action.id, undoAction);
    }
    useVoice.setState((state) => ({ actions: [...state.actions, action] }));
}

function number(value: unknown): number {
    return typeof value === 'number' ? value : 0;
}

function handleEvent(event: LiveEvent): void {
    completionDelivery?.handle(event);
    // A report that found the session not ready goes out with the next thing the session says.
    completionDelivery?.flush();
    if (event.type === 'session.started') {
        useVoice.setState({ phase: 'listening', error: null, sessionStartedAt: Date.now() });
        appendContext();
        return;
    }
    if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
        addTranscriptDelta(
            event.type.includes('input') ? 'user' : 'assistant',
            typeof event.delta === 'string' ? event.delta : '',
            number(event.start_ms),
            number(event.end_ms)
        );
        return;
    }
    if (event.type === 'response.event') {
        toolLoop?.handle(event);
        return;
    }
    if (event.type === 'error') {
        noteVoiceError(event);
        return;
    }
    if (event.type === 'session.error') {
        stopVoice();
        useVoice.setState({ phase: 'error', error: i18next.t('voice:error.session') });
    }
}

export async function startVoice(): Promise<void> {
    if (session !== null) {
        return;
    }
    releaseMicrophone = claimMicrophone(stopVoice);
    useVoice.setState({
        phase: 'connecting',
        error: null,
        transcript: [],
        actions: [],
        inputBands: silentBands(),
        outputBands: silentBands(),
        sessionStartedAt: null
    });
    undo.clear();
    const next = new LiveSession(
        (event) => {
            if (session === next) {
                handleEvent(event);
            }
        },
        (stream) => {
            if (session !== next) {
                return;
            }
            outputWaveform?.stop();
            outputWaveform = new WaveformMonitor((outputBands) => useVoice.setState({ outputBands }));
            void fireAndForget('outputWaveform.start', outputWaveform.start(stream));
        },
        () => {
            if (session === next) {
                stopVoice();
                useVoice.setState({ phase: 'error', error: i18next.t('voice:error.connectionLost') });
            }
        }
    );
    sessionWatch = new VoiceSessionWatch();
    const queue = new VoiceToolQueue(voiceWorkspaceRevision);
    toolQueue = queue;
    const execute = async (name: string, args: string): Promise<Record<string, unknown>> => {
        const execution = await executeVoiceTool(name, args);
        if (session !== next) {
            return { ok: false, code: 'session-ended', message: 'The voice session ended.' };
        }
        if (execution.action) {
            addAction(execution.action.kind, execution.action.label, execution.action.detail, execution.action.undo);
        }
        if (execution.clearedChatKey) {
            cancelChatFollowUps(execution.clearedChatKey);
        }
        if (execution.followUp) {
            trackChatFollowUp(execution.followUp);
        }
        if (execution.watch) {
            watchSession(execution.watch);
        }
        return execution.output;
    };
    toolLoop = new ResponseToolLoop(
        (event) => next.send(event),
        // A cancel is for the run the queue is waiting on, so it cannot wait its turn behind it.
        (name, args) => (bypassesQueue(name, args) ? execute(name, args) : queue.run(() => execute(name, args))),
        voiceDiagnosticsObserver
    );
    session = next;
    try {
        const stream = await startMicrophone();
        if (session !== next) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        const [{ language, voice }, domains] = await Promise.all([voicePreferencesForStart(), currentVoiceDomains()]);
        if (session !== next) {
            next.close();
            return;
        }
        completionDelivery = new VoiceCompletionDelivery((event) => next.send(event), { language, observer: voiceDeliveryObserver });
        startVoiceDiagnostics(domains);
        await next.start(stream, { language, voice, domains });
        if (session !== next) {
            next.close();
            return;
        }
        clockTimer = window.setInterval(appendTime, 60_000);
        let previous = workspaceContext();
        unsubscribeDocument = useDocument.subscribe(() => {
            const current = workspaceContext();
            if (current === previous) {
                return;
            }
            previous = current;
            if (contextTimer !== null) {
                window.clearTimeout(contextTimer);
            }
            contextTimer = window.setTimeout(appendContext, 250);
        });
        unsubscribeChats = useChats.subscribe(followChats);
        const offChatStatuses = subscribeChatStatuses(checkSessions);
        const offSessions = useSessions.subscribe(checkSessions);
        unsubscribeStatuses = () => {
            offChatStatuses();
            offSessions();
        };
        unsubscribeProject = useProject.subscribe((state, previous) => {
            if (state.current?.projectId !== previous.current?.projectId || state.currentEndpointId !== previous.currentEndpointId) {
                undo.clear();
                useVoice.setState((voice) => ({ actions: voice.actions.map((action) => ({ ...action, undoable: false })) }));
                appendContext();
            }
        });
    } catch (error) {
        if (session !== next) {
            next.close();
            return;
        }
        releaseMicrophoneClaim();
        next.close();
        session = null;
        stopClock();
        endSessionParts();
        useVoice.setState({ phase: 'error', error: failureText(error) });
    }
}

export function stopVoice(): void {
    releaseMicrophoneClaim();
    if (contextTimer !== null) {
        window.clearTimeout(contextTimer);
        contextTimer = null;
    }
    stopClock();
    unsubscribeDocument?.();
    unsubscribeDocument = null;
    unsubscribeChats?.();
    unsubscribeChats = null;
    unsubscribeStatuses?.();
    unsubscribeStatuses = null;
    unsubscribeProject?.();
    unsubscribeProject = null;
    for (const release of followUpReleases.values()) {
        release();
    }
    followUpReleases.clear();
    readingFollowUps.clear();
    chatFollowUps.clear();
    followedTurns.clear();
    useVoice.setState({ phase: session ? 'closing' : 'idle' });
    session?.close();
    session = null;
    endSessionParts();
    useVoice.setState({ phase: 'idle', sessionStartedAt: null });
}

function releaseMicrophoneClaim(): void {
    releaseMicrophone?.();
    releaseMicrophone = null;
}

function stopClock(): void {
    if (clockTimer !== null) {
        window.clearInterval(clockTimer);
        clockTimer = null;
    }
}

/* What a session owns besides its connection, ended the same way whether it stopped or never started. */
function endSessionParts(): void {
    completionDelivery?.clear();
    completionDelivery = null;
    sessionWatch = null;
    toolQueue?.cancel();
    toolQueue = null;
    toolLoop?.reset();
    toolLoop = null;
    finishVoiceDiagnostics();
    stopMicrophone();
    stopOutputWaveform();
}

async function startMicrophone(): Promise<MediaStream> {
    if (microphone !== null) {
        return microphone.start();
    }
    const next = new MicrophoneMonitor(({ bands }) => useVoice.setState({ inputBands: bands }), useSettings.getState().voiceInputDeviceId);
    microphone = next;
    try {
        return await next.start();
    } catch (error) {
        if (microphone === next) {
            microphone = null;
        }
        next.stop();
        throw new Error(microphoneFailureText(error));
    }
}

function stopMicrophone(): void {
    microphone?.stop();
    microphone = null;
    useVoice.setState({ inputBands: silentBands() });
}

function stopOutputWaveform(): void {
    outputWaveform?.stop();
    outputWaveform = null;
    useVoice.setState({ outputBands: silentBands() });
}

export function undoVoiceAction(id: string): void {
    undo.get(id)?.();
    undo.delete(id);
    useVoice.setState((state) => ({
        actions: state.actions.map((action) => (action.id === id ? { ...action, status: 'undone', undoable: false } : action))
    }));
}

export function undoVoiceActions(ids: string[]): void {
    for (const id of ids.toReversed()) {
        undoVoiceAction(id);
    }
}
