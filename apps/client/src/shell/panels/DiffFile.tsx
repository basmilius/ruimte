import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Columns2, FileWarning, GitCompare, RefreshCw, Rows2 } from 'lucide-react';
import type { ActionInput } from '@ruimte/actions';
import type { DiffContents } from '@adecore/agents-react/chat/ui/full-diff';
import type { GitDiffFile, GitDiffResult, GitDiffScope } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { relativeTime } from '@/shell/panels/commit-log';
import { CommitFileTree } from '@/shell/panels/CommitFileTree';
import { pickedFile } from '@/shell/panels/commit-tree';
import { FileActionsContext } from '@/shell/panels/file-actions';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { relativeTo } from '@/shell/panels/files-tree';
import { isCheckoutDiff, useFiles, type FileTabView } from '@/state/files';
import { useGit } from '@/state/git';
import { useGitSignal } from '@/state/git-watch';
import { useSettings } from '@/state/settings';
import { useTransport } from '@/transport/context';
import { ButtonGroup, ColumnResizeHandle, EmptyState, ErrorBoundary, Menu, Separator, lazyNamed, useColumnResize, useNow } from '@adecore/ui';

const UnifiedDiff = lazyNamed(() => import('@adecore/agents-react/chat/ui/UnifiedDiff'), 'default');

const MINUTE_MS = 60_000;

/* A commit's file tree keeps room for a name and its counts; it never takes more than half the tab (`max-w-1/2`). */
const MIN_TREE_WIDTH = 160;

type DiffState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; diff: GitDiffResult };

/* The whole texts beside the patch, which a daemon sends only when it can hand over both sides. */
function contentsOf(diff: GitDiffResult): DiffContents | undefined {
    return diff.oldText === undefined || diff.newText === undefined ? undefined : { old: diff.oldText, new: diff.newText };
}

function omittedLabel(omitted: GitDiffResult['omitted']): string {
    return omitted === 'binary' ? i18next.t('panels:diff.omitted.binary') : i18next.t('panels:diff.omitted.tooLarge');
}

/*
 * A changed file as its diff, in a tab of the preview panel next to the tab that holds the file
 * itself. The scope switch is the same one the git panel remembers, so flipping it here is what the
 * next diff opens in as well.
 */
export function DiffFile({ tabKey, path, name, view }: { tabKey: string; path: string; name: string; view: FileTabView }) {
    if (view.commit !== undefined) {
        return <CommitDiff tabKey={tabKey} cwd={view.cwd} commit={view.commit} />;
    }
    if (isCheckoutDiff(path, view)) {
        return <CommitDiff tabKey={tabKey} cwd={view.cwd} base={view.base ?? null} />;
    }
    return <FileDiffView tabKey={tabKey} path={path} name={name} view={view} />;
}

