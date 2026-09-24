import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { useLeaveConflict } from '@/project/leave-conflict';
import { PromptDialog } from '@/ui/PromptDialog';

/* Asked while the project on screen holds edits that cannot save until its conflict is resolved. */
export function LeaveConflictDialog() {
    const { t } = useTranslation('shell');
    const answer = useLeaveConflict((s) => s.answer);

    return (
        <PromptDialog
            open={answer !== null}
            title={t('leaveConflict.title')}
            description={t('leaveConflict.description')}
            confirmLabel={t('leaveConflict.confirm')}
            confirmIcon={LogOut}
            danger
            onConfirm={() => answer?.(true)}
            onClose={() => answer?.(false)}
        />
    );
}
