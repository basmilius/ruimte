import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { GitBranch } from 'lucide-react';
import { focusedCanvas, useCanvas } from '@/state/canvas';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

// A group's title, as a branch name git accepts.
const branchFromTitle = (title: string): string =>
    title
        .toLowerCase()
        .replace(/[^a-z0-9._/-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'work';

/* Binds a group to a git worktree of the project's repository; every node made inside it starts there. */
export function WorktreeDialog() {
    const { t } = useTranslation(['shell', 'common']);
    const groupId = useUi((s) => s.worktreeDialogFor);
    const close = useUi((s) => s.setWorktreeDialogFor);
    const group = useCanvas((s) => (groupId ? s.nodes[groupId] : undefined));
    const folder = useProject((s) => s.current?.folder ?? null);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const [branch, setBranch] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const transport = useTransport();

    const value = branch ?? (group ? branchFromTitle(group.title) : '');

    const submit = async (): Promise<void> => {
        if (!groupId || !folder || !value.trim()) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const result = await transport.request('git.worktree-add', { repo: folder, branch: value.trim(), ...(projectId === null ? {} : { projectId }) });
            focusedCanvas().getState().setGroupWorktree(groupId, result.worktree);
            setBranch(null);
            close(null);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : t('worktreeDialog.failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root
            open={groupId !== null}
            onOpenChange={(open) => {
                if (!open) {
                    setBranch(null);
                    close(null);
                }
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-text">
                        <Icon icon={GitBranch} size={16} /> {t('worktreeDialog.title')}
                    </Dialog.Title>
                    {folder ? (
                        <>
                            <p className="mt-1 text-sm text-text-muted">{t('worktreeDialog.description')}</p>
                            <input
                                autoFocus
                                className="field mt-3 font-mono text-code"
                                aria-label={t('worktreeDialog.branchLabel')}
                                placeholder={t('worktreeDialog.branchPlaceholder')}
                                value={value}
                                spellCheck={false}
                                onChange={(e) => setBranch(e.target.value)}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                        void submit();
                                    }
                                }}
                            />
                        </>
                    ) : (
                        <p className="mt-1 text-sm text-text-muted">{t('worktreeDialog.noFolder')}</p>
                    )}
                    {failure && <p className="mt-2 text-sm text-status-error">{failure}</p>}
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={() => close(null)}>{t('common:action.cancel')}</Button>
                        <Button variant="primary" disabled={busy || !folder || !value.trim()} onClick={() => void submit()}>
                            {busy ? t('worktreeDialog.creating') : t('worktreeDialog.bind')}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
