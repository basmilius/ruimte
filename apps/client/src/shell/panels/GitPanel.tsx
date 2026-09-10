import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Folder, GitBranch, Minus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { GitFile, GitFileState, GitStatus, Worktree } from '@ruimte/contracts';
import { basenameOf } from '@/shell/panels/files-tree';
import { activeDiffPath, buildGitRows, type GitTreeRow } from '@/shell/panels/git-tree';
import { useCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import { gitTarget, gitTargets, type GitTarget } from '@/state/git-target';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { transport } from '@/transport';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// How long the line about the stash a discard wrote stays up.
const NOTICE_MS = 10000;

const GROUPS: ReadonlyArray<{ state: GitFileState; label: string }> = [
    { state: 'conflicted', label: 'Conflicted' },
    { state: 'staged', label: 'Staged' },
    { state: 'unstaged', label: 'Changes' },
    { state: 'untracked', label: 'Untracked' }
];

const dirnameOf = (path: string): string => {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? '' : path.slice(0, cut);
};

/* One row's own path, plus the paths of a whole group for the button in its header. */
const pathsOf = (files: readonly GitFile[], state: GitFileState): string[] => files.filter((file) => file.state === state).map((file) => file.path);

/*
 * What the daemon knows about the checkout the panel is on, grouped the way a person acts on it:
 * conflicts first, then the index, then the working tree, then what git has never seen. A row opens
 * its diff in the preview panel; the buttons on it move the file in and out of the index and, behind
 * a confirm, throw its changes into a stash of their own.
 */
export function GitPanel() {
    const nodes = useCanvas((s) => s.nodes);
    const selection = useCanvas((s) => s.selection);
    const folder = useProject((s) => s.current?.folder ?? null);
    const scope = useGit((s) => s.scope);
    const tree = useSettings((s) => s.gitTree);
    const collapsedDirs = useGit((s) => s.collapsedDirs);
    const tabLimit = useSettings((s) => s.filesTabLimit);
    const derived = useMemo(() => gitTarget(nodes, selection, folder), [nodes, selection, folder]);
    /* A checkout picked by hand outranks the selection, until the selection points somewhere else
       of its own: `from` is the target it was picked over, so a click on the canvas takes over again. */
    const [picked, setPicked] = useState<{ target: GitTarget; from: string | null } | null>(null);
    const target = picked !== null && picked.from === derived.cwd ? picked.target : derived;
    const cwd = target.cwd;
    const [worktrees, setWorktrees] = useState<readonly Worktree[]>([]);
    const targets = useMemo(() => gitTargets(nodes, worktrees, folder), [nodes, worktrees, folder]);

    /* What was read, and which checkout it was read from: a target that just changed shows nothing
       until its own status lands, without an effect that empties the state first. */
    const [held, setHeld] = useState<{ cwd: string; status: GitStatus | null; failure: string | null } | null>(null);
    const shown = held !== null && held.cwd === cwd ? held : null;
    const status = shown?.status ?? null;
    const failure = shown?.failure ?? null;
    /* The change the preview is showing, so the row a person is reading stands out in the list. */
    const reading = useFiles((s) => activeDiffPath(s, status?.root ?? null));
    const [notice, setNotice] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<GitFile | null>(null);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async (): Promise<void> => {
        if (cwd === null) {
            return;
        }
        try {
            const answer = await transport.request('git.status', { cwd });
            setHeld({ cwd, status: answer, failure: null });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'The status could not be read.';
            setHeld((previous) => ({ cwd, status: previous?.cwd === cwd ? previous.status : null, failure: message }));
        }
    }, [cwd]);

    useEffect(() => {
        if (cwd === null) {
            return;
        }
        // The watch goes up before the first status, so a write in between is reported, not missed.
        void transport
            .request('git.watch', { cwd })
            .catch(() => undefined)
            .then(() => refresh());
        return () => {
            void transport.request('git.unwatch', { cwd }).catch(() => undefined);
        };
    }, [cwd, refresh]);

    useEffect(() => {
        return transport.on('git.status', (payload) => {
            if (payload.cwd === cwd) {
                setHeld({ cwd, status: payload.status, failure: null });
            }
        });
    }, [cwd]);

    useEffect(() => {
        // A repository the daemon gave up watching only moves when this window asks it to.
        if (status?.live !== false) {
            return;
        }
        const onFocus = (): void => void refresh();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [refresh, status?.live]);

    useEffect(() => {
        if (notice === null) {
            return;
        }
        const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
        return () => window.clearTimeout(timer);
    }, [notice]);

    const act = async (work: () => Promise<void>): Promise<void> => {
        setBusy(true);
        try {
            await work();
            await refresh();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'That did not work.';
            setHeld((previous) => (previous === null ? previous : { ...previous, failure: message }));
        } finally {
            setBusy(false);
        }
    };

    const stage = (paths: string[], staged: boolean): void => {
        if (cwd !== null && paths.length > 0) {
            void act(async () => {
                await transport.request('git.stage', { cwd, paths, staged });
            });
        }
    };

    const discard = (file: GitFile): void => {
        setConfirming(null);
        if (cwd === null) {
            return;
        }
        void act(async () => {
            const { stash } = await transport.request('git.discard', { cwd, paths: [file.path] });
            setNotice(stash === null ? `${file.path} had nothing to discard.` : `${file.path} went into the stash ${stash}. "git stash pop" brings it back.`);
        });
    };

    const openDiff = (file: GitFile): void => {
        if (status?.root) {
            useFiles.getState().open(`${status.root}/${file.path}`, tabLimit, { kind: 'diff', cwd: status.root, scope, staged: file.state === 'staged' });
        }
    };

    if (cwd === null) {
        return (
            <div className="grid grow place-items-center">
                <EmptyState icon={<Icon icon={Folder} size={20} />}>This canvas has no folder, so there is no repository to look at.</EmptyState>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
                <TargetMenu
                    target={target}
                    targets={targets}
                    onOpen={() => {
                        if (folder !== null) {
                            void transport
                                .request('git.worktree-list', { repo: folder })
                                .then((answer) => setWorktrees(answer.worktrees))
                                .catch(() => setWorktrees([]));
                        }
                    }}
                    onPick={(next) => setPicked({ target: next, from: derived.cwd })}
                />
                {status?.repo && target.kind === 'project' && status.branch !== null && (
                    <span className="truncate font-mono text-xs text-text-muted">{status.branch}</span>
                )}
                {status?.detached && <span className="text-xs text-text-muted">detached</span>}
                {status !== null && status.ahead > 0 && (
                    <span className="flex items-center text-xs tabular-nums text-text-muted">
                        <Icon icon={ArrowUp} size={12} />
                        {status.ahead}
                    </span>
                )}
                {status !== null && status.behind > 0 && (
                    <span className="flex items-center text-xs tabular-nums text-text-muted">
                        <Icon icon={ArrowDown} size={12} />
                        {status.behind}
                    </span>
                )}
                <span className="grow" />
                <Tooltip label="Refresh" name>
                    <button className="icon-btn h-6 w-6" disabled={busy} onClick={() => void refresh()}>
                        <Icon icon={RefreshCw} size={12} />
                    </button>
                </Tooltip>
            </div>
            {failure !== null && <p className="border-b border-border px-3 py-2 text-xs text-status-error">{failure}</p>}
            {notice !== null && (
                <p role="status" className="border-b border-border px-3 py-2 text-xs text-text-muted">
                    {notice}
                </p>
            )}
            <GitFileList
                status={status}
                tree={tree}
                collapsed={collapsedDirs}
                reading={reading}
                busy={busy}
                onOpen={openDiff}
                onStage={stage}
                onDiscard={setConfirming}
            />

            <Dialog.Root open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup top-[24vh] w-[420px] p-5">
                        <Dialog.Title className="text-base font-semibold text-text">Discard {confirming ? basenameOf(confirming.path) : ''}?</Dialog.Title>
                        <p className="mt-1 text-xs text-text-muted">
                            The file goes back to what HEAD holds. Nothing is thrown away: the changes go into a stash named after this discard first, and "git
                            stash pop" is the way back.
                        </p>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button onClick={() => setConfirming(null)}>Cancel</Button>
                            <Button variant="danger" disabled={busy} onClick={() => confirming && discard(confirming)}>
                                <Icon icon={Trash2} size={12} /> Discard
                            </Button>
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}

/*
 * Which checkout the panel is on, and the ones it could be on instead: the project folder and every
 * worktree the daemon knows of it, with the group that binds one named beside it. Picking one keeps
 * the panel there while the canvas selection stays where it is.
 */
function TargetMenu({
    target,
    targets,
    onOpen,
    onPick
}: {
    target: GitTarget;
    targets: readonly GitTarget[];
    onOpen(): void;
    onPick(target: GitTarget): void;
}) {
    return (
        <Menu.Root onOpenChange={(open) => open && onOpen()}>
            <Menu.Trigger
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 text-xs text-text-muted hover:text-text"
                aria-label="Which checkout this panel is on"
            >
                <Icon icon={target.kind === 'worktree' ? GitBranch : Folder} size={12} />
                <span className={clsx('max-w-40 truncate', target.kind === 'worktree' && 'font-mono')}>{target.label}</span>
                <Icon icon={ChevronDown} size={12} />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner className="popup-layer" side="bottom" align="start" sideOffset={6}>
                    <Menu.Popup className="menu-popup">
                        {targets.map((entry) => (
                            <Menu.Item key={entry.cwd ?? entry.label} className="menu-item" onClick={() => onPick(entry)}>
                                <Icon icon={entry.cwd === target.cwd ? Check : entry.kind === 'worktree' ? GitBranch : Folder} size={14} />
                                <span className="truncate">{entry.label}</span>
                                {entry.group !== undefined && <span className="text-text-faint">{entry.group}</span>}
                            </Menu.Item>
                        ))}
                        {targets.length === 0 && (
                            <Menu.Item className="menu-item" disabled>
                                No checkout to point at
                            </Menu.Item>
                        )}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

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

function GitFileList({ status, tree, collapsed, reading, busy, onOpen, onStage, onDiscard }: ListProps) {
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
                        <header className="git-group">
                            <span className="section-label">{group.label}</span>
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

// Every level of the tree is this much further in; the row's own padding is on top of it.
const INDENT = 12;

function GitDirectoryRow({ row, collapsed }: { row: Extract<GitTreeRow, { kind: 'directory' }>; collapsed: boolean }) {
    return (
        <div className="git-row">
            <button
                className="git-row-open"
                aria-expanded={!collapsed}
                style={{ paddingLeft: 12 + row.depth * INDENT }}
                onClick={() => useGit.getState().toggleDir(row.path)}
            >
                <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', !collapsed && 'rotate-90')} />
                <span className="git-row-name">{row.label}</span>
                <span className="text-text-faint tabular-nums">{row.count}</span>
                <span className="grow" />
            </button>
            {/* The columns of a file row end here too, so a directory never shifts them. */}
            <span className="git-row-actions btn-group" />
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
    depth: number;
    /* The flat list carries the folder next to the name; in a tree the row above says it. */
    showPath: boolean;
    /* Whether the preview is showing this file's diff right now. */
    selected: boolean;
    busy: boolean;
    onOpen(): void;
    onStage(): void;
    onDiscard(): void;
}) {
    const dir = dirnameOf(file.path);
    const staged = file.state === 'staged';
    return (
        <div className="git-row" data-selected={selected || undefined}>
            <button className="git-row-open" aria-current={selected} style={{ paddingLeft: 12 + depth * INDENT }} onClick={onOpen}>
                <FileIcon path={file.path} size={14} />
                <span className="git-row-name">{basenameOf(file.path)}</span>
                {showPath && dir !== '' && <span className="git-row-dir">{dir}</span>}
                <span className="grow" />
                <span className="git-row-code">{file.status}</span>
                <span className="git-row-count text-term-green">{file.added > 0 ? `+${file.added}` : ''}</span>
                <span className="git-row-count text-term-red">{file.deleted > 0 ? `-${file.deleted}` : ''}</span>
            </button>
            <span className="git-row-actions btn-group">
                <Tooltip label={staged ? 'Unstage' : 'Stage'} name>
                    <button className="icon-btn h-6 w-6" disabled={busy} onClick={onStage}>
                        <Icon icon={staged ? Minus : Plus} size={12} />
                    </button>
                </Tooltip>
                <Tooltip label="Discard" name>
                    <button className="icon-btn h-6 w-6" disabled={busy} onClick={onDiscard}>
                        <Icon icon={Trash2} size={12} />
                    </button>
                </Tooltip>
            </span>
        </div>
    );
}
