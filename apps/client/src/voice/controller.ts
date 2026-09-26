import { VoiceCompletionDelivery } from '@/voice/completion-delivery';
import { endpointById } from '@/state/endpoints';
import { splitKey } from '@/state/keys';
import { pool, transportFor } from '@/transport';
import { chatClientFor } from '@/transport/connections';
import { VoiceToolQueue } from '@/voice/tool-queue';
import { voiceWorkspaceRevision } from '@/voice/workspace-context';
import { claimMicrophone } from '@/audio/ownership';
import { localTimeZone } from '@ruimte/ui/format/time-zone';
import i18next from 'i18next';
import { isCanvasView, isOpenableView } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { activeViewOf, useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { LiveSession, type LiveEvent } from '@/voice/live-session';
import { MicrophoneMonitor, WaveformMonitor, WAVEFORM_BAND_COUNT } from '@/audio/microphone';
import { microphoneFailureText } from '@/audio/microphone-failure';
import { ResponseToolLoop } from '@/voice/response-tool-loop';
import { chatCompletion, type VoiceChatFollowUp } from '@/voice/chat-follow-up';
import { addTranscriptDelta, nextVoiceTimelineOrder, useVoice, type VoiceAction, type VoiceActionKind } from '@/voice/state';
import { bypassesQueue, executeVoiceTool } from '@/voice/tools';
import { currentVoiceDomains } from '@/voice/domains';
import { finishVoiceDiagnostics, startVoiceDiagnostics, voiceDiagnosticsObserver } from '@/voice/diagnostics-log';

let session: LiveSession | null = null;
let releaseMicrophone: (() => void) | null = null;
let microphone: MicrophoneMonitor | null = null;
let outputWaveform: WaveformMonitor | null = null;
let completionDelivery: VoiceCompletionDelivery | null = null;
let toolQueue: VoiceToolQueue | null = null;
let toolLoop: ResponseToolLoop | null = null;
let unsubscribeDocument: (() => void) | null = null;
let unsubscribeProject: (() => void) | null = null;
let followUpTimer: number | null = null;
const followUpReleases = new Map<string, () => void>();
const readingFollowUps = new Set<string>();
let unsubscribeChats: (() => void) | null = null;
let contextTimer: number | null = null;
let clockTimer: number | null = null;
const undo = new Map<string, () => void>();
const chatFollowUps = new Map<string, VoiceChatFollowUp>();

const failureText = (error: unknown): string => (error instanceof Error ? error.message : i18next.t('voice:error.start'));

/*
 * This context is for the speech model, not something a person reads, so it skips `format/`. A fixed
 * `en-GB` keeps the date unambiguous whatever the interface language is set to.
 */
const temporalContext = (): string => {
    const now = new Date();
    const timeZone = localTimeZone() ?? 'unknown';
    const local = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long' }).format(now);
    return `User local date and time: ${local}. IANA time zone: ${timeZone}. UTC time: ${now.toISOString()}.`;
};

const workspaceContext = (): string => {
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
};

const appendContext = (): void => {
    session?.send({ type: 'session.thinking.append', delegation_id: null, content: workspaceContext() });
};
const appendTime = (): void => {
    session?.send({ type: 'session.thinking.append', delegation_id: null, content: temporalContext() });
};

const reportCompletion = (id: string, followUp: VoiceChatFollowUp, completion: NonNullable<ReturnType<typeof chatCompletion>>): void => {
    if (chatFollowUps.get(id) !== followUp || !completionDelivery) {
        return;
    }
    completionDelivery.enqueue(followUp, completion);
    chatFollowUps.delete(id);
    followUpReleases.get(id)?.();
    followUpReleases.delete(id);
};

const flushChatFollowUps = (): void => {
    const chats = useChats.getState().byKey;
    for (const [id, followUp] of chatFollowUps) {
        const completion = chatCompletion(chats[followUp.key], followUp.turnId);
        if (completion) {
            reportCompletion(id, followUp, completion);
        }
    }
};

const pollChatFollowUps = (): void => {
    completionDelivery?.flush();
    for (const [id, followUp] of chatFollowUps) {
        if (readingFollowUps.has(id)) {
            continue;
        }
        const { endpointId, id: chatId } = splitKey(followUp.key);
        const transport = transportFor(endpointId);
        const client = chatClientFor(endpointId);
        if (!client || transport?.status !== 'open') {
            continue;
        }
        readingFollowUps.add(id);
        void transport
            .request('chat.list', {})
            .then(async ({ chats }) => {
                const info = chats.find((chat) => chat.chatId === chatId);
                if (!info || info.activeTurnId === followUp.turnId || chatFollowUps.get(id) !== followUp) {
                    return;
                }
                const snapshot = await client.inspect(chatId);
                const items = Object.fromEntries(snapshot.items.map((item) => [item.id, item]));
                const completion = chatCompletion(
                    { info: snapshot.info, items, structure: items, order: snapshot.items.map((item) => item.id) },
                    followUp.turnId
                );
                if (completion) {
                    reportCompletion(id, followUp, completion);
                }
            })
            .catch(() => undefined)
            .finally(() => readingFollowUps.delete(id));
    }
};

const cancelChatFollowUps = (key: string): void => {
    for (const [id, followUp] of chatFollowUps) {
        if (followUp.key === key) {
            chatFollowUps.delete(id);
            followUpReleases.get(id)?.();
            followUpReleases.delete(id);
        }
    }
    completionDelivery?.cancelChat(key);
};

const trackChatFollowUp = (followUp: VoiceChatFollowUp): void => {
    const id = `${followUp.key}:${followUp.turnId}`;
    followUpReleases.get(id)?.();
    const endpoint = endpointById(splitKey(followUp.key).endpointId);
    if (endpoint) {
        followUpReleases.set(id, pool.hold(endpoint));
    }
    chatFollowUps.set(id, followUp);
    flushChatFollowUps();
};

const addAction = (kind: VoiceActionKind, label: string, detail: string, undoAction?: () => void): void => {
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
};

const number = (value: unknown): number => (typeof value === 'number' ? value : 0);

const handleEvent = (event: LiveEvent): void => {
    completionDelivery?.handle(event);
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
    if (event.type === 'session.error') {
        stopVoice();
        useVoice.setState({ phase: 'error', error: i18next.t('voice:error.session') });
    }
};

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
        inputBands: Array(WAVEFORM_BAND_COUNT).fill(0),
        outputBands: Array(WAVEFORM_BAND_COUNT).fill(0),
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
            void outputWaveform.start(stream).catch(() => undefined);
        }
    );
    completionDelivery = new VoiceCompletionDelivery((event) => next.send(event));
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
        const { voiceLanguage, liveVoice } = useSettings.getState();
        const domains = await currentVoiceDomains();
        if (session !== next) {
            next.close();
            return;
        }
        startVoiceDiagnostics(domains);
        await next.start(stream, { language: voiceLanguage, voice: liveVoice, domains });
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
        unsubscribeChats = useChats.subscribe(flushChatFollowUps);
        followUpTimer = window.setInterval(pollChatFollowUps, 3000);
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
        releaseMicrophone?.();
        releaseMicrophone = null;
        next.close();
        session = null;
        completionDelivery?.clear();
        completionDelivery = null;
        toolQueue?.cancel();
        toolQueue = null;
        toolLoop?.reset();
        toolLoop = null;
        finishVoiceDiagnostics();
        if (clockTimer !== null) {
            window.clearInterval(clockTimer);
            clockTimer = null;
        }
        stopMicrophone();
        stopOutputWaveform();
        useVoice.setState({ phase: 'error', error: failureText(error) });
    }
}

