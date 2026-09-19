import { randomUUID } from 'node:crypto';
import type { ApprovalChoice, ApprovalRequest } from '@ruimte/contracts';
import { asString, ASKING_TOOLS } from './hooks.ts';

// Expire before curl and the CLI hook timeouts so the daemon, not either outer layer, releases first.
export const APPROVAL_HOLD_MS = 110_000;

// Despite the published docs, `hookSpecificOutput.decision` must be this object; the CLI rejects a string.
export type ApprovalDecision = { behavior: 'allow'; updatedPermissions?: unknown[] } | { behavior: 'deny'; message: string };

interface PermissionAsk {
    toolName: string;
    summary: string;
    suggestions: unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/*
 * The one line a person reads under the tool's name. A shell call is its command, a file tool its
 * path, and anything else falls back to the first string field the input has, because a CLI adds
 * tools faster than this list grows and an unnamed request is worse than a roughly named one.
 */
const summarize = (toolName: string, input: unknown): string => {
    if (!isRecord(input)) {
        return '';
    }
    const named = asString(input.command) ?? asString(input.file_path) ?? asString(input.path) ?? asString(input.url) ?? asString(input.pattern);
    if (named !== null) {
        return named;
    }
    for (const value of Object.values(input)) {
        const text = asString(value);
        if (text !== null) {
            return text;
        }
    }
    return toolName;
};

/*
 * The label of a rule the CLI offered to remember. Only the suggestions whose shape the daemon can
 * name become a button; the rest travel back untouched if that button is pressed, so an unlabeled
 * one is dropped rather than shown as a choice nobody can read.
 */
const suggestionLabel = (suggestion: unknown): string | null => {
    if (!isRecord(suggestion)) {
        return null;
    }
    if (suggestion.type === 'addRules' && suggestion.behavior === 'allow' && Array.isArray(suggestion.rules)) {
        const rules = suggestion.rules.filter(isRecord);
        const first = rules[0];
        if (!first) {
            return null;
        }
        const content = asString(first.ruleContent);
        const tool = asString(first.toolName) ?? 'this tool';
        return content === null ? `Always allow ${tool}` : `Always allow ${content}`;
    }
    if (suggestion.type === 'addDirectories' && Array.isArray(suggestion.directories)) {
        const first = asString(suggestion.directories[0]);
        return first === null ? null : `Always allow ${first}`;
    }
    // `setMode` widens the whole session rather than this one call, which is not a thing to press by accident.
    return null;
};

/* Reads a Claude Code `PermissionRequest` hook payload; null when the body is any other hook. */
export const parsePermissionAsk = (body: unknown): PermissionAsk | null => {
    if (!isRecord(body) || body.hook_event_name !== 'PermissionRequest') {
        return null;
    }
    const toolName = asString(body.tool_name);
    // A question asks for answers, not for permission: Allow would only let the TUI ask it, so its own screen does.
    if (toolName === null || ASKING_TOOLS.has(toolName)) {
        return null;
    }
    return {
        toolName,
        summary: summarize(toolName, body.tool_input),
        suggestions: Array.isArray(body.permission_suggestions) ? body.permission_suggestions : []
    };
};

interface Pending {
    request: ApprovalRequest;
    // The CLI's own suggestion behind each `remember` choice, handed back verbatim when one is pressed.
    remembers: Map<string, unknown>;
    settle: (decision: ApprovalDecision | null) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface ApprovalSink {
    (sessionId: string, approvals: ApprovalRequest[]): void;
}

interface HoldOptions {
    sessionId: string;
    ask: PermissionAsk;
    // Fires when the CLI dies under the hook. Answering in the TUI does not abort it: Claude Code
    // 2.1.270 leaves the hook running, so that path is closed by the end of the turn instead.
    signal: AbortSignal;
}

/*
 * The permission requests the terminal agents of this daemon are waiting on. A request is held for
 * as long as the hook that carries it is alive, answered once (whoever is first, in a client or in
 * the CLI's own prompt), and forgotten when its session goes. Nothing is written to disk: a request
 * that outlives the process it belongs to has no one left to answer to.
 */
export class ApprovalStore {
    private readonly pending = new Map<string, Pending>();
    private readonly bySession = new Map<string, Set<string>>();
    private readonly sink: ApprovalSink;
    private readonly holdMs: number;

