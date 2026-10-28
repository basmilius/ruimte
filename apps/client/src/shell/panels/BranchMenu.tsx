import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Copy, Eye, Folders, GitBranch, GitFork, GitMerge, Plus, Search } from 'lucide-react';
import type { GitRef, Worktree } from '@ruimte/contracts';
import { basenameOf } from '@/shell/panels/files-tree';
import { WorktreeRows, type WorktreeActions } from '@/shell/panels/WorktreeMenu';
import type { GitTarget } from '@/state/git-target';
import type { WorktreeNode } from '@/state/worktrees';
import { copyText, cameThroughPortal, Button, Icon, IconButton, Input, Menu, Tooltip, ContextMenu } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';

// The keys the menu itself owns while the field has focus; every other key is the field's.
const MENU_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Escape', 'Tab', 'Enter']);

/* What is known of one checkout's branches, and whether they are still on their way. */
export interface CheckoutRefs {
    refs: readonly GitRef[];
    loading: boolean;
    error?: string | null;
    retry?(): void;
    /* The branch that checkout's HEAD is on, for the hint on its row before its branches are in. */
    branch: string | null;
}

/* What the picker offers past choosing a place: the branches one level in, and what acts on one checkout. */
interface BranchActions {
    refsOf(cwd: string): CheckoutRefs;
    /* What one checkout can be told to do, drawn into its own level. The panel owns these, because
       half of them open a dialog it holds. */
    renderActions(cwd: string): ReactNode;
    /* Reads the branches of a checkout, which is what opening its level asks for. */
    onOpen(cwd: string): void;
    onCheckout(cwd: string, ref: GitRef): void;
    onCreate(cwd: string): void;
}

interface BranchMenuProps {
    /* The checkout a panel of one checkout is on; over several repositories, the project folder. */
    target: GitTarget;
    targets: readonly GitTarget[];
    /* What the chip says: the branch HEAD is on, or the state that is not a branch. */
    branch: string | null;
    detached: boolean;
    /* True while the panel shows more than one repository. The branches then sit one level further
       in, per checkout, because `main` says nothing about which of a folder's repositories is on it. */
    nested: boolean;
    /* The worktree the panel is in, or null while it shows the project. */
    worktree: GitTarget | null;
    worktrees: readonly Worktree[];
    nodes: readonly WorktreeNode[];
    /* What the project row says while the project has one repository: its branch, once read, and its folder. */
    projectBranch: string | null;
    folderLabel: string;
    /* The changes of the project, while the panel shows them; null inside a worktree, where they are not read. */
    projectChanges: number | null;
    /* The repository the worktrees were made from, named on their rows while the project holds several. */
    worktreeRepo: string | null;
    /* How many repositories of the folder a person folded away. */
    hidden?: number;
    busy: boolean;
    /* Without these a worktree's row only enters it. */
    worktreeActions?: WorktreeActions;
    /* Without these the picker only chooses where the panel stands. */
    branches?: BranchActions;
    /* The chip was opened; the worktrees beside the repositories are read again then. */
    onOpenMenu(): void;
    onEnterWorktree(worktree: Worktree): void;
    onLeaveWorktree(): void;
    onShowRepos?(): void;
    onMergeWorktrees?(): void;
}

/* Which worktree the branch is in, named after the group that binds it since that says more than its path does. */
function prefixOf(target: GitTarget): string | null {
    if (target.cwd === null || target.kind !== 'worktree') {
        return null;
    }
    return target.group ?? basenameOf(target.cwd);
}

/*
 * The chip at the start of the panel's header and the picker behind it: the project, the worktrees
 * the panel can go into instead, and the branches one level in. A repository is a section of the panel
 * and a worktree is a place it goes instead, so the two are offered apart.
 */
