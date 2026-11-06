import type { AgentStatus, ChatInfo } from '@adecore/agent-contracts';
import { EXTENSION_ERROR_CODES } from './extension-vocabularies.generated.ts';

/*
 * A daemon refuses an extension under one of the `ExtensionErrorCode`s of `@ruimte/extension`, and a host turns any other
 * code into one before an extension reads it. The list follows the `.d.ts` (`extension-vocabularies.generated.ts`).
 */
export { EXTENSION_ERROR_CODES };
export type ExtensionErrorCode = (typeof EXTENSION_ERROR_CODES)[number];

export type ExtensionResult<Value> = { ok: true; value: Value } | { ok: false; error: { code: ExtensionErrorCode; message: string } };

export function isExtensionErrorCode(code: string): code is ExtensionErrorCode {
    return (EXTENSION_ERROR_CODES as readonly string[]).includes(code);
}

/* A wrong shape of argument is the extension's own mistake, which it hears as a throw rather than a Result. */
export function isArgumentErrorCode(code: string): boolean {
    return code === 'bad-request' || code === 'invalid-input';
}

/* The code an extension reads for a code of the wire, an action or a verb. A refusal it has no word for is `refused`. */
export function extensionErrorCodeOf(code: string): ExtensionErrorCode {
    if (isExtensionErrorCode(code)) {
        return code;
    }

    if (code === 'forbidden') {
        return 'permission-denied';
    }

    if (code === 'not-connected' || code === 'unknown-request' || code === 'closed' || code === 'extension-unknown') {
        return 'unavailable';
    }

    if (code.endsWith('timeout') || code.endsWith('timed-out')) {
        return 'timeout';
    }

    if (code.startsWith('outside')) {
        return 'outside-project';
    }

    if (code.endsWith('not-found') || code.startsWith('no-') || code.startsWith('unknown-') || code === 'unreadable' || code === 'gone') {
        return 'not-found';
    }

    if (code === 'internal' || code === 'action-failed' || code === 'invalid-output') {
        return 'failed';
    }

    return 'refused';
}

export type ExtensionAgentStatus = 'idle' | 'running' | 'needsYou' | 'stopped';

/* An agent's status in the one word an extension reads everywhere; nothing to report reads as stopped. */
export function extensionAgentStatus(status: AgentStatus | null | undefined, needsYou = false): ExtensionAgentStatus {
    if (needsYou || status === 'needs-you') {
        return 'needsYou';
    }

    if (status === 'running') {
        return 'running';
    }

    return status === undefined || status === null || status === 'exited' ? 'stopped' : 'idle';
}

export interface ExtensionChatSummary {
    id: string;
    provider: string;
    status: ExtensionAgentStatus;
    model: string | null;
    cwd: string;
}

export function extensionChatOf(info: Pick<ChatInfo, 'chatId' | 'provider' | 'status' | 'model' | 'cwd' | 'requests'>): ExtensionChatSummary {
    return {
        id: info.chatId,
        provider: info.provider,
        status: extensionAgentStatus(info.status, (info.requests?.length ?? 0) > 0),
        model: info.model,
        cwd: info.cwd
    };
}
