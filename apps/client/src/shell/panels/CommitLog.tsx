import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Copy, GitCommitHorizontal } from 'lucide-react';
import { GIT_GROUP } from '@/shell/panels/classes';
import { perform } from '@/actions/client-actions';
import { githubPicture, groupCommits, mergeLogs, shownRefs, type LoadedLog, type LogRow } from '@/shell/panels/commit-log';
import { useTransport } from '@/transport/context';
import { Button, copyText, Icon, ListRow, Pill, PanelEmpty, SectionLabel, Tooltip, ContextMenu, useNow } from '@adecore/ui';
import { formatAge, formatClock, isSameDay } from '@adecore/ui/format';

// One screen of rows at a time; the button at the end asks for the next.
const PAGE = 30;
const MINUTE_MS = 60_000;

/* A commit on two branches names both; beyond that the names cost the subject more than they tell. */
const REFS_SHOWN = 2;

/* A commit row is its own open button: the row's states with the columns of a row that opens. */
const LOG_ROW = `group w-full min-w-0 gap-1.5 pr-1 pl-3 text-xs text-inherit hover:bg-surface-hover hover:text-text data-[selected]:bg-surface-active data-[selected]:text-text`;

/* The checkouts the log is read from, named so a row can say which one it came out of. */
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
 * The history under the commit box: every repository of the folder at once, newest first. It reloads
 * from the top whenever a status moves, since everything that moves a log moves the status with it.
 */
