import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { MENU_HINT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

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
    onPick(value: string): void;
    onClose(): void;
}

/* Picking one branch or one stash: the same list the branch menu draws, in a dialog. */
export function GitChoice({ open, title, description, choices, filterFrom = 10, empty, onPick, onClose }: ChoiceProps) {
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
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">{title}</Dialog.Title>
                    {description !== undefined && <p className="mt-1 text-sm text-text-muted">{description}</p>}
                    {choices.length > filterFrom && (
                        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border px-2.5">
                            <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                            <input
                                autoFocus
                                className="h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                                placeholder={t('git.dialog.filter')}
                                spellCheck={false}
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                        </div>
                    )}
                    <div className="mt-3 max-h-72 overflow-y-auto">
                        {shown.length === 0 && <p className="px-1 py-6 text-center text-sm text-text-faint">{empty}</p>}
                        {shown.map((choice) => (
                            <button
                                key={choice.value}
                                /* A dialog is no menu, so nothing hands these rows Base UI's
                                   highlight: the hover and the focus ring are their own. */
                                className={clsx('menu-item w-full text-left hover:bg-surface-hover', choice.disabled && 'opacity-45 hover:bg-transparent')}
                                disabled={choice.disabled}
                                onClick={() => onPick(choice.value)}
                            >
                                <span className="truncate font-mono text-sm">{choice.label}</span>
                                {choice.hint !== undefined && <span className={`${MENU_HINT} truncate`}>{choice.hint}</span>}
                            </button>
                        ))}
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
