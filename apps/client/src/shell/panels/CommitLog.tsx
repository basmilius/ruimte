import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Cloud, Copy, GitCommitHorizontal } from 'lucide-react';
import { GIT_GROUP } from '@/shell/panels/classes';
import { perform } from '@/actions/client-actions';
import { githubPicture, groupCommits, mergeLogs, shownRefs, type LoadedLog, type LogRow } from '@/shell/panels/commit-log';
import { useGit } from '@/state/git';
import { useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';
import { useMachineAnswers } from '@/transport/features';
import { Button, copyText, Icon, ListRow, Menu, Pill, PanelEmpty, SectionLabel, Tooltip, ContextMenu, useNow } from '@adecore/ui';
import { formatAgo, formatClock, formatElapsedShort, isSameDay } from '@adecore/ui/format';

// One screen of rows at a time; the button at the end asks for the next.
const PAGE = 30;
const MINUTE_MS = 60_000;

/* One name fits beside the subject in a narrow panel; the others fold into a count with their names in its tooltip. */
const REFS_SHOWN = 1;

/* A commit row is its own open button, inset and rounded like a row of the file tree above it; a
   button centers its text unless told otherwise. */
const LOG_ROW = `group w-full min-w-0 gap-2 overflow-hidden rounded-md pr-2 pl-1 text-left text-xs text-inherit hover:bg-surface-hover hover:text-text data-[selected]:bg-surface-active data-[selected]:text-text`;

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
    /* Where the one repository the log narrows to is kept: the same key as the draft. */
    filterKey: string;
    /* The commit the preview has open, so the row a person is reading stands out. */
    reading: string | null;
    onOpen(cwd: string, commit: LogRow): void;
}

/*
 * The history under the commit box: every repository of the folder at once, newest first. It reloads
 * from the top whenever a status moves, since everything that moves a log moves the status with it.
 */