export function CommitLog({ sources, reading, onOpen }: CommitLogProps) {
    const { t } = useTranslation('panels');
    /* What was asked for, so an answer to an older question is not drawn and a status that moved
       reads as loading without an effect that has to empty the state first. */
    const asked = sources.map((source) => `${source.cwd}\u0000${source.repo}\u0000${source.revision}`).join('\u0001');
    const [held, setHeld] = useState<{ asked: string; logs: LoadedLog[]; failed: boolean } | null>(null);
    const [paging, setPaging] = useState(false);
    const now = Math.floor(useNow(MINUTE_MS) / 1000);
    // The same path on another machine is another log, so a switch reads it again.
    const transport = useTransport();
    const shown = held !== null && held.asked === asked ? held : null;

    useEffect(() => {
        let alive = true;
        // From `asked`, not `sources`: each status that lands rebuilds the same list, and a new read drops every loaded page.
        const list =
            asked === ''
                ? []
                : asked.split('\u0001').map((entry) => {
                      const [cwd = '', repo = ''] = entry.split('\u0000');
                      return { cwd, repo };
                  });
        Promise.all(
            list.map(async (source): Promise<LoadedLog | null> => {
                try {
                    const answer = await perform('git.log', { repository: source.cwd, limit: PAGE, cursor: null });
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
    }, [transport, asked]);

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
                    const answer = await perform('git.log', { repository: log.cwd, limit: PAGE, cursor: log.cursor });
                    return { ...log, commits: [...log.commits, ...answer.commits], cursor: answer.cursor };
                } catch {
                    return { ...log, cursor: null };
                }
            })
        )
            .then((logs) => setHeld((previous) => (previous === null || previous.asked !== asked ? previous : { ...previous, logs })))
            .finally(() => setPaging(false));
    };

    // The panel hands a new function every render, which would draw every row again.
    const openRef = useRef(onOpen);
    useLayoutEffect(() => {
        openRef.current = onOpen;
    });
    const open = (cwd: string, commit: LogRow) => openRef.current(cwd, commit);

    const state = shown === null ? 'loading' : shown.failed ? 'error' : 'ready';
    const { rows: commits, more } = mergeLogs(shown?.logs ?? []);
    const sections = groupCommits(commits, now);

    if (state === 'error') {
        return <PanelEmpty icon={GitCommitHorizontal}>{t('git.log.failed')}</PanelEmpty>;
    }
    if (state === 'ready' && commits.length === 0) {
        return <PanelEmpty icon={GitCommitHorizontal}>{t('git.log.empty')}</PanelEmpty>;
    }

    return (
        <div className="min-h-0 grow overflow-y-auto py-1">
            {sections.map((section) => (
                <section key={section.label}>
                    <header className={GIT_GROUP}>
                        <SectionLabel>{section.label}</SectionLabel>
                    </header>
                    {section.commits.map((commit) => (
                        <CommitRow key={`${commit.cwd}\u0000${commit.hash}`} commit={commit} selected={commit.hash === reading} now={now} onOpen={open} />
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

interface CommitRowProps {
    commit: LogRow;
    selected: boolean;
    now: number;
    onOpen(cwd: string, commit: LogRow): void;
}

/* A commit is the same commit for as long as its hash is, so a page going in below leaves every row above it alone. */
function sameRow(before: CommitRowProps, after: CommitRowProps): boolean {
    return (
        before.commit.cwd === after.commit.cwd &&
        before.commit.hash === after.commit.hash &&
        before.commit.repo === after.commit.repo &&
        before.commit.refs.join('\u0000') === after.commit.refs.join('\u0000') &&
        (before.commit.remoteRefs ?? []).join('\u0000') === (after.commit.remoteRefs ?? []).join('\u0000') &&
        before.selected === after.selected &&
        before.now === after.now &&
        before.onOpen === after.onOpen
    );
}

const CommitRow = memo(function CommitRow({ commit, selected, now, onOpen }: CommitRowProps) {
    const { t } = useTranslation('panels');
    const refs = shownRefs(commit);
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<ListRow variant="flat" render={<button />} />}
                className={LOG_ROW}
                aria-current={selected}
                data-selected={selected || undefined}
                onClick={() => onOpen(commit.cwd, commit)}
            >
                <AuthorAvatar name={commit.author} email={commit.authorEmail} />
                {commit.repo !== '' && <span className="max-w-24 shrink-0 truncate text-text-faint">{commit.repo}</span>}
                <span className="truncate text-text">{commit.subject}</span>
                {refs.slice(0, REFS_SHOWN).map((ref) => (
                    <Tooltip key={ref.name} label={ref.tracked === null ? ref.name : t('git.log.tracked', { name: ref.name, remote: ref.tracked })}>
                        <Pill mono size="sm" className="max-w-32 shrink-0 py-0">
                            <span className="min-w-0 truncate">{ref.name}</span>
                            {ref.tracked !== null && <Icon icon={Cloud} size={12} className="shrink-0 text-text-faint" />}
                        </Pill>
                    </Tooltip>
                ))}
                {refs.length > REFS_SHOWN && (
                    <Tooltip
                        label={refs
                            .slice(REFS_SHOWN)
                            .map((ref) => ref.name)
                            .join(', ')}
                    >
                        <Pill size="sm" className="shrink-0 py-0 tabular-nums">
                            {t('git.log.moreRefs', { count: refs.length - REFS_SHOWN })}
                        </Pill>
                    </Tooltip>
                )}
                <span className="grow" />
                {/* Under a date the age says that date again; the time of day says what it does not. */}
                <span className="shrink-0 text-text-faint tabular-nums">
                    {isSameDay(commit.at * 1000, now * 1000) ? formatAge(commit.at * 1000, now * 1000) : formatClock(commit.at * 1000)}
                </span>
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                <ContextMenu.Item onClick={() => onOpen(commit.cwd, commit)}>
                    <Icon icon={GitCommitHorizontal} size={14} /> {t('git.log.open')}
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={() => copyText(commit.hash)}>
                    <Icon icon={Copy} size={14} /> {t('file.tab.copyCommit')}
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => copyText(commit.subject)}>
                    <Icon icon={Copy} size={14} /> {t('git.log.copySubject')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}, sameRow);

/* The author as a mark at the start of the row: GitHub's picture where the address names an account, else the first letter. */
function AuthorAvatar({ name, email }: { readonly name: string; readonly email: string | undefined }) {
    const picture = githubPicture(email);
    // Offline, or an account GitHub no longer knows: the letter stands in rather than a broken image.
    const [failed, setFailed] = useState<string | null>(null);
    return (
        <Tooltip label={email === undefined || email === '' ? name : `${name} <${email}>`}>
            {picture !== null && failed !== picture ? (
                <img src={picture} alt={name} className="size-4 shrink-0 rounded-full bg-surface-hover" onError={() => setFailed(picture)} />
            ) : (
                <span
                    role="img"
                    aria-label={name}
                    className="grid size-4 shrink-0 place-items-center rounded-full bg-surface-hover text-xs leading-none text-text-muted"
                >
                    {name.slice(0, 1).toUpperCase()}
                </span>
            )}
        </Tooltip>
    );
}
