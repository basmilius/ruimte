import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, Folder, GitPullRequest, MoreHorizontal, RefreshCw } from 'lucide-react';
import type { GitActionKind, GitCapabilitiesResult, GitCommit, GitFile, GitRef, GitStash, GitStatus, Worktree } from '@ruimte/contracts';
import { desktop } from '@/desktop/bridge';
import { BranchMenu } from '@/shell/panels/BranchMenu';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { CommitBox } from '@/shell/panels/CommitBox';
import { CommitLog } from '@/shell/panels/CommitLog';
import { basenameOf } from '@/shell/panels/files-tree';
import { GitChoice, GitPrompt, type Choice } from '@/shell/panels/GitDialogs';
import { GitFileList } from '@/shell/panels/GitFileList';
import { isUnmergedRefusal, pushButton } from '@/shell/panels/git-actions';
import { activeDiffPath, allDirs } from '@/shell/panels/git-tree';
import { useGitActions } from '@/shell/panels/use-git-actions';
import { PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { useCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import { watchGit } from '@/state/git-watch';
import { gitTarget, gitTargets, type GitTarget } from '@/state/git-target';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useToasts } from '@/state/toasts';
import { transport } from '@/transport';
import { Button } from '@/ui/Button';
import { BTN_GROUP, MENU_HINT, MENU_SEPARATOR } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

// Under this the header has no room for the counts, and the chips need what there is.
const PILLS_FROM_WIDTH = 320;

// What the log may be squeezed to, and what has to be left for the list above it.
const MIN_LOG_HEIGHT = 80;
const MIN_LIST_HEIGHT = 160;

type Dialog =
    | { kind: 'create-branch' }
    | { kind: 'rename-branch' }
    | { kind: 'pick-branch'; action: 'merge' | 'rebase' | 'delete-branch' }
    | { kind: 'confirm-delete'; ref: string; force: boolean }
    | { kind: 'force-push' }
    | { kind: 'stash' }
    | { kind: 'pick-stash' }
    | { kind: 'switch'; ref: GitRef }
    | { kind: 'discard'; file: GitFile }
    | { kind: 'pull-request'; subject: string };

/*
 * What the daemon knows about the checkout the panel is on: the branch it is on and every branch it
 * could be on, the changed files grouped the way a person acts on them, the message of the commit
 * to come, and the history under it. Every action goes through one `git.action` request whose
 * progress lands in a toast, so a push says where it is and a failure keeps what git wrote.
 */
export function GitPanel() {
    const nodes = useCanvas((s) => s.nodes);
    const selection = useCanvas((s) => s.selection);
    const folder = useProject((s) => s.current?.folder ?? null);
    const scope = useGit((s) => s.scope);
    const tree = useSettings((s) => s.gitTree);
    const collapsedDirs = useGit((s) => s.collapsedDirs);
    const logHeight = useGit((s) => s.logHeight);
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
    const [capabilities, setCapabilities] = useState<GitCapabilitiesResult | null>(null);
    const [refs, setRefs] = useState<readonly GitRef[]>([]);
    const [stashes, setStashes] = useState<readonly GitStash[]>([]);
    const [loadingRefs, setLoadingRefs] = useState(false);
    /* The change the preview is showing, so the row a person is reading stands out in the list. */
    const reading = useFiles((s) => activeDiffPath(s, status?.root ?? null));
    const readingCommit = useFiles((s) => s.tabs.find((tab) => tab.key === s.active)?.view?.commit ?? null);
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const [busy, setBusy] = useState(false);
    /* Goes up whenever the status moved, which is when the log below it may have moved too. */
    const [revision, setRevision] = useState(0);
    const bodyRef = useRef<HTMLDivElement>(null);
    const roomForPills = (useUi((s) => s.panelWidth) ?? 540) >= PILLS_FROM_WIDTH;
    const run = useGitActions();

    const refresh = useCallback(async (): Promise<void> => {
        if (cwd === null) {
            return;
        }
        try {
            const answer = await transport.request('git.status', { cwd });
            setHeld({ cwd, status: answer, failure: null });
            setRevision((count) => count + 1);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'The status could not be read.';
            setHeld((previous) => ({ cwd, status: previous?.cwd === cwd ? previous.status : null, failure: message }));
        }
    }, [cwd]);

    const loadRefs = useCallback((): void => {
        if (cwd === null) {
            return;
        }
        setLoadingRefs(true);
        transport
            .request('git.refs', { cwd })
            .then((answer) => {
                setRefs(answer.refs);
                setStashes(answer.stashes);
            })
            .catch(() => {
                setRefs([]);
                setStashes([]);
            })
            .finally(() => setLoadingRefs(false));
    }, [cwd]);

    useEffect(() => {
        if (cwd === null) {
            return;
        }
        // The watch goes up before the first status, so a write in between is reported, not missed.
        const watch = watchGit(cwd);
        void watch.ready.then(() => refresh());
        transport
            .request('git.capabilities', { cwd })
            .then(setCapabilities)
            .catch(() => setCapabilities(null));
        return () => {
            watch.release();
        };
    }, [cwd, refresh]);

    useEffect(() => {
        return transport.on('git.status', (payload) => {
            if (payload.cwd === cwd) {
                setHeld({ cwd, status: payload.status, failure: null });
                setRevision((count) => count + 1);
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

    /* Every action of the panel: it runs, it says how it went, and the status is read again after. */
    const act = useCallback(
        async (kind: GitActionKind, extra: Record<string, unknown> = {}, done?: Parameters<typeof run>[1]): Promise<boolean> => {
            if (cwd === null) {
                return false;
            }
            setBusy(true);
            setDialog(null);
            try {
                const outcome = await run({ cwd, kind, ...extra }, done);
                await refresh();
                if (outcome.ok) {
                    return true;
                }
                if (kind === 'delete-branch' && typeof extra.ref === 'string' && extra.force !== true && isUnmergedRefusal(outcome.message)) {
                    setDialog({ kind: 'confirm-delete', ref: extra.ref, force: true });
                }
                return false;
            } finally {
                setBusy(false);
            }
        },
        [cwd, refresh, run]
    );

    const stage = (paths: string[], staged: boolean): void => {
        if (cwd !== null && paths.length > 0) {
            setBusy(true);
            transport
                .request('git.stage', { cwd, paths, staged })
                .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'That did not work.';
                    useToasts.getState().show({ title: staged ? 'Staging failed' : 'Unstaging failed', description: message, kind: 'error', output: message });
                })
                .finally(() => {
                    setBusy(false);
                    void refresh();
                });
        }
    };

    const discard = (file: GitFile): void => {
        setDialog(null);
        if (cwd === null) {
            return;
        }
        setBusy(true);
        transport
            .request('git.discard', { cwd, paths: [file.path] })
            .then(({ stash }) => {
                useToasts.getState().show({
                    title: stash === null ? `${file.path} had nothing to discard` : `${file.path} went into a stash`,
                    ...(stash === null ? {} : { description: `"git stash pop" brings ${stash} back.` }),
                    kind: 'success'
                });
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'That did not work.';
                useToasts.getState().show({ title: 'The discard failed', description: message, kind: 'error', output: message });
            })
            .finally(() => {
                setBusy(false);
                void refresh();
            });
    };

    const openDiff = (file: GitFile): void => {
        if (status?.root) {
            useFiles.getState().open(`${status.root}/${file.path}`, tabLimit, { kind: 'diff', cwd: status.root, scope, staged: file.state === 'staged' });
        }
    };

    const openCommit = (commit: GitCommit): void => {
        if (status?.root) {
            useFiles.getState().open(status.root, tabLimit, { kind: 'diff', cwd: status.root, scope: 'commit', staged: false, commit: commit.hash });
        }
    };

    /* The one chip asks two questions, so opening it reads the branches and the worktrees at once. */
    const openBranchMenu = (): void => {
        loadRefs();
        if (folder !== null) {
            void transport
                .request('git.worktree-list', { repo: folder })
                .then((answer) => setWorktrees(answer.worktrees))
                .catch(() => setWorktrees([]));
        }
    };

    /* A switch that would lose the working tree asks first; a clean tree switches straight away. */
    const checkout = (ref: GitRef): void => {
        if ((status?.files.length ?? 0) > 0) {
            setDialog({ kind: 'switch', ref });
            return;
        }
        void act('checkout', { ref: ref.name });
    };

    const openPullRequest = (): void => {
        if (cwd === null) {
            return;
        }
        transport
            .request('git.log', { cwd, limit: 1 })
            .then((answer) => setDialog({ kind: 'pull-request', subject: answer.commits[0]?.subject ?? '' }))
            .catch(() => setDialog({ kind: 'pull-request', subject: '' }));
    };

    /* Dragging the line between the list and the log; both keep a whole number of pixels. */
    const startLogResize = (event: React.PointerEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const startY = event.clientY;
        const startHeight = logHeight;
        const available = (bodyRef.current?.getBoundingClientRect().height ?? 0) - MIN_LIST_HEIGHT;
        const onMove = (move: PointerEvent): void => {
            const next = Math.round(startHeight - (move.clientY - startY));
            useGit.getState().setLogHeight(Math.max(MIN_LOG_HEIGHT, Math.min(Math.max(MIN_LOG_HEIGHT, available), next)));
        };
        const onUp = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    if (cwd === null) {
        return (
            <div className="grid grow place-items-center">
                <EmptyState icon={<Icon icon={Folder} size={20} />}>This canvas has no folder, so there is no repository to look at.</EmptyState>
            </div>
        );
    }

    const push = pushButton(status);
    const branches = refs.filter((ref) => ref.kind === 'local');

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {/* The chips and the buttons of the panel live in the panel's own header, next to its
                name; the row under it holds what acts on the list. */}
            <PanelHeaderSlot>
                <BranchMenu
                    target={target}
                    targets={targets}
                    branch={status?.branch ?? null}
                    detached={status?.detached ?? false}
                    refs={refs}
                    loading={loadingRefs}
                    onOpen={openBranchMenu}
                    onPickTarget={(next) => setPicked({ target: next, from: derived.cwd })}
                    onCheckout={checkout}
                    onCreate={() => setDialog({ kind: 'create-branch' })}
                />
                {roomForPills && status !== null && status.ahead > 0 && (
                    <Pill icon={<Icon icon={ArrowUp} size={12} />} className="tabular-nums">
                        {status.ahead}
                    </Pill>
                )}
                {roomForPills && status !== null && status.behind > 0 && (
                    <Pill icon={<Icon icon={ArrowDown} size={12} />} className="tabular-nums">
                        {status.behind}
                    </Pill>
                )}
                <span className="grow" />
                <Tooltip label={push.reason}>
                    <Button size="sm" variant="primary" disabled={push.disabled || busy} onClick={() => void act(push.kind)}>
                        {push.label}
                    </Button>
                </Tooltip>
                <Separator />
            </PanelHeaderSlot>
            {status?.repo && (
                <div className={FILE_TOOLBAR}>
                    {tree && status.files.length > 0 && (
                        <span className={BTN_GROUP}>
                            <Tooltip label="Expand all folders" name>
                                <button className="icon-btn h-7 w-7" onClick={() => useGit.getState().setCollapsedDirs([])}>
                                    <Icon icon={ChevronsUpDown} size={14} />
                                </button>
                            </Tooltip>
                            <Tooltip label="Collapse all folders" name>
                                <button className="icon-btn h-7 w-7" onClick={() => useGit.getState().setCollapsedDirs(allDirs(status.files))}>
                                    <Icon icon={ChevronsDownUp} size={14} />
                                </button>
                            </Tooltip>
                        </span>
                    )}
                    <span className="grow" />
                    <Tooltip label="Refresh" name>
                        <button className="icon-btn h-7 w-7" disabled={busy} onClick={() => void refresh()}>
                            <Icon icon={RefreshCw} size={14} />
                        </button>
                    </Tooltip>
                    <Separator />
                    <ActionsMenu
                        busy={busy}
                        canPullRequest={capabilities?.gh === true}
                        stashes={stashes}
                        onOpen={loadRefs}
                        onAction={(kind) => void act(kind)}
                        onDialog={setDialog}
                        onPullRequest={openPullRequest}
                    />
                </div>
            )}
            {failure !== null && <p className="border-b border-border px-3 py-2 text-xs text-status-error">{failure}</p>}
            <div ref={bodyRef} className="flex min-h-0 grow flex-col">
                <GitFileList
                    status={status}
                    tree={tree}
                    collapsed={collapsedDirs}
                    reading={reading}
                    busy={busy}
                    onOpen={openDiff}
                    onStage={stage}
                    onDiscard={(file) => setDialog({ kind: 'discard', file })}
                />
                {status?.repo && (
                    <CommitBox
                        cwd={cwd}
                        status={status}
                        capabilities={capabilities}
                        busy={busy}
                        onCommit={(message, options) => {
                            void act(options.push ? 'commit-push' : 'commit', {
                                subject: message.subject,
                                body: message.body,
                                stageAll: options.stageAll
                            }).then((ok) => {
                                if (ok) {
                                    useGit.getState().setMessage(cwd, '');
                                }
                            });
                        }}
                    />
                )}
                {status?.repo && (
                    <>
                        <div
                            className="-mb-px h-[5px] shrink-0 cursor-row-resize border-b border-border hover:border-border-strong"
                            onPointerDown={startLogResize}
                        />
                        <div className="flex shrink-0 flex-col" style={{ height: logHeight }}>
                            <CommitLog cwd={cwd} revision={revision} reading={readingCommit} onOpen={openCommit} />
                        </div>
                    </>
                )}
            </div>

            <GitPrompt
                open={dialog?.kind === 'create-branch'}
                title="Create a branch"
                description="It starts from where this checkout is now and is checked out right away."
                field={{ label: 'Name', placeholder: 'feature/what-it-does' }}
                confirmLabel="Create branch"
                busy={busy}
                onConfirm={(name) => void act('create-branch', { name })}
                onClose={() => setDialog(null)}
            />
            <GitPrompt
                open={dialog?.kind === 'rename-branch'}
                title="Rename this branch"
                description="Only this branch moves; a remote that follows it keeps the old name until the next push."
                field={{ label: 'Name', initial: status?.branch ?? '' }}
                confirmLabel="Rename branch"
                busy={busy}
                onConfirm={(name) => void act('rename-branch', { name })}
                onClose={() => setDialog(null)}
            />
            <GitPrompt
                open={dialog?.kind === 'stash'}
                title="Stash the changes"
                description="Everything changed here goes into a stash, untracked files included, and the working tree goes back to HEAD."
                field={{ label: 'Message', placeholder: 'Optional' }}
                confirmLabel="Stash changes"
                busy={busy}
                onConfirm={(subject) => void act('stash', { subject })}
                onClose={() => setDialog(null)}
            />
            <GitPrompt
                open={dialog?.kind === 'force-push'}
                title="Force push this branch?"
                description="The remote is overwritten with what this checkout holds. It only goes through when the remote is still where this checkout last saw it, so a push somebody else made in between stops it."
                confirmLabel="Force push"
                danger
                busy={busy}
                onConfirm={() => void act('force-push')}
                onClose={() => setDialog(null)}
            />
            <GitPrompt
                open={dialog?.kind === 'switch'}
                title={dialog?.kind === 'switch' ? `Switch to ${dialog.ref.name}?` : 'Switch branch?'}
                description="This checkout has changes that are not committed. They can go into a stash first, and `git stash pop` brings them back."
                confirmLabel="Stash and switch"
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'switch') {
                        void act('checkout', { ref: dialog.ref.name, stash: true });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <GitPrompt
                open={dialog?.kind === 'confirm-delete'}
                title={dialog?.kind === 'confirm-delete' ? `Delete ${dialog.ref}?` : 'Delete this branch?'}
                description={
                    dialog?.kind === 'confirm-delete' && dialog.force
                        ? 'Git refused: this branch holds commits no other branch has. Deleting it now is the last word on them.'
                        : 'The branch goes away here; a remote branch of the same name stays where it is.'
                }
                confirmLabel={dialog?.kind === 'confirm-delete' && dialog.force ? 'Delete anyway' : 'Delete branch'}
                danger
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'confirm-delete') {
                        void act('delete-branch', { ref: dialog.ref, ...(dialog.force ? { force: true } : {}) });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <GitPrompt
                open={dialog?.kind === 'discard'}
                title={dialog?.kind === 'discard' ? `Discard ${basenameOf(dialog.file.path)}?` : 'Discard this file?'}
                description='The file goes back to what HEAD holds. Nothing is thrown away: the changes go into a stash named after this discard first, and "git stash pop" is the way back.'
                confirmLabel="Discard"
                danger
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'discard') {
                        discard(dialog.file);
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <GitPrompt
                open={dialog?.kind === 'pull-request'}
                title="Open a pull request"
                description="The branch is published first when the remote has never seen it. The pull request opens in your browser once gh has made it."
                field={{ label: 'Title', initial: dialog?.kind === 'pull-request' ? dialog.subject : '' }}
                area={{ label: 'Description', placeholder: 'What this changes and why.' }}
                confirmLabel="Create pull request"
                busy={busy}
                onConfirm={(subject, body) =>
                    void act(
                        'create-pr',
                        { subject, body },
                        {
                            done: (result) =>
                                result.url === undefined
                                    ? undefined
                                    : {
                                          label: 'Open',
                                          run: () => openUrl(result.url ?? '')
                                      }
                        }
                    )
                }
                onClose={() => setDialog(null)}
            />
            <GitChoice
                open={dialog?.kind === 'pick-branch'}
                title={
                    dialog?.kind === 'pick-branch'
                        ? dialog.action === 'merge'
                            ? 'Merge a branch into this one'
                            : dialog.action === 'rebase'
                              ? 'Rebase this branch onto'
                              : 'Delete a branch'
                        : 'Pick a branch'
                }
                choices={pickableBranches(dialog, refs, branches, status)}
                empty="There is no other branch here."
                onPick={(name) => {
                    if (dialog?.kind !== 'pick-branch') {
                        return;
                    }
                    if (dialog.action === 'delete-branch') {
                        setDialog({ kind: 'confirm-delete', ref: name, force: false });
                        return;
                    }
                    void act(dialog.action, { ref: name });
                }}
                onClose={() => setDialog(null)}
            />
            <GitChoice
                open={dialog?.kind === 'pick-stash'}
                title="Pop a stash"
                description="The changes come back into the working tree and the stash entry goes away."
                choices={stashes.map((stash) => ({ value: stash.ref, label: stash.ref, hint: stash.message }))}
                empty="There is nothing stashed here."
                onPick={(ref) => void act('stash-pop', { ref })}
                onClose={() => setDialog(null)}
            />
        </div>
    );
}

/* The branches a pick offers: everything but the one that is out, and only local ones to delete. */
const pickableBranches = (dialog: Dialog | null, refs: readonly GitRef[], locals: readonly GitRef[], status: GitStatus | null): Choice[] => {
    if (dialog?.kind !== 'pick-branch') {
        return [];
    }
    const source = dialog.action === 'delete-branch' ? locals : refs;
    return source
        .filter((ref) => !ref.current && ref.name !== status?.branch)
        .map((ref) => ({ value: ref.name, label: ref.name, ...(ref.isDefault ? { hint: 'default' } : {}) }));
};

/* The pull request opens where every other link does: the system browser, not a node on the canvas. */
const openUrl = (url: string): void => {
    const bridge = desktop();
    if (bridge) {
        void bridge.openExternal(url);
    } else {
        window.open(url, '_blank', 'noreferrer');
    }
};

interface ActionsMenuProps {
    busy: boolean;
    canPullRequest: boolean;
    stashes: readonly GitStash[];
    onOpen(): void;
    onAction(kind: GitActionKind): void;
    onDialog(dialog: Dialog): void;
    onPullRequest(): void;
}

/* Everything that is not the one button next to it. The order is how often a person reaches for it. */
function ActionsMenu({ busy, canPullRequest, stashes, onOpen, onAction, onDialog, onPullRequest }: ActionsMenuProps) {
    return (
        <Menu.Root onOpenChange={(open) => open && onOpen()}>
            <Tooltip label="More git actions" name>
                <Menu.Trigger className="icon-btn h-7 w-7" disabled={busy}>
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" align="end" sideOffset={6}>
                    <Menu.Popup className="menu-popup">
                        <Menu.Item className="menu-item" onClick={() => onAction('pull')}>
                            Pull
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onAction('push')}>
                            Push
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onAction('sync')}>
                            Sync
                            <span className={MENU_HINT}>pull, then push</span>
                        </Menu.Item>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item" onClick={() => onAction('fetch')}>
                            Fetch
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onDialog({ kind: 'force-push' })}>
                            Force Push
                        </Menu.Item>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item" onClick={() => onDialog({ kind: 'pick-branch', action: 'merge' })}>
                            Merge Branch...
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onDialog({ kind: 'pick-branch', action: 'rebase' })}>
                            Rebase onto...
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onDialog({ kind: 'rename-branch' })}>
                            Rename Branch...
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onDialog({ kind: 'pick-branch', action: 'delete-branch' })}>
                            Delete Branch...
                        </Menu.Item>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item" onClick={() => onDialog({ kind: 'stash' })}>
                            Stash Changes...
                        </Menu.Item>
                        <Menu.Item
                            className="menu-item"
                            disabled={stashes.length === 0}
                            onClick={() => (stashes.length > 1 ? onDialog({ kind: 'pick-stash' }) : onAction('stash-pop'))}
                        >
                            Pop Stash
                            {stashes.length > 1 && <span className={MENU_HINT}>{stashes.length}</span>}
                        </Menu.Item>
                        {canPullRequest && (
                            <>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={onPullRequest}>
                                    <Icon icon={GitPullRequest} size={14} />
                                    Create pull request...
                                </Menu.Item>
                            </>
                        )}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
