import type { ChatCreatePayload } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { ComposerPreference } from '../chat/composer-preferences.ts';
import type { StartAgentEntry } from './outbox.ts';

/*
 * The size a terminal agent starts at with nobody looking. Wide enough that a CLI does not wrap its
 * own layout into a column; the first client that attaches sizes it to itself, as every attach does.
 */
export const HEADLESS_TERMINAL = { cols: 120, rows: 40 } as const;

export interface StartAgentDeps {
    /* Whether a project still places the node; a node deleted before its start is not started. */
    placed(nodeId: string): boolean;
    hasChat(chatId: string): boolean;
    createChat(payload: ChatCreatePayload): Promise<unknown>;
    /* The composer preference of the connected clients for this provider, read when the chat is made. */
    composerPreference(provider: StartAgentEntry['payload']['provider']): ComposerPreference;
    killChat(chatId: string): Promise<void>;
    hasSession(sessionId: string): boolean;
    createSession(options: {
        sessionId: string;
        cols: number;
        rows: number;
        cwd?: string;
        agent: { kind: StartAgentEntry['payload']['provider'] };
    }): Promise<unknown>;
    killSession(sessionId: string): Promise<void>;
    log?: (line: string) => void;
    /* A start that failed and will not be tried again: what was waiting on the agent hears it here. */
    onGaveUp?: (entry: StartAgentEntry, error: unknown) => void;
}

/*
 * Starts the chat or the terminal of an agent node a verb wrote, the way a client mounting it would,
 * so a client that mounts it later attaches to what already runs. Nothing it does is retried: the
 * create takes the node's first prompt before it spawns, and a second attempt would start the agent
 * without its task. A failure is logged and the node stays as it is, so a client that mounts it
 * tries again the way it always did.
 */
export const startAgentHandler =
    (deps: StartAgentDeps) =>
    async (entry: StartAgentEntry): Promise<void> => {
        const { node, provider, cwd, runtimeMode } = entry.payload;
        const nodeId = entry.target;
        const log = deps.log ?? ((line: string) => console.error(line));
        if (!deps.placed(nodeId)) {
            return;
        }
        try {
            if (node === 'chat') {
                if (deps.hasChat(nodeId)) {
                    return;
                }
                // The mode of the chat that opened it beats the person's pick, which fills in the rest.
                const preference = deps.composerPreference(provider);
                const mode = runtimeMode ?? preference.runtimeMode;
                await deps.createChat({
                    chatId: nodeId,
                    provider,
                    ...(cwd === null ? {} : { cwd }),
                    ...(preference.selection ? { selection: preference.selection } : {}),
                    ...(mode === undefined ? {} : { runtimeMode: mode })
                });
            } else {
                if (deps.hasSession(nodeId)) {
                    return;
                }
                await deps.createSession({
                    sessionId: nodeId,
                    ...HEADLESS_TERMINAL,
                    ...(cwd === null ? {} : { cwd }),
                    // The node carries no mode, so neither does its launch: a reload would start it without one.
                    agent: { kind: provider }
                });
            }
        } catch (e) {
            // A client that mounted the node first made the session; that is the node started, not a failure.
            if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'session-exists') {
                return;
            }
            log(`Starting the agent of ${nodeId} failed: ${errorText(e)}`);
            deps.onGaveUp?.(entry, e);
            return;
        }
        // Deleted while it was being started: whoever deleted it found nothing to end yet.
        if (!deps.placed(nodeId)) {
            await (node === 'chat' ? deps.killChat(nodeId) : deps.killSession(nodeId)).catch(() => undefined);
        }
    };
