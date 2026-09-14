import { useMemo, useRef, useState } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import { Check, ChevronDown, GitBranch, Plus, Search } from 'lucide-react';
import type { GitRef } from '@ruimte/contracts';
import { basenameOf } from '@/shell/panels/files-tree';
import type { GitTarget } from '@/state/git-target';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// Under this many branches a field on top of the list costs more than it finds.
const FILTER_FROM = 10;

// The keys the menu itself owns while the field has focus; every other key is the field's.
const MENU_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Escape', 'Tab', 'Enter']);

interface BranchMenuProps {
    /* The checkout the panel is on, and the ones it could be on instead. */
    target: GitTarget;
    targets: readonly GitTarget[];
    /* What the chip says: the branch HEAD is on, or the state that is not a branch. */
    branch: string | null;
    detached: boolean;
    refs: readonly GitRef[];
    loading: boolean;
    onOpen(): void;
    onPickTarget(target: GitTarget): void;
    onCheckout(ref: GitRef): void;
    onCreate(): void;
}

/* Which worktree the branch is in, when it is not the project folder. The group that binds it says
   more than its path does, so that is the name it goes by. */
const prefixOf = (target: GitTarget): string | null => {
    if (target.kind !== 'worktree' || target.cwd === null) {
        return null;
    }
    return target.group ?? basenameOf(target.cwd);
};

/*
 * One chip for the checkout and the branch, because they are one question: which working tree is on
 * screen, and where is it. The menu answers it in two sections, the checkouts the panel can be
 * pointed at and the branches this one can be put on. Both are radio groups, so the row that is
 * already picked is a row like the others, with the same hover and the same check.
 *
 * Local branches first, then the remote ones, newest tip first the way the daemon sorted them; a
 * branch another worktree has out cannot be checked out here, so the row says so instead of failing.
 */
export function BranchMenu({ target, targets, branch, detached, refs, loading, onOpen, onPickTarget, onCheckout, onCreate }: BranchMenuProps) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle === '' ? refs : refs.filter((ref) => ref.name.toLowerCase().includes(needle));
    }, [refs, query]);

    const label = detached ? 'detached' : (branch ?? target.label);
    const prefix = prefixOf(target);
    const current = refs.find((ref) => ref.current)?.name ?? branch ?? '';

    return (
        <Menu.Root
            onOpenChange={(open) => {
                if (open) {
                    setQuery('');
                    onOpen();
                }
            }}
        >
            <Tooltip label={prefix === null ? 'The branch this checkout is on' : `${label}, in the worktree ${prefix}`}>
                <Menu.Trigger className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-full bg-surface-sunken px-2 text-xs text-text-muted hover:text-text">
                    <Icon icon={GitBranch} size={12} className="shrink-0" />
                    {prefix !== null && <span className="max-w-24 truncate text-text-faint">{prefix}</span>}
                    <span className="truncate font-mono">{label}</span>
                    <Icon icon={ChevronDown} size={12} className="shrink-0" />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" align="start" sideOffset={6}>
                    <Menu.Popup className="menu-popup max-h-96 w-80 overflow-y-auto">
                        <div className={MENU_LABEL}>Checkout</div>
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
                            {targets.length === 0 && (
                                <Menu.Item className="menu-item" disabled>
                                    No checkouts
                                </Menu.Item>
                            )}
                        </Menu.RadioGroup>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <div className={MENU_LABEL}>Branches</div>
                        <Menu.Item className="menu-item" onClick={onCreate}>
                            <Icon icon={Plus} size={14} />
                            Create branch...
                        </Menu.Item>
                        {refs.length > FILTER_FROM && (
                            <div className="mx-1 my-1 flex items-center gap-2 rounded-lg border border-border px-2.5">
                                <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                                <input
                                    ref={inputRef}
                                    className="h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                                    placeholder="Search branches"
                                    spellCheck={false}
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    /* A menu types to jump to a row; while this field has focus the
                                       letters belong to it, and only the keys that move or close
                                       the menu are passed on. */
                                    onKeyDown={(event) => {
                                        if (!MENU_KEYS.has(event.key)) {
                                            event.stopPropagation();
                                        }
                                    }}
                                />
                            </div>
                        )}
                        {loading && <p className="px-3 py-2 text-xs text-text-faint">Reading the branches.</p>}
                        {!loading && shown.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">No branch by that name.</p>}
                        <Menu.RadioGroup
                            value={current}
                            onValueChange={(value: string) => {
                                const picked = refs.find((ref) => ref.name === value);
                                if (picked && !picked.current) {
                                    onCheckout(picked);
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
                                    {ref.isDefault && <span className={MENU_HINT}>default</span>}
                                    {ref.worktree !== undefined && <span className={`${MENU_HINT} truncate`}>in another worktree</span>}
                                </Menu.RadioItem>
                            ))}
                        </Menu.RadioGroup>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
