import { useState } from 'react';
import { BatteryCharging } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { CLOSED_LID_BATTERY_FLOOR, type RuntimeMode } from '@ruimte/contracts';
import { rememberChatPreferences, useChatPreferences, RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@adecore/agents-react/chat';
import {
    setClosedLidRule,
    setKeepAwake,
    setKeepAwakeLidClosed,
    useClosedLid,
    useKeepAwakeAvailable,
    useKeepAwakeChoice,
    useMachineKeepsAwake
} from '@/state/keep-awake';
import { MachineSwitchSection } from '@/shell/settings/MachineSwitchSection';
import { ComputerSections } from '@/shell/settings/panes/ComputerSections';
import { SettingsRow } from '@adecore/ui/settings';
import { Button, FormError, Switch, Select, type SelectItem, messageOf } from '@adecore/ui';
import { formatPercent } from '@adecore/ui/format';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useUi } from '@/state/ui';

/* Both mode rows offer the same choices, and each one explains itself in the popup. Built while the
   pane draws, so the words are the ones the interface is in right now. */
function runtimeModeItems(): SelectItem<RuntimeMode>[] {
    return RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode), description: runtimeModeHint(mode) }));
}

/* What new agents start with, what they may do on each machine, and what this computer lets them do while they work. How a chat reads is under Chats. */
export function AgentsPane() {
    const { t } = useTranslation('settings');

    return (
        <>
            <AgentDefaultsSection />
            <MachineSwitchSection title={t('agents.machine.title')} settings={['agentsDeleteAnyView', 'resumeAtReset']} />
            <SettingsSection title={t('agents.notifications.title')}>
                <SettingSwitchRow id="agents.working.sound" setting="agentsTurnSound" />
            </SettingsSection>
            <ComputerSections />
            <WorkingSection />
        </>
    );
}

function AgentDefaultsSection() {
    const { t } = useTranslation('settings');
    const preferences = useChatPreferences();
    return (
        <SettingsSection
            title={t('agents.defaults.title')}
            description={
                <Trans
                    t={t}
                    i18nKey="agents.defaults.description"
                    components={{
                        link: (
                            <button
                                type="button"
                                className="text-accent hover:underline"
                                onClick={() => useUi.getState().setSettings({ section: 'providers' })}
                            />
                        )
                    }}
                />
            }
        >
            <SettingsRow
                searchId="agents.defaults.permissions"
                label={t('agents.defaults.permissions')}
                control={
                    <Select
                        value={preferences.runtimeMode}
                        label={t('agents.defaults.permissions')}
                        align="end"
                        items={runtimeModeItems()}
                        onValueChange={(value) => rememberChatPreferences({ runtimeMode: value })}
                    />
                }
            />
            <SettingsRow
                searchId="agents.defaults.terminalMode"
                label={t('agents.defaults.terminalMode')}
                control={
                    <Select
                        value={preferences.terminalRuntimeMode}
                        label={t('agents.defaults.terminalMode')}
                        align="end"
                        items={runtimeModeItems()}
                        onValueChange={(value) => rememberChatPreferences({ terminalRuntimeMode: value })}
                    />
                }
            />
        </SettingsSection>
    );
}

function WorkingSection() {
    const { t } = useTranslation('settings');
    const { keepAwake, keepAwakeOnBattery, keepAwakeDisplay } = useKeepAwakeChoice();
    // A browser cannot keep anything awake, so it is told nothing about a choice it has no way to honor.
    const awake = useKeepAwakeAvailable();
    // The machine holds the display only with battery allowed; the shell from before weighed the power source itself.
    const displayNeedsBattery = useMachineKeepsAwake() && !keepAwakeOnBattery;

    if (!awake) {
        return null;
    }

    return (
        <SettingsSection title={t('agents.working.title')} description={t('agents.working.description')} icon={BatteryCharging} scope="computer">
            <SettingsRow
                searchId="agents.keepAwake.mode"
                label={t('agents.keepAwake.mode.label')}
                description={keepAwake === 'off' ? undefined : t(`agents.keepAwake.mode.${keepAwake}.description`)}
                control={
                    <Select
                        value={keepAwake}
                        label={t('agents.keepAwake.mode.label')}
                        align="end"
                        items={[
                            { value: 'off', label: t('agents.keepAwake.mode.off') },
                            {
                                value: 'working',
                                label: t('agents.keepAwake.mode.working.label'),
                                description: t('agents.keepAwake.mode.working.description')
                            },
                            {
                                value: 'always',
                                label: t('agents.keepAwake.mode.always.label'),
                                description: t('agents.keepAwake.mode.always.description')
                            }
                        ]}
                        onValueChange={(value) => setKeepAwake({ keepAwake: value })}
                    />
                }
            />
            {keepAwake !== 'off' && (
                <SettingsRow
                    indent
                    label={t('agents.keepAwake.battery.label')}
                    description={t('agents.keepAwake.battery.description')}
                    control={
                        <Switch
                            checked={keepAwakeOnBattery}
                            onCheckedChange={(checked) => setKeepAwake({ keepAwakeOnBattery: checked })}
                            label={t('agents.keepAwake.battery.label')}
                        />
                    }
                />
            )}
            <ClosedLidRows shown={keepAwake !== 'off'} />
            {keepAwake === 'always' && (
                <SettingsRow
                    indent
                    label={t('agents.keepAwake.display.label')}
                    description={t(displayNeedsBattery ? 'agents.keepAwake.display.needsBattery' : 'agents.keepAwake.display.description')}
                    control={
                        <Switch
                            checked={keepAwakeDisplay}
                            onCheckedChange={(checked) => setKeepAwake({ keepAwakeDisplay: checked })}
                            label={t('agents.keepAwake.display.label')}
                        />
                    }
                />
            )}
        </SettingsSection>
    );
}

/* Mounted with the section, so a rule still waiting on macOS keeps its row busy while keep awake is off and on again. */
function ClosedLidRows({ shown }: { shown: boolean }) {
    const { t } = useTranslation('settings');
    const lid = useClosedLid();
    // The rule waits on macOS's administrator dialog, so the row stays busy for as long as that is up.
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const changeRule = (install: boolean): void => {
        setBusy(true);
        setError(null);
        void setClosedLidRule(install)
            .catch((e: unknown) => setError(messageOf(e)))
            .finally(() => setBusy(false));
    };

    if (!shown || !lid.offered) {
        return null;
    }
    return (
        <>
            <SettingsRow
                indent
                searchId="agents.keepAwake.lid"
                label={t('agents.keepAwake.lid.label')}
                description={t('agents.keepAwake.lid.description', { percent: formatPercent(CLOSED_LID_BATTERY_FLOOR) })}
                control={
                    <Switch checked={lid.on} disabled={!lid.rule || busy} onCheckedChange={setKeepAwakeLidClosed} label={t('agents.keepAwake.lid.label')} />
                }
            />
            <SettingsRow
                indent
                label={t('agents.keepAwake.lid.rule.label')}
                description={t(lid.rule ? 'agents.keepAwake.lid.rule.installed' : 'agents.keepAwake.lid.rule.missing')}
                control={
                    <Button variant="secondary" disabled={busy} onClick={() => changeRule(!lid.rule)}>
                        {t(lid.rule ? 'agents.keepAwake.lid.rule.remove' : 'agents.keepAwake.lid.rule.install')}
                    </Button>
                }
            >
                {error !== null && <FormError>{error}</FormError>}
            </SettingsRow>
        </>
    );
}
