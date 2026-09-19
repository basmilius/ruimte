import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { COMMIT_MESSAGE } from '@/shell/panels/classes';
import { Button } from '@/ui/Button';
import { MENU_HINT, SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

interface PromptProps {
    open: boolean;
    title: string;
    description?: ReactNode;
    /* A one line field the answer is typed in; without it the dialog is a confirm and nothing else. */
    field?: { label: string; initial?: string; placeholder?: string };
    /* A second, taller field under it, for the body of a pull request. */
    area?: { label: string; initial?: string; placeholder?: string };
    confirmLabel: string;
    danger?: boolean;
    busy?: boolean;
    /* Lets the field be confirmed empty, for a list that may be cleared. */
    allowEmpty?: boolean;
    /* A second way out next to the confirm, such as merging before removing. */
    secondary?: { label: string; onClick(): void };
    onConfirm(value: string, body: string): void;
    onClose(): void;
}

/*
 * The one dialog every git action asks its question in: a name to type, or a warning to agree with.
 * They share it so a confirm and a rename read the same and neither grows a layout of its own.
 */
export function GitPrompt({
    open,
    title,
    description,
    field,
    area,
    confirmLabel,
    danger = false,
    busy = false,
    allowEmpty = false,
    secondary,
    onConfirm,
    onClose
}: PromptProps) {
    const { t } = useTranslation('panels');
    /* The dialog stays mounted between questions, so every opening starts from what it was handed.
       The token is what it was handed, so a new question resets the fields in the same render that
       shows it and not in a second one after. */
    const token = open ? `${field?.initial ?? ''}\u0000${area?.initial ?? ''}` : '';
    const [draft, setDraft] = useState({ token, value: field?.initial ?? '', body: area?.initial ?? '' });
    if (draft.token !== token) {
        setDraft({ token, value: field?.initial ?? '', body: area?.initial ?? '' });
    }
    const value = draft.value;
    const body = draft.body;
    const setValue = (next: string): void => setDraft({ ...draft, value: next });
    const setBody = (next: string): void => setDraft({ ...draft, body: next });

    const submit = (): void => {
        if (!busy && (field === undefined || allowEmpty || value.trim() !== '')) {
            onConfirm(value.trim(), body.trim());
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">{title}</Dialog.Title>
                    {description !== undefined && <p className="mt-1 text-sm text-text-muted">{description}</p>}
                    {field !== undefined && (
                        <label className="mt-4 flex flex-col gap-1.5">
                            <span className={SECTION_LABEL}>{field.label}</span>
                            <input
                                autoFocus
                                className="field font-mono"
                                spellCheck={false}
                                placeholder={field.placeholder}
                                value={value}
                                onChange={(event) => setValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        submit();
                                    }
                                }}
                            />
                        </label>
                    )}
                    {area !== undefined && (
                        <label className="mt-3 flex flex-col gap-1.5">
                            <span className={SECTION_LABEL}>{area.label}</span>
                            <textarea
                                className={COMMIT_MESSAGE}
                                rows={5}
                                spellCheck={false}
                                placeholder={area.placeholder}
                                value={body}
                                onChange={(event) => setBody(event.target.value)}
                            />
                        </label>
                    )}
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={onClose}>{t('common:action.cancel')}</Button>
                        {secondary !== undefined && (
                            <Button disabled={busy} onClick={secondary.onClick}>
                                {secondary.label}
                            </Button>
                        )}
                        <Button
                            variant={danger ? 'danger' : 'primary'}
                            disabled={busy || (field !== undefined && !allowEmpty && value.trim() === '')}
                            onClick={submit}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

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