export function BranchMenu({
    target,
    targets,
    branch,
    detached,
    nested,
    worktree,
    worktrees,
    nodes,
    projectBranch,
    folderLabel,
    projectChanges,
    worktreeRepo,
    hidden = 0,
    busy,
    worktreeActions,
    branches,
    onOpenMenu,
    onEnterWorktree,
    onLeaveWorktree,
    onShowRepos,
    onMergeWorktrees
}: BranchMenuProps) {
    const { t } = useTranslation('panels');

    const label = detached ? t('git.branchMenu.detached') : (branch ?? target.label);
    const prefix = prefixOf(target);
    const repos = targets.filter((entry) => entry.kind !== 'worktree');
    const several = repos.length > 1;
    const mergeable = worktrees.filter((entry) => entry.missing !== true);
    const showRepos = several && hidden > 0 && onShowRepos !== undefined;
    const mergeWorktrees = !several && mergeable.length > 0 && onMergeWorktrees !== undefined;

    /* Only a branch has a name to take along; a detached HEAD and a chip over several repositories name none. */
    const copyable = !nested && !detached && branch !== null ? branch : null;

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                className="contents"
                onContextMenu={(event) => {
                    if (copyable === null || cameThroughPortal(event)) {
                        event.preventBaseUIHandler();
                    }
                }}
            >
                <Menu.Root onOpenChange={(open) => open && onOpenMenu()}>
                    <Tooltip
                        label={
                            nested
                                ? t('git.branchMenu.tooltipRepos', { count: repos.length })
                                : prefix === null
                                  ? t('git.branchMenu.tooltip')
                                  : t('git.branchMenu.tooltipWorktree', { branch: label, worktree: prefix })
                        }
                        name={nested}
                    >
                        <Menu.Trigger render={<Button size="xs" variant="ghost" className="min-w-0 shrink!" />}>
                            {nested ? (
                                <>
                                    <Icon icon={Folders} size={12} className="shrink-0" />
                                    <span className="truncate">{t('git.branchMenu.chipRepos', { count: repos.length })}</span>
                                </>
                            ) : (
                                <>
                                    <Icon icon={worktree === null ? GitBranch : GitFork} size={12} className="shrink-0" />
                                    <span className="truncate font-mono">{label}</span>
                                </>
                            )}
                            <Icon icon={ChevronDown} size={12} className="shrink-0" />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Popup className="max-h-[32rem] w-80 overflow-y-auto">
                        <Menu.Group>
                            <Menu.GroupLabel>{several ? t('git.branchMenu.project') : t('git.branchMenu.folder')}</Menu.GroupLabel>
                            <Menu.Item onClick={onLeaveWorktree}>
                                <Icon icon={several ? Folders : GitBranch} size={14} className="shrink-0 text-text-muted" />
                                {several ? (
                                    <span className="min-w-0 grow truncate">{t('git.branchMenu.chipRepos', { count: repos.length })}</span>
                                ) : projectBranch === null ? (
                                    <span className="min-w-0 grow truncate">{folderLabel}</span>
                                ) : (
                                    <span className="min-w-0 grow truncate font-mono text-xs">{projectBranch}</span>
                                )}
                                {projectChanges !== null && projectChanges > 0 && (
                                    <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatNumber(projectChanges)}</span>
                                )}
                                {worktree === null && <Menu.Check kind="radio" checked />}
                            </Menu.Item>
                        </Menu.Group>
                        {worktrees.length > 0 && (
                            <>
                                <Menu.Separator />
                                <Menu.Group>
                                    <Menu.GroupLabel>{t('git.branchMenu.worktrees')}</Menu.GroupLabel>
                                    <WorktreeRows
                                        worktrees={worktrees}
                                        nodes={nodes}
                                        current={worktree?.cwd ?? null}
                                        repo={worktreeRepo}
                                        busy={busy}
                                        actions={worktreeActions}
                                        onEnter={onEnterWorktree}
                                    />
                                </Menu.Group>
                            </>
                        )}
                        {branches !== undefined && nested && (
                            <>
                                <Menu.Separator />
                                <Menu.Group>
                                    <Menu.GroupLabel>{t('git.branchMenu.repositories')}</Menu.GroupLabel>
                                    {repos.map((entry) => (
                                        <CheckoutLevel
                                            key={entry.cwd ?? entry.label}
                                            entry={entry}
                                            refs={entry.cwd === null ? { refs: [], loading: false, branch: null } : branches.refsOf(entry.cwd)}
                                            renderActions={branches.renderActions}
                                            onOpen={branches.onOpen}
                                            onCheckout={branches.onCheckout}
                                            onCreate={branches.onCreate}
                                        />
                                    ))}
                                </Menu.Group>
                            </>
                        )}
                        {((branches !== undefined && !nested) || showRepos || mergeWorktrees) && <Menu.Separator />}
                        {branches !== undefined && !nested && target.cwd !== null && (
                            <BranchLevel
                                cwd={target.cwd}
                                refs={branches.refsOf(target.cwd)}
                                branch={branch}
                                onOpen={branches.onOpen}
                                onCheckout={branches.onCheckout}
                                onCreate={branches.onCreate}
                            />
                        )}
                        {showRepos && (
                            <Menu.Item onClick={onShowRepos}>
                                <Icon icon={Eye} size={14} /> {t('git.repo.showAll', { count: hidden })}
                            </Menu.Item>
                        )}
                        {mergeWorktrees && (
                            <Menu.Item disabled={busy} onClick={onMergeWorktrees}>
                                <Icon icon={GitMerge} size={14} /> {t('git.branchMenu.mergeWorktrees')}
                            </Menu.Item>
                        )}
                    </Menu.Popup>
                </Menu.Root>
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                <ContextMenu.Item onClick={() => copyText(copyable ?? '')}>
                    <Icon icon={Copy} size={14} /> {t('git.branchMenu.copyName')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

interface BranchLevelProps {
    cwd: string;
    refs: CheckoutRefs;
    branch: string | null;
    onOpen(cwd: string): void;
    onCheckout(cwd: string, ref: GitRef): void;
    onCreate(cwd: string): void;
}

/* The branches of the one checkout the panel shows, read when their level opens. */
function BranchLevel({ cwd, refs, branch, onOpen, onCheckout, onCreate }: BranchLevelProps) {
    const { t } = useTranslation('panels');
    return (
        <Menu.SubmenuRoot onOpenChange={(open) => open && onOpen(cwd)}>
            <Menu.SubmenuTrigger>
                <Icon icon={GitBranch} size={14} /> {t('git.branchMenu.switch')}
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-h-96 w-80 overflow-y-auto">
                <BranchList cwd={cwd} state={refs} branch={branch} onCheckout={onCheckout} onCreate={onCreate} />
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

interface LevelProps {
    entry: GitTarget;
    refs: CheckoutRefs;
    renderActions(cwd: string): ReactNode;
    onOpen(cwd: string): void;
    onCheckout(cwd: string, ref: GitRef): void;
    onCreate(cwd: string): void;
}

/*
 * One checkout as a level of its own: its name and the branch it is on, and behind it everything that
 * acts on that one repository. The branches are read when the level opens and not before, so a folder
 * of nine repositories costs nine `git.refs` calls only if a person walks all nine.
 */
function CheckoutLevel({ entry, refs, renderActions, onOpen, onCheckout, onCreate }: LevelProps) {
    const cwd = entry.cwd;
    if (cwd === null) {
        return null;
    }
    return (
        <Menu.SubmenuRoot onOpenChange={(open) => open && onOpen(cwd)}>
            <Menu.SubmenuTrigger>
                {/* The name keeps its width and the branch beside it gives way: a repository cut to two
                    letters is no longer a name, while a branch cut short still reads as one. */}
                <span className="max-w-40 shrink-0 truncate">{entry.label}</span>
                <span className="grow" />
                {entry.group !== undefined && <Menu.Hint className="truncate">{entry.group}</Menu.Hint>}
                {refs.branch !== null && <span className="min-w-0 truncate pl-3 font-mono text-code text-text-faint">{refs.branch}</span>}
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-h-[28rem] w-80 overflow-y-auto">
                {renderActions(cwd)}
                <Menu.Separator />
                <BranchList cwd={cwd} state={refs} branch={refs.branch} onCheckout={onCheckout} onCreate={onCreate} />
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

interface BranchListProps {
    cwd: string;
    state: CheckoutRefs;
    /* What HEAD is on, for a list whose refs are not in yet. */
    branch: string | null;
    onCheckout(cwd: string, ref: GitRef): void;
    onCreate(cwd: string): void;
}

/* The branches of one checkout, with the one that is out marked, the field that finds one among
   many and the button that makes a new one. A branch another worktree has out cannot be checked
   out here. */
function BranchList({ cwd, state, branch, onCheckout, onCreate }: BranchListProps) {
    const { t } = useTranslation('panels');
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const { refs, loading } = state;

    const needle = query.trim().toLowerCase();
    const shown = needle === '' ? refs : refs.filter((ref) => ref.name.toLowerCase().includes(needle));

    const current = refs.find((ref) => ref.current)?.name ?? branch ?? '';

    return (
        <>
            <div className="mx-1 my-1 flex items-center gap-1">
                <span className="relative min-w-0 grow">
                    <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" aria-hidden />
                    <Input
                        ref={inputRef}
                        className="pl-8"
                        placeholder={t('git.branchMenu.search')}
                        spellCheck={false}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        /* A menu types to jump to a row; while this field has focus the letters
                           belong to it, and only the keys that move or close the menu are passed on. */
                        onKeyDown={(event) => {
                            if (!MENU_KEYS.has(event.key)) {
                                event.stopPropagation();
                            }
                        }}
                    />
                </span>
                {/* An item and not a plain button, so it keeps the keyboard and the closing a menu row has. */}
                <IconButton icon={Plus} label={t('git.branchMenu.create')} render={<Menu.Item unstyled />} onClick={() => onCreate(cwd)} />
            </div>
            {loading && <p className="px-3 py-2 text-xs text-text-faint">{t('git.branchMenu.loading')}</p>}
            {state.error && (
                <>
                    <p className="px-3 py-2 text-xs text-status-error">{t('git.branchMenu.failed', { reason: state.error })}</p>
                    <Menu.Item onClick={state.retry}>{t('common:action.retry')}</Menu.Item>
                </>
            )}
            {!loading && !state.error && shown.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">{t('git.branchMenu.noMatch')}</p>}
            <Menu.RadioGroup
                value={current}
                onValueChange={(value: string) => {
                    const picked = refs.find((ref) => ref.name === value);
                    if (picked && !picked.current) {
                        onCheckout(cwd, picked);
                    }
                }}
            >
                {shown.map((ref) => (
                    <Menu.RadioItem key={`${ref.kind}:${ref.name}`} value={ref.name} disabled={ref.worktree !== undefined}>
                        <span className="truncate font-mono text-xs">{ref.name}</span>
                        {ref.isDefault && <Menu.Hint>{t('git.branchMenu.default')}</Menu.Hint>}
                        {ref.worktree !== undefined && <Menu.Hint className="truncate">{t('git.branchMenu.inWorktree')}</Menu.Hint>}
                    </Menu.RadioItem>
                ))}
            </Menu.RadioGroup>
        </>
    );
}
