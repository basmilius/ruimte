import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronRight, GitBranch, Plus, Search } from 'lucide-react';
import type { GitRef } from '@ruimte/contracts';
import { basenameOf } from '@/shell/panels/files-tree';
import type { GitTarget } from '@/state/git-target';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { MenuPopup } from '@/ui/MenuPopup';

// The keys the menu itself owns while the field has focus; every other key is the field's.
const MENU_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Escape', 'Tab', 'Enter']);

/* What is known of one checkout's branches, and whether they are still on their way. */
export interface CheckoutRefs {
    refs: readonly GitRef[];
    loading: boolean;
    /* The branch that checkout's HEAD is on, for the hint on its row before its branches are in. */
    branch: string | null;
}

interface BranchMenuProps {
    /* The checkout the panel is on, and the ones it could be on instead. */
    target: GitTarget;
    targets: readonly GitTarget[];
    /* What the chip says: the branch HEAD is on, or the state that is not a branch. */
    branch: string | null;
    detached: boolean;
    /* True while the folder holds more than one repository. The branches then sit one level in, per
       checkout, because `main` says nothing about which of a folder's repositories is on it. */
    nested: boolean;
    refsOf(cwd: string): CheckoutRefs;
    /* What one checkout can be told to do, drawn into its own level. The panel owns these, because
       half of them open a dialog it holds. */
    renderActions(cwd: string): ReactNode;
    /* The chip was opened; the worktrees beside the repositories are read again then. */
    onOpenMenu(): void;
    /* Reads the branches of a checkout, which is what opening its level asks for. */
    onOpen(cwd: string): void;
    onPickTarget(target: GitTarget): void;
    onCheckout(cwd: string, ref: GitRef): void;
    onCreate(cwd: string): void;
}

/* Which checkout the branch is in, when it is not simply the project folder: the worktree, named
   after the group that binds it since that says more than its path does, or the repository, since a
   branch called `main` says nothing about which of a folder's repositories is on it. */
const prefixOf = (target: GitTarget): string | null => {
    if (target.cwd === null) {
        return null;
    }
    if (target.kind === 'repo') {
        return target.label;
    }
    return target.kind === 'worktree' ? (target.group ?? basenameOf(target.cwd)) : null;
};

export function BranchMenu({
    target,
    targets,
    branch,
    detached,
    nested,
    refsOf,
    renderActions,
    onOpenMenu,
    onOpen,
    onPickTarget,
    onCheckout,
    onCreate
}: BranchMenuProps) {
    const { t } = useTranslation('panels');

    const label = detached ? t('git.branchMenu.detached') : (branch ?? target.label);
    const prefix = prefixOf(target);
    /* A repository is a section of the panel and a worktree is a place it goes instead, so the two
       are offered apart: a repository opens what can be done to it, a worktree takes the panel over. */
    const repos = targets.filter((entry) => entry.kind !== 'worktree');
    const worktrees = targets.filter((entry) => entry.kind === 'worktree');

    return (
        <Menu.Root
            onOpenChange={(open) => {
                if (!open) {
                    return;
                }
                onOpenMenu();
                // A flat menu shows the branches at once, so they are read the moment it opens.
                if (!nested && target.cwd !== null) {
                    onOpen(target.cwd);
                }
            }}
        >
            <Tooltip
                label={
                    nested
                        ? t('git.branchMenu.tooltipRepos', { count: targets.length })
                        : prefix === null
                          ? t('git.branchMenu.tooltip')
                          : t('git.branchMenu.tooltipWorktree', { branch: label, worktree: prefix })
                }
                name={nested}
            >
                <Menu.Trigger className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-full bg-surface-sunken px-2 text-xs text-text-muted hover:text-text">
                    <Icon icon={GitBranch} size={12} className="shrink-0" />
                    {/* Over several repositories no single branch is the one the panel is on, so the chip
                        says none rather than one that happens to be first. */}
                    {!nested && (
                        <>
                            {prefix !== null && <span className="max-w-24 truncate text-text-faint">{prefix}</span>}
                            <span className="truncate font-mono">{label}</span>
                        </>
                    )}
                    <Icon icon={ChevronDown} size={12} className="shrink-0" />
                </Menu.Trigger>
            </Tooltip>
            <MenuPopup className={nested ? 'max-h-[32rem] w-80 overflow-y-auto' : 'max-h-96 w-80 overflow-y-auto'}>
                {targets.length === 0 && (
                    <Menu.Item className="menu-item" disabled>
                        {t('git.branchMenu.noCheckouts')}
                    </Menu.Item>
                )}
                {nested ? (
                    <>
                        <div className={MENU_LABEL}>{t('git.branchMenu.repositories')}</div>
                        {repos.map((entry) => (
                            <CheckoutLevel
                                key={entry.cwd ?? entry.label}
                                entry={entry}
                                refs={entry.cwd === null ? { refs: [], loading: false, branch: null } : refsOf(entry.cwd)}
                                renderActions={renderActions}
                                onOpen={onOpen}
                                onCheckout={onCheckout}
                                onCreate={onCreate}
                            />
                        ))}
                    </>
                ) : (
                    <>
                        <div className={MENU_LABEL}>{t('git.branchMenu.checkout')}</div>
                        <CheckoutChoice targets={targets} target={target} onPickTarget={onPickTarget} />
                        {target.cwd !== null && (
                            <>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <BranchList cwd={target.cwd} state={refsOf(target.cwd)} branch={branch} onCheckout={onCheckout} onCreate={onCreate} />
                            </>
                        )}
                    </>
                )}
                {nested && worktrees.length > 0 && (
                    <>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <div className={MENU_LABEL}>{t('git.branchMenu.worktrees')}</div>
                        {/* A worktree takes the panel over whole, the way it always did: its repositories
                            step aside until the canvas or this menu points somewhere else. */}
                        <CheckoutChoice targets={worktrees} target={target} onPickTarget={onPickTarget} />
                    </>
                )}
            </MenuPopup>
        </Menu.Root>
    );
}

