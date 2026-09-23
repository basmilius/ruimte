import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { textDrafts, useTextDraft } from '@/state/text-drafts';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

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
export function DraftBar({ endpointId, path }: { endpointId: string; path: string }) {
    const { t } = useTranslation('panels');
    const draft = useTextDraft(endpointId, path);
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
    return (
        <EditorNotice message={t('file.draft.changedOnDisk')}>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => textDrafts.reload(endpointId, path))}>
                {t('file.draft.reload')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || draft.saving} onClick={() => run(() => textDrafts.overwrite(endpointId, path))}>
                {t('file.draft.overwrite')}
            </Button>
        </EditorNotice>
    );
}
