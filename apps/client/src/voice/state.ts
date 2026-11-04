import type { VoiceActionKind } from '@ruimte/voice';
import { create } from 'zustand';
import { silentBands } from '@/audio/waveform';
import { desktop, type OpenAiCredentialStatus } from '@/desktop/bridge';
import { useShownPanel, useUi } from '@/state/ui';
import { voiceOnMachine } from '@/voice/route';

export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'closing' | 'error';
export type { VoiceActionKind };
type VoiceActionStatus = 'running' | 'completed' | 'undone' | 'failed';

export interface VoiceUtterance {
    id: string;
    order: number;
    speaker: 'user' | 'assistant';
    text: string;
    startMs: number;
    endMs: number;
    interrupted: boolean;
}

export interface VoiceAction {
    id: string;
    order: number;
    kind: VoiceActionKind;
    status: VoiceActionStatus;
    label: string;
    detail: string;
    undoable: boolean;
}

let timelineOrder = 0;

export function nextVoiceTimelineOrder(): number {
    return ++timelineOrder;
}

interface VoiceState {
    credential: OpenAiCredentialStatus | null;
    phase: VoicePhase;
    error: string | null;
    transcript: VoiceUtterance[];
    actions: VoiceAction[];
    inputBands: number[];
    outputBands: number[];
    sessionStartedAt: number | null;
    setCredential(credential: OpenAiCredentialStatus): void;
}

export const useVoice = create<VoiceState>((set) => ({
    credential: null,
    phase: 'idle',
    error: null,
    transcript: [],
    actions: [],
    inputBands: silentBands(),
    outputBands: silentBands(),
    sessionStartedAt: null,
    setCredential: (credential) => {
        set({ credential });
        if (!credential.configured) {
            closeVoicePanel();
        }
    }
}));

export function openVoicePanel(): void {
    useUi.getState().setPanel({ open: true, kind: 'voice' });
}

export function closeVoicePanel(): void {
    const panel = useUi.getState().panel;
    if (panel.open && panel.kind === 'voice') {
        useUi.getState().setPanel({ open: false });
    }
}

/* Whether the window shows the Voice Control panel, which hides the floating caption. */
export function useVoicePanelOpen(): boolean {
    const panel = useShownPanel();
    return panel.open && panel.kind === 'voice';
}

export async function refreshVoiceCredential(): Promise<void> {
    if (voiceOnMachine()) {
        // Loaded only in the harness, so this module, which the toolbar loads, takes in no transport.
        const { machineVoiceCredential } = await import('@/voice/live-session');
        useVoice.setState({ credential: await machineVoiceCredential() });
        return;
    }
    const bridge = desktop()?.openAi;
    useVoice.setState({ credential: bridge ? await bridge.credentialStatus() : { configured: false, persistent: false } });
}

export function addTranscriptDelta(speaker: VoiceUtterance['speaker'], delta: string, startMs: number, endMs: number): void {
    if (delta === '') {
        return;
    }
    useVoice.setState((state) => {
        const transcript = [...state.transcript];
        const last = transcript.at(-1);
        if (speaker === 'user' && last?.speaker === 'assistant' && !last.interrupted && startMs <= last.endMs + 750) {
            transcript[transcript.length - 1] = { ...last, interrupted: true };
        }
        const current = transcript.at(-1);
        if (current?.speaker === speaker) {
            transcript[transcript.length - 1] = { ...current, text: current.text + delta, endMs: Math.max(current.endMs, endMs) };
        } else {
            const text = delta.trimStart();
            if (text === '') {
                return { transcript };
            }
            transcript.push({
                id: `${speaker}-${startMs}-${crypto.randomUUID()}`,
                order: nextVoiceTimelineOrder(),
                speaker,
                text,
                startMs,
                endMs,
                interrupted: false
            });
        }
        return { transcript };
    });
}
