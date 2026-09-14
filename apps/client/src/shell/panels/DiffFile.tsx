import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Columns2, FileDiff, FileWarning, GitBranch, GitCompare, LoaderCircle, Rows2, Space, WrapText } from 'lucide-react';
import type { GitDiffFile, GitDiffResult, GitDiffScope } from '@ruimte/contracts';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { relativeTime } from '@/shell/panels/commit-log';
import { FileActionsContext } from '@/shell/panels/file-actions';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { relativeTo } from '@/shell/panels/files-tree';
import { useFiles, type FileTabView } from '@/state/files';
import { useGit } from '@/state/git';
import { useSettings } from '@/state/settings';
import { useTransport } from '@/transport/context';
import { BTN_GROUP } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';

const UnifiedDiff = lazy(() => import('@/chat/ui/UnifiedDiff'));

type DiffState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; diff: GitDiffResult };

const omittedLabel = (omitted: GitDiffResult['omitted']): string => (omitted === 'binary' ? 'Binary files have no diff.' : 'This diff is too large to show.');

/*
 * A changed file as its diff, in a tab of the preview panel next to the tab that holds the file
 * itself. The scope switch is the same one the git panel remembers, so flipping it here is what the
 * next diff opens in as well.
 */
export function DiffFile({ tabKey, path, name, view }: { tabKey: string; path: string; name: string; view: FileTabView }) {
    if (view.commit !== undefined) {
        return <CommitDiff tabKey={tabKey} cwd={view.cwd} commit={view.commit} />;
    }
    return <FileDiffView tabKey={tabKey} path={path} name={name} view={view} />;
}

/* One changed file, in whichever scope the tab is set to. */
function FileDiffView({ tabKey, path, name, view }: { tabKey: string; path: string; name: string; view: FileTabView }) {
    const layout = useSettings((s) => s.diffLayout);
    const whitespace = useSettings((s) => s.diffWhitespace);
    const [wrap, setWrap] = useState(true);
    const [nonce, setNonce] = useState(0);
    const relative = useMemo(() => relativeTo(view.cwd, path), [view.cwd, path]);
    /* Which diff was asked for, so an answer to the question before this one is not drawn and a
       switch of scope reads as loading without an effect that has to empty the state first. */
    const asked = `${view.cwd}\u0000${relative}\u0000${view.scope}\u0000${String(view.staged)}\u0000${String(whitespace)}\u0000${nonce}`;
    const [held, setHeld] = useState<{ asked: string; state: DiffState } | null>(null);
    const transport = useTransport();
    const state: DiffState = held !== null && held.asked === asked ? held.state : { status: 'loading' };

    useEffect(() => {
        let alive = true;
        transport
            .request('git.diff', { cwd: view.cwd, path: relative, scope: view.scope, staged: view.staged, ignoreWhitespace: !whitespace })
            .then((diff) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'ready', diff } });
                    useGit.getState().setCounts(tabKey, { added: diff.added, deleted: diff.deleted });
                }
            })
            .catch((error: unknown) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'error', message: error instanceof Error ? error.message : 'Could not read the diff.' } });
                }
            });
        return () => {
            alive = false;
        };
    }, [transport, asked, relative, tabKey, view.cwd, view.scope, view.staged, whitespace]);

    const refresh = useCallback(() => setNonce((count) => count + 1), []);
    const actions = useMemo(() => ({ path, name, on: 'tab' as const, tabKey, refresh }), [tabKey, path, name, refresh]);

    const setScope = (scope: GitDiffScope): void => {
        useGit.getState().setScope(scope);
        useFiles.getState().setScope(tabKey, scope);
    };

    return (
        <FileActionsContext.Provider value={actions}>
            <div className="flex min-h-0 min-w-0 grow flex-col">
                <FileToolbar>
                    <span className={BTN_GROUP}>
                        <FileToolbarToggle
                            icon={FileDiff}
                            label="Against the working tree"
                            active={view.scope === 'worktree'}
                            onClick={() => setScope('worktree')}
                        />
                        <FileToolbarToggle icon={GitBranch} label="Against the base branch" active={view.scope === 'base'} onClick={() => setScope('base')} />
                    </span>
                    <Separator />
                    <span className={BTN_GROUP}>
                        <FileToolbarToggle
                            icon={Rows2}
                            label="Stacked"
                            active={layout === 'stacked'}
                            onClick={() => useSettings.getState().update({ diffLayout: 'stacked' })}
                        />
                        <FileToolbarToggle
                            icon={Columns2}
                            label="Split"
                            active={layout === 'split'}
                            onClick={() => useSettings.getState().update({ diffLayout: 'split' })}
                        />
                    </span>
                    <Separator />
                    <FileToolbarToggle
                        icon={Space}
                        label={whitespace ? 'Ignore whitespace changes' : 'Show whitespace changes'}
                        active={whitespace}
                        onClick={() => useSettings.getState().update({ diffWhitespace: !whitespace })}
                    />
                    <FileToolbarToggle
                        icon={WrapText}
                        label={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
                        active={wrap}
                        onClick={() => setWrap(!wrap)}
                    />
                </FileToolbar>
                <DiffBody state={state} wrap={wrap} layout={layout} relative={relative} />
            </div>
        </FileActionsContext.Provider>
    );
}

