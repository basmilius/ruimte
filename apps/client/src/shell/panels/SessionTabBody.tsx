import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Columns2, Rows2 } from 'lucide-react';
import type { GitBlobResult, GitComparePage, GitCompareResult, GitDiffFile } from '@ruimte/contracts';
import type { Editor } from '@adecore/editor';
import type { DiffSource } from '@adecore/editor-react';
import { EditorView } from '@adecore/editor-react';
import { Button, EmptyState, ErrorBoundary, LazyBoundary, Menu, Select, lazyNamed, messageOf } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { perform } from '@/actions/client-actions';
import { useEndpointId } from '@/state/keys';
import { useEndpointConnection } from '@/transport/status';
import { machineAnswers } from '@/transport/features';
import { useDocument } from '@/state/document';
import { useSettings } from '@/state/settings';
import { useCodeTheme } from '@/state/code-theme';
import { type CompareTab, type SessionTab, type SnapshotTab, useFiles } from '@/state/files';
import { CommitFileTree } from './CommitFileTree';
import { TreeSplit, COMMIT_TREE_MIN_WIDTH } from './TreeSplit';
import { pickedFile } from './commit-tree';
import { openSnapshot, refLabel, showBranchCompare } from './branch-compare';
import { useDiffCaret } from './diff-caret';
import { FileToolbarToggle } from './FileToolbar';
import { loadEditorEngine, loadedEditorEngine } from './editor-engine';
import { useGit } from '@/state/git';

const UnifiedDiff = lazyNamed(() => import('@adecore/agents-react/chat/ui'), 'UnifiedDiff');

function Failure({ message, retry }: { message: string; retry(): void }) {
    const { t } = useTranslation('common');
    return (
        <EmptyState
            action={
                <Button size="sm" onClick={retry}>
                    {t('action.retry')}
                </Button>
            }
        >
            {message}
        </EmptyState>
    );
}

function CommitSide({ comparison, side, initial }: { comparison: GitCompareResult; side: 'left' | 'right'; initial: GitComparePage }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const canPage = machineAnswers(connection, 'git.compareCommits');
    const [page, setPage] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    const more = async (): Promise<void> => {
        if (busy || !canPage || page.next === null) {
            return;
        }
        setBusy(true);
        try {
            const next = await perform('git.compareCommits', {
                repository: comparison.cwd,
                fromCommit: comparison.fromCommit,
                toCommit: comparison.toCommit,
                side,
                skip: page.next,
                pageSize: 30
            });
            if (alive.current) {
                setPage({ commits: [...page.commits, ...next.commits], next: next.next });
                setError(null);
            }
        } catch (failure) {
            if (alive.current) {
                setError(messageOf(failure));
            }
        } finally {
            if (alive.current) {
                setBusy(false);
            }
        }
    };
    return (
        <section className="border-b border-border p-3">
            <h3 className="mb-2 text-xs font-semibold">{t('git.compare.unique', { branch: refLabel(side === 'left' ? comparison.from : comparison.to) })}</h3>
            {page.commits.length === 0 && <p className="text-xs text-text-muted">{t('git.compare.noCommits')}</p>}
            {page.commits.map((commit) => (
                <div key={commit.hash} className="mb-2 min-w-0 text-xs">
                    <p className="truncate text-text">{commit.subject}</p>
                    <p className="truncate text-text-faint">
                        {commit.shortHash} · {commit.author}
                    </p>
                </div>
            ))}
            {error !== null && <p className="text-xs text-status-error">{error}</p>}
            {page.next !== null && !canPage && <p className="text-xs text-text-muted">{t('git.compare.update')}</p>}
            {page.next !== null && (
                <Button size="xs" disabled={busy || !canPage} onClick={() => void more()}>
                    {t('git.compare.moreCommits')}
                </Button>
            )}
        </section>
    );
}

function SnapshotActions({ comparison, file, menu = false }: { comparison: GitCompareResult; file: GitDiffFile; menu?: boolean }) {
    const { t } = useTranslation('panels');
    const open = (side: 'left' | 'right') =>
        openSnapshot(
            comparison.cwd,
            side === 'left' ? comparison.fromCommit : comparison.toCommit,
            side === 'left' ? comparison.from : comparison.to,
            file.path
        );
    const left = t('git.compare.openSide', { branch: refLabel(comparison.from) });
    const right = t('git.compare.openSide', { branch: refLabel(comparison.to) });
    return menu ? (
        <>
            <Menu.Item onClick={() => open('left')}>{left}</Menu.Item>
            <Menu.Item onClick={() => open('right')}>{right}</Menu.Item>
        </>
    ) : (
        <>
            <Button size="xs" onClick={() => open('left')}>
                {left}
            </Button>
            <Button size="xs" onClick={() => open('right')}>
                {right}
            </Button>
        </>
    );
}

