import type { VoiceToolDefinition } from '@ruimte/actions';
import { VOICE_LANGUAGES, VOICE_SDP_MAX_CHARS, type LiveVoice, type VoiceLanguage } from '@ruimte/contracts';
import { livePrompts, type LiveRunner } from './prompts.ts';

export const OPENAI_API_URL = 'https://api.openai.com';

export interface LiveSessionAnswer {
    session: { id: string };
    transport: { type: 'webrtc'; sdp: string };
}

/* What a session is minted with. The prompts follow from the runner: the desktop and a phone ask different things of the voice. */
export interface LiveSessionRequest {
    language: VoiceLanguage;
    voice: LiveVoice;
    tools: readonly VoiceToolDefinition[];
    sdp: string;
}

function languageEntry(language: VoiceLanguage): (typeof VOICE_LANGUAGES)[number] {
    return VOICE_LANGUAGES.find((entry) => entry.id === language)!;
}

function languageInstruction(language: VoiceLanguage): string {
    const entry = languageEntry(language);
    const name = entry.english;
    const speaker = 'accent' in entry ? entry.accent : `a native ${name} speaker`;
    return `Conduct the entire conversation in ${name}. Understand ${name} speech and always reply in natural ${name} unless the user explicitly asks for another language. Speak with the pronunciation, rhythm and standard accent of ${speaker}; do not carry an English accent into ${name}.`;
}

/*
 * The voice paraphrases what the backend writes. Given English it translates while it speaks and keeps
 * an English cadence, so the backend writes in the spoken language from the start.
 */
function responsesLanguageInstruction(language: VoiceLanguage): string {
    const name = languageEntry(language).english;

    return `Write every reply that the voice will say to the user in natural, idiomatic ${name}, as a native ${name} speaker would say it aloud, never as a translation from English. Keep ids, tool arguments and quoted names exactly as they are, and send a prompt to an AI Chat in the language the user spoke it in.`;
}

/* The body of `POST /v1/live/sessions`: GPT-Live speaks and delegates every Ruimte request to a Responses backend with the tools. */
export function liveSessionBody(request: LiveSessionRequest, runner: LiveRunner): Record<string, unknown> {
    const prompts = livePrompts(runner);

    return {
        session: {
            model: 'gpt-live-1',
            // Language and pronunciation come first, the way OpenAI's own Live prompts start.
            instructions: `${languageInstruction(request.language)}\n${prompts.instructions}`,
            audio: { output: { voice: request.voice } },
            delegation: {
                type: 'responses',
                responses: {
                    model: 'gpt-6-luna',
                    instructions: `${responsesLanguageInstruction(request.language)}\n${prompts.responsesInstructions}`,
                    max_output_tokens: 1024,
                    reasoning: { effort: 'none' },
                    text: { verbosity: 'low' },
                    tools: request.tools,
                    tool_choice: 'auto',
                    parallel_tool_calls: true
                }
            }
        },
        transport: { type: 'webrtc', sdp: request.sdp }
    };
}

export function isLiveSessionAnswer(value: unknown): value is LiveSessionAnswer {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { session?: unknown; transport?: unknown };
    const session = candidate.session as { id?: unknown } | undefined;
    const transport = candidate.transport as { type?: unknown; sdp?: unknown } | undefined;
    return typeof session?.id === 'string' && transport?.type === 'webrtc' && typeof transport.sdp === 'string';
}

// An id OpenAI gives a session goes into a path, so only the characters an id is made of.
const SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/;

export function isLiveSessionId(value: string): boolean {
    return SESSION_ID.test(value);
}

export interface LiveFetchInit {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
}

export interface LiveFetchResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

/* The runner's own fetch: the daemon's, or the desktop shell's `net.fetch`. */
export type LiveFetch = (input: string, init: LiveFetchInit) => Promise<LiveFetchResponse>;

export type LiveMintFailure = 'invalid-offer' | 'unreachable' | 'cancelled' | 'key-rejected' | 'rate-limited' | 'failed' | 'invalid-session';

/* Why a session could not be minted. The message is for a person and never holds the key or a response body. */
export class LiveMintError extends Error {
    readonly code: LiveMintFailure;

    constructor(code: LiveMintFailure, message: string) {
        super(message);
        this.code = code;
    }
}

const KEY_REJECTED: Record<LiveRunner, string> = {
    desktop: 'The saved OpenAI API key was rejected',
    phone: 'OpenAI rejected the Voice key on this machine'
};

const UNREACHABLE: Record<LiveRunner, string> = {
    desktop: 'OpenAI could not be reached',
    phone: 'The machine could not reach OpenAI'
};

function mintError(status: number, runner: LiveRunner): LiveMintError {
    if (status === 401) {
        return new LiveMintError('key-rejected', KEY_REJECTED[runner]);
    }
    if (status === 429) {
        return new LiveMintError('rate-limited', 'OpenAI is limiting this key for now');
    }
    return new LiveMintError('failed', `OpenAI could not start GPT-Live (${status})`);
}

export interface LiveMintOptions {
    signal?: AbortSignal;
    /* Only a test points this elsewhere, at a fake on loopback. */
    baseUrl?: string;
}

/*
 * Mints a GPT-Live session at OpenAI. The key is the caller's: it is handed in for this call, goes into the
 * `Authorization` header and nowhere else, and is not kept.
 */
export async function mintLiveSession(
    fetch: LiveFetch,
    key: string,
    request: LiveSessionRequest,
    runner: LiveRunner,
    options: LiveMintOptions = {}
): Promise<LiveSessionAnswer> {
    if (request.sdp.trim() === '' || request.sdp.length > VOICE_SDP_MAX_CHARS) {
        throw new LiveMintError('invalid-offer', 'The microphone session offer is invalid');
    }
    let response: LiveFetchResponse;
    try {
        response = await fetch(`${options.baseUrl ?? OPENAI_API_URL}/v1/live/sessions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(liveSessionBody(request, runner)),
            signal: options.signal
        });
    } catch {
        throw options.signal?.aborted ? new LiveMintError('cancelled', 'The Voice start was stopped') : new LiveMintError('unreachable', UNREACHABLE[runner]);
    }
    if (!response.ok) {
        throw mintError(response.status, runner);
    }
    const answer: unknown = await response.json().catch(() => null);
    if (!isLiveSessionAnswer(answer) || !isLiveSessionId(answer.session.id)) {
        throw new LiveMintError('invalid-session', 'OpenAI returned an invalid GPT-Live session');
    }
    return answer;
}
