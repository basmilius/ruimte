import type { AgentKind, ChatBackgroundTask, ChatItem, ChatSubagentItem, ChatToolItem } from '@ruimte/contracts';

export type BackgroundWork = ChatSubagentItem | ChatToolItem;

/*
 * Work a chat's CLI goes on with after the turn that started it ended: a subagent it runs in the
 * background (Claude's `run_in_background`, every agent Codex spawns) and a Claude workflow, whose call
 * answers at launch. A command or a monitor sent to the background is not work of this kind but a
 * `ChatBackgroundTask` in the chat's info, held to `BACKGROUND_COMMAND_LIMIT_MS`; an agent Ruimte opened
 * is a node with a task of its own.
 */
export const isBackgroundWork = (item: ChatItem): item is BackgroundWork =>
    (item.kind === 'subagent' && item.background && item.origin !== 'ruimte') || (item.kind === 'tool' && item.name === 'Workflow');

export const runsInBackground = (item: BackgroundWork): boolean => (item.kind === 'subagent' ? item.status === 'running' : item.state === 'running');

export const runningInBackground = (items: readonly ChatItem[]): BackgroundWork[] =>
    items.filter((item): item is BackgroundWork => isBackgroundWork(item) && runsInBackground(item));

/*
 * How long a command or a monitor still running in the background holds a child's task once nothing
 * else does, since a dev server never ends. Subagents and workflows have no such limit.
 */
export const BACKGROUND_COMMAND_LIMIT_MS = 30 * 60_000;

export const commandLabel = (task: ChatBackgroundTask): string => task.command ?? (task.description === '' ? task.id : task.description);

/*
 * Whether the CLI opens a turn of its own once its background work ended, to tell what came of it.
 * Claude Code 2.1.282 does after every task notification, a command's included; a command a subagent
 * started first takes that subagent up again, which then notifies the main agent. Codex 0.156.1
 * reports a spawned agent completed and opens nothing.
 */
export const reportsOnBackgroundWork = (provider: AgentKind): boolean => provider === 'claude';
