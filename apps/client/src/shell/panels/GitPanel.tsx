import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, Eye, Folder, GitMerge, GitPullRequest, MoreHorizontal, RefreshCw } from 'lucide-react';
import { type GitActionKind, type GitCapabilitiesResult, type GitFile, type GitRef, type GitStash, type Worktree } from '@ruimte/contracts';
import { performAsPerson, runAsPerson } from '@/actions/client-actions';
import { desktop } from '@/desktop/bridge';
import { BranchMenu, type CheckoutRefs } from '@/shell/panels/BranchMenu';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { CommitBox } from '@/shell/panels/CommitBox';
import { CommitLog, type LogSource } from '@/shell/panels/CommitLog';
import { basenameOf } from '@/shell/panels/files-tree';
import { GitChoice, GitDiverged, type Choice } from '@/shell/panels/GitDialogs';
import { PromptDialog } from '@/ui/PromptDialog';
import { GitFileList } from '@/shell/panels/GitFileList';
import { isUnmergedRefusal, pushButton, pushable, pushEntries, type CommitCandidate } from '@/shell/panels/git-actions';
import { PushMenu } from '@/shell/panels/PushMenu';
import { activeDiff, allDirs } from '@/shell/panels/git-tree';
import { stageFiles } from '@/shell/panels/stage-files';
import { useGitActions, type ActionOutcome } from '@/shell/panels/use-git-actions';
import { WorktreeSection } from '@/shell/panels/WorktreeSection';
import { worktreeBase, worktreeDiffTab } from '@/shell/panels/worktree-rows';
import { PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { useColumnResize } from '@/shell/useColumnResize';
import { revealNode } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import { useGitCheckouts, useProjectRepos, visibleRepos, withoutNestedRepos, type GitCheckoutRef } from '@/state/git-repos';
import { gitTarget, gitTargets, type GitTarget } from '@/state/git-target';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useToasts } from '@/state/toasts';
import { useProjectNodes, useWorktrees, worktreeLists } from '@/state/worktrees';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { BTN_GROUP, FORM_ERROR, MENU_HINT, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { PanelEmpty } from '@/ui/PanelEmpty';
import { MenuPopup } from '@/ui/MenuPopup';

// Under this the header has no room for the counts, and the chips need what there is.
const PILLS_FROM_WIDTH = 320;

// What the log may be squeezed to, and what has to be left for the list above it.
const MIN_LOG_HEIGHT = 80;
const MIN_LIST_HEIGHT = 160;

/* Every dialog names the repository it acts on: with more than one on screen, "the checkout" is not
   a thing a person can point at any more. */
type Dialog =
    | { kind: 'create-branch'; cwd: string }
    | { kind: 'rename-branch'; cwd: string; branch: string }
    | { kind: 'pick-branch'; cwd: string; action: 'merge' | 'rebase' | 'delete-branch' }
    | { kind: 'confirm-delete'; cwd: string; ref: string; force: boolean }
    | { kind: 'force-push'; cwd: string }
    | { kind: 'stash'; cwd: string }
    | { kind: 'pick-stash'; cwd: string }
    | { kind: 'switch'; cwd: string; ref: GitRef }
    | { kind: 'discard'; cwd: string; file: GitFile }
    | { kind: 'diverged'; cwd: string; action: GitActionKind; branch: string }
    | { kind: 'pull-request'; cwd: string; subject: string };

/*
 * What the daemon knows about the checkouts of a project: every repository the folder holds, the
 * changed files of each grouped the way a person acts on them, and for the one the panel is pointed
 * at the branch it is on, every branch it could be on, the message of the commit to come and the
 * history under it. Every action goes through one `git.action` request whose progress lands in a
 * toast, so a push says where it is and a failure keeps what git wrote.
 */
export function GitPanel() {
    const { t } = useTranslation('panels');
    const nodes = useCanvas((s) => s.nodes);
    const selection = useCanvas((s) => s.selection);
    const folder = useProject((s) => s.current?.folder ?? null);
    const scope = useGit((s) => s.scope);
    const collapsedDirs = useGit((s) => s.collapsedDirs);
    const logHeight = useGit((s) => s.logHeight);
    const hiddenRepos = useGit((s) => s.hiddenRepos);
    const tabLimit = useSettings((s) => s.filesTabLimit);
    const endpointId = useEndpointId();
    const transport = useTransport();
    const worktrees = useWorktrees(transport, endpointId, folder, true);
    const derived = useMemo(() => gitTarget(nodes, selection, folder, worktrees), [nodes, selection, folder, worktrees]);
    /* A worktree picked by hand outranks the selection, until the selection points somewhere else of
       its own: `from` is the target it was picked over, so a click on the canvas takes over again. A
       repository is not picked here but remembered, since it travels with the project's local file. */
    const [picked, setPicked] = useState<{ target: GitTarget; from: string | null } | null>(null);
    const projectNodes = useProjectNodes();
    const { repos, truncated: reposTruncated, reload: reloadRepos } = useProjectRepos(folder);
    const targets = useMemo(() => gitTargets(nodes, worktrees, folder, repos), [nodes, worktrees, folder, repos]);
    // A worktree picked by hand that has since been removed hands the panel back to the selection.
    const pickedStands = picked !== null && picked.from === derived.cwd && targets.some((entry) => entry.cwd === picked.target.cwd);
    /* The worktree the panel is in, if it is in one: that is the whole list then, the way it always was. */
    const worktree = pickedStands ? picked.target : derived.kind === 'worktree' ? derived : null;

    const refs = useMemo<readonly GitCheckoutRef[]>(
        () =>
            worktree !== null && worktree.cwd !== null ? [{ path: worktree.cwd, label: worktree.label, kind: 'worktree' }] : visibleRepos(repos, hiddenRepos),
        [worktree, repos, hiddenRepos]
    );
    const read = useGitCheckouts(refs);
    /* A repository this panel draws is not also an untracked folder in the one above it. */
    const checkouts = useMemo(() => {
        const roots = read.checkouts.map((checkout) => checkout.path);
        return read.checkouts.map((checkout) => ({ ...checkout, status: withoutNestedRepos(checkout.status, checkout.path, roots) }));
    }, [read.checkouts]);
    const refresh = read.refresh;

    /* A folder with one repository names none: in the list, in the log and in the commit box, and its
       chip still carries the branch. With more than one, no single branch is the panel's. */
    const named = checkouts.length > 1;
    /* The one checkout a folder with a single repository has, which is what the chip, the capabilities
       and the one-repository push button read. Over several there is no such thing. */
    const only = named ? null : (checkouts[0] ?? null);
    const cwd = only?.path ?? null;
    const status = only?.status ?? null;
    const target = useMemo<GitTarget>(
        () => targets.find((entry) => entry.cwd === cwd) ?? { cwd, label: only?.label ?? '', branch: null, kind: cwd === folder ? 'project' : 'repo' },
        [targets, cwd, only, folder]
    );
    /* A message is typed once and commits whatever is staged, so it belongs to the project. */
    const messageKey = worktree?.cwd ?? folder ?? '';
    const sources = useMemo<readonly LogSource[]>(
        () => checkouts.map((checkout) => ({ cwd: checkout.path, repo: named ? checkout.label : '', revision: checkout.revision })),
        [checkouts, named]
    );

    const [capabilities, setCapabilities] = useState<GitCapabilitiesResult | null>(null);
    /* The branches and stashes of every checkout a person walked into, read when its level opens: a
       folder of nine repositories is nine `git.refs` calls only for whoever asks for all nine. */
    const [refsByCwd, setRefsByCwd] = useState<Record<string, { refs: readonly GitRef[]; stashes: readonly GitStash[]; loading: boolean }>>({});
    /* The change the preview is showing, so the row a person is reading stands out in its own list. */
    const readingTab = useFiles((s) => s.tabs.find((tab) => tab.key === s.active));
    const reading = useMemo(() => activeDiff(readingTab), [readingTab]);
    const readingCommit = readingTab?.view?.commit ?? null;
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const [busy, setBusy] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);
    const logRef = useRef<HTMLDivElement>(null);
    /* Dragging the line between the list and the log; both keep a whole number of pixels. */
    const { startResize: startLogResize } = useColumnResize(logRef, {
        size: logHeight,
        min: MIN_LOG_HEIGHT,
        from: 'bottom',
        max: () => (bodyRef.current?.getBoundingClientRect().height ?? 0) - MIN_LIST_HEIGHT,
        onSize: (next) => useGit.getState().setLogHeight(next)
    });
    const roomForPills = (useUi((s) => s.panelWidth) ?? 540) >= PILLS_FROM_WIDTH;
    const run = useGitActions();

    const loadRefs = useCallback((path: string): void => {
        setRefsByCwd((previous) => ({ ...previous, [path]: { refs: previous[path]?.refs ?? [], stashes: previous[path]?.stashes ?? [], loading: true } }));
        performAsPerson('git.refs', { repository: path })
            .then((answer) => setRefsByCwd((previous) => ({ ...previous, [path]: { refs: answer.refs, stashes: answer.stashes, loading: false } })))
            .catch(() => setRefsByCwd((previous) => ({ ...previous, [path]: { refs: [], stashes: [], loading: false } })));
    }, []);

    const refsOf = useCallback(
        (path: string): CheckoutRefs => ({
            refs: refsByCwd[path]?.refs ?? [],
            loading: refsByCwd[path]?.loading ?? false,
            branch: checkouts.find((checkout) => checkout.path === path)?.status?.branch ?? null
        }),
        [refsByCwd, checkouts]
    );

    const probe = checkouts[0]?.path ?? null;

    useEffect(() => {
        if (probe === null) {
            return;
        }
        // What this machine can offer is the same for every repository on it; one is enough to ask.
        transport
            .request('git.capabilities', { cwd: probe })
            .then(setCapabilities)
            .catch(() => setCapabilities(null));
    }, [transport, probe]);

    /* One action on one checkout: it runs, it says how it went, and that checkout is read again after. */
    const actOn = useCallback(
        async (target: string, kind: GitActionKind, extra: Record<string, unknown> = {}, done?: Parameters<typeof run.run>[1]): Promise<ActionOutcome> => {
            setBusy(true);
            setDialog(null);
            try {
                const outcome = await run.run({ cwd: target, kind, ...extra }, done);
                await refresh(target);
                // A merge, a pull or a rebase that ended in conflicts opens where they are resolved.
                if (outcome.ok && (outcome.result.conflicts?.length ?? 0) > 0) {
                    useUi.getState().setConflicts({ cwd: target });
                }
                return outcome;
            } finally {
                setBusy(false);
            }
        },
        [refresh, run]
    );

    /* An action on one repository, with the second question a failure can raise. */
    const act = useCallback(
        async (path: string, kind: GitActionKind, extra: Record<string, unknown> = {}, done?: Parameters<typeof run.run>[1]): Promise<boolean> => {
            const outcome = await actOn(path, kind, extra, done);
            if (outcome.ok) {
                return true;
            }
            if (kind === 'delete-branch' && typeof extra.ref === 'string' && extra.force !== true && isUnmergedRefusal(outcome.message)) {
                setDialog({ kind: 'confirm-delete', cwd: path, ref: extra.ref, force: true });
            }
            if (outcome.code === 'diverged') {
                const branch = checkouts.find((checkout) => checkout.path === path)?.status?.branch ?? '';
                setDialog({ kind: 'diverged', cwd: path, action: kind, branch });
            }
            return false;
        },
        [actOn, checkouts]
    );

    /* Every repository at once, in order under one toast. Fetch, pull and push are the actions a
       folder of repositories is asked for as a whole; everything else names the one it acts on. */
    const actAll = useCallback(
        (kind: GitActionKind): void => {
            const jobs = checkouts.map((checkout) => ({ cwd: checkout.path, kind, label: checkout.label }));
            if (jobs.length === 0) {
                return;
            }
            setBusy(true);
            void run
                .runMany(jobs)
                .then(() => refresh())
                .finally(() => setBusy(false));
        },
        [checkouts, run, refresh]
    );

    const stage = (path: string, paths: string[], staged: boolean): void => {
        if (paths.length === 0) {
            return;
        }
        setBusy(true);
        void stageFiles(path, paths, staged).finally(() => {
            setBusy(false);
            void refresh(path);
        });
    };

    const discard = (path: string, file: GitFile): void => {
        setDialog(null);
        setBusy(true);
        performAsPerson('git.discard', { repository: path, paths: [file.path] })
            .then(({ stash }) => {
                useToasts.getState().show({
                    title: stash === null ? t('git.panel.discardNothing', { path: file.path }) : t('git.panel.discardStashed', { path: file.path }),
                    ...(stash === null ? {} : { description: t('git.panel.discardRestore', { stash }) }),
                    kind: 'success'
                });
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : t('error.generic');
                useToasts.getState().show({ title: t('git.panel.discardFailed'), description: message, kind: 'error', output: message });
            })
            .finally(() => {
                setBusy(false);
                void refresh(path);
            });
    };

    const openDiff = (path: string, file: GitFile): void => {
        // A conflict has three versions, so a diff with two sides is the wrong thing to open on it.
        if (file.state === 'conflicted') {
            useUi.getState().setConflicts({ cwd: path, path: file.path });
            return;
        }
        // A worktree's own changes are measured against the branch it was made from, not the repository's base.
        const entry = worktrees.find((candidate) => candidate.path === path);
        const base = entry === undefined ? undefined : worktreeBase(entry);
        useFiles.getState().open(`${path}/${file.path}`, tabLimit, {
            kind: 'diff',
            cwd: path,
            scope,
            staged: file.state === 'staged',
            ...(base === undefined ? {} : { base })
        });
    };

    /* The file next to its diff, for a change a person wants to read whole rather than as a patch. */
    const openFile = (path: string, file: GitFile): void => {
        void runAsPerson('file.preview', { path: `${path}/${file.path}`, line: null });
    };

    const openCommit = (path: string, commit: { hash: string }): void => {
        useFiles.getState().open(path, tabLimit, { kind: 'diff', cwd: path, scope: 'commit', staged: false, commit: commit.hash });
    };

    /* The chip lists the worktrees beside the repositories, so opening it reads them again. */
    const openBranchMenu = (): void => {
        if (folder !== null) {
            worktreeLists.reload(endpointId, folder);
        }
    };

    /* A worktree takes the panel over whole and is remembered per session; picking anything else is
       leaving it, which puts the folder's repositories back. */
    const pickTarget = (next: GitTarget): void => {
        setPicked(next.kind === 'worktree' ? { target: next, from: derived.cwd } : null);
    };

    /* Viewing a worktree points the panel at it, the way picking it from the chip does, and opens everything it holds in a tab. */
    const viewWorktree = (entry: Worktree): void => {
        const next = targets.find((candidate) => candidate.cwd === entry.path);
        if (next) {
            setPicked({ target: next, from: derived.cwd });
        }
        const tab = worktreeDiffTab(entry);
        useFiles.getState().open(tab.path, tabLimit, tab.view);
    };

    /* A switch that would lose the working tree asks first; a clean tree switches straight away. */
    const checkout = (path: string, ref: GitRef): void => {
        const entry = checkouts.find((candidate) => candidate.path === path);
        if ((entry?.status?.files.length ?? 0) > 0) {
            setDialog({ kind: 'switch', cwd: path, ref });
            return;
        }
        void actOn(path, 'checkout', { ref: ref.name });
    };

    const openPullRequest = (path: string): void => {
        performAsPerson('git.log', { repository: path, limit: 1, cursor: null })
            .then((answer) => setDialog({ kind: 'pull-request', cwd: path, subject: answer.commits[0]?.subject ?? '' }))
            .catch(() => setDialog({ kind: 'pull-request', cwd: path, subject: '' }));
    };

    /* One message over every repository that has something staged: one commit each, same words. */
    const commit = (message: { subject: string; body: string }, options: { targets: readonly CommitCandidate[]; stageAll: boolean; push: boolean }): void => {
        const kind: GitActionKind = options.push ? 'commit-push' : 'commit';
        const extra = { subject: message.subject, body: message.body, stageAll: options.stageAll };
        const clear = (ok: boolean): void => {
            if (ok) {
                useGit.getState().setMessage(messageKey, '');
            }
        };
        const one = options.targets[0];
        if (options.targets.length === 1 && one !== undefined) {
            void act(one.path, kind, extra).then(clear);
            return;
        }
        setBusy(true);
        void run
            .runMany(options.targets.map((entry) => ({ cwd: entry.path, kind, label: entry.label, extra })))
            .then((outcome) => {
                void refresh();
                clear(outcome.failed === 0);
            })
            .finally(() => setBusy(false));
    };

    const entries = useMemo(() => pushEntries(checkouts), [checkouts]);

    /* Every repository that has something to push, one after another under one toast. */
    const pushAll = (): void => {
        const jobs = pushable(entries).map((entry) => ({ cwd: entry.cwd, kind: entry.button.kind, label: entry.label }));
        if (jobs.length === 0) {
            return;
        }
        setBusy(true);
        void run
            .runMany(jobs)
            .then(() => refresh())
            .finally(() => setBusy(false));
    };

    if (folder === null) {
        return <PanelEmpty icon={Folder}>{t('git.panel.noFolder')}</PanelEmpty>;
    }

    const push = pushButton(status);
    const changes = checkouts.reduce((count, checkout) => count + (checkout.status?.files.length ?? 0), 0);
    const failures = checkouts.filter((checkout) => checkout.failure !== null);
    /* Over several repositories the counts are the whole folder's, which is what the button beside
       them acts on as well. */
    const ahead = checkouts.reduce((count, checkout) => count + (checkout.status?.ahead ?? 0), 0);
    const behind = checkouts.reduce((count, checkout) => count + (checkout.status?.behind ?? 0), 0);

    /* What acts on one repository: the whole actions menu of a folder with a single one, and the head
       of every repository's own level while it holds more. */
    const repoActions = (path: string): ReactNode => (
        <RepoActionItems
            cwd={path}
            busy={busy}
            canPullRequest={capabilities?.gh === true}
            stashes={refsByCwd[path]?.stashes ?? []}
            branch={checkouts.find((checkout) => checkout.path === path)?.status?.branch ?? ''}
            onAction={(kind) => void act(path, kind)}
            onDialog={setDialog}
            onPullRequest={() => openPullRequest(path)}
        />
    );

    return (
        <div
            className="flex min-h-0 min-w-0 grow flex-col"
            onFocus={(event) => {
                // Focus moving between controls inside the panel is not the panel gaining it.
                if (folder !== null && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    worktreeLists.refreshCounts(endpointId, folder);
                }
            }}
        >
            {/* The chips and the buttons of the panel live in the panel's own header, next to its
                name; the row under it holds what acts on the list. */}
            <PanelHeaderSlot>
                <BranchMenu
                    target={target}
                    targets={targets}
                    branch={status?.branch ?? null}
                    detached={status?.detached ?? false}
                    nested={named}
                    refsOf={refsOf}
                    renderActions={repoActions}
                    onOpenMenu={openBranchMenu}
                    onOpen={loadRefs}
                    onPickTarget={pickTarget}
                    onCheckout={checkout}
                    onCreate={(path) => setDialog({ kind: 'create-branch', cwd: path })}
                />
                {roomForPills && ahead > 0 && (
                    <Pill icon={<Icon icon={ArrowUp} size={12} />} className="tabular-nums">
                        {ahead}
                    </Pill>
                )}
                {roomForPills && behind > 0 && (
                    <Pill icon={<Icon icon={ArrowDown} size={12} />} className="tabular-nums">
                        {behind}
                    </Pill>
                )}
                <span className="grow" />
                <PushMenu button={push} active={cwd} entries={entries} busy={busy} onPush={(path, kind) => void actOn(path, kind)} onPushAll={pushAll} />
                <Separator />
            </PanelHeaderSlot>
            {/* A folder whose every repository is hidden keeps this row, since the menu on it is the way back. */}
            {(checkouts.length > 0 || hiddenRepos.length > 0) && (
                <div className={FILE_TOOLBAR}>
                    {changes > 0 && (
                        <span className={BTN_GROUP}>
                            <Tooltip label={t('git.panel.expandAll')} name>
                                <button className="icon-btn icon-btn-sm" onClick={() => useGit.getState().setCollapsedDirs([])}>
                                    <Icon icon={ChevronsUpDown} size={14} />
                                </button>
                            </Tooltip>
                            <Tooltip label={t('git.panel.collapseAll')} name>
                                <button
                                    className="icon-btn icon-btn-sm"
                                    onClick={() =>
                                        useGit
                                            .getState()
                                            .setCollapsedDirs(
                                                checkouts.flatMap((checkout) => allDirs(checkout.status?.files ?? [], named ? checkout.label : ''))
                                            )
                                    }
                                >
                                    <Icon icon={ChevronsDownUp} size={14} />
                                </button>
                            </Tooltip>
                        </span>
                    )}
                    <span className="grow" />
                    <Tooltip label={t('file.menu.refresh')} name>
                        <button
                            className="icon-btn icon-btn-sm"
                            disabled={busy}
                            onClick={() => {
                                void refresh();
                                reloadRepos();
                                if (folder !== null) {
                                    worktreeLists.reload(endpointId, folder);
                                }
                            }}
                        >
                            <Icon icon={RefreshCw} size={14} />
                        </button>
                    </Tooltip>
                    <Separator />
                    <ActionsMenu
                        busy={busy}
                        hidden={hiddenRepos.length}
                        onOpen={() => cwd !== null && loadRefs(cwd)}
                        onAll={actAll}
                        onShowRepos={() => useGit.getState().setHiddenRepos([])}
                    >
                        {/* One repository keeps the menu it always had; over several, what acts on one
                            of them sits in that repository's own level of the branch menu. */}
                        {!named && cwd !== null ? repoActions(cwd) : undefined}
                    </ActionsMenu>
                </div>
            )}
            {failures.map((checkout) => (
                <p key={checkout.path} className={`${FORM_ERROR} border-b border-border px-3 py-2`} role="alert">
                    {named ? `${checkout.label}: ${checkout.failure}` : checkout.failure}
                </p>
            ))}
            {/* A checkout that stopped halfway says so until it is finished or taken back, however
                the panel is left and come back to. */}
            {checkouts.map((checkout) => {
                const conflicted = checkout.status?.files.filter((file) => file.state === 'conflicted').length ?? 0;
                const operation = checkout.status?.operation;
                if (operation === undefined && conflicted === 0) {
                    return null;
                }
                return (
                    <div key={checkout.path} className="flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                        <Icon icon={GitMerge} size={14} className="shrink-0 text-status-needs-you" />
                        <span className="min-w-0 grow truncate text-xs text-text">
                            {operation === undefined ? t('git.conflict.plain') : t(`git.conflict.${operation}`)}
                            {named ? ` (${checkout.label})` : ''}
                        </span>
                        {conflicted > 0 && <span className="shrink-0 text-xs text-text-faint">{t('git.conflict.files', { count: conflicted })}</span>}
                        <Button size="sm" variant="secondary" onClick={() => useUi.getState().setConflicts({ cwd: checkout.path })}>
                            {t('git.conflict.resolve')}
                        </Button>
                    </div>
                );
            })}
            <div ref={bodyRef} className="flex min-h-0 grow flex-col">
                <GitFileList
                    checkouts={checkouts}
                    collapsed={collapsedDirs}
                    reading={reading}
                    reposTruncated={reposTruncated}
                    busy={busy}
                    onOpen={openDiff}
                    onOpenFile={openFile}
                    onStage={stage}
                    onDiscard={(path, file) => setDialog({ kind: 'discard', cwd: path, file })}
                />
                {checkouts.length > 0 && (
                    <CommitBox messageKey={messageKey} checkouts={checkouts} named={named} capabilities={capabilities} busy={busy} onCommit={commit} />
                )}
                {folder !== null && (
                    <WorktreeSection
                        folder={folder}
                        worktrees={worktrees}
                        nodes={projectNodes}
                        current={cwd}
                        busy={busy}
                        onView={viewWorktree}
                        onMerge={(entry) => useUi.getState().setWorktreeMerge({ folder, paths: [entry.path] })}
                        onRemove={(entry) => useUi.getState().setWorktreeRemoval({ folder, paths: [entry.path] })}
                        onReveal={revealNode}
                    />
                )}
                {checkouts.length > 0 && (
                    <>
                        <div
                            className="-mb-px h-[5px] shrink-0 cursor-row-resize border-b border-border hover:border-border-strong"
                            onPointerDown={startLogResize}
                        />
                        <div ref={logRef} className="flex shrink-0 flex-col" style={{ height: logHeight }}>
                            <CommitLog sources={sources} reading={readingCommit} onOpen={openCommit} />
                        </div>
                    </>
                )}
            </div>

            <PromptDialog
                open={dialog?.kind === 'create-branch'}
                title={t('git.dialog.createBranch.title')}
                description={t('git.dialog.createBranch.description')}
                field={{ mono: true, label: t('git.dialog.name'), placeholder: 'feature/what-it-does' }}
                confirmLabel={t('git.dialog.createBranch.confirm')}
                busy={busy}
                onConfirm={(name) => {
                    if (dialog?.kind === 'create-branch') {
                        void actOn(dialog.cwd, 'create-branch', { name });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'rename-branch'}
                title={t('git.dialog.renameBranch.title')}
                description={t('git.dialog.renameBranch.description')}
                field={{ mono: true, label: t('git.dialog.name'), initial: dialog?.kind === 'rename-branch' ? dialog.branch : '' }}
                confirmLabel={t('git.dialog.renameBranch.confirm')}
                busy={busy}
                onConfirm={(name) => {
                    if (dialog?.kind === 'rename-branch') {
                        void act(dialog.cwd, 'rename-branch', { name });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'stash'}
                title={t('git.dialog.stash.title')}
                description={t('git.dialog.stash.description')}
                field={{ mono: true, label: t('git.dialog.message'), placeholder: t('git.dialog.optional') }}
                confirmLabel={t('git.dialog.stash.confirm')}
                busy={busy}
                onConfirm={(subject) => {
                    if (dialog?.kind === 'stash') {
                        void act(dialog.cwd, 'stash', { subject });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'force-push'}
                title={t('git.dialog.forcePush.title')}
                description={t('git.dialog.forcePush.description')}
                confirmLabel={t('git.dialog.forcePush.confirm')}
                danger
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'force-push') {
                        void act(dialog.cwd, 'force-push');
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'switch'}
                title={dialog?.kind === 'switch' ? t('git.dialog.switch.title', { branch: dialog.ref.name }) : t('git.dialog.switch.fallback')}
                description={t('git.dialog.switch.description')}
                confirmLabel={t('git.dialog.switch.confirm')}
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'switch') {
                        void actOn(dialog.cwd, 'checkout', { ref: dialog.ref.name, stash: true });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'confirm-delete'}
                title={dialog?.kind === 'confirm-delete' ? t('git.dialog.deleteBranch.title', { branch: dialog.ref }) : t('git.dialog.deleteBranch.fallback')}
                description={
                    dialog?.kind === 'confirm-delete' && dialog.force ? t('git.dialog.deleteBranch.unmerged') : t('git.dialog.deleteBranch.description')
                }
                confirmLabel={dialog?.kind === 'confirm-delete' && dialog.force ? t('git.dialog.deleteBranch.anyway') : t('git.dialog.deleteBranch.confirm')}
                danger
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'confirm-delete') {
                        void act(dialog.cwd, 'delete-branch', { ref: dialog.ref, ...(dialog.force ? { force: true } : {}) });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'discard'}
                title={dialog?.kind === 'discard' ? t('git.dialog.discard.title', { name: basenameOf(dialog.file.path) }) : t('git.dialog.discard.fallback')}
                description={t('git.dialog.discard.description')}
                confirmLabel={t('git.dialog.discard.confirm')}
                danger
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'discard') {
                        discard(dialog.cwd, dialog.file);
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'pull-request'}
                title={t('git.dialog.pullRequest.title')}
                description={t('git.dialog.pullRequest.description')}
                field={{ mono: true, label: t('git.dialog.pullRequest.subject'), initial: dialog?.kind === 'pull-request' ? dialog.subject : '' }}
                area={{ label: t('git.dialog.pullRequest.body'), placeholder: t('git.dialog.pullRequest.bodyPlaceholder') }}
                confirmLabel={t('git.dialog.pullRequest.confirm')}
                busy={busy}
                onConfirm={(subject, body) => {
                    if (dialog?.kind === 'pull-request') {
                        void act(
                            dialog.cwd,
                            'create-pr',
                            { subject, body },
                            {
                                done: (result) =>
                                    result.url === undefined ? undefined : { label: t('common:action.open'), run: () => openUrl(result.url ?? '') }
                            }
                        );
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <GitDiverged
                open={dialog?.kind === 'diverged'}
                branch={dialog?.kind === 'diverged' ? dialog.branch : ''}
                busy={busy}
                onPick={(strategy) => {
                    if (dialog?.kind === 'diverged') {
                        void act(dialog.cwd, dialog.action, { strategy });
                    }
                }}
                onClose={() => setDialog(null)}
            />
            <GitChoice
                open={dialog?.kind === 'pick-branch'}
                title={
                    dialog?.kind === 'pick-branch'
                        ? dialog.action === 'merge'
                            ? t('git.dialog.pick.merge')
                            : dialog.action === 'rebase'
                              ? t('git.dialog.pick.rebase')
                              : t('git.dialog.pick.delete')
                        : t('git.dialog.pick.fallback')
                }
                choices={pickableBranches(dialog, dialog?.kind === 'pick-branch' ? refsOf(dialog.cwd) : null)}
                empty={t('git.dialog.pick.empty')}
                onPick={(name) => {
                    if (dialog?.kind !== 'pick-branch') {
                        return;
                    }
                    if (dialog.action === 'delete-branch') {
                        setDialog({ kind: 'confirm-delete', cwd: dialog.cwd, ref: name, force: false });
                        return;
                    }
                    void act(dialog.cwd, dialog.action, { ref: name });
                }}
                onClose={() => setDialog(null)}
            />
            <GitChoice
                open={dialog?.kind === 'pick-stash'}
                title={t('git.dialog.popStash.title')}
                description={t('git.dialog.popStash.description')}
                choices={(dialog?.kind === 'pick-stash' ? (refsByCwd[dialog.cwd]?.stashes ?? []) : []).map((stash) => ({
                    value: stash.ref,
                    label: stash.ref,
                    hint: stash.message
                }))}
                empty={t('git.dialog.popStash.empty')}
                onPick={(ref) => {
                    if (dialog?.kind === 'pick-stash') {
                        void act(dialog.cwd, 'stash-pop', { ref });
                    }
                }}
                onClose={() => setDialog(null)}
            />
        </div>
    );
}

/* The branches a pick offers: everything but the one that is out, and only local ones to delete. */
const pickableBranches = (dialog: Dialog | null, state: CheckoutRefs | null): Choice[] => {
    if (dialog?.kind !== 'pick-branch' || state === null) {
        return [];
    }
    const source = dialog.action === 'delete-branch' ? state.refs.filter((ref) => ref.kind === 'local') : state.refs;
    return source
        .filter((ref) => !ref.current && ref.name !== state.branch)
        .map((ref) => ({ value: ref.name, label: ref.name, ...(ref.isDefault ? { hint: i18next.t('panels:git.branchMenu.default') } : {}) }));
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
    /* How many repositories of the folder a person folded away, which is the only way back to them. */
    hidden: number;
    onOpen(): void;
    /* Fetch, pull and push over every repository the folder holds. */
    onAll(kind: GitActionKind): void;
    onShowRepos(): void;
    /* What acts on one repository, which a folder with a single one has right here. */
    children?: ReactNode;
}

/*
 * Everything that is not the one button next to it. A folder with a single repository has the menu it
 * always had; over several, the three that make sense for the whole folder stay here and everything
 * that names one repository sits in that repository's own level of the branch menu.
 */
function ActionsMenu({ busy, hidden, onOpen, onAll, onShowRepos, children }: ActionsMenuProps) {
    const { t } = useTranslation('panels');
    return (
        <Menu.Root onOpenChange={(open) => open && onOpen()}>
            <Tooltip label={t('git.actions.more')} name>
                <Menu.Trigger className="icon-btn icon-btn-sm" disabled={busy}>
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.Trigger>
            </Tooltip>
            <MenuPopup align="end">
                {children ?? (
                    <>
                        <Menu.Item className="menu-item" onClick={() => onAll('pull')}>
                            {t('git.actions.pullAll')}
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onAll('sync')}>
                            {t('git.actions.syncAll')}
                            <span className={MENU_HINT}>{t('git.actions.syncHint')}</span>
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => onAll('fetch')}>
                            {t('git.actions.fetchAll')}
                        </Menu.Item>
                    </>
                )}
                {hidden > 0 && (
                    <>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item" onClick={onShowRepos}>
                            <Icon icon={Eye} size={14} />
                            {t('git.repo.showAll', { count: hidden })}
                        </Menu.Item>
                    </>
                )}
            </MenuPopup>
        </Menu.Root>
    );
}

interface RepoActionItemsProps {
    cwd: string;
    busy: boolean;
    canPullRequest: boolean;
    stashes: readonly GitStash[];
    /* What HEAD is on, which the rename dialog opens with. */
    branch: string;
    onAction(kind: GitActionKind): void;
    onDialog(dialog: Dialog): void;
    onPullRequest(): void;
}

/* Everything that acts on one repository. The order is how often a person reaches for it. */
function RepoActionItems({ cwd, busy, canPullRequest, stashes, branch, onAction, onDialog, onPullRequest }: RepoActionItemsProps) {
    const { t } = useTranslation('panels');
    return (
        <>
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onAction('pull')}>
                {t('git.actions.pull')}
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onAction('push')}>
                {t('git.actions.push')}
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onAction('sync')}>
                {t('git.actions.sync')}
                <span className={MENU_HINT}>{t('git.actions.syncHint')}</span>
            </Menu.Item>
            <Menu.Separator className={MENU_SEPARATOR} />
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onAction('fetch')}>
                {t('git.actions.fetch')}
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onDialog({ kind: 'force-push', cwd })}>
                {t('git.actions.forcePush')}
            </Menu.Item>
            <Menu.Separator className={MENU_SEPARATOR} />
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onDialog({ kind: 'pick-branch', cwd, action: 'merge' })}>
                {t('git.actions.merge')}
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onDialog({ kind: 'pick-branch', cwd, action: 'rebase' })}>
                {t('git.actions.rebase')}
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onDialog({ kind: 'rename-branch', cwd, branch })}>
                {t('git.actions.renameBranch')}
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onDialog({ kind: 'pick-branch', cwd, action: 'delete-branch' })}>
                {t('git.actions.deleteBranch')}
            </Menu.Item>
            <Menu.Separator className={MENU_SEPARATOR} />
            <Menu.Item className="menu-item" disabled={busy} onClick={() => onDialog({ kind: 'stash', cwd })}>
                {t('git.actions.stash')}
            </Menu.Item>
            <Menu.Item
                className="menu-item"
                disabled={busy || stashes.length === 0}
                onClick={() => (stashes.length > 1 ? onDialog({ kind: 'pick-stash', cwd }) : onAction('stash-pop'))}
            >
                {t('git.actions.popStash')}
                {stashes.length > 1 && <span className={MENU_HINT}>{stashes.length}</span>}
            </Menu.Item>
            {canPullRequest && (
                <>
                    <Menu.Separator className={MENU_SEPARATOR} />
                    <Menu.Item className="menu-item" disabled={busy} onClick={onPullRequest}>
                        <Icon icon={GitPullRequest} size={14} />
                        {t('git.actions.pullRequest')}
                    </Menu.Item>
                </>
            )}
        </>
    );
}
