import { Button, Icon } from '@adecore/ui';
import { DetailHeader, SettingsRow } from '@adecore/ui/settings';
import { Laptop } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SetUpMachineDialog } from '@/shell/settings/SetUpMachineDialog';
import { SettingsSection } from '@/surface/settings/SettingsSection';

/*
 * What a desktop app without a machine of its own offers for this computer. It never starts one by
 * itself: the person asks, and the app restarts. A machine that already runs here is the shell's to use.
 */
export function ThisComputerDetail() {
    const { t } = useTranslation('settings');
    const [confirming, setConfirming] = useState(false);
    return (
        <>
            <DetailHeader
                mark={
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-hover">
                        <Icon icon={Laptop} size={20} className="text-text-muted" />
                    </span>
                }
                title={t('machines.thisComputer.row')}
                subtitle={t('machines.thisComputer.subtitle')}
            />
            <SettingsSection>
                <SettingsRow
                    searchId="machines.thisComputer"
                    label={t('machines.thisComputer.setUp.label')}
                    description={t('machines.thisComputer.setUp.description')}
                    control={
                        <Button variant="secondary" onClick={() => setConfirming(true)}>
                            {t('machines.thisComputer.setUp.action')}
                        </Button>
                    }
                />
            </SettingsSection>
            <SetUpMachineDialog open={confirming} onOpenChange={setConfirming} />
        </>
    );
}
