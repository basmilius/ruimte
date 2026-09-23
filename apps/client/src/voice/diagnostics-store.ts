import { ACTION_DOMAINS, type ActionDomain } from '@ruimte/actions';
import { z } from 'zod';
import { create } from 'zustand';
import { VoiceDiagnosticsRecorder, type VoiceSessionRecord } from '@/voice/diagnostics';
import type { ToolLoopObserver } from '@/voice/response-tool-loop';

const STORAGE_KEY = 'ruimte.voice.diagnostics';
const PERSIST_DELAY_MS = 2_000;
export const MAX_STORED_SESSIONS = 20;
export const MAX_STORED_REQUESTS = 50;

const isDomain = (value: string): value is ActionDomain => (ACTION_DOMAINS as readonly string[]).includes(value);

const StoredSessionSchema = z.object({
    startedAt: z.number(),
    domains: z.array(z.string()).transform((domains) => domains.filter(isDomain)),
    toolCount: z.number(),
    toolBytes: z.number(),
    requests: z.array(
        z.object({
            status: z.enum(['running', 'answered', 'failed', 'unfinished']),
            totalMs: z.number().nullable(),
            responses: z.array(z.object({ durationMs: z.number(), status: z.enum(['completed', 'failed', 'incomplete', 'cancelled']), calls: z.number() })),
            calls: z.array(
                z.object({
                    tool: z.string(),
                    action: z.string().nullable(),
                    response: z.number(),
                    durationMs: z.number().nullable(),
                    result: z.string().nullable(),
                    target: z.object({ found: z.number(), ambiguous: z.number(), missing: z.number() }).optional()
                })
            )
        })
    )
});

/* What an older or damaged entry cannot be read as is dropped, not repaired. */
export const parseStoredSessions = (raw: string | null): VoiceSessionRecord[] => {
    if (raw === null) {
        return [];
    }
    try {
        const parsed = z.array(z.unknown()).safeParse(JSON.parse(raw));
        if (!parsed.success) {
            return [];
        }
        return parsed.data.flatMap((entry) => {
            const session = StoredSessionSchema.safeParse(entry);
            return session.success ? [session.data] : [];
        });
    } catch {
        return [];
    }
};

export const storedRing = (sessions: readonly VoiceSessionRecord[]): VoiceSessionRecord[] =>
    sessions.slice(-MAX_STORED_SESSIONS).map((session) => ({ ...session, requests: session.requests.slice(-MAX_STORED_REQUESTS) }));

const readStored = (): VoiceSessionRecord[] => {
    try {
        return parseStoredSessions(localStorage.getItem(STORAGE_KEY));
    } catch {
        return [];
    }
};

interface VoiceDiagnosticsState {
    history: VoiceSessionRecord[];
    current: VoiceSessionRecord | null;
}

export const useVoiceDiagnostics = create<VoiceDiagnosticsState>(() => ({ history: readStored(), current: null }));

let recorder: VoiceDiagnosticsRecorder | null = null;
let persistTimer: number | null = null;

const persist = (): void => {
    if (persistTimer !== null) {
        window.clearTimeout(persistTimer);
        persistTimer = null;
    }
    const { history, current } = useVoiceDiagnostics.getState();
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRing(current ? [...history, current] : history)));
    } catch {
        // Storage that refuses keeps the measurements for this session only.
    }
};

const persistSoon = (): void => {
    if (persistTimer === null) {
        persistTimer = window.setTimeout(persist, PERSIST_DELAY_MS);
    }
};

export const allVoiceSessions = (state: VoiceDiagnosticsState): VoiceSessionRecord[] => (state.current ? [...state.history, state.current] : state.history);

export function startVoiceDiagnostics(domains: readonly ActionDomain[]): void {
    finishVoiceDiagnostics();
    useVoiceDiagnostics.setState((state) => ({ history: storedRing(allVoiceSessions(state)), current: null }));
    recorder = new VoiceDiagnosticsRecorder(domains, Date.now, (current) => {
        useVoiceDiagnostics.setState({ current });
        persistSoon();
    });
}

export function finishVoiceDiagnostics(): void {
    if (recorder === null) {
        return;
    }
    recorder.finish();
    recorder = null;
    persist();
}

export function clearVoiceDiagnostics(): void {
    recorder?.clear();
    useVoiceDiagnostics.setState((state) => ({ history: [], current: recorder ? state.current : null }));
    persist();
}

/* The tool loop is built before the session knows its domains, so it reports to whichever recorder is current. */
export const voiceDiagnosticsObserver: ToolLoopObserver = {
    responseEvent: (delegationId, type) => recorder?.responseEvent(delegationId, type),
    responseRequested: (delegationId) => recorder?.responseRequested(delegationId),
    callStarted: (delegationId, callId, tool, rawArguments) => recorder?.callStarted(delegationId, callId, tool, rawArguments),
    callFinished: (callId, output) => recorder?.callFinished(callId, output)
};