/* The checkouts the panel can be pointed at, with the one it is on marked. */
function CheckoutChoice({ targets, target, onPickTarget }: { targets: readonly GitTarget[]; target: GitTarget; onPickTarget(target: GitTarget): void }) {
    return (
        <Menu.RadioGroup
            value={target.cwd ?? ''}
            onValueChange={(value: string) => {
                const picked = targets.find((entry) => entry.cwd === value);
                if (picked) {
                    onPickTarget(picked);
                }
            }}
        >
            {targets.map((entry) => (
                <Menu.RadioItem key={entry.cwd ?? entry.label} value={entry.cwd ?? ''} className="menu-item">
                    <span className="grid h-5 w-4 shrink-0 place-items-center">
                        <Menu.RadioItemIndicator>
                            <Icon icon={Check} size={14} />
                        </Menu.RadioItemIndicator>
                    </span>
                    <span className="truncate">{entry.label}</span>
                    {entry.group !== undefined && <span className={`${MENU_HINT} truncate`}>{entry.group}</span>}
                </Menu.RadioItem>
            ))}
        </Menu.RadioGroup>
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
            <Menu.SubmenuTrigger className="menu-item">
                {/* The name keeps its width and the branch beside it gives way: a repository cut to two
                    letters is no longer a name, while a branch cut short still reads as one. */}
                <span className="max-w-40 shrink-0 truncate">{entry.label}</span>
                <span className="grow" />
                {entry.group !== undefined && <span className={`${MENU_HINT} truncate`}>{entry.group}</span>}
                {refs.branch !== null && <span className="min-w-0 truncate pl-3 font-mono text-code text-text-faint">{refs.branch}</span>}
                <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                    <Menu.Popup className="menu-popup max-h-[28rem] w-80 overflow-y-auto">
                        {renderActions(cwd)}
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <BranchList cwd={cwd} state={refs} branch={refs.branch} onCheckout={onCheckout} onCreate={onCreate} />
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
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

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle === '' ? refs : refs.filter((ref) => ref.name.toLowerCase().includes(needle));
    }, [refs, query]);

    const current = refs.find((ref) => ref.current)?.name ?? branch ?? '';

    return (
        <>
            <div className="mx-1 my-1 flex items-center gap-1">
                <div className="flex min-w-0 grow items-center gap-2 rounded-lg border border-border px-2.5">
                    <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                    <input
                        ref={inputRef}
                        className="h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
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
                </div>
                {/* An item and not a plain button, so it keeps the keyboard and the closing a menu row has. */}
                <Tooltip label={t('git.branchMenu.create')} name>
                    <Menu.Item className="icon-btn h-8 w-8" onClick={() => onCreate(cwd)}>
                        <Icon icon={Plus} size={14} />
                    </Menu.Item>
                </Tooltip>
            </div>
            {loading && <p className="px-3 py-2 text-xs text-text-faint">{t('git.branchMenu.loading')}</p>}
            {!loading && shown.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">{t('git.branchMenu.noMatch')}</p>}
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
                    <Menu.RadioItem
                        key={`${ref.kind}:${ref.name}`}
                        value={ref.name}
                        disabled={ref.worktree !== undefined}
                        className={clsx('menu-item', ref.worktree !== undefined && 'opacity-45')}
                    >
                        <span className="grid h-5 w-4 shrink-0 place-items-center">
                            <Menu.RadioItemIndicator>
                                <Icon icon={Check} size={14} />
                            </Menu.RadioItemIndicator>
                        </span>
                        <span className="truncate font-mono text-xs">{ref.name}</span>
                        {ref.isDefault && <span className={MENU_HINT}>{t('git.branchMenu.default')}</span>}
                        {ref.worktree !== undefined && <span className={`${MENU_HINT} truncate`}>{t('git.branchMenu.inWorktree')}</span>}
                    </Menu.RadioItem>
                ))}
            </Menu.RadioGroup>
        </>
    );
}
