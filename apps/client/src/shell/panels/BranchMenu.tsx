import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import { Check, ChevronDown, GitBranch, Plus, Search } from 'lucide-react';
import type { GitRef } from '@ruimte/contracts';
import { basenameOf } from '@/shell/panels/files-tree';
import type { GitTarget } from '@/state/git-target';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { MenuPopup } from '@/ui/MenuPopup';

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

export function BranchMenu({ target, targets, branch, detached, refs, loading, onOpen, onPickTarget, onCheckout, onCreate }: BranchMenuProps) {
    const { t } = useTranslation('panels');
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle === '' ? refs : refs.filter((ref) => ref.name.toLowerCase().includes(needle));
    }, [refs, query]);

    const label = detached ? t('git.branchMenu.detached') : (branch ?? target.label);
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
            <Tooltip label={prefix === null ? t('git.branchMenu.tooltip') : t('git.branchMenu.tooltipWorktree', { branch: label, worktree: prefix })}>
                <Menu.Trigger className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-full bg-surface-sunken px-2 text-xs text-text-muted hover:text-text">
                    <Icon icon={GitBranch} size={12} className="shrink-0" />
                    {prefix !== null && <span className="max-w-24 truncate text-text-faint">{prefix}</span>}
                    <span className="truncate font-mono">{label}</span>
                    <Icon icon={ChevronDown} size={12} className="shrink-0" />
                </Menu.Trigger>
            </Tooltip>
            <MenuPopup className="max-h-96 w-80 overflow-y-auto">
                <div className={MENU_LABEL}>{t('git.branchMenu.checkout')}</div>
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
                            {t('git.branchMenu.noCheckouts')}
                        </Menu.Item>
                    )}
                </Menu.RadioGroup>
                <Menu.Separator className={MENU_SEPARATOR} />
                <div className={MENU_LABEL}>{t('git.branchMenu.branches')}</div>
                <Menu.Item className="menu-item" onClick={onCreate}>
                    <Icon icon={Plus} size={14} />
                    {t('git.branchMenu.create')}
                </Menu.Item>
                {refs.length > FILTER_FROM && (
                    <div className="mx-1 my-1 flex items-center gap-2 rounded-lg border border-border px-2.5">
                        <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                        <input
                            ref={inputRef}
                            className="h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                            placeholder={t('git.branchMenu.search')}
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
                {loading && <p className="px-3 py-2 text-xs text-text-faint">{t('git.branchMenu.loading')}</p>}
                {!loading && shown.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">{t('git.branchMenu.noMatch')}</p>}
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
                            {ref.isDefault && <span className={MENU_HINT}>{t('git.branchMenu.default')}</span>}
                            {ref.worktree !== undefined && <span className={`${MENU_HINT} truncate`}>{t('git.branchMenu.inWorktree')}</span>}
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </MenuPopup>
        </Menu.Root>
    );
}