/* One changed file, in whichever scope the tab is set to. */
function FileDiffView({ tabKey, path, name, view }: { tabKey: string; path: string; name: string; view: FileTabView }) {
    const { t } = useTranslation('panels');
    const layout = useSettings((s) => s.diffLayout);
    const whitespace = useSettings((s) => s.diffWhitespace);
    const wrap = useSettings((s) => s.codeWrap);
    const [nonce, setNonce] = useState(0);
    /* Goes up whenever the checkout moved, which is the tab reading itself again. */
    const signal = useGitSignal(view.cwd);
    const relative = useMemo(() => relativeTo(view.cwd, path), [view.cwd, path]);
    /* Which diff was asked for, so an answer to the question before this one is not drawn and a
       switch of scope reads as loading without an effect that has to empty the state first. A
       reread of the same question is not part of it: the diff on screen stays up until the new
       one lands, or every write would blink the tab back to its spinner. */
    const asked = `${view.cwd}\u0000${relative}\u0000${view.scope}\u0000${String(view.staged)}\u0000${String(whitespace)}\u0000${view.base ?? ''}`;
    const [held, setHeld] = useState<{ asked: string; state: DiffState } | null>(null);
    // The same path on another machine is another diff, so a switch reads it again.
    const transport = useTransport();
    const state: DiffState = held !== null && held.asked === asked ? held.state : { status: 'loading' };

    useEffect(() => {
        let alive = true;
        performAsPerson('git.diff', {
            repository: view.cwd,
            path: relative,
            scope: view.scope,
            commit: null,
            staged: view.staged,
            ignoreWhitespace: !whitespace,
            base: view.base ?? null
        })
            .then((diff) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'ready', diff } });
                    useGit.getState().setCounts(tabKey, { added: diff.added, deleted: diff.deleted });
                }
            })
            .catch((error: unknown) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'error', message: error instanceof Error ? error.message : i18next.t('panels:diff.readFailed') } });
                }
            });
        return () => {
            alive = false;
        };
    }, [transport, asked, nonce, signal, relative, tabKey, view.cwd, view.scope, view.staged, view.base, whitespace]);

    const refresh = useCallback(() => setNonce((count) => count + 1), []);
    const actions = useMemo(() => ({ path, name, on: 'tab' as const, tabKey, refresh }), [tabKey, path, name, refresh]);

    const setScope = (scope: GitDiffScope): void => {
        useGit.getState().setScope(scope);
        useFiles.getState().setScope(tabKey, scope);
    };

    return (
        <FileActionsContext.Provider value={actions}>
            <div className="flex min-h-0 min-w-0 grow flex-col">
                <FileToolbar
                    menu={
                        <>
                            <Menu.RadioGroup value={view.scope} onValueChange={(scope: GitDiffScope) => setScope(scope)}>
                                <Menu.RadioItem value="worktree">{t('diff.scope.worktree')}</Menu.RadioItem>
                                <Menu.RadioItem value="base">{t('diff.scope.base')}</Menu.RadioItem>
                            </Menu.RadioGroup>
                            <Menu.Separator />
                            <Menu.RadioGroup value={layout} onValueChange={(diffLayout: 'stacked' | 'split') => useSettings.getState().update({ diffLayout })}>
                                <Menu.RadioItem value="stacked">{t('diff.layout.stacked')}</Menu.RadioItem>
                                <Menu.RadioItem value="split">{t('diff.layout.split')}</Menu.RadioItem>
                            </Menu.RadioGroup>
                            <Menu.Separator />
                            <Menu.CheckboxItem checked={whitespace} onCheckedChange={(diffWhitespace) => useSettings.getState().update({ diffWhitespace })}>
                                {t('diff.whitespace.show')}
                            </Menu.CheckboxItem>
                        </>
                    }
                />
                <DiffBody state={state} wrap={wrap} layout={layout} relative={relative} />
            </div>
        </FileActionsContext.Provider>
    );
}

function DiffBody({ state, wrap, layout, relative }: { state: DiffState; wrap: boolean; layout: 'stacked' | 'split'; relative: string }) {
    const { t } = useTranslation('panels');
    if (state.status === 'loading') {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState busy>{t('diff.reading', { path: relative })}</EmptyState>
            </div>
        );
    }
    if (state.status === 'error') {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState icon={FileWarning}>{state.message}</EmptyState>
            </div>
        );
    }
    if (state.diff.omitted) {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState icon={FileWarning}>{omittedLabel(state.diff.omitted)}</EmptyState>
            </div>
        );
    }
    if (state.diff.diff === '') {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState icon={GitCompare}>{t('diff.noChange', { path: relative })}</EmptyState>
            </div>
        );
    }
    return (
        <div className="file-diff flex min-h-0 grow flex-col overflow-auto">
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('diff.loading')}</div>}>
                <UnifiedDiff
                    change={{ path: relative, kind: 'update', diff: state.diff.diff }}
                    overflow={wrap ? 'wrap' : 'scroll'}
                    diffStyle={layout === 'split' ? 'split' : 'unified'}
                    fill
                    contents={contentsOf(state.diff)}
                />
            </Suspense>
        </div>
    );
}

type CommitState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; diff: GitDiffResult };

