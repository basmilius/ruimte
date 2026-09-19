import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { Button } from '@/ui/Button';
import { useAsyncAction } from '@/ui/useAsyncAction';

interface ProjectNameDialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    title: string;
    description: string;
    /* The word on the confirming button: what this dialog is about to do. */
    action: string;
    /* What the field starts with; empty for a project that does not exist yet. */
    initial?: string;
    /* The name an empty field stands for. Without one the button waits until something is typed. */
    fallback?: string;
    onSubmit(name: string): Promise<void>;
}

/* The part that holds what was typed. It lives under the popup, which unmounts on close, so every
   look at the dialog starts at the name the project has now rather than at the last attempt. */
function NameForm({ description, action, initial = '', fallback, onSubmit, onOpenChange }: ProjectNameDialogProps) {
    const { t } = useTranslation(['shell', 'common']);
    const [value, setValue] = useState(initial);
    const { busy, failure, run } = useAsyncAction(t('projectName.failed'));
    const name = value.trim() === '' ? (fallback ?? '') : value.trim();

    const submit = async (): Promise<void> => {
        if (name === '') {
            return;
        }
        if (await run(() => onSubmit(name))) {
            onOpenChange(false);
        }
    };

    return (
        <>
            <p className="mt-1 text-sm text-text-muted">{description}</p>
            <input
                autoFocus
                className="field mt-3"
                aria-label={t('projectName.label')}
                placeholder={fallback ?? t('projectName.placeholder')}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        void submit();
                    }
                }}
            />
            {failure && <p className="mt-2 text-sm text-status-error">{failure}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
                <Button onClick={() => onOpenChange(false)}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={busy || name === ''} onClick={() => void submit()}>
                    {action}
                </Button>
            </div>
        </>
    );
}

/* Naming a project, whether it is being made or renamed: the same field, the same failure line. */
export function ProjectNameDialog(props: ProjectNameDialogProps) {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">{props.title}</Dialog.Title>
                    <NameForm {...props} />
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
