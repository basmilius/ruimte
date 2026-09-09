import { AgentKindSchema } from '@ruimte/contracts';
import type { HookResult } from '../sessions/manager.ts';

export interface HookTarget {
    applyHook(kind: 'claude' | 'codex', token: string, body: unknown): Promise<HookResult>;
}

export const HOOKS_PATH = '/hooks';

// A PostToolUse payload carries the tool output; anything past this is not a hook.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const bearer = (request: Request): string | null => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
};

/* Answers `POST /hooks/<kind>` from a CLI hook. The token in the bearer header names the session. */
export const handleHookRequest = async (request: Request, pathname: string, target: HookTarget): Promise<Response> => {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    const kind = AgentKindSchema.safeParse(pathname.slice(HOOKS_PATH.length + 1));
    if (!kind.success) {
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
    return new Response(null, { status: 204 });
};
