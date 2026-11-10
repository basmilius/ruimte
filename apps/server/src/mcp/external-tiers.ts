import type { ExternalTier } from '@ruimte/contracts';

/*
 * An explicit list per tier, apart from `Audience`, so a tool added later stays out of reach of a client elsewhere until
 * someone adds its name here. Outside every tier: `secret_request`, `task_done`, `context_list`, `chat_attach`, `visual_*`,
 * the `plan_*` tools (they act on the plans of the chat that calls, and a client elsewhere is no chat) and every tool
 * whose input is a path on the machine (`artifact_publish`, `device_install`, `device_media`, `language_*`, `template_new`).
 */

const READ: readonly string[] = [
    'guide',
    'project_list',
    'view_list',
    'node_list',
    'link_list',
    'context_read',
    'task_list',
    'artifact_list',
    'artifact_read',
    'worktree_list',
    'worktree_diff',
    'operation_get'
];

const WORK: readonly string[] = [
    'view_new',
    'view_edit',
    'view_delete',
    'view_open',
    'view_diagram',
    'view_drawing',
    'node_new',
    'node_edit',
    'node_update',
    'node_delete',
    'node_group',
    'node_arrange',
    'link_new',
    'link_delete',
    'flag',
    'agent_start',
    'agent_team',
    'agent_answer',
    'agent_fork',
    'task_new',
    'notify',
    'operation_cancel',
    'project_open',
    'project_activate'
];

/* What runs on the machine itself, each tool within the grant of its own feature. */
const MACHINE: readonly string[] = [
    'launch_list',
    'launch_read',
    'launch_new',
    'launch_edit',
    'launch_control',
    'routine_list',
    'routine_new',
    'routine_edit',
    'routine_toggle',
    'routine_run',
    'worktree_merge',
    'tool_list',
    'tool_run',
    'browser_state',
    'browser_go',
    'browser_history',
    'browser_shot',
    'device_list',
    'device_start',
    'device_state',
    'device_shot',
    'device_input',
    'device_app',
    'device_set',
    'device_open',
    'device_permission',
    'device_push',
    'device_biometric',
    'device_clipboard',
    'device_record',
    'database_list',
    'database_tables',
    'database_describe',
    'database_query',
    'database_execute',
    'computer_apps',
    'computer_state',
    'computer_read',
    'computer_wait',
    'computer_act',
    'computer_menu',
    'computer_open'
];

/* The tools the box on a credential adds, whatever its tier. */
export const APPROVAL_TOOLS: readonly string[] = ['approval_list', 'approval_answer'];

export const TIER_TOOLS: Readonly<Record<ExternalTier, readonly string[]>> = {
    read: READ,
    work: [...READ, ...WORK],
    machine: [...READ, ...WORK, ...MACHINE]
};

/* Tools that take no `project`: they work on the machine, not in a project. */
export const MACHINE_WIDE_TOOLS: ReadonlySet<string> = new Set(['guide', 'project_list', 'project_open', 'project_activate', ...APPROVAL_TOOLS]);

export function tierHas(tier: ExternalTier, name: string): boolean {
    return TIER_TOOLS[tier].includes(name);
}
