import { useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui-components/react/popover';
import clsx from 'clsx';
import { Check, ChevronDown, GitBranch, Plus, Search } from 'lucide-react';
import type { GitRef } from '@ruimte/contracts';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// Under this many branches a field on top of the list costs more than it finds.
const FILTER_FROM = 10;

interface BranchMenuProps {
    /* What the chip says: the branch HEAD is on, or the state that is not a branch. */
    branch: string | null;
    detached: boolean;
    refs: readonly GitRef[];
    loading: boolean;
    onOpen(): void;
    onCheckout(ref: GitRef): void;
    onCreate(): void;
}

/*
 * The branch of the checkout, and every branch it could be on instead. Local branches first, then
 * the remote ones, newest tip first the way the daemon sorted them. A branch another worktree has
 * out cannot be checked out here, so the row says which checkout holds it instead of failing.
 */
export function BranchMenu({ branch, detached, refs, loading, onOpen, onCheckout, onCreate }: BranchMenuProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle === '' ? refs : refs.filter((ref) => ref.name.toLowerCase().includes(needle));
    }, [refs, query]);

    const label = detached ? 'detached' : (branch ?? 'no branch');

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
            <Tooltip label="The branch this checkout is on">
                <Popover.Trigger className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-full bg-surface-sunken px-2 text-xs text-text-muted hover:text-text">
                    <Icon icon={GitBranch} size={12} className="shrink-0" />
                    <span className="truncate font-mono">{label}</span>
                    <Icon icon={ChevronDown} size={12} className="shrink-0" />
                </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
                <Popover.Positioner className="popup-layer" side="bottom" align="start" sideOffset={6}>
                    <Popover.Popup className="picker-popup" initialFocus={inputRef}>
                        <div className="p-1">
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
                        </div>
                        {refs.length > FILTER_FROM && (
                            <div className="flex items-center gap-2 border-y border-border px-2.5">
                                <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                                <input
                                    ref={inputRef}
                                    className="h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                                    placeholder="Search branches"
                                    spellCheck={false}
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                            </div>
                        )}
                        <div className="max-h-72 overflow-y-auto p-1">
                            {loading && <p className="px-3 py-6 text-center text-xs text-text-faint">Reading the branches.</p>}
                            {!loading && shown.length === 0 && <p className="px-3 py-6 text-center text-xs text-text-faint">No branch by that name.</p>}
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
