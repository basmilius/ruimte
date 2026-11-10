import { Button, ButtonGroup, EmptyState, ErrorBoundary, LazyBoundary, Menu, ScrollArea, Segmented, Select, lazyNamed, messageOf } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { GitBlobResult, GitComparePage, GitCompareMode, GitCompareResult, GitDiffFile } from '@ruimte/contracts';
import { Columns2, FileWarning, RefreshCw, Rows2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { openSnapshot, showBranchCompare } from '@/files/branch-compare';
import { pickedFile } from '@/files/commit-tree';
import { CommitFileTree } from '@/files/CommitFileTree';
import { FileToolbarToggle } from '@/files/FileToolbar';
import { COMMIT_TREE_MIN_WIDTH, TreeSplit } from '@/files/TreeSplit';
import { useEndpointId } from '@/state/current-endpoint';
import { compareTabOf, useFiles, type CompareTab } from '@/state/files';
import { useGit } from '@/state/git';
import { useSettings } from '@/state/settings';
import { FILE_TOOLBAR } from '@/surface/panels/classes';
import { refLabel } from '@/worktree-rules/ref-label';

const UnifiedDiff = lazyNamed(() => import('@adecore/agents-react/chat/ui'), 'UnifiedDiff');

const COMMIT_PAGE_SIZE = 30;

type Reading = { key: string; result: GitCompareResult } | { key: string; error: string };

/* The text of a side of a file, empty where the file does not exist there, or undefined where it cannot be unfolded. */
function textOf(blob: GitBlobResult): string | undefined {
    return blob.omitted === 'missing' ? '' : blob.text;
}

/*
 * Two refs of one repository: the files that differ in a tree beside their diff, and the commits only each
 * side has. Every read after the first one names the commits the refs resolved to, so the tab shows one
 * snapshot until Read again resolves the refs anew.
 */
export function CompareBody({ tab }: { tab: CompareTab }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const layout = useSettings((state) => state.diffLayout);
    const treeWidth = useGit((state) => state.commitTreeWidth);
    const [retries, setRetries] = useState(0);
    const [held, setHeld] = useState<Reading | null>(null);
    const [picked, setPicked] = useState<string | undefined>(undefined);
    const [section, setSection] = useState<'files' | 'commits'>('files');
    const key = JSON.stringify([endpointId, tab.cwd, tab.from, tab.to, tab.mode, tab.refresh, retries]);

    useEffect(() => {
        let alive = true;
        // Read from the store and not from the tab, so pinning the commits does not read again.
        const pinned = compareTabOf(useFiles.getState(), tab.key)?.resolved;

        perform('git.compare', {
            repository: tab.cwd,
            from: pinned?.fromCommit ?? tab.from,
            to: pinned?.toCommit ?? tab.to,
            mode: tab.mode
        }).then(
            (result) => {
                if (alive) {
                    useFiles.getState().resolveComparison(tab.key, tab.refresh, { fromCommit: result.fromCommit, toCommit: result.toCommit });
                    setHeld({ key, result: { ...result, from: tab.from, to: tab.to } });
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
    }, [key, tab.key, tab.cwd, tab.from, tab.to, tab.mode, tab.refresh]);

    const reading = held?.key === key ? held : null;
    const result = reading !== null && 'result' in reading ? reading.result : null;
    const files = result?.diff.files ?? [];
    const shown = pickedFile(files, picked);

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className={FILE_TOOLBAR}>
                <span className="min-w-0 grow truncate font-mono text-xs text-text-muted">
                    {refLabel(tab.from)} → {refLabel(tab.to)}
                </span>
                <Select
                    label={t('git.compare.mode')}
                    size="sm"
                    value={tab.mode}
                    items={[
                        { value: 'merge-base', label: t('git.compare.mergeBase') },
                        { value: 'tips', label: t('git.compare.tips') }
                    ]}
                    onValueChange={(mode: GitCompareMode) => useFiles.getState().setCompareMode(tab.key, mode)}
                />
                <FileToolbarToggle
                    icon={RefreshCw}
                    label={t('git.compare.refresh')}
                    active={false}
                    onClick={() => useFiles.getState().refreshComparison(tab.key)}
                />
                <Button size="sm" onClick={() => showBranchCompare({ cwd: tab.cwd, from: tab.from, to: tab.to, mode: tab.mode })}>
                    {t('git.compare.choose')}
                </Button>
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
            {reading === null && (
                <EmptyState busy className="grow">
                    {t('git.compare.reading')}
                </EmptyState>
            )}
            {reading !== null && 'error' in reading && (
                <EmptyState
                    icon={FileWarning}
                    className="grow"
                    action={
                        <Button size="sm" onClick={() => setRetries((count) => count + 1)}>
                            {t('common:action.retry')}
                        </Button>
                    }
                >
                    {reading.error}
                </EmptyState>
            )}
            {result !== null && (
                <ErrorBoundary label={t('git.compare.failed')} resetKeys={[key]} className="min-h-0 grow">
                    <p className="shrink-0 border-b border-border px-3 py-2 text-xs text-text-muted">
                        {t(tab.mode === 'merge-base' ? 'git.compare.summaryMergeBase' : 'git.compare.summaryTips', {
                            from: refLabel(tab.from),
                            to: refLabel(tab.to),
                            fromCommit: result.fromCommit.slice(0, 7),
                            toCommit: result.toCommit.slice(0, 7),
                            base: result.baseCommit.slice(0, 7)
                        })}
                    </p>
                    <TreeSplit
                        width={treeWidth}
                        minWidth={COMMIT_TREE_MIN_WIDTH}
                        onWidth={(width) => useGit.getState().setCommitTreeWidth(width)}
                        stackedHeight="h-60"
                        side={
                            <div className="flex min-h-0 grow flex-col">
                                <div className="shrink-0 border-b border-border p-2">
                                    <Segmented
                                        label={t('git.compare.section')}
                                        size="sm"
                                        value={section}
                                        onValueChange={setSection}
                                        options={[
                                            { id: 'files', label: t('git.compare.files', { total: formatNumber(files.length) }) },
                                            { id: 'commits', label: t('git.compare.commits') }
                                        ]}
                                    />
                                </div>
                                {section === 'files' ? (
                                    <div className="flex min-h-0 grow flex-col overflow-hidden py-1">
                                        {files.length > 0 && (
                                            <CommitFileTree
                                                files={files}
                                                shown={shown?.path ?? null}
                                                onPick={setPicked}
                                                menu={(file) => <OpenMenuItems result={result} cwd={tab.cwd} file={file} />}
                                            />
                                        )}
                                        {files.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">{t('git.compare.noFiles')}</p>}
                                        {result.diff.truncated === true && <p className="shrink-0 px-3 py-2 text-xs text-text-faint">{t('diff.moreFiles')}</p>}
                                    </div>
                                ) : (
                                    <ScrollArea className="min-h-0 grow">
                                        <CommitSide key={`left:${result.fromCommit}:${result.toCommit}`} result={result} cwd={tab.cwd} side="left" />
                                        <CommitSide key={`right:${result.fromCommit}:${result.toCommit}`} result={result} cwd={tab.cwd} side="right" />
                                    </ScrollArea>
                                )}
                            </div>
                        }
                    >
                        <ComparedFile key={`${result.baseCommit}:${result.toCommit}:${shown?.path ?? ''}`} result={result} cwd={tab.cwd} file={shown} />
                    </TreeSplit>
                </ErrorBoundary>
            )}
        </div>
    );
}

function CommitSide({ result, cwd, side }: { result: GitCompareResult; cwd: string; side: 'left' | 'right' }) {
    const { t } = useTranslation('panels');
    const [page, setPage] = useState<GitComparePage>(side === 'left' ? result.left : result.right);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const branch = refLabel(side === 'left' ? result.from : result.to);

    const more = async (): Promise<void> => {
        if (page.next === null) {
            return;
        }

        setBusy(true);

        try {
            const next = await perform('git.compareCommits', {
                repository: cwd,
                fromCommit: result.fromCommit,
                toCommit: result.toCommit,
                side,
                skip: page.next,
                pageSize: COMMIT_PAGE_SIZE
            });

            setPage({ commits: [...page.commits, ...next.commits], next: next.next });
            setError(null);
        } catch (failure) {
            setError(messageOf(failure));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="border-b border-border p-3">
            <h3 className="mb-2 text-xs font-medium text-text">{t('git.compare.onlyOn', { branch })}</h3>
            {page.commits.length === 0 && <p className="text-xs text-text-faint">{t('git.compare.noCommits')}</p>}
            {page.commits.map((commit) => (
                <div key={commit.hash} className="mb-2 min-w-0 text-xs">
                    <p className="truncate text-text">{commit.subject}</p>
                    <p className="truncate text-text-faint">
                        {commit.shortHash} · {commit.author}
                    </p>
                </div>
            ))}
            {error !== null && <p className="text-xs text-status-error">{error}</p>}
            {page.next !== null && (
                <Button size="xs" disabled={busy} onClick={() => void more()}>
                    {t('git.compare.moreCommits')}
                </Button>
            )}
        </section>
    );
}

/* Where a file can be opened as it is on each side: both tips, and the common ancestor the diff starts from when it is not the left tip. */
function sidesOf(result: GitCompareResult, ancestorName: string): Array<{ commit: string; name: string }> {
    return [
        { commit: result.fromCommit, name: refLabel(result.from) },
        ...(result.baseCommit === result.fromCommit ? [] : [{ commit: result.baseCommit, name: ancestorName }]),
        { commit: result.toCommit, name: refLabel(result.to) }
    ];
}

function OpenMenuItems({ result, cwd, file }: { result: GitCompareResult; cwd: string; file: GitDiffFile }) {
    const { t } = useTranslation('panels');

    return (
        <>
            {sidesOf(result, t('git.compare.ancestorName')).map((side) => (
                <Menu.Item key={side.commit} onClick={() => openSnapshot(cwd, side.commit, side.name, file.path)}>
                    {t('git.compare.openOn', { branch: side.name })}
                </Menu.Item>
            ))}
        </>
    );
}

/* The diff of the picked file, unfoldable once both sides have been read from the pinned commits. */
function ComparedFile({ result, cwd, file }: { result: GitCompareResult; cwd: string; file: GitDiffFile | null }) {
    const { t } = useTranslation('panels');
    const layout = useSettings((state) => state.diffLayout);
    const wrap = useSettings((state) => state.codeWrap);
    const [contents, setContents] = useState<{ old: string; new: string } | null>(null);
    const path = file?.path;
    const readable = file !== null && file.omitted === undefined;

    useEffect(() => {
        if (!readable || path === undefined) {
            return;
        }

        let alive = true;

        Promise.all([result.baseCommit, result.toCommit].map((commit) => perform('git.blob', { repository: cwd, commit, path }))).then(
            ([before, after]) => {
                const old = textOf(before!);
                const fresh = textOf(after!);

                if (alive && old !== undefined && fresh !== undefined) {
                    setContents({ old, new: fresh });
                }
            },
            () => undefined
        );

        return () => {
            alive = false;
        };
    }, [readable, path, cwd, result.baseCommit, result.toCommit]);

    if (file === null) {
        return null;
    }

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
                <span className="min-w-0 grow truncate font-mono text-xs text-text-muted">{file.path}</span>
                {sidesOf(result, t('git.compare.ancestorName')).map((side) => (
                    <Button key={side.commit} size="xs" onClick={() => openSnapshot(cwd, side.commit, side.name, file.path)}>
                        {t('git.compare.openOn', { branch: side.name })}
                    </Button>
                ))}
            </div>
            {file.omitted !== undefined || file.diff === '' ? (
                <div className="file-diff grid min-h-0 min-w-0 grow place-items-center">
                    <EmptyState icon={FileWarning}>
                        {file.omitted === undefined
                            ? t('diff.noChange', { path: file.path })
                            : file.omitted === 'binary'
                              ? t('diff.omitted.binary')
                              : t('diff.omitted.tooLarge')}
                    </EmptyState>
                </div>
            ) : (
                <ScrollArea axis="both" className="grow" viewportClassName="file-diff flex flex-col">
                    <LazyBoundary fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('diff.loading')}</div>}>
                        <UnifiedDiff
                            change={{ path: file.path, kind: file.kind ?? 'update', diff: file.diff }}
                            overflow={wrap ? 'wrap' : 'scroll'}
                            diffStyle={layout === 'split' ? 'split' : 'unified'}
                            fill
                            {...(contents === null ? {} : { contents })}
                        />
                    </LazyBoundary>
                </ScrollArea>
            )}
        </div>
    );
}
