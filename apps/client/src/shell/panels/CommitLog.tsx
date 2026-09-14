import { useEffect, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Copy, GitCommitHorizontal } from 'lucide-react';
import type { GitCommit } from '@ruimte/contracts';
import { GIT_GROUP } from '@/shell/panels/classes';
import { groupCommits, relativeTime } from '@/shell/panels/commit-log';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { MENU_SEPARATOR, SECTION_LABEL } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';

// One screen of rows at a time; the button at the end asks for the next.
const PAGE = 30;

/* A commit row is its own open button: the row's states with the columns of a row that opens. */
const LOG_ROW =
    'group flex h-7 w-full min-w-0 items-center gap-1.5 pr-1 pl-3 text-xs text-inherit hover:bg-surface-hover hover:text-text data-[selected]:bg-surface-active data-[selected]:text-text';

interface CommitLogProps {
    cwd: string;
    /* Bumped by the panel whenever the status moved, which is when the log may have too. */
    revision: number;
    /* The commit the preview has open, so the row a person is reading stands out. */
    reading: string | null;
    onOpen(commit: GitCommit): void;
}

/*
 * The history of the checkout under the commit box. It reloads from the top whenever the status
 * changes, because a commit, a pull and a rebase all move the log and all move the status with it;
 * the pages that were loaded past the first are read again on the way down. A right click on a row
 * offers the commit and the two things a person copies out of one.
 */
export function CommitLog({ cwd, revision, reading, onOpen }: CommitLogProps) {
    /* What was asked for, so the answer to the question before this one is not drawn and a status
       that moved reads as loading without an effect that has to empty the state first. */
    const asked = `${cwd}\u0000${revision}`;
    const [held, setHeld] = useState<{ asked: string; commits: GitCommit[]; cursor: string | null; failed: boolean } | null>(null);
    const [page, setPage] = useState<string | null>(null);
    const [now] = useState(() => Math.floor(Date.now() / 1000));
    const transport = useTransport();
    const shown = held !== null && held.asked === asked ? held : null;

    useEffect(() => {
        let alive = true;
        transport
            .request('git.log', { cwd, limit: PAGE })
            .then((answer) => {
                if (alive) {
                    setHeld({ asked, commits: answer.commits, cursor: answer.cursor, failed: false });
                }
            })
            .catch(() => {
                if (alive) {
                    setHeld({ asked, commits: [], cursor: null, failed: true });
                }
            });
        return () => {
            alive = false;
        };
    }, [transport, asked, cwd]);

    const loadMore = (cursor: string): void => {
        setPage(cursor);
        transport
            .request('git.log', { cwd, limit: PAGE, cursor })
            .then((answer) => {
                setHeld((previous) =>
                    previous === null || previous.asked !== asked
                        ? previous
                        : { ...previous, commits: [...previous.commits, ...answer.commits], cursor: answer.cursor }
                );
            })
            .catch(() => undefined)
            .finally(() => setPage(null));
    };

    const state = shown === null ? 'loading' : shown.failed ? 'error' : 'ready';
    const commits = shown?.commits ?? [];
    const cursor = shown?.cursor ?? null;
    const loadingMore = page !== null;

    if (state === 'error') {
        return (
            <div className="grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={GitCommitHorizontal} size={20} />}>Could not read the history.</EmptyState>
            </div>
        );
    }
    if (state === 'ready' && commits.length === 0) {
        return (
            <div className="grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={GitCommitHorizontal} size={20} />}>No commits yet.</EmptyState>
            </div>
        );
    }

    return (
        <div className="min-h-0 grow overflow-y-auto py-1">
            {groupCommits(commits, now).map((section) => (
                <section key={section.label}>
                    <header className={GIT_GROUP}>
                        <span className={SECTION_LABEL}>{section.label}</span>
                    </header>
                    {section.commits.map((commit) => (
                        <ContextMenu.Root key={commit.hash}>
                            <ContextMenu.Trigger
                                render={<button />}
                                className={LOG_ROW}
                                aria-current={commit.hash === reading}
                                data-selected={commit.hash === reading || undefined}
                                onClick={() => onOpen(commit)}
                            >
                                <span className="shrink-0 font-mono text-text-faint">{commit.shortHash}</span>
                                <span className="truncate text-text">{commit.subject}</span>
                                {commit.refs.map((ref) => (
                                    <Pill key={ref} mono className="shrink-0 py-0">
                                        {ref}
                                    </Pill>
                                ))}
                                <span className="grow" />
                                <span className="truncate text-text-faint">{commit.author}</span>
                                <span className="shrink-0 text-text-faint">{relativeTime(commit.at, now)}</span>
                            </ContextMenu.Trigger>
                            <ContextMenu.Portal>
                                <ContextMenu.Positioner className="z-(--z-popup)">
                                    <ContextMenu.Popup className="menu-popup">
                                        <ContextMenu.Item className="menu-item" onClick={() => onOpen(commit)}>
                                            <Icon icon={GitCommitHorizontal} size={14} /> Open the commit
                                        </ContextMenu.Item>
                                        <ContextMenu.Separator className={MENU_SEPARATOR} />
                                        <ContextMenu.Item className="menu-item" onClick={() => copyText(commit.hash)}>
                                            <Icon icon={Copy} size={14} /> Copy commit hash
                                        </ContextMenu.Item>
                                        <ContextMenu.Item className="menu-item" onClick={() => copyText(commit.subject)}>
                                            <Icon icon={Copy} size={14} /> Copy subject
                                        </ContextMenu.Item>
                                    </ContextMenu.Popup>
                                </ContextMenu.Positioner>
                            </ContextMenu.Portal>
                        </ContextMenu.Root>
                    ))}
                </section>
            ))}
            {cursor !== null && (
                <div className="flex justify-center p-2">
                    <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => loadMore(cursor)}>
                        {loadingMore ? 'Loading' : 'Load more'}
                    </Button>
                </div>
            )}
        </div>
    );
}
