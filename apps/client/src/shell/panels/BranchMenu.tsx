import { useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui-components/react/popover';
import clsx from 'clsx';
import { Check, ChevronDown, GitBranch, Plus, Search } from 'lucide-react';
import type { GitRef } from '@ruimte/contracts';
import { basenameOf } from '@/shell/panels/files-tree';
import type { GitTarget } from '@/state/git-target';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// Under this many branches a field on top of the list costs more than it finds.
const FILTER_FROM = 10;

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
 * pointed at and the branches this one can be put on. Local branches first, then the remote ones,
 * newest tip first the way the daemon sorted them; a branch another worktree has out cannot be
 * checked out here, so the row says so instead of failing.
 */
export function BranchMenu({ target, targets, branch, detached, refs, loading, onOpen, onPickTarget, onCheckout, onCreate }: BranchMenuProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle === '' ? refs : refs.filter((ref) => ref.name.toLowerCase().includes(needle));
    }, [refs, query]);

    const label = detached ? 'detached' : (branch ?? target.label);
    const prefix = prefixOf(target);

    return (
        <Popover.Root
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (next) {
                    setQuery('');
                    onOpen();
                }
            }}
        >
            <Tooltip label={prefix === null ? 'The branch this checkout is on' : `${label}, in the worktree ${prefix}`}>
                <Popover.Trigger className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-full bg-surface-sunken px-2 text-xs text-text-muted hover:text-text">
                    <Icon icon={GitBranch} size={12} className="shrink-0" />
                    {prefix !== null && <span className="max-w-24 truncate text-text-faint">{prefix}</span>}
                    <span className="truncate font-mono">{label}</span>
                    <Icon icon={ChevronDown} size={12} className="shrink-0" />
                </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
                <Popover.Positioner className="popup-layer" side="bottom" align="start" sideOffset={6}>
                    <Popover.Popup className="picker-popup" initialFocus={inputRef}>
                        <div className="max-h-96 overflow-y-auto p-1">
                            <p className="menu-label">Checkout</p>
                            {targets.map((entry) => (
                                <button
                                    key={entry.cwd ?? entry.label}
                                    className="menu-item w-full text-left"
                                    onClick={() => {
                                        setOpen(false);
                                        onPickTarget(entry);
                                    }}
                                >
                                    <span className="grid h-5 w-4 shrink-0 place-items-center">
                                        {entry.cwd === target.cwd && <Icon icon={Check} size={14} />}
                                    </span>
                                    <span className="truncate">{entry.label}</span>
                                    {entry.group !== undefined && <span className="menu-hint truncate">{entry.group}</span>}
                                </button>
                            ))}
                            {targets.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">No checkout to point at</p>}
                            <span className="menu-separator block" />
                            <p className="menu-label">Branches</p>
                            <button
                                className="menu-item w-full text-left"
                                onClick={() => {
                                    setOpen(false);
                                    onCreate();
                                }}
                            >
                                <Icon icon={Plus} size={14} />
                                Create branch...
                            </button>
                            {refs.length > FILTER_FROM && (
                                <div className="my-1 flex items-center gap-2 rounded-lg border border-border px-2.5">
                                    <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                                    <input
                                        ref={inputRef}
                                        className="h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                                        placeholder="Search branches"
                                        spellCheck={false}
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                    />
                                </div>
                            )}
                            {loading && <p className="px-3 py-2 text-xs text-text-faint">Reading the branches.</p>}
                            {!loading && shown.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">No branch by that name.</p>}
                            {shown.map((ref) => (
                                <button
                                    key={`${ref.kind}:${ref.name}`}
                                    className={clsx('menu-item w-full text-left', ref.worktree !== undefined && 'opacity-45')}
                                    disabled={ref.worktree !== undefined}
                                    onClick={() => {
                                        setOpen(false);
                                        onCheckout(ref);
                                    }}
                                >
                                    <span className="grid h-5 w-4 shrink-0 place-items-center">{ref.current && <Icon icon={Check} size={14} />}</span>
                                    <span className="truncate font-mono text-xs">{ref.name}</span>
                                    {ref.isDefault && <span className="menu-hint">default</span>}
                                    {ref.worktree !== undefined && <span className="menu-hint truncate">in another worktree</span>}
                                </button>
                            ))}
                        </div>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
