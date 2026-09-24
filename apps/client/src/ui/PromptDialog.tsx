import { useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/ui/Button';
import { MULTILINE_FIELD, SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { useAsyncAction } from '@/ui/useAsyncAction';

interface PromptDialogProps {
    open: boolean;
    title: string;
    /* The mark beside the title, for a dialog that names the thing it is about. */
    titleIcon?: LucideIcon;
    description?: ReactNode;
    /* A one line field the answer is typed in; without it the dialog is a confirm and nothing else. */
    field?: {
        /* Drawn above the field. Without one only a screen reader hears the name, from `ariaLabel`. */
        label?: string;
        ariaLabel?: string;
        initial?: string;
        placeholder?: string;
        /* A branch, a path or anything else git reads back letter by letter. */
        mono?: boolean;
        maxLength?: number;
    };
    /* A second, taller field under it, for the body of a pull request. */
    area?: { label: string; initial?: string; placeholder?: string };
    confirmLabel: string;
    /* What the button says while the step runs, for one slow enough that a quiet button is not enough. */
    confirmBusyLabel?: string;
    confirmIcon?: LucideIcon;
    danger?: boolean;
    /* The caller runs the step somewhere else and says when it is busy; a step this dialog awaits says so itself. */
    busy?: boolean;
    /* Lets the field be confirmed empty, for a list that may be cleared or a name with a default. */
    allowEmpty?: boolean;
    /* A reason this question cannot be answered at all, beside the one an empty field is. */
    confirmDisabled?: boolean;
    /* A second way out next to the confirm, such as merging before removing. */
    secondary?: { label: string; onClick(): void };
    /* Over another dialog, so what is under it is dimmed a second time. */
    nested?: boolean;
    /* Whatever this question needs beyond a field, between the description and the buttons. */
    children?: ReactNode;
    /* Told what was typed. A rejection stays on screen as the reason and leaves the dialog open. */
    onConfirm(value: string, body: string): void | Promise<unknown>;
    /* What the failure line reads when the rejection carries no sentence of its own. */
    fallbackMessage?: string;
    onClose(): void;
}

/*
 * The one dialog a question is asked in: a name to type, or a warning to agree with. Every confirm
 * and every rename shares it, so none of them grows a layout of its own. It never closes itself,
 * because what a confirm leads to is the caller's business: an action that asks a second question
 * would be shut out by a close of its own.
 */
export function PromptDialog({
    open,
    title,
    titleIcon,
    description,
    field,
    area,
    confirmLabel,
    confirmBusyLabel,
    confirmIcon,
    danger = false,
    busy = false,
    allowEmpty = false,
    confirmDisabled = false,
    secondary,
    nested = false,
    children,
    onConfirm,
    fallbackMessage,
    onClose
}: PromptDialogProps) {
    const { t } = useTranslation('common');
    /* The dialog stays mounted between questions, so every opening starts from what it was handed.
       The token is what it was handed, so a new question resets the fields in the same render that
       shows it and not in a second one after. */
    const token = open ? `${field?.initial ?? ''}\u0000${area?.initial ?? ''}` : '';
    const [draft, setDraft] = useState({ token, value: field?.initial ?? '', body: area?.initial ?? '' });
    const step = useAsyncAction(fallbackMessage);
    if (draft.token !== token) {
        setDraft({ token, value: field?.initial ?? '', body: area?.initial ?? '' });
        step.clear();
    }
    const value = draft.value;
    const body = draft.body;
    const working = busy || step.busy;
    const setValue = (next: string): void => setDraft({ ...draft, value: next });
    const setBody = (next: string): void => setDraft({ ...draft, body: next });

    const submit = (): void => {
        if (!working && !confirmDisabled && (field === undefined || allowEmpty || value.trim() !== '')) {
            void step.run(async () => await onConfirm(value.trim(), body.trim()));
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Backdrop className={clsx('dialog-backdrop', nested && 'dialog-backdrop-nested')} forceRender={nested} />
                <Dialog.Popup className={clsx('dialog-popup w-[420px] p-5', nested && 'dialog-popup-nested')}>
                    <Dialog.Title className="flex items-center gap-2 text-base font-semibold break-words text-text">
                        {titleIcon && <Icon icon={titleIcon} size={16} />}
                        {title}
                    </Dialog.Title>
                    {description !== undefined && <p className="mt-1 text-sm break-words text-text-muted">{description}</p>}
                    {field !== undefined && (
                        <label className="mt-4 flex flex-col gap-1.5">
                            {field.label !== undefined && <span className={SECTION_LABEL}>{field.label}</span>}
                            <input
                                autoFocus
                                className={clsx('field', field.mono === true && 'font-mono text-code')}
                                aria-label={field.ariaLabel}
                                spellCheck={false}
                                placeholder={field.placeholder}
                                maxLength={field.maxLength}
                                value={value}
                                onChange={(event) => setValue(event.target.value)}
                                onKeyDown={(event) => {
                                    // The canvas and the window listen on their own keys, and a name may hold any of them.
                                    event.stopPropagation();
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
                                className={MULTILINE_FIELD}
                                rows={5}
                                spellCheck={false}
                                placeholder={area.placeholder}
                                value={body}
                                onChange={(event) => setBody(event.target.value)}
                            />
                        </label>
                    )}
                    {children}
                    {step.failure !== null && (
                        <p className="mt-2 text-sm break-words text-status-error" role="alert">
                            {step.failure}
                        </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        <Button onClick={onClose}>{t('action.cancel')}</Button>
                        {secondary !== undefined && (
                            <Button disabled={working} onClick={secondary.onClick}>
                                {secondary.label}
                            </Button>
                        )}
                        <Button
                            variant={danger ? 'danger' : 'primary'}
                            disabled={working || confirmDisabled || (field !== undefined && !allowEmpty && value.trim() === '')}
                            onClick={submit}
                        >
                            {confirmIcon && <Icon icon={confirmIcon} size={12} />}
                            {working && confirmBusyLabel !== undefined ? confirmBusyLabel : confirmLabel}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
