import { VOICE_CONTROL_TOOL, VOICE_TOOL_ACTIONS, voiceToolsFor, type ActionDomain } from '@ruimte/actions';

/*
 * How Voice fared, measured on this machine and never sent anywhere. A record holds names, codes,
 * counts, sizes and durations only: no transcript, no prompt, no argument a person spoke.
 */

export type VoiceResponseStatus = 'completed' | 'failed' | 'incomplete' | 'cancelled';
export type VoiceRequestStatus = 'running' | 'answered' | 'failed' | 'unfinished';

export interface VoiceTargetCounts {
    found: number;
    ambiguous: number;
    missing: number;
}

export interface VoiceCallRecord {
    tool: string;
    /* Null when the model named an action its tool does not have. */
    action: string | null;
    /* Which model response of the request asked for it, counted from 0. */
    response: number;
    /* Null while the call runs. */
    durationMs: number | null;
    /* `ok`, `needs_confirmation` or a refusal code; null while the call runs. */
    result: string | null;
    target?: VoiceTargetCounts;
}

export interface VoiceResponseRecord {
    durationMs: number;
    status: VoiceResponseStatus;
    calls: number;
}

export interface VoiceRequestRecord {
    status: VoiceRequestStatus;
    /* Until the answer, from the first event of the request; null while it runs. */
    totalMs: number | null;
    responses: VoiceResponseRecord[];
    calls: VoiceCallRecord[];
}

export interface VoiceSessionRecord {
    startedAt: number;
    domains: ActionDomain[];
    toolCount: number;
    toolBytes: number;
    requests: VoiceRequestRecord[];
}

export const MAX_REQUESTS_PER_SESSION = 100;

const END_STATUSES: Readonly<Record<string, VoiceResponseStatus>> = {
    'response.completed': 'completed',
    'response.failed': 'failed',
    'response.incomplete': 'incomplete',
    'response.cancelled': 'cancelled'
};

/* A code is kept only when it looks like one, so a message can never pass for it. */
const CODE = /^[a-z][a-z0-9_-]{0,47}$/;

const parsedArguments = (raw: string): Record<string, unknown> | null => {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

/* Only a name from the catalog is kept; whatever else the model put in `action` is dropped. */
export const voiceActionOf = (tool: string, rawArguments: string): string | null => {
    const action = parsedArguments(rawArguments)?.action;
    if (typeof action !== 'string') {
        return null;
    }
    if (tool === VOICE_CONTROL_TOOL) {
        return action === 'confirm' || action === 'cancel' ? action : null;
    }
    return VOICE_TOOL_ACTIONS.get(tool)?.find((name) => name === action) ?? null;
};

export const voiceResultOf = (output: Record<string, unknown>): string => {
    if (output.ok === true) {
        return 'ok';
    }
    if (output.needs_confirmation === true) {
        return 'needs_confirmation';
    }
    return typeof output.code === 'string' && CODE.test(output.code) ? output.code : 'failed';
};

const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

export const voiceTargetOf = (output: Record<string, unknown>): VoiceTargetCounts => ({
    found: lengthOf(output.found),
    ambiguous: lengthOf(output.ambiguous),
    missing: lengthOf(output.missing)
});

export const voiceToolBytes = (domains: readonly ActionDomain[]): { count: number; bytes: number } => {
    const tools = voiceToolsFor(domains);
    return { count: tools.length, bytes: new TextEncoder().encode(JSON.stringify(tools)).length };
};

interface OpenRequest {
    record: VoiceRequestRecord;
    startedAt: number;
    responseStartedAt: number | null;
    responseCalls: number;
}

interface OpenCall {
    record: VoiceCallRecord;
    startedAt: number;
}

/*
 * Follows the requests of one Voice session. A request is a delegation: model responses and the
 * tool calls between them, until a response that asks for nothing more is the answer.
 */
export class VoiceDiagnosticsRecorder {
    readonly #now: () => number;
    readonly #ended: (request: VoiceRequestRecord) => void;
    readonly #session: VoiceSessionRecord;
    readonly #requests = new Map<string, OpenRequest>();
    readonly #calls = new Map<string, OpenCall>();

    constructor(domains: readonly ActionDomain[], now: () => number, ended: (request: VoiceRequestRecord) => void) {
        this.#now = now;
        this.#ended = ended;
        const tools = voiceToolBytes(domains);
        this.#session = { startedAt: now(), domains: [...domains], toolCount: tools.count, toolBytes: tools.bytes, requests: [] };
    }

    get session(): VoiceSessionRecord {
        return structuredClone(this.#session);
    }

    /* Any event of a delegation; the first one opens the request and, unless one was asked for, a response. */
    responseEvent(delegationId: string, type: string): void {
        const request = this.#request(delegationId);
        const now = this.#now();
        request.responseStartedAt ??= now;
        const status = END_STATUSES[type];
        if (status === undefined) {
            return;
        }
        request.record.responses.push({ durationMs: now - request.responseStartedAt, status, calls: request.responseCalls });
        const asked = request.responseCalls > 0;
        request.responseStartedAt = null;
        request.responseCalls = 0;
        if (status !== 'completed' || !asked) {
            request.record.status = status === 'completed' ? 'answered' : 'failed';
            request.record.totalMs = now - request.startedAt;
            this.#requests.delete(delegationId);
            this.#ended(structuredClone(request.record));
        }
    }

    responseRequested(delegationId: string): void {
        const request = this.#requests.get(delegationId);
        if (request) {
            request.responseStartedAt = this.#now();
        }
    }

    callStarted(delegationId: string, callId: string, tool: string, rawArguments: string): void {
        const request = this.#request(delegationId);
        request.responseStartedAt ??= this.#now();
        const record: VoiceCallRecord = {
            tool,
            action: voiceActionOf(tool, rawArguments),
            response: request.record.responses.length,
            durationMs: null,
            result: null
        };
        request.responseCalls += 1;
        request.record.calls.push(record);
        this.#calls.set(callId, { record, startedAt: this.#now() });
    }

    callFinished(callId: string, output: Record<string, unknown>): void {
        const call = this.#calls.get(callId);
        if (!call) {
            return;
        }
        this.#calls.delete(callId);
        call.record.durationMs = this.#now() - call.startedAt;
        call.record.result = voiceResultOf(output);
        if (call.record.action === 'target.resolve' && call.record.result === 'ok') {
            call.record.target = voiceTargetOf(output);
        }
    }

    /* The session ended; what still waited on the model never got its answer. */
    finish(): void {
        for (const request of this.#requests.values()) {
            request.record.status = 'unfinished';
            this.#ended(structuredClone(request.record));
        }
        this.#requests.clear();
        this.#calls.clear();
    }

    #request(delegationId: string): OpenRequest {
        const open = this.#requests.get(delegationId);
        if (open) {
            return open;
        }
        const record: VoiceRequestRecord = { status: 'running', totalMs: null, responses: [], calls: [] };
        const request: OpenRequest = { record, startedAt: this.#now(), responseStartedAt: null, responseCalls: 0 };
        this.#requests.set(delegationId, request);
        this.#session.requests.push(record);
        if (this.#session.requests.length > MAX_REQUESTS_PER_SESSION) {
            this.#session.requests.shift();
        }
        return request;
    }
}
