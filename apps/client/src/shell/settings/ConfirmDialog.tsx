import { PromptDialog } from '@ruimte/ui/PromptDialog';

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
    return (
        <PromptDialog
            open={open}
            nested
            danger
            title={title}
            description={description}
            confirmLabel={confirmLabel}
            onConfirm={async () => {
                await onConfirm();
                onOpenChange(false);
            }}
            onClose={() => onOpenChange(false)}
        />
    );
}
