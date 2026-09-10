import { useMemo } from 'react';
import clsx from 'clsx';
import { ChevronRight, GitBranch, Minus, Plus, Trash2 } from 'lucide-react';
import type { GitFile, GitFileState, GitStatus } from '@ruimte/contracts';
import { GIT_GROUP, GIT_ROW, GIT_ROW_ACTIONS, GIT_ROW_OPEN } from '@/shell/panels/classes';
import { basenameOf } from '@/shell/panels/files-tree';
import { buildGitRows, type GitTreeRow } from '@/shell/panels/git-tree';
import { useGit } from '@/state/git';
import { BTN_GROUP, SECTION_LABEL } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const GROUPS: ReadonlyArray<{ state: GitFileState; label: string }> = [
    { state: 'conflicted', label: 'Conflicted' },
    { state: 'staged', label: 'Staged' },
    { state: 'unstaged', label: 'Changes' },
    { state: 'untracked', label: 'Untracked' }
];

// Every level of the tree is this much further in; the row's own padding is on top of it.
const INDENT = 12;

const dirnameOf = (path: string): string => {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? '' : path.slice(0, cut);
};

/* The paths of a whole group, for the button in its header. */
const pathsOf = (files: readonly GitFile[], state: GitFileState): string[] => files.filter((file) => file.state === state).map((file) => file.path);

interface ListProps {
    status: GitStatus | null;
    /* Whether every group is a tree of the folders its files sit in, the `gitTree` setting. */
    tree: boolean;
    collapsed: string[];
    /* The path of the change the preview has open, which is the row that reads as selected. */
    reading: string | null;
    busy: boolean;
    onOpen(file: GitFile): void;
    onStage(paths: string[], staged: boolean): void;
    onDiscard(file: GitFile): void;
}

/*
 * The changed files, grouped the way a person acts on them: conflicts first, then the index, then
 * the working tree, then what git has never seen. A row opens its diff in the preview panel; the
 * buttons on it move the file in and out of the index and, behind a confirm, throw its changes into
 * a stash of their own.
 */
export function GitFileList({ status, tree, collapsed, reading, busy, onOpen, onStage, onDiscard }: ListProps) {
    const folded = useMemo(() => new Set(collapsed), [collapsed]);

    if (status === null) {
        return <div className="grid grow place-items-center" />;
    }
    if (!status.repo) {
        return (
            <div className="grid grow place-items-center">
                <EmptyState icon={<Icon icon={GitBranch} size={20} />}>This folder is not a git repository, so there is nothing to compare.</EmptyState>
            </div>
        );
    }
    if (status.files.length === 0) {
        return (
            <div className="grid grow place-items-center">
                <EmptyState icon={<Icon icon={GitBranch} size={20} />}>Nothing changed here. Every file is what the last commit holds.</EmptyState>
            </div>
        );
    }
    return (
        <div className="min-h-0 grow overflow-y-auto py-1">
            {GROUPS.map((group) => {
                const files = status.files.filter((file) => file.state === group.state);
                if (files.length === 0) {
                    return null;
                }
                const staged = group.state === 'staged';
                const rows: GitTreeRow[] = tree ? buildGitRows(files, folded) : files.map((file) => ({ kind: 'file', file, depth: 0 }));
                return (
                    <section key={group.state}>
                        <header className={GIT_GROUP}>
                            <span className={SECTION_LABEL}>{group.label}</span>
                            <span className="tabular-nums text-text-faint">{files.length}</span>
                            <span className="grow" />
                            {group.state !== 'conflicted' && (
                                <Tooltip label={staged ? `Unstage everything in ${group.label}` : `Stage everything in ${group.label}`} name>
                                    <button className="icon-btn h-6 w-6" disabled={busy} onClick={() => onStage(pathsOf(status.files, group.state), !staged)}>
                                        <Icon icon={staged ? Minus : Plus} size={12} />
                                    </button>
                                </Tooltip>
                            )}
                        </header>
                        {rows.map((row) =>
                            row.kind === 'directory' ? (
                                <GitDirectoryRow key={`${group.state}:${row.path}/`} row={row} collapsed={folded.has(row.path)} />
                            ) : (
                                <GitFileRow
                                    key={`${group.state}:${row.file.path}`}
                                    file={row.file}
                                    depth={row.depth}
                                    showPath={!tree}
                                    selected={row.file.path === reading}
                                    busy={busy}
                                    onOpen={() => onOpen(row.file)}
                                    onStage={() => onStage([row.file.path], !staged)}
                                    onDiscard={() => onDiscard(row.file)}
                                />
                            )
                        )}
                    </section>
                );
            })}
            {status.truncated && <p className="px-3 py-2 text-xs text-text-faint">More files changed than this list holds.</p>}
        </div>
    );
}