export function stopVoice(): void {
    releaseMicrophone?.();
    releaseMicrophone = null;
    if (contextTimer !== null) {
        window.clearTimeout(contextTimer);
        contextTimer = null;
    }
    if (clockTimer !== null) {
        window.clearInterval(clockTimer);
        clockTimer = null;
    }
    unsubscribeDocument?.();
    unsubscribeDocument = null;
    unsubscribeChats?.();
    unsubscribeChats = null;
    unsubscribeProject?.();
    unsubscribeProject = null;
    if (followUpTimer !== null) {
        window.clearInterval(followUpTimer);
        followUpTimer = null;
    }
    for (const release of followUpReleases.values()) {
        release();
    }
    followUpReleases.clear();
    readingFollowUps.clear();
    chatFollowUps.clear();
    useVoice.setState({ phase: session ? 'closing' : 'idle' });
    session?.close();
    session = null;
    completionDelivery?.clear();
    completionDelivery = null;
    toolQueue?.cancel();
    toolQueue = null;
    toolLoop?.reset();
    toolLoop = null;
    finishVoiceDiagnostics();
    stopMicrophone();
    stopOutputWaveform();
    useVoice.setState({ phase: 'idle', sessionStartedAt: null });
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
        const current = microphone === next;
        if (current) {
            microphone = null;
        }
        next.stop();
        throw new Error(microphoneFailureText(error));
    }
}

function stopMicrophone(): void {
    microphone?.stop();
    microphone = null;
    useVoice.setState({ inputBands: Array(WAVEFORM_BAND_COUNT).fill(0) });
}

function stopOutputWaveform(): void {
    outputWaveform?.stop();
    outputWaveform = null;
    useVoice.setState({ outputBands: Array(WAVEFORM_BAND_COUNT).fill(0) });
}

export function closeVoicePanel(): void {
    useVoice.setState({ open: false });
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
