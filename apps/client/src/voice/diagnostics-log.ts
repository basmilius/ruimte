import type { ActionDomain } from '@ruimte/actions';
import { VoiceDiagnosticsRecorder } from '@/voice/diagnostics';
import { summarizeVoiceSessions } from '@/voice/diagnostics-summary';
import type { ToolLoopObserver } from '@/voice/response-tool-loop';

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
