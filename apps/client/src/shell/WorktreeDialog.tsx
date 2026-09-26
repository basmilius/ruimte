import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { performAsPerson } from '@/actions/client-actions';
import { focusedCanvas, useCanvas } from '@/state/canvas';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { PromptDialog } from '@ruimte/ui/PromptDialog';

// A group's title, as a branch name git accepts.
const branchFromTitle = (title: string): string =>
    title
        .toLowerCase()
        .replace(/[^a-z0-9._/-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'work';

/* Binds a group to a git worktree of the project's repository; every node made inside it starts there. */
export function WorktreeDialog() {
    const { t } = useTranslation('shell');
    const groupId = useUi((s) => s.worktreeDialogFor);
    const close = useUi((s) => s.setWorktreeDialogFor);
    const group = useCanvas((s) => (groupId ? s.nodes[groupId] : undefined));
    const folder = useProject((s) => s.current?.folder ?? null);

    const submit = async (branch: string): Promise<void> => {
        if (!groupId || !folder) {
            return;
        }
        const result = await performAsPerson('worktree.create', { branch });
        focusedCanvas().getState().setGroupWorktree(groupId, result.worktree);
        close(null);
    };

    return (
        <PromptDialog
            open={groupId !== null}
            title={t('worktreeDialog.title')}
            titleIcon={GitBranch}
            description={folder ? t('worktreeDialog.description') : t('worktreeDialog.noFolder')}
            {...(folder
                ? {
                      field: {
                          ariaLabel: t('worktreeDialog.branchLabel'),
                          placeholder: t('worktreeDialog.branchPlaceholder'),
                          initial: group ? branchFromTitle(group.title) : '',
                          mono: true
                      }
                  }
                : {})}
            confirmLabel={t('worktreeDialog.bind')}
            confirmBusyLabel={t('worktreeDialog.creating')}
            confirmDisabled={!folder}
            fallbackMessage={t('worktreeDialog.failed')}
            onConfirm={submit}
            onClose={() => close(null)}
        />
    );
}
