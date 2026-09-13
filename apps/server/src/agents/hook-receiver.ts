import { AgentKindSchema, type AgentKind } from '@ruimte/contracts';
import type { HookResult } from '../sessions/manager.ts';
import type { ApprovalDecision } from './approvals.ts';
import { hasHooks, takesHookContext } from './hooks.ts';

interface HookTarget {
    applyHook(kind: AgentKind, token: string, body: unknown): Promise<HookResult>;
}

/* Holds a permission request until someone answers it; null when nobody did, or when there is nobody to ask. */
export type ApprovalHold = (token: string, body: unknown, signal: AbortSignal) => Promise<ApprovalDecision | null>;

// A hook event whose answer decides whether a tool runs. Only Claude Code fires it.
const PERMISSION_EVENT = 'PermissionRequest';

export const HOOKS_PATH = '/hooks';

// A PostToolUse payload carries the tool output; anything past this is not a hook.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// The Claude Code events whose hook stdout becomes context for the model (`hookSpecificOutput.additionalContext`).
const CONTEXT_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);

const bearer = (request: Request): string | null => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
};

const eventOf = (body: unknown): string | null => {
    const event = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).hook_event_name : undefined;
    return typeof event === 'string' ? event : null;
};

/*
 * Answers `POST /hooks/<kind>` from a CLI hook. The token in the bearer header names the
 * session. A Claude Code prompt hook gets the session's context hint back as JSON, which the
 * hook command prints and the CLI folds into the turn; a permission hook is answered late, once
 * a person has decided; every other hook gets an empty 204.
 */
export const handleHookRequest = async (
    request: Request,
    pathname: string,
    target: HookTarget,
    contextHintForToken?: (token: string, event: string) => string | null,
    holdApproval?: ApprovalHold
): Promise<Response> => {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    // A kind the daemon has no normalizer for is as unknown here as one that is not an agent at all.
    const kind = AgentKindSchema.safeParse(pathname.slice(HOOKS_PATH.length + 1));
    if (!kind.success || !hasHooks(kind.data)) {
        return new Response('Unknown agent', { status: 404 });
    }
    const token = bearer(request);
    if (!token) {
        return new Response('Missing bearer token', { status: 401 });
    }
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) {
        return new Response('Payload too large', { status: 413 });
    }
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return new Response('Body is not JSON', { status: 400 });
    }
    const result = await target.applyHook(kind.data, token, body);
    if (result === 'unknown-token') {
        return new Response('Unknown token', { status: 401 });
    }
    const event = eventOf(body);
    if (result === 'applied' && holdApproval && event === PERMISSION_EVENT) {
        // The CLI is showing its own prompt while this waits, so an answer of null is not a failure:
        // it is the daemon stepping aside and leaving the question where it already was.
        const decision = await holdApproval(token, body, request.signal);
        if (decision !== null) {
            return Response.json({ hookSpecificOutput: { hookEventName: PERMISSION_EVENT, decision } });
        }
    }
    if (takesHookContext(kind.data) && event !== null && CONTEXT_EVENTS.has(event)) {
        const hint = contextHintForToken?.(token, event) ?? null;
        if (hint !== null) {
            return Response.json({ hookSpecificOutput: { hookEventName: event, additionalContext: hint } });
        }
    }
    return new Response(null, { status: 204 });
};
