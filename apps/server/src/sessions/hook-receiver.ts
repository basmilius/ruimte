import { isRecord } from '@adecore/utils/record';
import { AgentKindSchema, type AgentKind } from '@ruimte/contracts';
import type { HookResult } from './manager.ts';
import { bearerToken } from '../agents/bearer.ts';
import { hasHooks, takesHookContext } from '../agents/hooks.ts';

interface HookTarget {
    // Asked before the body is read, so a request with a made-up token costs no buffering.
    knows(token: string): boolean;
    applyHook(kind: AgentKind, token: string, body: unknown): Promise<HookResult>;
}

export const HOOKS_PATH = '/hooks';

// A PostToolUse payload carries the tool output; anything past this is not a hook.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// The events whose hook stdout becomes context for the model (`hookSpecificOutput.additionalContext`), in Claude Code and Codex alike.
const CONTEXT_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);

/* The body as text, or null once it passes `maxBytes`, which a chunked body without `content-length` can only show while it is read. */
async function bodyUpTo(request: Request, maxBytes: number): Promise<string | null> {
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let total = 0;

    for (let chunk = await reader?.read(); chunk !== undefined && !chunk.done; chunk = await reader?.read()) {
        total += chunk.value.byteLength;
        if (total > maxBytes) {
            void reader?.cancel();
            return null;
        }
        text += decoder.decode(chunk.value, { stream: true });
    }

    return text + decoder.decode();
}

function eventOf(body: unknown): string | null {
    const event = isRecord(body) ? body.hook_event_name : undefined;
    return typeof event === 'string' ? event : null;
}

/*
 * Answers `POST /hooks/<kind>` from a CLI hook. The token in the bearer header names the
 * session. A Claude Code or Codex prompt hook gets the session's context hint back as JSON, which the
 * hook command prints and the CLI folds into the turn; every other hook gets an empty 204. A permission
 * request is only a status: the CLI's own prompt is where it is answered.
 */
export async function handleHookRequest(
    request: Request,
    pathname: string,
    target: HookTarget,
    contextHintForToken?: (token: string, event: string, kind: AgentKind) => string | null
): Promise<Response> {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    // A kind the daemon has no normalizer for is as unknown here as one that is not an agent at all.
    const kind = AgentKindSchema.safeParse(pathname.slice(HOOKS_PATH.length + 1));
    if (!kind.success || !hasHooks(kind.data)) {
        return new Response('Unknown agent', { status: 404 });
    }
    const token = bearerToken(request);
    if (!token) {
        return new Response('Missing bearer token', { status: 401 });
    }
    if (!target.knows(token)) {
        return new Response('Unknown token', { status: 401 });
    }
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) {
        return new Response('Payload too large', { status: 413 });
    }
    const text = await bodyUpTo(request, MAX_BODY_BYTES);
    if (text === null) {
        return new Response('Payload too large', { status: 413 });
    }
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return new Response('Body is not JSON', { status: 400 });
    }
    const result = await target.applyHook(kind.data, token, body);
    if (result === 'unknown-token') {
        return new Response('Unknown token', { status: 401 });
    }
    const event = eventOf(body);
    if (takesHookContext(kind.data) && event !== null && CONTEXT_EVENTS.has(event)) {
        const hint = contextHintForToken?.(token, event, kind.data) ?? null;
        if (hint !== null) {
            return Response.json({ hookSpecificOutput: { hookEventName: event, additionalContext: hint } });
        }
    }
    return new Response(null, { status: 204 });
}
