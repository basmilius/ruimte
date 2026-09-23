import { create } from 'zustand';
import { desktop, type OpenAiCredentialStatus } from '@/desktop/bridge';

export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'closing' | 'error';
export type VoiceActionKind = 'focus' | 'rename' | 'note' | 'terminal' | 'chat' | 'node' | 'view' | 'delete' | 'git';
export type VoiceActionStatus = 'running' | 'completed' | 'undone' | 'failed';

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
const VOICE_WIDTH_KEY = 'ruimte.voice.width';

const readVoiceWidth = (): number | null => {
    try {
        const value = Number.parseInt(localStorage.getItem(VOICE_WIDTH_KEY) ?? '', 10);
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
};

const persistVoiceWidth = (width: number): void => {
    try {
        localStorage.setItem(VOICE_WIDTH_KEY, String(width));
    } catch {
        // Storage that refuses keeps the width for this session only.
    }
};

export const nextVoiceTimelineOrder = (): number => ++timelineOrder;

interface VoiceState {
    credential: OpenAiCredentialStatus | null;
    open: boolean;
    phase: VoicePhase;
    error: string | null;
    transcript: VoiceUtterance[];
    actions: VoiceAction[];
    inputBands: number[];
    outputBands: number[];
    sessionStartedAt: number | null;
    width: number | null;
    setCredential(credential: OpenAiCredentialStatus): void;
    setOpen(open: boolean): void;
    setWidth(width: number): void;
}

export const useVoice = create<VoiceState>((set) => ({
    credential: null,
    open: false,
    phase: 'idle',
    error: null,
    transcript: [],
    actions: [],
    inputBands: Array(40).fill(0),
    outputBands: Array(40).fill(0),
    sessionStartedAt: null,
    width: readVoiceWidth(),
    setCredential: (credential) => set((state) => ({ credential, open: credential.configured ? state.open : false })),
    setOpen: (open) => set({ open }),
    setWidth: (width) => {
        persistVoiceWidth(width);
        set({ width });
    }
}));

export async function refreshVoiceCredential(): Promise<void> {
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
