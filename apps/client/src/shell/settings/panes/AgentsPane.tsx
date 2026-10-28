import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { CLOSED_LID_BATTERY_FLOOR, type AgentIntegrationFile, type RuntimeMode } from '@ruimte/contracts';
import {
    rememberChatPreferences,
    rememberReadingWidth,
    rememberSendKey,
    useChatPreferences,
    CHAT_SEND_KEYS,
    sendKeyHint,
    sendKeyLabel,
    CHAT_READING_WIDTHS,
    readingWidthHint,
    readingWidthLabel,
    RUNTIME_MODES,
    runtimeModeHint,
    runtimeModeLabel
} from '@adecore/agents-react/chat';
import {
    setClosedLidRule,
    setKeepAwake,
    setKeepAwakeLidClosed,
    useClosedLid,
    useKeepAwakeAvailable,
    useKeepAwakeChoice,
    useMachineKeepsAwake
} from '@/state/keep-awake';
import { IntegrationDetails, IntegrationReports } from '@/shell/AgentIntegrationsDialog';
import { CliMark } from '@adecore/agents-react/providers';
import { INTEGRATION_NAMES, loadIntegrationFiles, useAgentIntegrations, useIntegrationChoice } from '@/state/agent-integrations';
import { isApplePlatform } from '@/desktop/bridge';
import { hasLocalMachine } from '@/state/local-machine';
import { MachineSwitchSections } from '@/shell/settings/MachineSwitchSection';
import { SettingsRow } from '@adecore/ui/settings';
import { Button, FormError, Switch, Select, type SelectItem, messageOf } from '@adecore/ui';
import { formatPercent } from '@adecore/ui/format';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';

/* Both mode rows offer the same choices, and each one explains itself in the popup. Built while the
   pane draws, so the words are the ones the interface is in right now. */
function runtimeModeItems(): SelectItem<RuntimeMode>[] {
    return RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode), description: runtimeModeHint(mode) }));
}

const STREAMING_MODES = ['words', 'blocks', 'whole'] as const;

export function AgentsPane() {
    return (
        <>
            <AgentDefaultsSection />
            <ChatsSection />
            <MachineSwitchSections />
            <WorkingSection />
            <IntegrationsSection />
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

function ChatsSection() {
    const { t } = useTranslation('settings');
    const chatStreaming = useSettings((s) => s.chatStreaming);
    const update = useSettings((s) => s.update);
    const readingWidth = useChatPreferences((preferences) => preferences.readingWidth);
    const sendKey = useChatPreferences((preferences) => preferences.sendKey);
    const apple = isApplePlatform();
    return (
        <SettingsSection title={t('agents.chats.title')} scope="client">
            <SettingsRow
                searchId="agents.chats.sendKey"
                label={t('agents.chats.sendKey.label')}
                description={t('agents.chats.sendKey.description')}
                control={
                    <Select
                        value={sendKey}
                        label={t('agents.chats.sendKey.label')}
                        align="end"
                        items={CHAT_SEND_KEYS.map((key) => ({ value: key, label: sendKeyLabel(key, apple), description: sendKeyHint(key, apple) }))}
                        onValueChange={rememberSendKey}
                    />
                }
            />
            <SettingSwitchRow id="agents.chats.steerByDefault" setting="chatSteerByDefault" />
            <SettingSwitchRow id="agents.chats.hideToolCalls" setting="chatHideToolCalls" />
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
                searchId="agents.chats.readingWidth"
                label={t('agents.chats.readingWidth.label')}
                description={t('agents.chats.readingWidth.description')}
                control={
                    <Select
                        value={readingWidth}
                        label={t('agents.chats.readingWidth.label')}
                        align="end"
                        items={CHAT_READING_WIDTHS.map((width) => ({ value: width, label: readingWidthLabel(width), description: readingWidthHint(width) }))}
                        onValueChange={rememberReadingWidth}
                    />
                }
            />
            <SettingSwitchRow id="agents.chats.showViews" setting="agentsShowViews" />
            <SettingSwitchRow id="agents.chats.mapTiles" setting="chatMapTiles" />
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
    return (
        <SettingsSection title={t('agents.working.title')} description={awake ? t('agents.working.description') : undefined} scope="computer">
            <SettingSwitchRow id="agents.working.sound" setting="agentsTurnSound" />
            {awake && (
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
            <ClosedLidRows shown={awake && keepAwake !== 'off'} />
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
    );
}

/* What Ruimte may write into the CLIs' global settings, per CLI. Only this computer's own machine has it. */
function IntegrationsSection() {
    const { t } = useTranslation('settings');
    const summary = useAgentIntegrations();
    const [files, setFiles] = useState<AgentIntegrationFile[] | null>(null);
    const { reports, busy, error, change } = useIntegrationChoice();
    const listed = summary !== null && hasLocalMachine();

    useEffect(() => {
        if (listed) {
            void loadIntegrationFiles()
                .then(setFiles)
                .catch(() => setFiles([]));
        }
    }, [listed, summary]);

    if (!listed) {
        return null;
    }

    return (
        <SettingsSection
            title={t('agents.integrations.title')}
            description={summary.fixed ? `${t('agents.integrations.description')} ${t('agents.integrations.fixed')}` : t('agents.integrations.description')}
            scope="computer"
        >
            {summary.providers.map((entry, index) => (
                <SettingsRow
                    key={entry.provider}
                    searchId={index === 0 ? 'agents.integrations' : undefined}
                    label={INTEGRATION_NAMES[entry.provider] ?? entry.provider}
                    leading={<CliMark kind={entry.provider} size={20} />}
                    control={
                        <Switch
                            checked={entry.state === 'on'}
                            disabled={summary.fixed || busy !== null}
                            onCheckedChange={(checked) => void change(entry.provider, checked)}
                            label={INTEGRATION_NAMES[entry.provider] ?? entry.provider}
                        />
                    }
                >
                    <IntegrationDetails entry={entry} files={files} />
                    {reports[entry.provider] !== undefined && <IntegrationReports reports={reports[entry.provider]!} />}
                    {error?.provider === entry.provider && <FormError>{error.message}</FormError>}
                </SettingsRow>
            ))}
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