/*
 * A whole commit in one tab: what it says and who wrote it over a tree of the files it touched, and
 * beside that the diff of the one file picked in the tree. One request answers all of it, so moving
 * through the tree reads nothing and the caps that keep a diff readable are the same ones. Without a
 * commit the tab is a whole checkout against `base`, which is how a worktree shows what it holds.
 */
function CommitDiff({ tabKey, cwd, commit, base }: { tabKey: string; cwd: string; commit?: string; base?: string | null }) {
    const { t } = useTranslation('panels');
    const layout = useSettings((s) => s.diffLayout);
    const wrap = useSettings((s) => s.codeWrap);
    const now = Math.floor(useNow(MINUTE_MS) / 1000);
    const [nonce, setNonce] = useState(0);
    /* A commit never changes, so only the changes of a checkout follow the tree. */
    const signal = useGitSignal(commit === undefined ? cwd : null);
    /* Which commit was asked for, so a tab that just changed reads as loading without an effect
       that has to empty the state first. A reread of the same one keeps what is on screen. */
    const asked = `${cwd}\u0000${commit ?? ''}\u0000${base ?? ''}`;

    const [held, setHeld] = useState<{ asked: string; state: CommitState } | null>(null);
    // The same path on another machine is another diff, so a switch reads it again.
    const transport = useTransport();
    const state: CommitState = held !== null && held.asked === asked ? held.state : { status: 'loading' };

    useEffect(() => {
        let alive = true;
        const ask: ActionInput<'git.diff'> =
            commit === undefined
                ? { repository: cwd, path: null, scope: 'base', commit: null, staged: null, ignoreWhitespace: null, base: base ?? null }
                : { repository: cwd, path: null, scope: 'commit', commit, staged: null, ignoreWhitespace: null, base: null };
        performAsPerson('git.diff', ask)
            .then((diff) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'ready', diff } });
                    useGit.getState().setCounts(tabKey, { added: diff.added, deleted: diff.deleted });
                }
            })
            .catch((error: unknown) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'error', message: error instanceof Error ? error.message : i18next.t('panels:diff.commitFailed') } });
                }
            });
        return () => {
            alive = false;
        };
    }, [transport, asked, nonce, signal, commit, base, cwd, tabKey]);

    const ready = state.status === 'ready' ? state.diff : null;
    const meta = ready?.commit;
    const files = useMemo<readonly GitDiffFile[]>(() => ready?.files ?? [], [ready]);
    const since = base ?? t('worktree.baseBranch');
    const picked = useGit((s) => s.commitFiles[tabKey]);
    const shown = pickedFile(files, picked);
    const pick = useCallback((path: string) => useGit.getState().setCommitFile(tabKey, path), [tabKey]);
    const treeWidth = useGit((s) => s.commitTreeWidth);
    const bodyRef = useRef<HTMLDivElement>(null);
    const treeRef = useRef<HTMLElement>(null);
    const { startResize } = useColumnResize(treeRef, {
        size: treeWidth,
        min: MIN_TREE_WIDTH,
        from: 'left',
        max: () => Math.floor((bodyRef.current?.getBoundingClientRect().width ?? 0) / 2),
        onSize: (next) => useGit.getState().setCommitTreeWidth(next)
    });

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className={FILE_TOOLBAR}>
                <span className="truncate font-mono text-xs text-text-muted">
                    {commit === undefined ? t('diff.since', { base: since }) : (meta?.shortHash ?? commit.slice(0, 7))}
                </span>
                <span className="grow" />
                {commit === undefined && (
                    <>
                        <FileToolbarToggle icon={RefreshCw} label={t('diff.readAgain')} active={false} onClick={() => setNonce((count) => count + 1)} />
                        <Separator />
                    </>
                )}
                <ButtonGroup render={<span />}>
                    <FileToolbarToggle
                        icon={Rows2}
                        label={t('diff.layout.stacked')}
                        active={layout === 'stacked'}
                        onClick={() => useSettings.getState().update({ diffLayout: 'stacked' })}
                    />
                    <FileToolbarToggle
                        icon={Columns2}
                        label={t('diff.layout.split')}
                        active={layout === 'split'}
                        onClick={() => useSettings.getState().update({ diffLayout: 'split' })}
                    />
                </ButtonGroup>
            </div>
            {state.status === 'loading' && (
                <div className="file-diff grid min-h-0 grow place-items-center">
                    <EmptyState busy>{commit === undefined ? t('diff.readingChanges') : t('diff.readingCommit')}</EmptyState>
                </div>
            )}
            {state.status === 'error' && (
                <div className="file-diff grid min-h-0 grow place-items-center">
                    <EmptyState icon={FileWarning}>{state.message}</EmptyState>
                </div>
            )}
            {ready !== null && (
                <ErrorBoundary label={t('diff.commitCrashed')} resetKeys={[asked]} className="min-h-0 grow">
                    {/* Too narrow for the two side by side, the tree stands above the diff at a height it cannot grow past. */}
                    <div ref={bodyRef} className="@container flex min-h-0 grow flex-col">
                        <div className="flex min-h-0 grow flex-col @xl:flex-row">
                            <aside
                                ref={treeRef}
                                className="relative flex h-72 min-h-0 max-h-1/2 shrink-0 flex-col border-b bg-surface border-border @xl:h-auto @xl:max-h-none @xl:w-(--commit-tree-width) @xl:max-w-1/2 @xl:border-r @xl:border-b-0"
                                style={{ '--commit-tree-width': `${treeWidth}px` } as CSSProperties}
                            >
                                <div className="shrink-0 border-b border-border px-3 py-2">
                                    {commit === undefined ? (
                                        <p className="text-xs text-text-faint">
                                            {files.length === 0 ? t('diff.nothingSince', { base: since }) : t('diff.sinceSummary', { base: since })}
                                        </p>
                                    ) : (
                                        <>
                                            <p className="text-xs font-medium text-text">{meta?.subject ?? commit}</p>
                                            <p className="mt-1 text-xs text-text-faint">
                                                {meta === undefined ? commit : `${meta.author} · ${relativeTime(meta.at, now)} · ${meta.shortHash}`}
                                            </p>
                                        </>
                                    )}
                                </div>
                                <div className="flex min-h-0 grow flex-col overflow-hidden py-1">
                                    {files.length > 0 && <CommitFileTree files={files} shown={shown?.path ?? null} onPick={pick} />}
                                    {ready.truncated === true && <p className="shrink-0 px-3 py-2 text-xs text-text-faint">{t('diff.moreFiles')}</p>}
                                </div>
                                <ColumnResizeHandle from="left" className="hidden @xl:block" onPointerDown={startResize} />
                            </aside>
                            <CommitFileDiff file={shown} empty={files.length === 0} commit={commit !== undefined} wrap={wrap} layout={layout} />
                        </div>
                    </div>
                </ErrorBoundary>
            )}
        </div>
    );
}