function GitDirectoryRow({ row, collapsed }: { row: Extract<GitTreeRow, { kind: 'directory' }>; collapsed: boolean }) {
    return (
        <div className={GIT_ROW}>
            <button
                className={GIT_ROW_OPEN}
                aria-expanded={!collapsed}
                style={{ paddingLeft: 12 + row.depth * INDENT }}
                onClick={() => useGit.getState().toggleDir(row.path)}
            >
                <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', !collapsed && 'rotate-90')} />
                <span className="truncate text-text">{row.label}</span>
                <span className="tabular-nums text-text-faint">{row.count}</span>
                <span className="grow" />
            </button>
            {/* The columns of a file row end here too, so a directory never shifts them. */}
            <span className={`${GIT_ROW_ACTIONS} ${BTN_GROUP}`} />
        </div>
    );
}

function GitFileRow({
    file,
    depth,
    showPath,
    selected,
    busy,
    onOpen,
    onStage,
    onDiscard
}: {
    file: GitFile;
    /* The flat list carries the folder next to the name; in a tree the row above says it. */
    showPath: boolean;
    depth: number;
    /* Whether the preview is showing this file's diff right now. */
    selected: boolean;
    busy: boolean;
    onOpen(): void;
    onStage(): void;
    onDiscard(): void;
}) {
    const dir = dirnameOf(file.path);
    const staged = file.state === 'staged';
    const conflicted = file.state === 'conflicted';
    return (
        <div className={GIT_ROW} data-selected={selected || undefined}>
            <button className={GIT_ROW_OPEN} aria-current={selected} style={{ paddingLeft: 12 + depth * INDENT }} onClick={onOpen}>
                <FileIcon path={file.path} size={14} />
                <span className="truncate text-text">{basenameOf(file.path)}</span>
                {showPath && dir !== '' && <span className="truncate text-text-faint">{dir}</span>}
                <span className="grow" />
                <span className="w-4 shrink-0 text-right font-mono text-text-faint">{file.status}</span>
                <span className="w-8 shrink-0 text-right tabular-nums text-term-green">{file.added > 0 ? `+${file.added}` : ''}</span>
                <span className="w-8 shrink-0 text-right tabular-nums text-term-red">{file.deleted > 0 ? `-${file.deleted}` : ''}</span>
            </button>
            <span className={`${GIT_ROW_ACTIONS} ${BTN_GROUP}`}>
                <Tooltip label={staged ? 'Unstage' : conflicted ? 'Stage as resolved' : 'Stage'} name>
                    <button className="icon-btn h-6 w-6" disabled={busy} onClick={onStage}>
                        <Icon icon={staged ? Minus : Plus} size={12} />
                    </button>
                </Tooltip>
                {/* A conflict is resolved by staging it or by a merge tool; discarding one side of it
                    silently is the one way out that loses work nobody can name afterwards. */}
                {!conflicted && (
                    <Tooltip label="Discard" name>
                        <button className="icon-btn h-6 w-6" disabled={busy} onClick={onDiscard}>
                            <Icon icon={Trash2} size={12} />
                        </button>
                    </Tooltip>
                )}
            </span>
        </div>
    );
}
