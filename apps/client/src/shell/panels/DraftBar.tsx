import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { useConflictInfo } from '@/editor-ai/conflict-info';
import { reviewConflict } from '@/editor-ai/conflict-wiring';
import { useProviderName } from '@/editor-ai/use-chat-identity';
import { basenameOf } from '@/shell/panels/files-tree';
import { useFiles } from '@/state/files';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { textDrafts, useTextDraft } from '@/state/text-drafts';
import { Button, Icon } from '@basmilius/desktop-ui';

/* A line over the editor with the buttons that answer it. It wraps in a narrow node rather than cutting the message. */
export function EditorNotice({ message, children }: { message: string; children?: ReactNode }) {
    return (
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-sm text-text" role="status">
            <Icon icon={TriangleAlert} size={14} className="shrink-0 text-status-needs-you" />
            <span className="min-w-0 grow">{message}</span>
            {children}
        </div>
    );
}

/*
 * What stands between a draft and the disk. The file that moved is a choice between two versions,
 * so it waits for a person; anything else is said, and the draft stays until a save goes through.
 */
export function DraftBar({ endpointId, path, onReviewed }: { endpointId: string; path: string; onReviewed?: () => void }) {
    const { t } = useTranslation('panels');
    const draft = useTextDraft(endpointId, path);
    const author = useConflictInfo((state) => state.rows[endpointKey(endpointId, path)]?.author ?? null);
    const name = useProviderName(author?.provider);
    const [busy, setBusy] = useState(false);
    const problem = draft?.problem ?? null;

    if (draft === undefined || problem === null) {
        return null;
    }

    const run = (step: () => Promise<unknown>): void => {
        setBusy(true);
        void step().finally(() => setBusy(false));
    };

    if (problem.kind === 'error') {
        return (
            <EditorNotice message={t('file.draft.failed', { reason: problem.message })}>
                <Button variant="secondary" size="sm" disabled={busy || draft.saving} onClick={() => run(() => textDrafts.save(endpointId, path))}>
                    {t('common:action.retry')}
                </Button>
            </EditorNotice>
        );
    }
    const review = (): void => {
        // An editor that has the file shows the rows; for a file no editor has, opening it starts them.
        if (!reviewConflict(endpointId, path) && endpointId === currentEndpointId()) {
            useFiles.getState().open(path, useSettings.getState().filesTabLimit);
        }
        onReviewed?.();
    };
    const message =
        author === null ? t('file.draft.changedOnDisk') : t('file.draft.agentWrote', { name: name || t('file.conflict.agent'), file: basenameOf(path) });

    return (
        <EditorNotice message={message}>
            {draft.incoming !== undefined && (
                <Button variant="primary" size="sm" disabled={busy} onClick={review}>
                    {t('file.draft.review')}
                </Button>
            )}
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => textDrafts.reload(endpointId, path))}>
                {t('file.draft.reload')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || draft.saving} onClick={() => run(() => textDrafts.overwrite(endpointId, path))}>
                {t('file.draft.overwrite')}
            </Button>
        </EditorNotice>
    );
}
