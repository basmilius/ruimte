import type { VoiceToolDefinition } from '@ruimte/actions';
import { VOICE_LANGUAGES, type LiveVoice, type VoiceLanguage } from '@ruimte/contracts';

export interface LiveSessionAnswer {
    session: { id: string };
    transport: { type: 'webrtc'; sdp: string };
}

/* What a session is minted with. The prompts are the caller's: the desktop and a phone ask different things of the voice. */
export interface LiveSessionRequest {
    language: VoiceLanguage;
    voice: LiveVoice;
    instructions: string;
    responsesInstructions: string;
    tools: readonly VoiceToolDefinition[];
    sdp: string;
}

function languageName(language: VoiceLanguage): string {
    return VOICE_LANGUAGES.find((entry) => entry.id === language)!.english;
}

function accentOf(language: VoiceLanguage): string | null {
    const entry = VOICE_LANGUAGES.find((candidate) => candidate.id === language)!;
    return 'accent' in entry ? entry.accent : null;
}

function languageInstruction(language: VoiceLanguage): string {
    const name = languageName(language);
    const accent = accentOf(language);
    const speaker = accent === null ? `a native ${name} speaker` : accent;
    return `Conduct the entire conversation in ${name}. Understand ${name} speech and always reply in natural ${name} unless the user explicitly asks for another language. Speak with the pronunciation, rhythm and standard accent of ${speaker}; do not carry an English accent into ${name}.`;
}

/*
 * The voice paraphrases what the backend writes. Given English it translates while it speaks and keeps
 * an English cadence, so the backend writes in the spoken language from the start.
 */
function responsesLanguageInstruction(language: VoiceLanguage): string {
    const name = languageName(language);
    return `Write every reply that the voice will say to the user in natural, idiomatic ${name}, as a native ${name} speaker would say it aloud, never as a translation from English. Keep ids, tool arguments and quoted names exactly as they are, and send a prompt to an AI Chat in the language the user spoke it in.`;
}

/* The body of `POST /v1/live/sessions`: GPT-Live speaks and delegates every Ruimte request to a Responses backend with the tools. */
export function liveSessionBody(request: LiveSessionRequest): Record<string, unknown> {
    return {
        session: {
            model: 'gpt-live-1',
            // Language and pronunciation come first, the way OpenAI's own Live prompts start.
            instructions: `${languageInstruction(request.language)}\n${request.instructions}`,
            audio: { output: { voice: request.voice } },
            delegation: {
                type: 'responses',
                responses: {
                    model: 'gpt-6-luna',
                    instructions: `${responsesLanguageInstruction(request.language)}\n${request.responsesInstructions}`,
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
