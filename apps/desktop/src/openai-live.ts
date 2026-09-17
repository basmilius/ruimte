import { VOICE_TOOL_DEFINITIONS } from '@ruimte/contracts';

export interface LiveSessionAnswer {
    session: { id: string };
    transport: { type: 'webrtc'; sdp: string };
}

const LANGUAGE_NAMES = {
    ar: 'Arabic',
    ca: 'Catalan',
    zh: 'Chinese',
    cs: 'Czech',
    da: 'Danish',
    nl: 'Dutch',
    en: 'English',
    fi: 'Finnish',
    fr: 'French',
    de: 'German',
    el: 'Greek',
    he: 'Hebrew',
    hi: 'Hindi',
    hu: 'Hungarian',
    id: 'Indonesian',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    no: 'Norwegian',
    pl: 'Polish',
    pt: 'Portuguese',
    ro: 'Romanian',
    ru: 'Russian',
    es: 'Spanish',
    sv: 'Swedish',
    th: 'Thai',
    tr: 'Turkish',
    uk: 'Ukrainian',
    vi: 'Vietnamese'
} as const;

const LIVE_VOICES = ['marin', 'cedar'] as const;

type VoiceLanguage = keyof typeof LANGUAGE_NAMES;
type LiveVoice = (typeof LIVE_VOICES)[number];

export interface OpenAiLivePreferences {
    language: VoiceLanguage;
    voice: LiveVoice;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const INSTRUCTIONS = `You are the voice interface for Ruimte, a spatial workspace for terminals, agents, notes, browsers and project views.
Speak concisely. The application sends private workspace and time context as thinking messages.
Delegate every request that reads, changes or controls Ruimte to the Responses backend. This includes focusing, creating or renaming views and nodes; adding notes, terminals, AI Chats, browsers and groups; controlling the canvas; and submitting prompts to AI Chat. Delegate compound requests once and let the backend use as many Ruimte tools as needed. Never claim an action succeeded until the backend reports its verified result. Never answer on behalf of a target AI Chat.`;

const RESPONSES_INSTRUCTIONS = `You execute requests from a live voice conversation by calling Ruimte tools.
Transcripts can contain mistakes, omitted words, corrections and references to earlier turns. Use conversation context and inspect_workspace when the target or current state is unclear. For every request that reads or changes Ruimte, call the appropriate tool instead of merely describing what you would do. For compound requests, call tools in the required order and use each result before continuing. Never claim success without an ok tool result.
Call independent tools together. Only wait for an earlier tool when its result is needed to choose the next call.
When prompting AI Chat, send the direct request the target agent should receive. For example, “go to Chat Test and ask for a motivating quote” requires focus_view followed by prompt_ai_chat with prompt “Give a motivating quote”. Do not forward meta-language such as “ask the chat”, and do not turn a user's correction or observation into a chat prompt unless they explicitly request submission.
For reminder-like note requests, create a note whose content is the useful reminder itself. Do not claim that a notification or alarm was scheduled. Do not delete anything; destructive Ruimte tools are intentionally unavailable.`;

const languageInstruction = (language: VoiceLanguage): string => {
    const name = LANGUAGE_NAMES[language];
    return `Conduct the entire conversation in ${name}. Understand ${name} speech and always reply in natural ${name} unless the user explicitly asks for another language. Speak with the pronunciation, rhythm and standard accent of a native ${name} speaker; do not carry an English accent into ${name}.`;
};

export const parseOpenAiLivePreferences = (value: unknown): OpenAiLivePreferences | null => {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const candidate = value as { language?: unknown; voice?: unknown };
    const language = typeof candidate.language === 'string' && candidate.language in LANGUAGE_NAMES ? (candidate.language as VoiceLanguage) : null;
    const voice = LIVE_VOICES.find((item) => item === candidate.voice) ?? null;
    return language && voice ? { language, voice } : null;
};

const isAnswer = (value: unknown): value is LiveSessionAnswer => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { session?: unknown; transport?: unknown };
    const session = candidate.session as { id?: unknown } | undefined;
    const transport = candidate.transport as { type?: unknown; sdp?: unknown } | undefined;
    return typeof session?.id === 'string' && transport?.type === 'webrtc' && typeof transport.sdp === 'string';
};

export async function createOpenAiLiveSession(fetch: Fetch, apiKey: string, sdp: string, preferences: OpenAiLivePreferences): Promise<LiveSessionAnswer> {
    if (sdp.trim() === '' || sdp.length > 128_000) {
        throw new Error('The microphone session offer is invalid');
    }
    const response = await fetch('https://api.openai.com/v1/live/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session: {
                model: 'gpt-live-1',
                instructions: `${INSTRUCTIONS}\n${languageInstruction(preferences.language)}`,
                audio: { output: { voice: preferences.voice } },
                delegation: {
                    type: 'responses',
                    responses: {
                        model: 'gpt-5.6-terra',
                        instructions: RESPONSES_INSTRUCTIONS,
                        max_output_tokens: 256,
                        reasoning: { effort: 'none' },
                        text: { verbosity: 'low' },
                        tools: VOICE_TOOL_DEFINITIONS,
                        tool_choice: 'auto',
                        parallel_tool_calls: true
                    }
                }
            },
            transport: { type: 'webrtc', sdp }
        })
    });
    if (!response.ok) {
        throw new Error(response.status === 401 ? 'The saved OpenAI API key was rejected' : `OpenAI could not start GPT-Live (${response.status})`);
    }
    const answer: unknown = await response.json();
    if (!isAnswer(answer)) {
        throw new Error('OpenAI returned an invalid GPT-Live session');
    }
    return answer;
}
