import { claimMicrophone } from '@/audio/ownership';
import i18next from 'i18next';
import { isCanvasView, isOpenableView } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { activeViewOf, useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { LiveSession, type LiveEvent } from '@/voice/live-session';
import { MicrophoneMonitor, WaveformMonitor, WAVEFORM_BAND_COUNT } from '@/audio/microphone';
import { ResponseToolLoop } from '@/voice/response-tool-loop';
import { chatCompletion, completionPrompt, type VoiceChatFollowUp } from '@/voice/chat-follow-up';
import { addTranscriptDelta, nextVoiceTimelineOrder, useVoice, type VoiceAction, type VoiceActionKind } from '@/voice/state';
import { executeVoiceTool } from '@/voice/tools';

let session: LiveSession | null = null;
let releaseMicrophone: (() => void) | null = null;
let microphone: MicrophoneMonitor | null = null;
let outputWaveform: WaveformMonitor | null = null;
let toolLoop: ResponseToolLoop | null = null;
let unsubscribeDocument: (() => void) | null = null;
let unsubscribeChats: (() => void) | null = null;
let contextTimer: number | null = null;
let clockTimer: number | null = null;
const undo = new Map<string, () => void>();
const chatFollowUps = new Map<string, VoiceChatFollowUp>();

const failureText = (error: unknown): string => (error instanceof Error ? error.message : i18next.t('voice:error.start'));

const microphoneFailureText = (error: unknown): string => {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return i18next.t('voice:error.microphoneDenied');
    }
    if (error instanceof DOMException && error.name === 'NotFoundError') {
        return i18next.t('voice:error.microphoneMissing');
    }
    return error instanceof Error ? error.message : i18next.t('voice:error.microphoneFailed');
};

/*
 * This context is for the speech model, not something a person reads, so it skips `format/`. A fixed
 * `en-GB` keeps the date unambiguous whatever the interface language is set to.
 */
const temporalContext = (): string => {
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
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

const appendContext = (): void => session?.send({ type: 'session.thinking.append', delegation_id: null, content: workspaceContext() });
const appendTime = (): void => session?.send({ type: 'session.thinking.append', delegation_id: null, content: temporalContext() });

const flushChatFollowUps = (): void => {
    const chats = useChats.getState().byKey;
    for (const [id, followUp] of chatFollowUps) {
        const completion = chatCompletion(chats[followUp.key], followUp.turnId);
        if (!completion) {
            continue;
        }
        chatFollowUps.delete(id);
        session?.send({ type: 'session.thinking.append', delegation_id: null, content: completionPrompt(followUp, completion) });
        session?.send({ type: 'response.create', event_id: crypto.randomUUID() });
    }
};

const trackChatFollowUp = (followUp: VoiceChatFollowUp): void => {
    chatFollowUps.set(`${followUp.key}:${followUp.turnId}`, followUp);
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
    toolLoop = new ResponseToolLoop(
        (event) => next.send(event),
        async (name, args) => {
            const execution = await executeVoiceTool(name, args);
            if (execution.action) {
                addAction(execution.action.kind, execution.action.label, execution.action.detail, execution.action.undo);
            }
            if (execution.followUp) {
                trackChatFollowUp(execution.followUp);
            }
            return execution.output;
        }
    );
    session = next;
    try {
        const stream = await startMicrophone();
        if (session !== next) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        const { voiceLanguage, liveVoice } = useSettings.getState();
        await next.start(stream, { language: voiceLanguage, voice: liveVoice });
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
    } catch (error) {
        if (session !== next) {
            next.close();
            return;
        }
        releaseMicrophone?.();
        releaseMicrophone = null;
        next.close();
        session = null;
        toolLoop?.reset();
        toolLoop = null;
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
    chatFollowUps.clear();
    useVoice.setState({ phase: session ? 'closing' : 'idle' });
    session?.close();
    session = null;
    toolLoop?.reset();
    toolLoop = null;
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
