import { Button, EmptyState, messageOf } from '@adecore/ui';
import type { GitBlobResult } from '@ruimte/contracts';
import { FileWarning } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { CodeText } from '@/files/CodeFile';
import type { SnapshotTab } from '@/state/files';
import { refLabel } from '@/worktree-rules/ref-label';

type SnapshotState = { key: string; blob: GitBlobResult } | { key: string; error: string };

/*
 * One file as a commit holds it. It is text on screen and nothing else: there is no editor, no draft and
 * no save behind it, and it never reads the working copy of the same path.
 */
export function SnapshotBody({ tab }: { tab: SnapshotTab }) {
    const { t } = useTranslation('panels');
    const [retries, setRetries] = useState(0);
    const [held, setHeld] = useState<SnapshotState | null>(null);
    const key = JSON.stringify([tab.cwd, tab.commit, tab.path, retries]);

    useEffect(() => {
        let alive = true;

        perform('git.blob', { repository: tab.cwd, commit: tab.commit, path: tab.path }).then(
            (blob) => {
                if (alive) {
                    setHeld({ key, blob });
                }
            },
            (error: unknown) => {
                if (alive) {
                    setHeld({ key, error: messageOf(error) });
                }
            }
        );

        return () => {
            alive = false;
        };
    }, [key, tab.cwd, tab.commit, tab.path]);

    const current = held?.key === key ? held : null;
    const blob = current !== null && 'blob' in current ? current.blob : null;

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
                <p className="truncate font-mono text-text">{tab.path}</p>
                <p className="mt-1 text-text-muted">
                    {t(blob?.symlink === true ? 'git.compare.symlink' : 'git.compare.readOnly', {
                        branch: refLabel(tab.branch),
                        commit: tab.commit.slice(0, 7)
                    })}
                </p>
            </div>
            {current === null ? (
                <EmptyState busy>{t('git.compare.reading')}</EmptyState>
            ) : 'error' in current ? (
                <EmptyState
                    icon={FileWarning}
                    action={
                        <Button size="sm" onClick={() => setRetries((count) => count + 1)}>
                            {t('common:action.retry')}
                        </Button>
                    }
                >
                    {current.error}
                </EmptyState>
            ) : current.blob.text === undefined ? (
                <EmptyState icon={FileWarning}>{t(`git.compare.blob.${current.blob.omitted ?? 'missing'}`)}</EmptyState>
            ) : (
                <CodeText text={current.blob.text} language={current.blob.language} />
            )}
        </div>
    );
}
