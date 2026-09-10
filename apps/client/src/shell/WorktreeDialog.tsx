import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { faCodeBranch } from '@fortawesome/pro-regular-svg-icons';
import { useCanvas } from '@/state/canvas';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { Icon } from '@/ui/Icon';

// A group's title, as a branch name git accepts.
const branchFromTitle = (title: string): string =>
    title
        .toLowerCase()
        .replace(/[^a-z0-9._/-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'work';

/* Binds a group to a git worktree of the project's repository; every node made inside it starts there. */
export function WorktreeDialog() {
    const groupId = useUi((s) => s.worktreeDialogFor);
    const close = useUi((s) => s.setWorktreeDialogFor);
    const group = useCanvas((s) => (groupId ? s.nodes[groupId] : undefined));
    const folder = useProject((s) => s.current?.folder ?? null);
    const [branch, setBranch] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const value = branch ?? (group ? branchFromTitle(group.title) : '');

    const submit = async (): Promise<void> => {
        if (!groupId || !folder || !value.trim()) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const result = await transport.request('git.worktree-add', { repo: folder, branch: value.trim() });
            useCanvas.getState().setGroupWorktree(groupId, result.worktree);
            setBranch(null);
            close(null);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'The worktree could not be made');
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
                <Dialog.Popup className="dialog-popup top-[24vh] w-[420px] p-5">
                    <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-text">
                        <Icon icon={faCodeBranch} size={16} /> Bind to a worktree
                    </Dialog.Title>
                    {folder ? (
                        <>
                            <p className="mt-1 text-xs text-text-muted">
                                A checkout of this branch is made next to the app data, and every terminal or chat created inside the group starts in it.
                            </p>
                            <input
                                autoFocus
                                className="mt-3 h-9 w-full rounded-lg border border-border bg-surface px-2.5 font-mono text-code text-text outline-none placeholder:text-text-faint focus:border-accent"
                                placeholder="branch name"
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
                        <p className="mt-1 text-xs text-text-muted">This canvas is not in a folder, so there is no repository to make a worktree of.</p>
                    )}
                    {failure && <p className="mt-2 text-xs text-status-error">{failure}</p>}
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <button
                            className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-text-muted hover:bg-surface-sunken hover:text-text"
                            onClick={() => close(null)}
                        >
                            Cancel
                        </button>
                        <button
                            className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-text disabled:opacity-50"
                            disabled={busy || !folder || !value.trim()}
                            onClick={() => void submit()}
                        >
                            {busy ? 'Making the checkout' : 'Bind'}
                        </button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
