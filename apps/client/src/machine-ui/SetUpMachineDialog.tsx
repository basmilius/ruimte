import { PromptDialog } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { desktop } from '@/desktop/bridge';
import { isShellFailure } from '@/desktop/shell-failure';

interface SetUpMachineDialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
}

/* The restart that makes this computer run a machine. A rejection stays in the dialog as its reason. */
export function SetUpMachineDialog({ open, onOpenChange }: SetUpMachineDialogProps) {
    const { t } = useTranslation('settings');
    return (
        <PromptDialog
            open={open}
            nested
            title={t('machines.thisComputer.confirm.title')}
            description={t('machines.thisComputer.confirm.description')}
            confirmLabel={t('machines.thisComputer.confirm.action')}
            onConfirm={async () => {
                const machine = desktop()?.machine;
                if (machine === undefined) {
                    throw new Error(t('machines.thisComputer.confirm.failed'));
                }
                try {
                    await machine.choose('local');
                } catch (e) {
                    throw isShellFailure(e) ? new Error(t('machines.thisComputer.confirm.failed')) : e;
                }
            }}
            onOpenChange={onOpenChange}
        />
    );
}
