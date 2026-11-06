import { rememberChatSelection } from '@adecore/agents-react/chat';
import { Button, Dialog, ErrorBoundary, FormError, Icon, messageOf } from '@adecore/ui';
import { GitBranch } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { createStartWorktree, useWorktreeStart } from '@/worktrees/use-worktree-start';
import { createWorktreeChat } from '@/worktrees/worktree-chat';
import { WorktreeStartFields } from '@/worktrees/WorktreeStartFields';

/*
 * A chat in a worktree made for it: a branch name, the base it starts at, and the chat node only
 * once the checkout exists. A refusal keeps the dialog open and makes nothing.
 */
export function NewWorktreeChatDialog() {
    const { t } = useTranslation('shell');
    const open = useUi((s) => s.newWorktreeChatOpen);
    const close = (): void => useUi.getState().setNewWorktreeChatOpen(false);
    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
            <Dialog.Popup size="sm">
                <Dialog.Title className="flex items-center gap-2">
                    <Icon icon={GitBranch} size={16} /> {t('newWorktreeChat.title')}
                </Dialog.Title>
                <ErrorBoundary label={t('newWorktreeChat.failed')} resetKeys={[open]}>
                    {open && <NewWorktreeChatForm onDone={close} />}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function NewWorktreeChatForm({ onDone }: { onDone(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const folder = useProject((s) => s.current?.folder ?? null);
    const start = useWorktreeStart(folder);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const ready = start !== null && start.ready && !busy;

    async function submit(): Promise<void> {
        if (start === null || !ready || start.provider === null) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const worktree = await createStartWorktree(start);
            if (start.selection !== null) {
                rememberChatSelection(start.provider, start.selection);
            }
            const chatId = await createWorktreeChat({ cwd: worktree.path, provider: start.provider });
            if (chatId === null) {
                throw new Error(t('newWorktreeChat.noCanvas'));
            }
            onDone();
        } catch (e) {
            setFailure(messageOf(e, t('newWorktreeChat.failed')));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Dialog.Text className="mt-1">{t('newWorktreeChat.description')}</Dialog.Text>
            {start !== null && <WorktreeStartFields start={start} idPrefix="new-worktree" onSubmit={() => void submit()} />}
            {failure && <FormError className="mt-2">{failure}</FormError>}
            <Dialog.Footer>
                <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
                    {busy ? t('newWorktreeChat.starting') : t('newWorktreeChat.start')}
                </Button>
            </Dialog.Footer>
        </>
    );
}
