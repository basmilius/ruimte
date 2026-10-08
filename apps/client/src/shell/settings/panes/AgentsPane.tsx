import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { CLOSED_LID_BATTERY_FLOOR, type RuntimeMode } from '@ruimte/contracts';
import { rememberChatPreferences, useChatPreferences } from '@adecore/agents-react/chat/preferences';
import { RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@adecore/agents-react/chat/runtime-modes';
import {
    setClosedLidRule,
    setKeepAwake,
    setKeepAwakeLidClosed,
    useClosedLid,
    useKeepAwakeAvailable,
    useKeepAwakeChoice,
    useMachineKeepsAwake
} from '@/state/keep-awake';
import { MachineSwitchSections } from '@/shell/settings/MachineSwitchSection';
import { SettingsRow } from '@adecore/ui/settings';
import { Button, FormError, Switch, Select, type SelectItem } from '@adecore/ui';
import { formatPercent } from '@adecore/ui/format';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';

/* Both mode rows offer the same choices, and each one explains itself in the popup. Built while the
   pane draws, so the words are the ones the interface is in right now. */
function runtimeModeItems(): SelectItem<RuntimeMode>[] {
    return RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode), description: runtimeModeHint(mode) }));
}

const KEEP_AWAKE_DESCRIPTIONS = {
    off: null,
    working: 'agents.keepAwake.mode.working.description',
    always: 'agents.keepAwake.mode.always.description'
} as const;

const STREAMING_MODES = ['words', 'blocks', 'whole'] as const;

export function AgentsPane() {
    const { t } = useTranslation('settings');
    const preferences = useChatPreferences();
    const agentsShowViews = useSettings((s) => s.agentsShowViews);
    const { keepAwake, keepAwakeOnBattery, keepAwakeDisplay } = useKeepAwakeChoice();
    const agentsTurnSound = useSettings((s) => s.agentsTurnSound);
    const chatStreaming = useSettings((s) => s.chatStreaming);
    const chatSteerByDefault = useSettings((s) => s.chatSteerByDefault);
    const update = useSettings((s) => s.update);
    // A browser cannot keep anything awake, so it is told nothing about a choice it has no way to honor.
    const awake = useKeepAwakeAvailable();
    // The machine holds the display only with battery allowed; the shell from before weighed the power source itself.
    const displayNeedsBattery = useMachineKeepsAwake() && !keepAwakeOnBattery;
    const keepAwakeDescription = KEEP_AWAKE_DESCRIPTIONS[keepAwake];
    const lid = useClosedLid();
    const lidShown = awake && lid.offered && keepAwake !== 'off';
    // The rule waits on macOS's administrator dialog, so the row stays busy for as long as that is up.
    const [lidBusy, setLidBusy] = useState(false);
    const [lidError, setLidError] = useState<string | null>(null);

    const changeLidRule = (install: boolean): void => {
        setLidBusy(true);
        setLidError(null);
        void setClosedLidRule(install)
            .catch((e: unknown) => setLidError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLidBusy(false));
    };

    return (
        <>
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
            <SettingsSection title={t('agents.chats.title')} scope="client">
                <SettingsRow
                    searchId="agents.chats.steerByDefault"
                    label={t('agents.chats.steerByDefault.label')}
                    description={t('agents.chats.steerByDefault.description')}
                    control={
                        <Switch
                            checked={chatSteerByDefault}
                            onCheckedChange={(checked) => update({ chatSteerByDefault: checked })}
                            label={t('agents.chats.steerByDefault.label')}
                        />
                    }
                />
                <SettingsRow
                    searchId="agents.chats.streaming"
                    label={t('agents.chats.streaming.label')}
                    description={t(`agents.chats.streaming.${chatStreaming}.description`)}
                    control={
                        <Select
                            value={chatStreaming}
                            label={t('agents.chats.streaming.label')}
                            align="end"
                            items={STREAMING_MODES.map((mode) => ({
                                value: mode,
                                label: t(`agents.chats.streaming.${mode}.label`),
                                description: t(`agents.chats.streaming.${mode}.description`)
                            }))}
                            onValueChange={(value) => update({ chatStreaming: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="agents.chats.showViews"
                    label={t('agents.chats.showViews.label')}
                    description={t('agents.chats.showViews.description')}
                    control={
                        <Switch
                            checked={agentsShowViews}
                            onCheckedChange={(checked) => update({ agentsShowViews: checked })}
                            label={t('agents.chats.showViews.label')}
                        />
                    }
                />
            </SettingsSection>
            <MachineSwitchSections />
            <SettingsSection title={t('agents.working.title')} description={awake ? t('agents.working.description') : undefined} scope="computer">
                <SettingsRow
                    searchId="agents.working.sound"
                    label={t('agents.working.sound.label')}
                    description={t('agents.working.sound.description')}
                    control={
                        <Switch
                            checked={agentsTurnSound}
                            onCheckedChange={(checked) => update({ agentsTurnSound: checked })}
                            label={t('agents.working.sound.label')}
                        />
                    }
                />
                {awake && (
                    <SettingsRow
                        searchId="agents.keepAwake.mode"
                        label={t('agents.keepAwake.mode.label')}
                        description={keepAwakeDescription === null ? undefined : t(keepAwakeDescription)}
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
                )}
                {awake && keepAwake !== 'off' && (
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
                {lidShown && (
                    <SettingsRow
                        indent
                        searchId="agents.keepAwake.lid"
                        label={t('agents.keepAwake.lid.label')}
                        description={t('agents.keepAwake.lid.description', { percent: formatPercent(CLOSED_LID_BATTERY_FLOOR) })}
                        control={
                            <Switch
                                checked={lid.on}
                                disabled={!lid.rule || lidBusy}
                                onCheckedChange={setKeepAwakeLidClosed}
                                label={t('agents.keepAwake.lid.label')}
                            />
                        }
                    />
                )}
                {lidShown && (
                    <SettingsRow
                        indent
                        label={t('agents.keepAwake.lid.rule.label')}
                        description={t(lid.rule ? 'agents.keepAwake.lid.rule.installed' : 'agents.keepAwake.lid.rule.missing')}
                        control={
                            <Button variant="secondary" disabled={lidBusy} onClick={() => changeLidRule(!lid.rule)}>
                                {t(lid.rule ? 'agents.keepAwake.lid.rule.remove' : 'agents.keepAwake.lid.rule.install')}
                            </Button>
                        }
                    >
                        {lidError !== null && <FormError>{lidError}</FormError>}
                    </SettingsRow>
                )}
                {awake && keepAwake === 'always' && (
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
        </>
    );
}
