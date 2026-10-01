import { Hand } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GrantRows, SetupLine } from '@/computer/ComputerSetupRows';
import { canSwitch, showsGrants } from '@/computer/setup';
import type { ComputerMachine } from '@/computer/use-computer-machine';
import { TaskNote, TaskPane } from '@/onboarding/TaskPane';
import { SettingsRow, SettingsSection } from '@basmilius/desktop-ui/settings';
import { Button, FormError, Switch } from '@basmilius/desktop-ui';

interface ComputerTaskProps {
    machine: string;
    computer: ComputerMachine;
    next: { label: string; go(): void };
}

/* Computer use on this Mac: the switch, the two permissions it waits for, and the restart Screen Recording takes. */
export function ComputerTask({ machine, computer, next }: ComputerTaskProps) {
    const { t } = useTranslation(['onboarding', 'settings']);
    const { connected, status, setup, local, busy, error } = computer;
    const ready = setup.phase === 'ready';
    // Screen Recording only reaches a helper started after the grant, which is what checking again does.
    const restart = local && showsGrants(setup) && setup.screenRecording === 'missing';
    const enable = t('settings:computer.enable', { machine });

    return (
        <TaskPane
            icon={Hand}
            title={t('tasks.computer.title')}
            subtitle={t('tasks.computer.header')}
            footer={
                <>
                    <span className="grow">
                        {!ready && (
                            <Button className="-ml-3" onClick={next.go}>
                                {t('computer.skip')}
                            </Button>
                        )}
                    </span>
                    {restart && (
                        <Button variant="primary" disabled={busy} onClick={computer.checkAgain}>
                            {t('settings:computer.checkAgain')}
                        </Button>
                    )}
                    {ready && (
                        <Button variant="primary" onClick={next.go}>
                            {next.label}
                        </Button>
                    )}
                </>
            }
        >
            <TaskNote>{t('computer.info')}</TaskNote>
            <SettingsSection>
                <SettingsRow
                    label={enable}
                    description={connected ? <SetupLine setup={setup} /> : t('settings:computer.machine.notConnected')}
                    control={
                        <Switch
                            checked={status?.enabled === true}
                            label={enable}
                            disabled={!connected || busy || !canSwitch(setup)}
                            onCheckedChange={computer.setEnabled}
                        />
                    }
                >
                    {(error ?? status?.problem) && <FormError>{error ?? status?.problem}</FormError>}
                </SettingsRow>
                {connected && showsGrants(setup) && <GrantRows setup={setup} local={local} busy={busy} onOpen={computer.openGrant} />}
            </SettingsSection>
            {restart && <p className="text-xs text-text-faint">{t('settings:computer.restartNote')}</p>}
        </TaskPane>
    );
}
