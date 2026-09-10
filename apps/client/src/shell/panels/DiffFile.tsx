import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Columns2, FileDiff, FileWarning, GitBranch, GitCompare, LoaderCircle, Rows2, Space, WrapText } from 'lucide-react';
import type { GitDiffResult, GitDiffScope } from '@ruimte/contracts';
import { FileActionsContext } from '@/shell/panels/file-actions';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { relativeTo } from '@/shell/panels/files-tree';
import { useFiles, type FileTabView } from '@/state/files';
import { useGit } from '@/state/git';
import { useSettings } from '@/state/settings';
import { transport } from '@/transport';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';

const UnifiedDiff = lazy(() => import('@/chat/ui/UnifiedDiff'));

type DiffState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; diff: GitDiffResult };

const omittedLabel = (omitted: GitDiffResult['omitted']): string =>
    omitted === 'binary' ? 'A binary file has no diff to read.' : 'This diff is too large to draw here.';

/*
 * A changed file as its diff, in a tab of the preview panel next to the tab that holds the file
 * itself. The scope switch is the same one the git panel remembers, so flipping it here is what the
 * next diff opens in as well.
 */
export function DiffFile({ tabKey, path, name, view }: { tabKey: string; path: string; name: string; view: FileTabView }) {
    const layout = useSettings((s) => s.diffLayout);
    const whitespace = useSettings((s) => s.diffWhitespace);
    const [wrap, setWrap] = useState(true);
    const [nonce, setNonce] = useState(0);
    const relative = useMemo(() => relativeTo(view.cwd, path), [view.cwd, path]);
    /* Which diff was asked for, so an answer to the question before this one is not drawn and a
       switch of scope reads as loading without an effect that has to empty the state first. */
    const asked = `${view.cwd}\u0000${relative}\u0000${view.scope}\u0000${String(view.staged)}\u0000${String(whitespace)}\u0000${nonce}`;
    const [held, setHeld] = useState<{ asked: string; state: DiffState } | null>(null);
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
                    setHeld({ asked, state: { status: 'error', message: error instanceof Error ? error.message : 'The diff could not be read.' } });
                }
            });
        return () => {
            alive = false;
        };
    }, [asked, relative, tabKey, view.cwd, view.scope, view.staged, whitespace]);

    const refresh = useCallback(() => setNonce((count) => count + 1), []);
    const actions = useMemo(() => ({ key: tabKey, path, name, refresh }), [tabKey, path, name, refresh]);

    const setScope = (scope: GitDiffScope): void => {
        useGit.getState().setScope(scope);
        useFiles.getState().setScope(tabKey, scope);
    };

    return (
        <FileActionsContext.Provider value={actions}>
            <div className="flex min-h-0 min-w-0 grow flex-col">
                <FileToolbar>
                    <span className="btn-group">
                        <FileToolbarToggle
                            icon={FileDiff}
                            label="Against the working tree"
                            active={view.scope === 'worktree'}
                            onClick={() => setScope('worktree')}
                        />
                        <FileToolbarToggle icon={GitBranch} label="Against the base branch" active={view.scope === 'base'} onClick={() => setScope('base')} />
                    </span>
                    <Separator />
                    <span className="btn-group">
                        <FileToolbarToggle
                            icon={Rows2}
                            label="One patch, stacked"
                            active={layout === 'stacked'}
                            onClick={() => useSettings.getState().update({ diffLayout: 'stacked' })}
                        />
                        <FileToolbarToggle
                            icon={Columns2}
                            label="Old and new side by side"
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
                <EmptyState icon={<Icon icon={LoaderCircle} size={20} className="animate-spin" />}>Reading the diff of {relative}.</EmptyState>
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
