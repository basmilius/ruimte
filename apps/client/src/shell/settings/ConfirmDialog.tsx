import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { messageOf } from '@/pulsar/account';
import { Button } from '@/ui/Button';

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    title: string;
    description: string;
    confirmLabel: string;
    /* Closes the dialog once it resolves; a rejection stays on screen as the reason. */
    onConfirm(): Promise<void>;
}

/* One destructive step, asked before it happens, over whichever dialog it was opened from. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm }: ConfirmDialogProps) {
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const confirm = async (): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await onConfirm();
            onOpenChange(false);
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                setFailure(null);
                onOpenChange(next);
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop dialog-backdrop-nested" forceRender />
                <Dialog.Popup className="dialog-popup dialog-popup-nested touch-roomy w-[400px] p-5">
                    <Dialog.Title className="text-base font-semibold break-words text-text">{title}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-xs break-words text-text-muted">{description}</Dialog.Description>
                    {failure && (
                        <p className="mt-2 text-xs break-words text-status-error" role="alert">
                            {failure}
                        </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
                            {confirmLabel}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