/* The diff of the one file of a commit the tree has picked. */
function CommitFileDiff({
    file,
    empty,
    commit,
    wrap,
    layout
}: {
    file: GitDiffFile | null;
    /* Whether the answer holds no file at all, which a checkout says above the tree already. */
    empty: boolean;
    commit: boolean;
    wrap: boolean;
    layout: 'stacked' | 'split';
}) {
    const { t } = useTranslation('panels');
    if (file === null || file.diff === '') {
        return (
            <div className="file-diff grid min-h-0 min-w-0 grow place-items-center">
                {file !== null ? (
                    <EmptyState icon={FileWarning}>{omittedLabel(file.omitted)}</EmptyState>
                ) : (
                    empty && commit && <EmptyState icon={GitCompare}>{t('diff.noFiles')}</EmptyState>
                )}
            </div>
        );
    }
    return (
        <div className="file-diff flex min-h-0 min-w-0 grow flex-col overflow-auto">
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('diff.loading')}</div>}>
                <UnifiedDiff
                    key={file.path}
                    change={{ path: file.path, kind: 'update', diff: file.diff }}
                    overflow={wrap ? 'wrap' : 'scroll'}
                    diffStyle={layout === 'split' ? 'split' : 'unified'}
                    fill
                />
            </Suspense>
        </div>
    );
}
