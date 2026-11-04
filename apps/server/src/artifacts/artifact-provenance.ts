import type { ArtifactProvenance } from '@ruimte/contracts';

/* What the daemon knows of the caller of an agent tool, from its own records only. */
interface CallerRecord {
    machineId: string;
    caller: string;
    /* The caller's chat as the daemon runs it; absent for a terminal, or a chat that is not running. */
    chat?: { provider: string; model: string | null; selection: { model: string }; activeTurnId: string | null };
    /* Whether the caller is a chat at all, running or stored. */
    isChat: boolean;
    taskId?: string;
}

/*
 * The provenance of a version an agent publishes. Every field comes from the caller's record and none
 * from the call's arguments, so an agent never states where its work came from or what made it.
 */
export function agentProvenance({ machineId, caller, chat, isChat, taskId }: CallerRecord): ArtifactProvenance {
    const turnId = chat?.activeTurnId ?? null;
    // The model the CLI reported wins over the one picked, since an alias or a reroute can differ from it.
    const model = chat === undefined ? null : (chat.model ?? chat.selection.model);
    return {
        maker: 'agent',
        machineId,
        nodeId: caller,
        ...(isChat ? { chatId: caller } : {}),
        ...(turnId === null ? {} : { turnId }),
        ...(taskId === undefined ? {} : { taskId }),
        ...(chat === undefined ? {} : { agent: chat.provider }),
        ...(model === null || model === '' ? {} : { model })
    };
}
