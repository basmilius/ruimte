import { AGENT_WORKSPACE_DIALOGS } from '@/agents/dialogs';
import { ATTENTION_DIALOGS } from '@/attention/dialogs';
import { CANVAS_DIALOGS } from '@/canvas/dialogs';
import { CHAT_WORKSPACE_DIALOGS } from '@/chat/dialogs';
import { CONFLICT_DIALOGS } from '@/conflicts/dialog';
import { DATABASE_DIALOGS } from '@/database/dialogs';
import { DEVICE_DIALOGS } from '@/devices/dialogs';
import { FILE_DIALOGS } from '@/files/dialogs';
import { GITHUB_DIALOGS } from '@/github/dialogs';
import { LAUNCH_DIALOGS } from '@/launches/dialogs';
import { MACHINE_DIALOGS } from '@/machine-ui/dialogs';
import { PROJECT_DIALOGS } from '@/project/dialogs';
import { workspaceDialogs } from '@/registry/dialogs';
import { ROUTINE_DIALOGS } from '@/routines/dialogs';
import { VIEW_DIALOGS } from '@/views/dialogs';
import { WORKTREE_DIALOGS } from '@/worktrees/dialogs';

/* The dialogs about the project that is open, each in a boundary of its own, in the order they mount. */
export function installWorkspaceDialogs(): void {
    workspaceDialogs.add(
        ...CANVAS_DIALOGS,
        ...CHAT_WORKSPACE_DIALOGS,
        ...VIEW_DIALOGS,
        ...AGENT_WORKSPACE_DIALOGS,
        ...FILE_DIALOGS,
        ...CONFLICT_DIALOGS,
        ...WORKTREE_DIALOGS,
        ...LAUNCH_DIALOGS,
        ...DATABASE_DIALOGS,
        ...PROJECT_DIALOGS,
        ...MACHINE_DIALOGS,
        ...DEVICE_DIALOGS,
        ...GITHUB_DIALOGS,
        ...ROUTINE_DIALOGS,
        ...ATTENTION_DIALOGS
    );
}