    constructor(sink: ApprovalSink, holdMs: number = APPROVAL_HOLD_MS) {
        this.sink = sink;
        this.holdMs = holdMs;
    }

    /* Opens a request and answers when someone decides, or with null when nobody does in time. */
    hold(options: HoldOptions): Promise<ApprovalDecision | null> {
        const { sessionId, ask, signal } = options;
        const requestId = randomUUID();
        const createdAt = Date.now();
        const remembers = new Map<string, unknown>();
        const choices: ApprovalChoice[] = [{ id: 'allow', kind: 'allow', label: 'Allow once' }];
        ask.suggestions.forEach((suggestion, index) => {
            const label = suggestionLabel(suggestion);
            if (label === null) {
                return;
            }
            const id = `remember-${index}`;
            remembers.set(id, suggestion);
            choices.push({ id, kind: 'remember', label });
        });
        choices.push({ id: 'deny', kind: 'deny', label: 'Deny' });

        return new Promise<ApprovalDecision | null>((resolve) => {
            const entry: Pending = {
                request: {
                    requestId,
                    sessionId,
                    toolName: ask.toolName,
                    summary: ask.summary,
                    choices,
                    createdAt,
                    expiresAt: createdAt + this.holdMs
                },
                remembers,
                settle: resolve,
                timer: setTimeout(() => this.close(requestId, null), this.holdMs)
            };
            this.pending.set(requestId, entry);
            const ids = this.bySession.get(sessionId) ?? new Set<string>();
            ids.add(requestId);
            this.bySession.set(sessionId, ids);
            signal.addEventListener('abort', () => this.close(requestId, null), { once: true });
            this.publish(sessionId);
        });
    }

    /*
     * A client's answer. False when the request is already gone, which is how a second client hears
     * that it lost the race rather than silently overwriting an answer the agent has already acted on.
     */
    answer(sessionId: string, requestId: string, choiceId: string): boolean {
        const entry = this.pending.get(requestId);
        if (!entry || entry.request.sessionId !== sessionId) {
            return false;
        }
        const choice = entry.request.choices.find((candidate) => candidate.id === choiceId);
        if (!choice) {
            return false;
        }
        if (choice.kind === 'deny') {
            this.close(requestId, { behavior: 'deny', message: 'Denied from Ruimte.' });
            return true;
        }
        const remembered = entry.remembers.get(choiceId);
        this.close(requestId, remembered === undefined ? { behavior: 'allow' } : { behavior: 'allow', updatedPermissions: [remembered] });
        return true;
    }

    /* What a session is waiting on, for a client that arrives after the request opened. */
    forSession(sessionId: string): ApprovalRequest[] {
        const ids = this.bySession.get(sessionId);
        if (!ids) {
            return [];
        }
        return [...ids].flatMap((id) => {
            const entry = this.pending.get(id);
            return entry ? [entry.request] : [];
        });
    }

    /* The session ended, so every hook waiting on it is gone too and nobody is left to answer. */
    dropSession(sessionId: string): void {
        const ids = this.bySession.get(sessionId);
        if (!ids) {
            return;
        }
        for (const id of [...ids]) {
            this.close(id, null);
        }
    }

    private close(requestId: string, decision: ApprovalDecision | null): void {
        const entry = this.pending.get(requestId);
        if (!entry) {
            return;
        }
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        const sessionId = entry.request.sessionId;
        const ids = this.bySession.get(sessionId);
        ids?.delete(requestId);
        if (ids && ids.size === 0) {
            this.bySession.delete(sessionId);
        }
        entry.settle(decision);
        this.publish(sessionId);
    }

    private publish(sessionId: string): void {
        this.sink(sessionId, this.forSession(sessionId));
    }
}
