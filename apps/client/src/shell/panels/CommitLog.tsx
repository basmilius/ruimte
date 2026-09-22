import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Copy, GitCommitHorizontal } from 'lucide-react';
import { GIT_GROUP } from '@/shell/panels/classes';
import { groupCommits, mergeLogs, relativeTime, type LoadedLog, type LogRow } from '@/shell/panels/commit-log';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { MENU_SEPARATOR, SECTION_LABEL } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { PanelEmpty } from '@/ui/PanelEmpty';
import { Tooltip } from '@/ui/Tooltip';

// One screen of rows at a time; the button at the end asks for the next.
const PAGE = 30;

/* A commit on two branches names both; beyond that the names cost the subject more than they tell. */
const REFS_SHOWN = 2;

/* A commit row is its own open button: the row's states with the columns of a row that opens. */
const LOG_ROW =
    'group flex h-7 w-full min-w-0 items-center gap-1.5 pr-1 pl-3 text-xs text-inherit hover:bg-surface-hover hover:text-text data-[selected]:bg-surface-active data-[selected]:text-text';

/* The checkouts the log is read from, named so a row can say which one it came out of. The panel hands
   this list over memoized: a new one of the same checkouts would read every log again. */
export interface LogSource {
    cwd: string;
    /* Empty while the folder holds a single repository, which is a log that names none. */
    repo: string;
    /* Goes up whenever that checkout's status moved, which is when its log may have moved too. */
    revision: number;
}

interface CommitLogProps {
    sources: readonly LogSource[];
    /* The commit the preview has open, so the row a person is reading stands out. */
    reading: string | null;
    onOpen(cwd: string, commit: LogRow): void;
}

/*
 * The history under the commit box: every repository of the folder at once, newest first, each row
 * saying where it came from. It reloads from the top whenever a status moves, because a commit, a
 * pull and a rebase all move a log and all move the status with it; the pages loaded past the first
 * are read again on the way down. A right click on a row offers the commit and the two things a
 * person copies out of one.
 */