function DiffBody({ state, wrap, layout, relative }: { state: DiffState; wrap: boolean; layout: 'stacked' | 'split'; relative: string }) {
    if (state.status === 'loading') {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={LoaderCircle} size={20} className="animate-spin" />}>Reading the diff of {relative}...</EmptyState>
            </div>
        );
    }
    if (state.status === 'error') {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={FileWarning} size={20} />}>{state.message}</EmptyState>
            </div>
        );
    }
    if (state.diff.omitted) {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={FileWarning} size={20} />}>{omittedLabel(state.diff.omitted)}</EmptyState>
            </div>
        );
    }
    if (state.diff.diff === '') {
        return (
            <div className="file-diff grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={GitCompare} size={20} />}>Nothing changed in {relative} in this scope.</EmptyState>
            </div>
        );
    }
    return (
        <div className="file-diff min-h-0 grow overflow-auto">
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">Loading diff</div>}>
                <UnifiedDiff
                    change={{ path: relative, kind: 'update', diff: state.diff.diff }}
                    overflow={wrap ? 'wrap' : 'scroll'}
                    diffStyle={layout === 'split' ? 'split' : 'unified'}
                />
            </Suspense>
        </div>
    );
}

type CommitState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; diff: GitDiffResult };

/*
 * A whole commit in one tab: what it says and who wrote it, the files it touched as a list at the
 * top, and every patch under that. One request answers all of it, so a commit opens as fast as a
 * single file does and the caps that keep a diff readable are the same ones.
 */
function CommitDiff({ tabKey, cwd, commit }: { tabKey: string; cwd: string; commit: string }) {
    const layout = useSettings((s) => s.diffLayout);
    const [wrap, setWrap] = useState(true);
    const [now] = useState(() => Math.floor(Date.now() / 1000));
    /* Which commit was asked for, so a tab that just changed reads as loading without an effect
       that has to empty the state first. */
    const asked = `${cwd}\u0000${commit}`;
    const [held, setHeld] = useState<{ asked: string; state: CommitState } | null>(null);
    const transport = useTransport();
    const state: CommitState = held !== null && held.asked === asked ? held.state : { status: 'loading' };

    useEffect(() => {
        let alive = true;
        transport
            .request('git.diff', { cwd, scope: 'commit', commit })
            .then((diff) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'ready', diff } });
                    useGit.getState().setCounts(tabKey, { added: diff.added, deleted: diff.deleted });
                }
            })
            .catch((error: unknown) => {
                if (alive) {
                    setHeld({ asked, state: { status: 'error', message: error instanceof Error ? error.message : 'Could not read the commit.' } });
                }
            });
        return () => {
            alive = false;
        };
    }, [transport, asked, commit, cwd, tabKey]);

    const meta = state.status === 'ready' ? state.diff.commit : undefined;
    const files: readonly GitDiffFile[] = state.status === 'ready' ? (state.diff.files ?? []) : [];

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className={FILE_TOOLBAR}>
                <span className="truncate font-mono text-xs text-text-muted">{meta?.shortHash ?? commit.slice(0, 7)}</span>
                <span className="grow" />
                <span className={BTN_GROUP}>
                    <FileToolbarToggle
                        icon={Rows2}
                        label="Stacked"
                        active={layout === 'stacked'}
                        onClick={() => useSettings.getState().update({ diffLayout: 'stacked' })}
                    />
                    <FileToolbarToggle
                        icon={Columns2}
                        label="Split"
                        active={layout === 'split'}
                        onClick={() => useSettings.getState().update({ diffLayout: 'split' })}
                    />
                </span>
                <Separator />
                <FileToolbarToggle icon={WrapText} label={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'} active={wrap} onClick={() => setWrap(!wrap)} />
            </div>
            {state.status === 'loading' && (
                <div className="file-diff grid min-h-0 grow place-items-center">
                    <EmptyState icon={<Icon icon={LoaderCircle} size={20} className="animate-spin" />}>Reading the commit.</EmptyState>
                </div>
            )}
            {state.status === 'error' && (
                <div className="file-diff grid min-h-0 grow place-items-center">
                    <EmptyState icon={<Icon icon={FileWarning} size={20} />}>{state.message}</EmptyState>
                </div>
            )}
            {state.status === 'ready' && (
                <div className="file-diff min-h-0 grow overflow-auto">
                    <div className="border-b border-border px-3 py-2">
                        <p className="text-xs font-medium text-text">{meta?.subject ?? commit}</p>
                        <p className="mt-1 text-xs text-text-faint">
                            {meta === undefined ? commit : `${meta.author} · ${relativeTime(meta.at, now)} · ${meta.shortHash}`}
                        </p>
                        <ul className="mt-2 flex flex-col gap-0.5">
                            {files.map((file) => (
                                <li key={file.path} className="flex items-center gap-2 text-xs">
                                    <span className="truncate font-mono text-text-muted">{file.path}</span>
                                    <span className="grow" />
                                    <span className="shrink-0 tabular-nums text-term-green">{file.added > 0 ? `+${file.added}` : ''}</span>
                                    <span className="shrink-0 tabular-nums text-term-red">{file.deleted > 0 ? `-${file.deleted}` : ''}</span>
                                </li>
                            ))}
                        </ul>
                        {state.diff.truncated === true && <p className="mt-2 text-xs text-text-faint">More files changed than this list holds.</p>}
                    </div>
                    <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">Loading diff</div>}>
                        {files.map((file) =>
                            file.diff === '' ? (
                                <p key={file.path} className="px-3 py-2 text-xs text-text-faint">
                                    {file.path}: {omittedLabel(file.omitted)}
                                </p>
                            ) : (
                                <UnifiedDiff
                                    key={file.path}
                                    change={{ path: file.path, kind: 'update', diff: file.diff }}
                                    overflow={wrap ? 'wrap' : 'scroll'}
                                    diffStyle={layout === 'split' ? 'split' : 'unified'}
                                />
                            )
                        )}
                    </Suspense>
                </div>
            )}
        </div>
    );
}
