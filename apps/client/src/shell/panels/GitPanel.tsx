import { PromptDialog, useColumnResize, Banner, Button, FormError, Icon, IconButton, PanelEmpty, Menu, messageOf, Separator } from '@adecore/ui';
import { type GitActionKind, type GitCapabilitiesResult, type GitFile, type GitRef, type GitStash, type Worktree, absoluteOf } from '@ruimte/contracts';
import i18next from 'i18next';
import { Archive, ChevronsDownUp, ChevronsUpDown, Folder, GitBranch, GitMerge, GitPullRequest, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { assumeStaged, useGitCheckouts, useProjectRepos, visibleRepos, withoutNestedCheckouts, type GitCheckoutRef } from '@/controllers/git-repos';
import { useProjectNodes, useWorktrees, worktreeLists } from '@/controllers/worktrees';
import { openInSystemBrowser } from '@/desktop/bridge';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { basenameOf } from '@/paths/file-path';
import { revealNode } from '@/project/views';
import { startDiffDrag, type DraggedDiff } from '@/shell/diff-drag';
import { PanelHeaderActions, PanelHeaderLeadingSlot, PanelHeaderSlot, PanelHeaderTitleHidden } from '@/shell/PanelHeaderSlot';
import { BranchMenu, type CheckoutRefs } from '@/shell/panels/BranchMenu';
import { CommitBox } from '@/shell/panels/CommitBox';
import { CommitLog, type LogSource } from '@/shell/panels/CommitLog';
import { activeDiff, allCollapseKeys } from '@/shell/panels/git-tree';
import { GitChoice, GitDiverged, type Choice } from '@/shell/panels/GitDialogs';
import { GitFileList, type GitWork } from '@/shell/panels/GitFileList';
import { PushMenu } from '@/shell/panels/PushMenu';
import { stageFiles } from '@/shell/panels/stage-files';
import { useGitActions, type ActionOutcome, type ManyJob } from '@/shell/panels/use-git-actions';
import { useWorktreeInspection } from '@/shell/panels/use-worktree-inspection';
import { WorktreeBar, WorktreeInspectDialog, type WorktreeActions } from '@/shell/panels/WorktreeMenu';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { fileTabOf, useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import { gitPlace, gitTarget, gitTargets, type GitPick, type GitTarget } from '@/state/git-target';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { isUnmergedRefusal, popStashStep, pushButton, pushable, pushEntries, type CommitCandidate } from '@/worktree-rules/git-actions';
import { nodeNames, nodesInWorktree, worktreeBase, worktreeDiffTab } from '@/worktree-rules/worktree-rows';

// What the log may be squeezed to, and what has to be left for the list above it.
const MIN_LOG_HEIGHT = 80;
const MIN_LIST_HEIGHT = 160;

/* Every dialog names the repository it acts on: with more than one on screen, "the checkout" is not
   a thing a person can point at any more. A discard or a delete over a selection names one each. */
type Dialog =
    | { kind: 'create-branch'; cwd: string }
    | { kind: 'rename-branch'; cwd: string; branch: string }
    | { kind: 'pick-branch'; cwd: string; action: 'merge' | 'rebase' | 'delete-branch' }
    | { kind: 'confirm-delete'; cwd: string; ref: string; force: boolean }
    | { kind: 'force-push'; cwd: string }
    | { kind: 'confirm-rebase'; cwd: string; onto: string }
    | { kind: 'stash'; cwd: string }
    | { kind: 'pick-stash'; cwd: string }
    | { kind: 'switch'; cwd: string; ref: GitRef }
    | { kind: 'discard'; work: GitWork[] }
    | { kind: 'delete-file'; work: GitWork[] }
    | { kind: 'diverged'; cwd: string; action: GitActionKind; branch: string }
    | { kind: 'pull-request'; cwd: string; subject: string };

function filesOf(work: readonly GitWork[]): GitFile[] {
    return work.flatMap((step) => step.files);
}

/*
 * Staged files choose the commit's repositories; a worktree can take over the whole panel. The React
 * Compiler leaves this as written (a try without a catch), so its memos stay by hand.
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
    /* A worktree picked by hand, or the project folder pinned, outranks the selection until the
       selection points somewhere else of its own. A repository is not picked here but remembered,
       since it travels with the project's local file. */
    const [picked, setPicked] = useState<GitPick | null>(null);
    const projectNodes = useProjectNodes();
    const { repos, truncated: reposTruncated, reload: reloadRepos } = useProjectRepos(folder);
    const targets = useMemo(() => gitTargets(nodes, worktrees, folder, repos), [nodes, worktrees, folder, repos]);
    /* The worktree the panel is in, if it is in one: that is the whole list then, the way it always was. */
    const { worktree, following } = gitPlace(derived, picked, targets);
    const followedNode = following && derived.via !== undefined ? (nodes[derived.via] ?? null) : null;

    const refs = useMemo<readonly GitCheckoutRef[]>(
        () =>
            worktree !== null && worktree.cwd !== null ? [{ path: worktree.cwd, label: worktree.label, kind: 'worktree' }] : visibleRepos(repos, hiddenRepos),
        [worktree, repos, hiddenRepos]
    );
    const read = useGitCheckouts(refs);
    /* A repository this panel draws is not also an untracked folder in the one above it. */
    const checkouts = useMemo(() => withoutNestedCheckouts(read.checkouts), [read.checkouts]);
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
    const messageKey = endpointKey(endpointId, worktree?.cwd ?? folder ?? '');
    const sources = useMemo<readonly LogSource[]>(
        () => checkouts.map((checkout) => ({ cwd: checkout.path, repo: named ? checkout.label : '', revision: checkout.revision })),
        [checkouts, named]
    );

    const [capabilities, setCapabilities] = useState<GitCapabilitiesResult | null>(null);
    /* The branches and stashes of every checkout a person walked into, read when its level opens: a
       folder of nine repositories is nine `git.refs` calls only for whoever asks for all nine. */
    const [refsRequests] = useState(() => new Map<string, number>());
    const checkoutKey = (path: string): string => endpointKey(endpointId, path);
    const [refsByCwd, setRefsByCwd] = useState<
        Record<string, { refs: readonly GitRef[]; stashes: readonly GitStash[]; loading: boolean; error: string | null }>
    >({});
    /* The change the preview is showing, so the row a person is reading stands out in its own list. */
    const readingId = useDocument((s) => s.activeViewId);
    const readingTab = useFiles((s) => fileTabOf(s, readingId));
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
    const run = useGitActions();
    const inspection = useWorktreeInspection(folder);

    const loadRefs = (path: string): void => {
        const key = checkoutKey(path);
        const generation = (refsRequests.get(key) ?? 0) + 1;
        refsRequests.set(key, generation);
        // What was read before stays on screen while the new read is out, and after it failed.
        const settle = (next: { loading: boolean; error: string | null; refs?: readonly GitRef[]; stashes?: readonly GitStash[] }): void => {
            setRefsByCwd((previous) => ({ ...previous, [key]: { refs: previous[key]?.refs ?? [], stashes: previous[key]?.stashes ?? [], ...next } }));
        };
        settle({ loading: true, error: null });
        perform('git.refs', { repository: path })
            .then((answer) => {
                if (refsRequests.get(key) === generation) {
                    settle({ refs: answer.refs, stashes: answer.stashes, loading: false, error: null });
                }
            })
            .catch((error: unknown) => {
                if (refsRequests.get(key) === generation) {
                    settle({ loading: false, error: messageOf(error) });
                }
            });
    };

    const branchOf = (path: string): string | null => checkouts.find((checkout) => checkout.path === path)?.status?.branch ?? null;

    const refsOf = (path: string): CheckoutRefs => {
        const held = refsByCwd[checkoutKey(path)];
        return { refs: held?.refs ?? [], loading: held?.loading ?? false, error: held?.error ?? null, retry: () => loadRefs(path), branch: branchOf(path) };
    };

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
    const actOn = async (
        target: string,
        kind: GitActionKind,
        extra: Record<string, unknown> = {},
        done?: Parameters<typeof run.run>[1]
    ): Promise<ActionOutcome> => {
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
    };

    /* An action on one repository, with the second question a failure can raise. */
    const act = async (path: string, kind: GitActionKind, extra: Record<string, unknown> = {}, done?: Parameters<typeof run.run>[1]): Promise<boolean> => {
        const outcome = await actOn(path, kind, extra, done);
        if (outcome.ok) {
            return true;
        }
        if (kind === 'delete-branch' && typeof extra.ref === 'string' && extra.force !== true && isUnmergedRefusal(outcome.message)) {
            setDialog({ kind: 'confirm-delete', cwd: path, ref: extra.ref, force: true });
        }
        if (outcome.code === 'diverged') {
            setDialog({ kind: 'diverged', cwd: path, action: kind, branch: branchOf(path) ?? '' });
        }
        return false;
    };

    /* Every repository at once, in order under one toast. Fetch, pull and push are the actions a
       folder of repositories is asked for as a whole; everything else names the one it acts on. */
    const actAll = (kind: GitActionKind): void => {
        const jobs = checkouts.map((checkout) => ({ cwd: checkout.path, kind, label: checkout.label }));
        if (jobs.length === 0) {
            return;
        }
        // A branch that moved on both sides is asked about from the summary, the way one repository asks at once.
        const choose = (job: ManyJob): void => setDialog({ kind: 'diverged', cwd: job.cwd, action: job.kind, branch: branchOf(job.cwd) ?? '' });
        setBusy(true);
        void run
            .runMany(jobs, { choose })
            .then(() => refresh())
            .finally(() => setBusy(false));
    };

    const stage = (path: string, paths: string[], staged: boolean): void => {
        if (paths.length === 0) {
            return;
        }
        read.assume(path, (status) => assumeStaged(status, paths, staged));
        setBusy(true);
        void stageFiles(path, paths, staged).finally(() => {
            setBusy(false);
            void refresh(path);
        });
    };

    /* What a toast calls the files it acted on: the path of one, the count of several. */
    const nameOf = (files: readonly GitFile[]): string => (files.length === 1 ? files[0]!.path : t('git.panel.manyFiles', { count: files.length }));

    const discardIn = (path: string, files: GitFile[]): Promise<void> => {
        const name = nameOf(files);
        return perform('git.discard', { repository: path, paths: files.map((file) => file.path) })
            .then(({ stash }) => {
                useToasts.getState().show({
                    title: stash === null ? t('git.panel.discardNothing', { path: name }) : t('git.panel.discardStashed', { path: name }),
                    ...(stash === null ? {} : { description: t('git.panel.discardRestore', { stash }) }),
                    kind: 'success'
                });
            })
            .catch((error: unknown) => {
                const message = messageOf(error, t('error.generic'));
                useToasts.getState().show({ title: t('git.panel.discardFailed'), description: message, kind: 'error', output: message });
            })
            .finally(() => {
                void refresh(path);
            });
    };

    /* A file that was added to the index is taken out of it first, or the index would keep a file that is gone. */
    const deleteIn = (path: string, files: GitFile[]): Promise<void> => {
        const staged = files.filter((file) => file.state === 'staged').map((file) => file.path);
        const unstaged = staged.length > 0 ? perform('git.unstage', { repository: path, paths: staged }) : Promise.resolve();
        return unstaged
            .then(() => perform('file.delete', { paths: files.map((file) => absoluteOf(path, file.path)) }))
            .then(() => {
                useToasts.getState().show({ title: t('git.panel.deleteDone', { path: nameOf(files) }), kind: 'success' });
            })
            .catch((error: unknown) => {
                const message = messageOf(error, t('error.generic'));
                useToasts.getState().show({ title: t('git.panel.deleteFailed'), description: message, kind: 'error', output: message });
            })
            .finally(() => {
                void refresh(path);
            });
    };

    /* A selection can span repositories; each is one request of its own, with a toast of its own. */
    const runWork = (work: readonly GitWork[], step: (path: string, files: GitFile[]) => Promise<void>): void => {
        setDialog(null);
        setBusy(true);
        void Promise.all(work.map(({ cwd: path, files }) => step(path, files))).finally(() => setBusy(false));
    };

    const diffOf = (path: string, file: GitFile): DraggedDiff => {
        // A worktree's own changes are measured against the branch it was made from, not the repository's base.
        const entry = worktrees.find((candidate) => candidate.path === path);
        const base = entry === undefined ? undefined : worktreeBase(entry);
        return {
            path: absoluteOf(path, file.path),
            view: { kind: 'diff', cwd: path, scope, staged: file.state === 'staged', ...(base === undefined ? {} : { base }) }
        };
    };

    const openDiff = (path: string, file: GitFile): void => {
        // A conflict has three versions, so a diff with two sides is the wrong thing to open on it.
        if (file.state === 'conflicted') {
            useUi.getState().setConflicts({ cwd: path, path: file.path });
            return;
        }
        const diff = diffOf(path, file);
        // The list keeps the keyboard, so the next arrow key moves on to the next change.
        useFiles.getState().open(diff.path, tabLimit, diff.view, undefined, { focus: false });
    };

    /* The file next to its diff, for a change a person wants to read whole rather than as a patch. */
    const openFile = (path: string, file: GitFile): void => {
        void perform('file.preview', { path: absoluteOf(path, file.path), line: null }).catch(ignoreRefusal);
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
       leaving it, which pins the folder's repositories over a selection in a worktree. */
    const pickTarget = (next: GitTarget): void => {
        setPicked({ target: next.kind === 'worktree' ? next : null, from: derived.cwd });
    };

    const leaveWorktree = (): void => {
        setPicked({ target: null, from: derived.cwd });
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
        perform('git.log', { repository: path, limit: 1, cursor: null })
            .then((answer) => setDialog({ kind: 'pull-request', cwd: path, subject: answer.commits[0]?.subject ?? '' }))
            .catch(() => setDialog({ kind: 'pull-request', cwd: path, subject: '' }));
    };

    /* One message over every repository that has something staged: one commit each, same words. */
    const commit = (
        message: { subject: string; body: string },
        options: { targets: readonly CommitCandidate[]; stageAll: boolean; push: boolean; amend: boolean }
    ): void => {
        const version = useGit.getState().messageVersions[messageKey] ?? 0;
        const kind: GitActionKind = options.push ? 'commit-push' : 'commit';
        const extra = { subject: message.subject, body: message.body, stageAll: options.stageAll, ...(options.amend ? { amend: true } : {}) };
        const clear = (ok: boolean): void => {
            if (ok) {
                useGit.getState().clearMessage(messageKey, version);
                useGit.getState().setAmend(messageKey, false);
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
    const behind = checkouts.filter((checkout) => (checkout.status?.behind ?? 0) > 0);
    const several = targets.filter((entry) => entry.kind !== 'worktree').length > 1;
    /* The repository the worktrees were made from: the one the project folder itself is. */
    const folderRepo = repos.find((repo) => repo.path === folder)?.label ?? basenameOf(folder);
    const inside = worktree === null ? null : (worktrees.find((entry) => entry.path === worktree.cwd) ?? null);
    const insideNames = inside === null ? '' : nodeNames(nodesInWorktree(projectNodes, inside));

    const refreshAll = (): void => {
        void refresh();
        reloadRepos();
        worktreeLists.reload(endpointId, folder);
    };

    const enterWorktree = (entry: Worktree): void => {
        const next = targets.find((candidate) => candidate.cwd === entry.path);
        if (next) {
            pickTarget(next);
        }
    };

    const worktreeActions: WorktreeActions = {
        onView: viewWorktree,
        onMerge: (entry) => useUi.getState().setWorktreeMerge({ folder, paths: [entry.path] }),
        onRemove: (entry) => useUi.getState().setWorktreeRemoval({ folder, paths: [entry.path] }),
        onReveal: revealNode,
        onInspect: inspection.inspect
    };

    /* The words of a dialog over files: the name of one, the count of several. */
    const filesDialogText = (kind: 'discard' | 'delete-file', key: 'discard' | 'deleteFile'): { title: string; description: string } => {
        const files = dialog?.kind === kind ? filesOf(dialog.work) : null;
        return {
            title:
                files === null
                    ? t(`git.dialog.${key}.fallback`)
                    : files.length > 1
                      ? t(`git.dialog.${key}.titleMany`, { count: files.length })
                      : t(`git.dialog.${key}.title`, { name: basenameOf(files[0]!.path) }),
            description: files !== null && files.length > 1 ? t(`git.dialog.${key}.descriptionMany`) : t(`git.dialog.${key}.description`)
        };
    };

    /* What acts on one repository: the whole actions menu of a folder with a single one, and the head
       of every repository's own level and the menu of its row while it holds more. */
    const repoActions = (path: string): ReactNode => (
        <RepoActionItems
            cwd={path}
            busy={busy}
            canPullRequest={capabilities?.gh === true}
            stashes={refsByCwd[checkoutKey(path)]?.stashes ?? []}
            branch={branchOf(path) ?? ''}
            onAction={(kind, extra) => void act(path, kind, extra)}
            onDialog={setDialog}
            onPullRequest={() => openPullRequest(path)}
            onShowPullRequest={() => useUi.getState().setPullRequestDialog({ cwd: path })}
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
            {/* The panel's name gives way to the chip, which names what the panel shows better than "Git" does. */}
            <PanelHeaderTitleHidden />
            <PanelHeaderLeadingSlot>
                <BranchMenu
                    target={target}
                    targets={targets}
                    branch={status?.branch ?? null}
                    detached={status?.detached ?? false}
                    nested={named}
                    worktree={worktree}
                    worktrees={worktrees}
                    nodes={projectNodes}
                    projectBranch={worktree === null ? (status?.branch ?? null) : null}
                    folderLabel={basenameOf(folder)}
                    projectChanges={worktree === null ? changes : null}
                    worktreeRepo={several ? folderRepo : null}
                    hidden={hiddenRepos.length}
                    busy={busy}
                    worktreeActions={worktreeActions}
                    branches={{
                        refsOf,
                        renderActions: repoActions,
                        onOpen: loadRefs,
                        onCheckout: checkout,
                        onCreate: (path) => setDialog({ kind: 'create-branch', cwd: path })
                    }}
                    onOpenMenu={openBranchMenu}
                    onEnterWorktree={enterWorktree}
                    onLeaveWorktree={leaveWorktree}
                    onShowRepos={() => useGit.getState().setHiddenRepos([])}
                    onMergeWorktrees={() =>
                        useUi.getState().setWorktreeMerge({ folder, paths: worktrees.filter((entry) => entry.missing !== true).map((entry) => entry.path) })
                    }
                />
            </PanelHeaderLeadingSlot>
            <PanelHeaderSlot>
                <PanelHeaderActions>
                    <PushMenu
                        key="push"
                        button={push}
                        active={cwd}
                        entries={entries}
                        busy={busy}
                        onPush={(path, kind) => void actOn(path, kind)}
                        onPushAll={pushAll}
                    />
                    <ActionsMenu
                        key="actions"
                        busy={busy}
                        foldable={changes > 0}
                        onOpen={() => cwd !== null && loadRefs(cwd)}
                        onAll={actAll}
                        onRefresh={refreshAll}
                        onExpandAll={() => useGit.getState().setCollapsedDirs([])}
                        onCollapseAll={() =>
                            useGit.getState().setCollapsedDirs(checkouts.flatMap((checkout) => allCollapseKeys(checkout.status?.files ?? [], checkout.path)))
                        }
                    >
                        {/* One repository keeps the menu it always had; over several, what acts on one
                        of them sits on its row in the list and in its own level of the branch menu. */}
                        {!named && cwd !== null ? repoActions(cwd) : undefined}
                    </ActionsMenu>
                </PanelHeaderActions>
                {/* Outside the groups, since an empty row still counts as one and would leave a line at the end. */}
                {cwd !== null && (
                    <SlotRow
                        place="diffToolbar"
                        context={{ repository: cwd }}
                        wrap={(row) => (
                            <>
                                <Separator />
                                {row}
                            </>
                        )}
                    />
                )}
            </PanelHeaderSlot>
            {worktree !== null && (
                /* While the selection put the panel here, the row says so; the chip's project row leaves. */
                <WorktreeBar
                    label={several ? folderRepo : t('git.worktree.label')}
                    names={insideNames}
                    tooltip={
                        followedNode === null ? (worktree.cwd ?? worktree.label) : t('git.follow.label', { node: followedNode.title || followedNode.kind })
                    }
                    following={followedNode !== null}
                >
                    {inside !== null && (
                        <Button
                            size="xs"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => useUi.getState().setWorktreeMerge({ folder, paths: [inside.path] })}
                        >
                            <Icon icon={GitMerge} size={12} />
                            {t('git.worktree.merge')}
                        </Button>
                    )}
                </WorktreeBar>
            )}
            {failures.map((checkout) => (
                <FormError key={checkout.path} className="border-b border-border px-3 py-2">
                    {named ? `${checkout.label}: ${checkout.failure}` : checkout.failure}
                </FormError>
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
            {/* One notice per repository behind its upstream, each with the sync that brings it level. */}
            {behind.length > 0 && (
                <div className="flex shrink-0 flex-col gap-2 px-2 pt-2">
                    {behind.map((checkout) => {
                        const count = checkout.status?.behind ?? 0;
                        const upstream = checkout.status?.upstream ?? '';
                        return (
                            <Banner
                                key={checkout.path}
                                placement="inline"
                                tone="attention"
                                icon={GitMerge}
                                message={
                                    named
                                        ? t('git.behind.repo', { repo: checkout.label, count, remote: upstream.split('/')[0] })
                                        : t('git.behind.one', { upstream, count })
                                }
                            >
                                <Button size="xs" variant="secondary" disabled={busy} onClick={() => void act(checkout.path, 'sync')}>
                                    {t('git.actions.sync')}
                                </Button>
                            </Banner>
                        );
                    })}
                </div>
            )}
            <div ref={bodyRef} className="flex min-h-0 grow flex-col">
                <GitFileList
                    checkouts={checkouts}
                    collapsed={collapsedDirs}
                    reading={reading}
                    reposTruncated={reposTruncated}
                    busy={busy}
                    onOpen={openDiff}
                    onOpenFile={openFile}
                    onDrag={(path, file, transfer) => startDiffDrag(transfer, diffOf(path, file))}
                    onStage={stage}
                    onDiscard={(work) => setDialog({ kind: 'discard', work })}
                    onDelete={(work) => setDialog({ kind: 'delete-file', work })}
                    {...(named ? { renderRepoActions: repoActions, onRepoMenu: loadRefs } : {})}
                />
                {checkouts.length > 0 && (
                    <CommitBox messageKey={messageKey} checkouts={checkouts} named={named} capabilities={capabilities} busy={busy} onCommit={commit} />
                )}
                {checkouts.length > 0 && (
                    <>
                        <div
                            className="-mb-px h-[5px] shrink-0 cursor-row-resize border-b border-border hover:border-border-strong"
                            onPointerDown={startLogResize}
                        />
                        <div ref={logRef} className="flex shrink-0 flex-col" style={{ height: logHeight }}>
                            <CommitLog sources={sources} filterKey={messageKey} reading={readingCommit} onOpen={openCommit} />
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
                onOpenChange={() => setDialog(null)}
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
                onOpenChange={() => setDialog(null)}
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
                onOpenChange={() => setDialog(null)}
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
                onOpenChange={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'confirm-rebase'}
                title={dialog?.kind === 'confirm-rebase' ? t('git.dialog.rebase.title', { onto: dialog.onto }) : t('git.dialog.rebase.fallback')}
                description={t('git.dialog.rebase.description')}
                confirmLabel={t('git.dialog.rebase.confirm')}
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'confirm-rebase') {
                        void act(dialog.cwd, 'rebase', { ref: dialog.onto });
                    }
                }}
                onOpenChange={() => setDialog(null)}
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
                onOpenChange={() => setDialog(null)}
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
                onOpenChange={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'discard'}
                {...filesDialogText('discard', 'discard')}
                confirmLabel={t('git.dialog.discard.confirm')}
                danger
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'discard') {
                        runWork(dialog.work, discardIn);
                    }
                }}
                onOpenChange={() => setDialog(null)}
            />
            <PromptDialog
                open={dialog?.kind === 'delete-file'}
                {...filesDialogText('delete-file', 'deleteFile')}
                confirmLabel={t('git.dialog.deleteFile.confirm')}
                danger
                busy={busy}
                onConfirm={() => {
                    if (dialog?.kind === 'delete-file') {
                        runWork(dialog.work, deleteIn);
                    }
                }}
                onOpenChange={() => setDialog(null)}
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
                                    result.url === undefined ? undefined : { label: t('common:action.open'), run: () => openInSystemBrowser(result.url ?? '') }
                            }
                        );
                    }
                }}
                onOpenChange={() => setDialog(null)}
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
                loading={dialog?.kind === 'pick-branch' && refsOf(dialog.cwd).loading}
                error={dialog?.kind === 'pick-branch' ? refsOf(dialog.cwd).error : null}
                onRetry={dialog?.kind === 'pick-branch' ? refsOf(dialog.cwd).retry : undefined}
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
                    if (dialog.action === 'rebase') {
                        setDialog({ kind: 'confirm-rebase', cwd: dialog.cwd, onto: name });
                        return;
                    }
                    void act(dialog.cwd, dialog.action, { ref: name });
                }}
                onClose={() => setDialog(null)}
            />
            <GitChoice
                open={dialog?.kind === 'pick-stash'}
                loading={dialog?.kind === 'pick-stash' && refsOf(dialog.cwd).loading}
                error={dialog?.kind === 'pick-stash' ? refsOf(dialog.cwd).error : null}
                onRetry={dialog?.kind === 'pick-stash' ? refsOf(dialog.cwd).retry : undefined}
                title={t('git.dialog.popStash.title')}
                description={t('git.dialog.popStash.description')}
                choices={(dialog?.kind === 'pick-stash' ? (refsByCwd[checkoutKey(dialog.cwd)]?.stashes ?? []) : []).map((stash) => ({
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
            <WorktreeInspectDialog
                inspected={inspection.inspected}
                onClose={inspection.close}
                onRemove={(entry) => useUi.getState().setWorktreeRemoval({ folder, paths: [entry.path] })}
            />
        </div>
    );
}

/* The branches a pick offers: everything but the one that is out, and only local ones to delete. */
function pickableBranches(dialog: Dialog | null, state: CheckoutRefs | null): Choice[] {
    if (dialog?.kind !== 'pick-branch' || state === null) {
        return [];
    }
    const source = dialog.action === 'delete-branch' ? state.refs.filter((ref) => ref.kind === 'local') : state.refs;
    return source
        .filter((ref) => !ref.current && ref.name !== state.branch)
        .map((ref) => ({ value: ref.name, label: ref.name, ...(ref.isDefault ? { hint: i18next.t('panels:git.branchMenu.default') } : {}) }));
}

interface ActionsMenuProps {
    busy: boolean;
    /* Whether the list has folders to fold, which is when expanding and collapsing all of them mean something. */
    foldable: boolean;
    onOpen(): void;
    /* Fetch, pull and push over every repository the folder holds. */
    onAll(kind: GitActionKind): void;
    /* Reads every status, the repositories and the worktrees again. */
    onRefresh(): void;
    onExpandAll(): void;
    onCollapseAll(): void;
    /* What acts on one repository, which a folder with a single one has right here. */
    children?: ReactNode;
}

/*
 * Everything that is not the push button next to it. A folder with a single repository has the menu it
 * always had; over several, the three that make sense for the whole folder stay here and everything
 * that names one repository sits on that repository's row and in its own level of the branch menu.
 */
function ActionsMenu({ busy, foldable, onOpen, onAll, onRefresh, onExpandAll, onCollapseAll, children }: ActionsMenuProps) {
    const { t } = useTranslation('panels');
    return (
        <Menu.Root onOpenChange={(open) => open && onOpen()}>
            <IconButton icon={MoreHorizontal} label={t('git.actions.more')} render={<Menu.Trigger />} disabled={busy} />
            <Menu.Popup align="end">
                {children ?? (
                    <>
                        <Menu.Item onClick={() => onAll('pull')}>{t('git.actions.pullAll')}</Menu.Item>
                        <Menu.Item onClick={() => onAll('sync')}>
                            {t('git.actions.syncAll')}
                            <Menu.Hint>{t('git.actions.syncHint')}</Menu.Hint>
                        </Menu.Item>
                        <Menu.Item onClick={() => onAll('fetch')}>{t('git.actions.fetchAll')}</Menu.Item>
                    </>
                )}
                {foldable && (
                    <>
                        <Menu.Separator />
                        <Menu.Item onClick={onExpandAll}>
                            <Icon icon={ChevronsUpDown} size={14} /> {t('git.panel.expandAll')}
                        </Menu.Item>
                        <Menu.Item onClick={onCollapseAll}>
                            <Icon icon={ChevronsDownUp} size={14} /> {t('git.panel.collapseAll')}
                        </Menu.Item>
                    </>
                )}
                <Menu.Separator />
                <Menu.Item onClick={onRefresh}>
                    <Icon icon={RefreshCw} size={14} /> {t('file.menu.refresh')}
                </Menu.Item>
            </Menu.Popup>
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
    onAction(kind: GitActionKind, extra?: { ref: string }): void;
    onDialog(dialog: Dialog): void;
    onPullRequest(): void;
    onShowPullRequest(): void;
}

/* Everything that acts on one repository: what a person reaches for most at the top, a force push apart at the bottom. */
function RepoActionItems({ cwd, busy, canPullRequest, stashes, branch, onAction, onDialog, onPullRequest, onShowPullRequest }: RepoActionItemsProps) {
    const { t } = useTranslation('panels');
    const popStash = (): void => {
        const step = popStashStep(stashes);
        if (step?.kind === 'pick') {
            onDialog({ kind: 'pick-stash', cwd });
        } else if (step?.kind === 'pop') {
            onAction('stash-pop', { ref: step.ref });
        }
    };
    return (
        <>
            <Menu.Item disabled={busy} onClick={() => onAction('pull')}>
                {t('git.actions.pull')}
            </Menu.Item>
            <Menu.Item disabled={busy} onClick={() => onAction('push')}>
                {t('git.actions.push')}
            </Menu.Item>
            <Menu.Item disabled={busy} onClick={() => onAction('sync')}>
                {t('git.actions.sync')}
                <Menu.Hint>{t('git.actions.syncHint')}</Menu.Hint>
            </Menu.Item>
            <Menu.Item disabled={busy} onClick={() => onAction('fetch')}>
                {t('git.actions.fetch')}
            </Menu.Item>
            <Menu.Separator />
            <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger disabled={busy}>
                    <Icon icon={GitBranch} size={14} /> {t('git.actions.branchGroup')}
                </Menu.SubmenuTrigger>
                <Menu.Popup>
                    <Menu.Item disabled={busy} onClick={() => onDialog({ kind: 'pick-branch', cwd, action: 'merge' })}>
                        {t('git.actions.merge')}
                    </Menu.Item>
                    <Menu.Item disabled={busy} onClick={() => onDialog({ kind: 'pick-branch', cwd, action: 'rebase' })}>
                        {t('git.actions.rebase')}
                    </Menu.Item>
                    <Menu.Item disabled={busy} onClick={() => onDialog({ kind: 'rename-branch', cwd, branch })}>
                        {t('git.actions.renameBranch')}
                    </Menu.Item>
                    <Menu.Separator />
                    <Menu.Item className="text-status-error" disabled={busy} onClick={() => onDialog({ kind: 'pick-branch', cwd, action: 'delete-branch' })}>
                        {t('git.actions.deleteBranch')}
                    </Menu.Item>
                </Menu.Popup>
            </Menu.SubmenuRoot>
            <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger disabled={busy}>
                    <Icon icon={Archive} size={14} /> {t('git.actions.stashGroup')}
                </Menu.SubmenuTrigger>
                <Menu.Popup>
                    <Menu.Item disabled={busy} onClick={() => onDialog({ kind: 'stash', cwd })}>
                        {t('git.actions.stash')}
                    </Menu.Item>
                    <Menu.Item disabled={busy || stashes.length === 0} onClick={popStash}>
                        {t('git.actions.popStash')}
                        {stashes.length > 1 && <Menu.Hint>{stashes.length}</Menu.Hint>}
                    </Menu.Item>
                </Menu.Popup>
            </Menu.SubmenuRoot>
            {canPullRequest && (
                <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger disabled={busy}>
                        <Icon icon={GitPullRequest} size={14} /> {t('git.actions.pullRequestGroup')}
                    </Menu.SubmenuTrigger>
                    <Menu.Popup>
                        <Menu.Item disabled={busy} onClick={onPullRequest}>
                            {t('git.actions.pullRequest')}
                        </Menu.Item>
                        <Menu.Item disabled={busy} onClick={onShowPullRequest}>
                            {t('git.actions.showPullRequest')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.SubmenuRoot>
            )}
            <Menu.Separator />
            <Menu.Item disabled={busy} onClick={() => onDialog({ kind: 'force-push', cwd })}>
                {t('git.actions.forcePush')}
            </Menu.Item>
        </>
    );
}
