import { useTranslation } from 'react-i18next';
import { PromptDialog } from '@/ui/PromptDialog';

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

/* Naming a project, whether it is being made or renamed: the same field, the same failure line. */
export function ProjectNameDialog({ open, onOpenChange, title, description, action, initial = '', fallback, onSubmit }: ProjectNameDialogProps) {
    const { t } = useTranslation('shell');
    return (
        <PromptDialog
            open={open}
            title={title}
            description={description}
            field={{ ariaLabel: t('projectName.label'), placeholder: fallback ?? t('projectName.placeholder'), initial }}
            confirmLabel={action}
            fallbackMessage={t('projectName.failed')}
            allowEmpty={fallback !== undefined}
            onConfirm={async (typed) => {
                await onSubmit(typed === '' ? (fallback ?? '') : typed);
                onOpenChange(false);
            }}
            onClose={() => onOpenChange(false)}
        />
    );
}