export function CommitLog({ sources, filterKey, reading, onOpen }: CommitLogProps) {
    const { t } = useTranslation('panels');
    const picked = useGit((s) => s.logRepos[filterKey] ?? '');
    /* A repository that left the panel (hidden, or the panel went into a worktree) narrows nothing. */
    const narrowed = sources.length > 1 ? (sources.find((source) => source.cwd === picked) ?? null) : null;
    const read = narrowed === null ? sources : [narrowed];
    /* What was asked for, so an answer to an older question is not drawn and a status that moved
       reads as loading without an effect that has to empty the state first. */
    const asked = read.map((source) => `${source.cwd}\u0000${source.repo}\u0000${source.revision}`).join('\u0001');
    const [held, setHeld] = useState<{ asked: string; logs: LoadedLog[]; failed: boolean } | null>(null);
    const [paging, setPaging] = useState(false);
    const now = Math.floor(useNow(MINUTE_MS) / 1000);
    // The same path on another machine is another log, so a switch reads it again.
    const transport = useTransport();
    const shown = held !== null && held.asked === asked ? held : null;
    const accounts = useAuthorAccounts(read);

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

    const filter =
        sources.length > 1 ? <RepoFilter sources={sources} narrowed={narrowed} onPick={(cwd) => useGit.getState().setLogRepo(filterKey, cwd)} /> : null;

    /* A log narrowed to a repository without commits keeps the filter, which is the way back. */
    if (state === 'error' || (state === 'ready' && commits.length === 0)) {
        return (
            <div className="flex min-h-0 grow flex-col px-2 py-1">
                {narrowed !== null && <header className={GIT_GROUP}>{filter}</header>}
                <PanelEmpty icon={GitCommitHorizontal}>{state === 'error' ? t('git.log.failed') : t('git.log.empty')}</PanelEmpty>
            </div>
        );
    }

    return (
        <div className="min-h-0 grow overflow-y-auto px-2 py-1">
            {sections.map((section, index) => (
                <section key={section.label}>
                    <header className={GIT_GROUP}>
                        <SectionLabel>{section.label}</SectionLabel>
                        {index === 0 && filter}
                    </header>
                    {section.commits.map((commit) => (
                        <CommitRow
                            key={`${commit.cwd}\u0000${commit.hash}`}
                            commit={commit}
                            picture={githubPicture(commit.authorEmail, accounts)}
                            selected={commit.hash === reading}
                            now={now}
                            onOpen={open}
                        />
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

interface RepoFilterProps {
    sources: readonly LogSource[];
    narrowed: LogSource | null;
    /* Null shows every repository again. */
    onPick(cwd: string | null): void;
}

/* Narrows the log to one repository of the folder, or widens it to all of them again. */
function RepoFilter({ sources, narrowed, onPick }: RepoFilterProps) {
    const { t } = useTranslation('panels');
    return (
        <Menu.Root>
            <Menu.Trigger render={<Button size="xs" variant="ghost" className="ml-auto min-w-0" />}>
                <span className="truncate">{narrowed === null ? t('git.log.allRepos') : narrowed.repo}</span>
                <Icon icon={ChevronDown} size={12} className="shrink-0" />
            </Menu.Trigger>
            <Menu.Popup align="end">
                <Menu.RadioGroup value={narrowed?.cwd ?? ''} onValueChange={(value: string) => onPick(value === '' ? null : value)}>
                    <Menu.RadioItem value="">{t('git.log.allRepos')}</Menu.RadioItem>
                    <Menu.Separator />
                    {sources.map((source) => (
                        <Menu.RadioItem key={source.cwd} value={source.cwd}>
                            <span className="truncate">{source.repo}</span>
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.Root>
    );
}

interface CommitRowProps {
    commit: LogRow;
    /* The author's GitHub picture, null where the address names no account GitHub told of. */
    picture: string | null;
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
        before.picture === after.picture &&
        before.selected === after.selected &&
        before.now === after.now &&
        before.onOpen === after.onOpen
    );
}

const CommitRow = memo(function CommitRow({ commit, picture, selected, now, onOpen }: CommitRowProps) {
    const { t } = useTranslation('panels');
    const refs = shownRefs(commit);
    const elapsedMs = Math.max(0, (now - commit.at) * 1000);
    const unitMs = elapsedMs < 3_600_000 ? MINUTE_MS : 3_600_000;
    const age = elapsedMs < MINUTE_MS ? formatAgo(0) : formatElapsedShort(Math.floor(elapsedMs / unitMs) * unitMs);

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<ListRow variant="flat" render={<button />} />}
                className={LOG_ROW}
                aria-current={selected}
                data-selected={selected || undefined}
                onClick={() => onOpen(commit.cwd, commit)}
            >
                <AuthorAvatar name={commit.author} email={commit.authorEmail} picture={picture} />
                {/* One width for every repository, so the subjects start in one column. */}
                {commit.repo !== '' && <span className="w-16 shrink-0 truncate text-text-faint">{commit.repo}</span>}
                <span className="min-w-0 flex-1 truncate text-text">{commit.subject}</span>
                {refs.slice(0, REFS_SHOWN).map((ref) => (
                    <Tooltip key={ref.name} label={ref.tracked === null ? ref.name : t('git.log.tracked', { name: ref.name, remote: ref.tracked })}>
                        {/* A Pill takes the tooltip's click handler and turns into a button, which a row that is a button cannot hold. */}
                        <span className="flex max-w-32 min-w-0 shrink-0">
                            <Pill mono size="sm" className="max-w-full min-w-0 py-0">
                                <span className="min-w-0 truncate">{ref.name}</span>
                                {ref.tracked !== null && <Icon icon={Cloud} size={12} className="shrink-0 text-text-faint" />}
                            </Pill>
                        </span>
                    </Tooltip>
                ))}
                {refs.length > REFS_SHOWN && (
                    <Tooltip
                        label={refs
                            .slice(REFS_SHOWN)
                            .map((ref) => ref.name)
                            .join(', ')}
                    >
                        <span className="flex shrink-0">
                            <Pill size="sm" className="py-0 tabular-nums">
                                {t('git.log.moreRefs', { count: refs.length - REFS_SHOWN })}
                            </Pill>
                        </span>
                    </Tooltip>
                )}
                {/* Under a date the age says that date again; the time of day says what it does not. */}
                <span className="ml-auto shrink-0 text-text-faint tabular-nums">
                    {isSameDay(commit.at * 1000, now * 1000) ? age : formatClock(commit.at * 1000)}
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

/*
 * The GitHub accounts behind the addresses in these repositories' logs, merged into one map, since an
 * address is the same person in every repository. Read once per set of folders, not on every status.
 */
function useAuthorAccounts(sources: readonly LogSource[]): ReadonlyMap<string, number> | undefined {
    const transport = useTransport();
    const answers = useMachineAnswers(useEndpointId(), 'git.authors');
    const cwds = sources.map((source) => source.cwd).join('\u0000');
    const [held, setHeld] = useState<{ cwds: string; accounts: ReadonlyMap<string, number> } | null>(null);

    useEffect(() => {
        if (!answers || cwds === '') {
            return;
        }

        let alive = true;

        Promise.all(
            cwds.split('\u0000').map((cwd) =>
                transport
                    .request('git.authors', { cwd })
                    .then((answer) => answer.authors)
                    .catch(() => [])
            )
        ).then((lists) => {
            if (alive) {
                setHeld({ cwds, accounts: new Map(lists.flat().map((author) => [author.email, author.id])) });
            }
        });

        return () => {
            alive = false;
        };
    }, [transport, answers, cwds]);

    return held?.cwds === cwds ? held.accounts : undefined;
}

/* The author as a mark at the start of the row: GitHub's picture where the address names an account, else the first letter. */
function AuthorAvatar({ name, email, picture }: { readonly name: string; readonly email: string | undefined; readonly picture: string | null }) {
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
