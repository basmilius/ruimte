import type { AgentKind, ChatItem, ChatSubagentItem, ChatToolItem } from '@ruimte/contracts';

export type BackgroundWork = ChatSubagentItem | ChatToolItem;

/*
 * Work a chat's CLI goes on with after the turn that started it ended: a subagent it runs in the
 * background (Claude's `run_in_background`, every agent Codex spawns) and a Claude workflow, whose call
 * answers at launch. A command or a monitor sent to the background is not work of this kind, since a
 * dev server never ends; an agent Ruimte opened is a node with a task of its own.
 */
export const isBackgroundWork = (item: ChatItem): item is BackgroundWork =>
    (item.kind === 'subagent' && item.background && item.origin !== 'ruimte') || (item.kind === 'tool' && item.name === 'Workflow');

export const runsInBackground = (item: BackgroundWork): boolean => (item.kind === 'subagent' ? item.status === 'running' : item.state === 'running');

export const runningInBackground = (items: readonly ChatItem[]): BackgroundWork[] =>
    items.filter((item): item is BackgroundWork => isBackgroundWork(item) && runsInBackground(item));

/*
 * Whether the CLI opens a turn of its own once its background work ended, to tell what came of it.
 * Claude Code 2.1.282 does after every task notification; Codex 0.156.1 reports a spawned agent
 * completed and opens nothing.
 */
export const reportsOnBackgroundWork = (provider: AgentKind): boolean => provider === 'claude';
