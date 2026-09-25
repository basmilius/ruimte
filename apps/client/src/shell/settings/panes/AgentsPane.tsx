import { Trans, useTranslation } from 'react-i18next';
import type { RuntimeMode } from '@ruimte/contracts';
import { rememberChatPreferences, useChatPreferences } from '@/chat/preferences';
import { RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@/chat/runtime-modes';
import { canKeepAwake } from '@/desktop/bridge';
import { MachineSwitchSections } from '@/shell/settings/MachineSwitchSection';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { Select, type SelectItem } from '@/ui/Select';

/* Both mode rows offer the same choices, and each one explains itself in the popup. Built while the
   pane draws, so the words are the ones the interface is in right now. */
const runtimeModeItems = (): SelectItem<RuntimeMode>[] =>
    RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode), description: runtimeModeHint(mode) }));

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
    const keepAwake = useSettings((s) => s.keepAwake);
    const keepAwakeOnBattery = useSettings((s) => s.keepAwakeOnBattery);
    const keepAwakeDisplay = useSettings((s) => s.keepAwakeDisplay);
    const agentsTurnSound = useSettings((s) => s.agentsTurnSound);
    const chatStreaming = useSettings((s) => s.chatStreaming);
    const update = useSettings((s) => s.update);
    // A browser cannot keep anything awake, so it is told nothing about a choice it has no way to honor.
    const awake = canKeepAwake();
    const keepAwakeDescription = KEEP_AWAKE_DESCRIPTIONS[keepAwake];

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
                        <Toggle
                            checked={agentsShowViews}
                            onChange={(checked) => update({ agentsShowViews: checked })}
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
                        <Toggle
                            checked={agentsTurnSound}
                            onChange={(checked) => update({ agentsTurnSound: checked })}
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
                                onValueChange={(value) => update({ keepAwake: value })}
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
                            <Toggle
                                checked={keepAwakeOnBattery}
                                onChange={(checked) => update({ keepAwakeOnBattery: checked })}
                                label={t('agents.keepAwake.battery.label')}
                            />
                        }
                    />
                )}
                {awake && keepAwake === 'always' && (
                    <SettingsRow
                        indent
                        label={t('agents.keepAwake.display.label')}
                        description={t('agents.keepAwake.display.description')}
                        control={
                            <Toggle
                                checked={keepAwakeDisplay}
                                onChange={(checked) => update({ keepAwakeDisplay: checked })}
                                label={t('agents.keepAwake.display.label')}
                            />
                        }
                    />
                )}
            </SettingsSection>
        </>
    );
}
