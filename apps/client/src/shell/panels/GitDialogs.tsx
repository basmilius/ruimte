import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { Button, FormError, Icon, Input, Menu, Dialog } from '@adecore/ui';

export interface Choice {
    value: string;
    label: string;
    /* What the row says on its right: where a branch lives, when a stash was made. */
    hint?: string;
    disabled?: boolean;
}

interface ChoiceProps {
    open: boolean;
    title: string;
    description?: ReactNode;
    choices: readonly Choice[];
    /* Shown above the list once there are more rows than a person scans at a glance. */
    filterFrom?: number;
    empty: string;
    loading?: boolean;
    error?: string | null;
    onRetry?(): void;
    onPick(value: string): void;
    onClose(): void;
}

/* Picking one branch or one stash: the same list the branch menu draws, in a dialog. */
export function GitChoice({ open, title, description, choices, filterFrom = 10, empty, loading = false, error, onRetry, onPick, onClose }: ChoiceProps) {
    const { t } = useTranslation('panels');
    /* The filter belongs to one opening of the dialog; closing it is what empties the field. */
    const [filter, setFilter] = useState({ open, query: '' });
    if (filter.open !== open) {
        setFilter({ open, query: '' });
    }
    const query = filter.query;
    const setQuery = (next: string): void => setFilter({ open, query: next });

    const needle = query.trim().toLowerCase();
    const shown = needle === '' ? choices : choices.filter((choice) => choice.label.toLowerCase().includes(needle));

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{title}</Dialog.Title>
                {description !== undefined && <Dialog.Text className="mt-1">{description}</Dialog.Text>}
                {choices.length > filterFrom && (
                    <span className="relative mt-4 block">
                        <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" aria-hidden />
                        <Input
                            autoFocus
                            className="pl-8"
                            placeholder={t('git.dialog.filter')}
                            spellCheck={false}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </span>
                )}
                <div className="mt-3 max-h-72 overflow-y-auto">
                    {loading && <p className="px-1 py-6 text-center text-sm text-text-faint">{t('git.branchMenu.loading')}</p>}
                    {error && (
                        <div className="flex flex-col items-start gap-2 py-3">
                            <FormError>{error}</FormError>
                            <Button size="sm" onClick={onRetry}>
                                {t('common:action.retry')}
                            </Button>
                        </div>
                    )}
                    {!loading && !error && shown.length === 0 && <p className="px-1 py-6 text-center text-sm text-text-faint">{empty}</p>}
                    {shown.map((choice) => (
                        <button
                            key={choice.value}
                            /* A dialog is no menu, so these rows draw their own hover and focus ring. */
                            className={clsx('menu-item w-full text-left hover:bg-surface-hover', choice.disabled && 'opacity-50 hover:bg-transparent')}
                            disabled={choice.disabled}
                            onClick={() => onPick(choice.value)}
                        >
                            <span className="truncate font-mono text-sm">{choice.label}</span>
                            {choice.hint !== undefined && <Menu.Hint className="truncate">{choice.hint}</Menu.Hint>}
                        </button>
                    ))}
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

interface DivergedProps {
    open: boolean;
    branch: string;
    busy: boolean;
    onPick(strategy: 'merge' | 'rebase'): void;
    onClose(): void;
}

/*
 * The one question a pull asks: a branch that moved here and on the remote comes together as a merge
 * commit or as the local commits replayed on top. Git picks neither on its own, and neither does the
 * panel, since the answer is about what the history should read like afterwards.
 */
export function GitDiverged({ open, branch, busy, onPick, onClose }: DivergedProps) {
    const { t } = useTranslation('panels');
    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('git.dialog.diverged.title', { branch })}</Dialog.Title>
                <Dialog.Text className="mt-1">{t('git.dialog.diverged.description')}</Dialog.Text>
                <div className="mt-4 flex flex-col gap-2">
                    <button
                        className="rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-hover"
                        disabled={busy}
                        onClick={() => onPick('merge')}
                    >
                        <span className="block text-sm text-text">{t('git.dialog.diverged.merge')}</span>
                        <span className="block text-xs text-text-muted">{t('git.dialog.diverged.mergeHint')}</span>
                    </button>
                    <button
                        className="rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-hover"
                        disabled={busy}
                        onClick={() => onPick('rebase')}
                    >
                        <span className="block text-sm text-text">{t('git.dialog.diverged.rebase')}</span>
                        <span className="block text-xs text-text-muted">{t('git.dialog.diverged.rebaseHint')}</span>
                    </button>
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