function ComparedFile({ comparison, file, tabKey }: { comparison: GitCompareResult; file: GitDiffFile | null; tabKey: string }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const layout = useSettings((state) => state.diffLayout);
    const wrap = useSettings((state) => state.codeWrap);
    const [contents, setContents] = useState<{ key: string; old: string; new: string } | null>(null);
    const key = `${comparison.baseCommit}\0${comparison.toCommit}\0${file?.path ?? ''}`;
    useEffect(() => {
        if (file === null || !machineAnswers(connection, 'git.blob')) {
            return;
        }
        let alive = true;
        void Promise.all(
            [comparison.baseCommit, comparison.toCommit].map((commit) =>
                perform('git.blob', {
                    repository: comparison.cwd,
                    commit,
                    path: file.path
                })
            )
        )
            .then(([old, fresh]) => {
                const text = (blob: GitBlobResult | undefined): string | undefined => (blob?.omitted === 'missing' ? '' : blob?.text);
                const before = text(old);
                const after = text(fresh);
                if (alive && before !== undefined && after !== undefined) {
                    setContents({ key, old: before, new: after });
                }
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [connection, comparison.cwd, comparison.baseCommit, comparison.toCommit, file, key]);
    const reveal = (source: DiffSource): boolean => {
        const at = source.at();
        if (file === null || source.side === 'old' || at === null) {
            return false;
        }
        openSnapshot(comparison.cwd, comparison.toCommit, comparison.to, file.path, at.line);
        return true;
    };
    const { surface, onSource } = useDiffCaret('', tabKey, reveal);
    if (file === null) {
        return <EmptyState>{t('git.compare.noFiles')}</EmptyState>;
    }
    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
                <span className="min-w-0 grow truncate text-xs text-text-muted">{file.path}</span>
                <SnapshotActions comparison={comparison} file={file} />
            </div>
            {file.omitted !== undefined ? (
                <EmptyState>{t(`diff.omitted.${file.omitted === 'binary' ? 'binary' : 'tooLarge'}`)}</EmptyState>
            ) : (
                <div ref={surface} className="file-diff flex min-h-0 grow flex-col overflow-auto">
                    <LazyBoundary>
                        <UnifiedDiff
                            key={file.path}
                            change={{ path: file.path, kind: file.kind ?? 'update', diff: file.diff }}
                            contents={contents?.key === key ? { old: contents.old, new: contents.new } : undefined}
                            overflow={wrap ? 'wrap' : 'scroll'}
                            diffStyle={layout === 'split' ? 'split' : 'unified'}
                            fill
                            onSource={onSource}
                        />
                    </LazyBoundary>
                </div>
            )}
        </div>
    );
}

function ComparisonView({ tab }: { tab: CompareTab }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const [refresh, setRefresh] = useState(0);
    const [held, setHeld] = useState<{ key: string; value?: GitCompareResult; error?: string } | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [section, setSection] = useState<'files' | 'commits'>('files');
    const layout = useSettings((state) => state.diffLayout);
    const width = useGit((state) => state.commitTreeWidth);
    const key = JSON.stringify([endpointId, tab.cwd, tab.from, tab.to, tab.mode, refresh]);
    useEffect(() => {
        let alive = true;
        void perform('git.compare', { repository: tab.cwd, from: tab.from, to: tab.to, mode: tab.mode }).then(
            (value) => {
                if (alive) {
                    setHeld({ key, value });
                    useGit.getState().setCounts(tab.key, { added: value.diff.added, deleted: value.diff.deleted });
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
    }, [key, tab.cwd, tab.from, tab.to, tab.mode, tab.key]);
    const ready = held?.key === key ? held.value : undefined;
    const files = ready?.diff.files ?? [];
    const shown = pickedFile(files, selected ?? undefined);
    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <span className="min-w-0 grow truncate font-mono text-xs">
                    {refLabel(tab.from)} → {refLabel(tab.to)}
                </span>
                <Select
                    label={t('git.compare.mode')}
                    value={tab.mode}
                    size="sm"
                    items={[
                        { value: 'merge-base', label: t('git.compare.mergeBase') },
                        { value: 'tips', label: t('git.compare.tips') }
                    ]}
                    onValueChange={(value) => useFiles.getState().setCompareMode(tab.key, value as CompareTab['mode'])}
                />
                <Button size="xs" onClick={() => setRefresh((value) => value + 1)}>
                    {t('diff.readAgain')}
                </Button>
                <Button size="xs" onClick={() => showBranchCompare(tab.cwd, tab.to, tab.from)}>
                    {t('git.compare.choose')}
                </Button>
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
            </div>
            {held?.key === key && held.error !== undefined ? (
                <Failure message={held.error} retry={() => setRefresh((value) => value + 1)} />
            ) : ready === undefined ? (
                <EmptyState busy>{t('git.compare.reading')}</EmptyState>
            ) : (
                <ErrorBoundary label={t('git.compare.failed')} resetKeys={[key]} className="flex min-h-0 grow flex-col">
                    <p className="shrink-0 border-b border-border px-3 py-2 text-xs text-text-muted">
                        {t(tab.mode === 'merge-base' ? 'git.compare.ancestor' : 'git.compare.tipSummary', {
                            left: ready.fromCommit.slice(0, 7),
                            right: ready.toCommit.slice(0, 7),
                            base: ready.baseCommit.slice(0, 7)
                        })}
                    </p>
                    <TreeSplit
                        width={width}
                        minWidth={COMMIT_TREE_MIN_WIDTH}
                        onWidth={(value) => useGit.getState().setCommitTreeWidth(value)}
                        stackedHeight="h-60"
                        side={
                            <div className="flex min-h-0 grow flex-col">
                                <div className="flex shrink-0 gap-1 border-b border-border p-2">
                                    <Button size="xs" onClick={() => setSection('files')}>
                                        {t('git.compare.files', { total: formatNumber(files.length) })}
                                    </Button>
                                    <Button size="xs" onClick={() => setSection('commits')}>
                                        {t('git.compare.commits')}
                                    </Button>
                                </div>
                                <div className={section === 'files' ? 'flex min-h-0 grow flex-col overflow-hidden' : 'hidden'}>
                                    <CommitFileTree
                                        files={files}
                                        shown={shown?.path ?? null}
                                        onPick={setSelected}
                                        menu={(file) => <SnapshotActions comparison={ready} file={file} menu />}
                                    />
                                    {files.length === 0 && <p className="p-3 text-xs text-text-muted">{t('git.compare.noFiles')}</p>}
                                    {ready.diff.truncated === true && <p className="p-3 text-xs text-text-muted">{t('diff.moreFiles')}</p>}
                                </div>
                                <div key={`${ready.fromCommit}:${ready.toCommit}`} className={section === 'commits' ? 'min-h-0 grow overflow-auto' : 'hidden'}>
                                    <CommitSide comparison={ready} side="left" initial={ready.left} />
                                    <CommitSide comparison={ready} side="right" initial={ready.right} />
                                </div>
                            </div>
                        }
                    >
                        <ComparedFile key={`${ready.baseCommit}:${ready.toCommit}`} comparison={ready} file={shown} tabKey={tab.key} />
                    </TreeSplit>
                </ErrorBoundary>
            )}
        </div>
    );
}

function SnapshotView({ tab }: { tab: SnapshotTab }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const [retry, setRetry] = useState(0);
    const [held, setHeld] = useState<{ key: string; blob?: GitBlobResult; error?: string } | null>(null);
    const [engine, setEngine] = useState(loadedEditorEngine);
    const [editor, setEditor] = useState<Editor | null>(null);
    const active = useDocument((state) => state.activeViewId === tab.key);
    const [engineError, setEngineError] = useState<string | null>(null);
    const theme = useCodeTheme();
    const wrap = useSettings((state) => state.codeWrap);
    const key = JSON.stringify([endpointId, tab.cwd, tab.commit, tab.path, retry]);
    useEffect(() => {
        let alive = true;
        void perform('git.blob', { repository: tab.cwd, commit: tab.commit, path: tab.path }).then(
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
    useEffect(() => {
        if (engine !== null) {
            return;
        }
        let alive = true;
        void loadEditorEngine().then(
            (value) => {
                if (alive) {
                    setEngine(value);
                    setEngineError(null);
                }
            },
            (error: unknown) => {
                if (alive) {
                    setEngineError(messageOf(error));
                }
            }
        );
        return () => {
            alive = false;
        };
    }, [engine, retry]);
    useEffect(() => {
        if (active && editor !== null) {
            editor.revealLine(tab.line ?? 1);
            editor.focus();
        }
    }, [active, editor, tab.line]);
    const current = held?.key === key ? held : null;
    const blob = current?.blob;
    const error = current?.error ?? engineError;
    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
                <p className="truncate font-mono">
                    {tab.path} · {refLabel(tab.branch)} · {tab.commit.slice(0, 7)}
                </p>
                <p className="mt-1 text-text-muted">{t(blob?.symlink ? 'git.compare.symlink' : 'git.compare.readonly')}</p>
            </div>
            {error !== null && error !== undefined ? (
                <Failure message={error} retry={() => setRetry((value) => value + 1)} />
            ) : blob === undefined || engine === null ? (
                <EmptyState busy>{t('git.compare.reading')}</EmptyState>
            ) : blob.text === undefined ? (
                <EmptyState>{t(`git.compare.blob.${blob.omitted ?? 'missing'}`)}</EmptyState>
            ) : (
                <div className="relative min-h-0 grow">
                    <EditorView
                        engine={engine}
                        options={{
                            text: blob.text,
                            theme,
                            language: blob.text.length > 100_000 ? undefined : blob.language,
                            readOnly: true,
                            readOnlyReason: t('git.compare.readonly'),
                            label: tab.path,
                            wrap
                        }}
                        onMount={setEditor}
                    />
                </div>
            )}
        </div>
    );
}

export function SessionTabBody({ tab }: { tab: SessionTab }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    if (connection.status !== 'open') {
        return <EmptyState>{t('git.compare.offline')}</EmptyState>;
    }
    if (!machineAnswers(connection, tab.kind === 'compare' ? 'git.compare' : 'git.blob')) {
        return <EmptyState>{t('git.compare.update')}</EmptyState>;
    }
    return tab.kind === 'compare' ? <ComparisonView tab={tab} /> : <SnapshotView tab={tab} />;
}