export function CommitLog({ sources, reading, onOpen }: CommitLogProps) {
    /* What was asked for, so the answer to the question before this one is not drawn and a status
       that moved reads as loading without an effect that has to empty the state first. */
    const { t } = useTranslation('panels');
    const asked = sources.map((source) => `${source.cwd}\u0000${source.revision}`).join('\u0001');
    const [held, setHeld] = useState<{ asked: string; logs: LoadedLog[]; failed: boolean } | null>(null);
    const [paging, setPaging] = useState(false);
    const [now] = useState(() => Math.floor(Date.now() / 1000));
    const transport = useTransport();
    const shown = held !== null && held.asked === asked ? held : null;

    useEffect(() => {
        let alive = true;
        const list = asked === '' ? [] : sources;
        Promise.all(
            list.map(async (source): Promise<LoadedLog | null> => {
                try {
                    const answer = await transport.request('git.log', { cwd: source.cwd, limit: PAGE });
                    return { cwd: source.cwd, repo: source.repo, commits: answer.commits, cursor: answer.cursor };
                } catch {
                    return null;
                }
            })
        ).then((answers) => {
            if (alive) {
                const logs = answers.filter((log): log is LoadedLog => log !== null);
                // Only a folder where not one repository answered has nothing to say but the failure.
                setHeld({ asked, logs, failed: list.length > 0 && logs.length === 0 });
            }
        });
        return () => {
            alive = false;
        };
    }, [transport, sources, asked]);

    /* The next page of every repository that still has one, which is one step down the whole log. */
    const loadMore = (): void => {
        const current = shown;
        if (current === null) {
            return;
        }
        setPaging(true);
        Promise.all(
            current.logs.map(async (log): Promise<LoadedLog> => {
                if (log.cursor === null) {
                    return log;
                }
                try {
                    const answer = await transport.request('git.log', { cwd: log.cwd, limit: PAGE, cursor: log.cursor });
                    return { ...log, commits: [...log.commits, ...answer.commits], cursor: answer.cursor };
                } catch {
                    return { ...log, cursor: null };
                }
            })
        )
            .then((logs) => setHeld((previous) => (previous === null || previous.asked !== asked ? previous : { ...previous, logs })))
            .finally(() => setPaging(false));
    };

    const state = shown === null ? 'loading' : shown.failed ? 'error' : 'ready';
    const { rows: commits, more } = mergeLogs(shown?.logs ?? []);

    if (state === 'error') {
        return <PanelEmpty icon={GitCommitHorizontal}>{t('git.log.failed')}</PanelEmpty>;
    }
    if (state === 'ready' && commits.length === 0) {
        return <PanelEmpty icon={GitCommitHorizontal}>{t('git.log.empty')}</PanelEmpty>;
    }

    return (
        <div className="min-h-0 grow overflow-y-auto py-1">
            {groupCommits(commits, now).map((section) => (
                <section key={section.label}>
                    <header className={GIT_GROUP}>
                        <span className={SECTION_LABEL}>{section.label}</span>
                    </header>
                    {section.commits.map((commit) => (
                        <ContextMenu.Root key={`${commit.cwd}\u0000${commit.hash}`}>
                            <ContextMenu.Trigger
                                render={<button />}
                                className={LOG_ROW}
                                aria-current={commit.hash === reading}
                                data-selected={commit.hash === reading || undefined}
                                onClick={() => onOpen(commit.cwd, commit)}
                            >
                                {commit.repo !== '' && <span className="max-w-24 shrink-0 truncate text-text-faint">{commit.repo}</span>}
                                <span className="truncate text-text">{commit.subject}</span>
                                {commit.refs.slice(0, REFS_SHOWN).map((ref) => (
                                    <Tooltip key={ref} label={ref}>
                                        <Pill mono className="max-w-32 shrink-0 py-0">
                                            <span className="min-w-0 truncate">{ref}</span>
                                        </Pill>
                                    </Tooltip>
                                ))}
                                {commit.refs.length > REFS_SHOWN && (
                                    <Tooltip label={commit.refs.slice(REFS_SHOWN).join(', ')}>
                                        <Pill className="shrink-0 py-0 tabular-nums">{t('git.log.moreRefs', { count: commit.refs.length - REFS_SHOWN })}</Pill>
                                    </Tooltip>
                                )}
                                <span className="grow" />
                                <span className="truncate text-text-faint">{commit.author}</span>
                                <span className="shrink-0 text-text-faint">{relativeTime(commit.at, now)}</span>
                            </ContextMenu.Trigger>
                            <ContextMenu.Portal>
                                <ContextMenu.Positioner className="z-(--z-popup)">
                                    <ContextMenu.Popup className="menu-popup">
                                        <ContextMenu.Item className="menu-item" onClick={() => onOpen(commit.cwd, commit)}>
                                            <Icon icon={GitCommitHorizontal} size={14} /> {t('git.log.open')}
                                        </ContextMenu.Item>
                                        <ContextMenu.Separator className={MENU_SEPARATOR} />
                                        <ContextMenu.Item className="menu-item" onClick={() => copyText(commit.hash)}>
                                            <Icon icon={Copy} size={14} /> {t('file.tab.copyCommit')}
                                        </ContextMenu.Item>
                                        <ContextMenu.Item className="menu-item" onClick={() => copyText(commit.subject)}>
                                            <Icon icon={Copy} size={14} /> {t('git.log.copySubject')}
                                        </ContextMenu.Item>
                                    </ContextMenu.Popup>
                                </ContextMenu.Positioner>
                            </ContextMenu.Portal>
                        </ContextMenu.Root>
                    ))}
                </section>
            ))}
            {more && (
                <div className="flex justify-center p-2">
                    <Button size="sm" variant="secondary" disabled={paging} onClick={loadMore}>
                        {paging ? t('common:state.loading') : t('git.log.loadMore')}
                    </Button>
                </div>
            )}
        </div>
    );
}
