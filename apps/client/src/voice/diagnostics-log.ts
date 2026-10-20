import type { ActionDomain } from '@ruimte/actions';
import { VoiceDiagnosticsRecorder } from '@/voice/diagnostics';
import { summarizeVoiceSessions } from '@/voice/diagnostics-summary';
import type { LiveEvent, ToolLoopObserver, VoiceDeliveryObserver } from '@ruimte/voice';

/* Measurements go to the developer console and nowhere else; nothing is kept once the window closes. */
let recorder: VoiceDiagnosticsRecorder | null = null;

export function startVoiceDiagnostics(domains: readonly ActionDomain[]): void {
    finishVoiceDiagnostics();
    recorder = new VoiceDiagnosticsRecorder(domains, Date.now, (request) => console.debug('[voice] request', request));
}

export function finishVoiceDiagnostics(): void {
    if (recorder === null) {
        return;
    }
    recorder.finish();
    const session = recorder.session;
    recorder = null;
    console.debug('[voice] session', summarizeVoiceSessions([session]), session);
}

/* The tool loop is built before the session knows its domains, so it reports to whichever recorder is current. */
export const voiceDiagnosticsObserver: ToolLoopObserver = {
    responseEvent: (delegationId, type) => recorder?.responseEvent(delegationId, type),
    responseRequested: (delegationId) => recorder?.responseRequested(delegationId),
    callStarted: (delegationId, callId, tool, rawArguments) => recorder?.callStarted(delegationId, callId, tool, rawArguments),
    callFinished: (callId, output) => recorder?.callFinished(callId, output)
};

/* Only a code that looks like one is logged, so a message from the service, which may quote the user, never is. */
function codeOf(value: unknown): string | null {
    return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(value) ? value : null;
}

export const voiceDeliveryObserver: VoiceDeliveryObserver = {
    reportSpoken: () => console.debug('[voice] report', 'spoken'),
    appendTimedOut: () => console.debug('[voice] report', 'append timed out, moved on'),
    reportDropped: (code) => console.debug('[voice] report', 'dropped after a refused append', codeOf(code))
};

/* A command error leaves the session running, so it is noted rather than ending Voice. */
export function noteVoiceError(event: LiveEvent): void {
    const error = event.error as { type?: unknown; code?: unknown } | undefined;
    console.debug('[voice] error', codeOf(error?.type), codeOf(error?.code));
}
