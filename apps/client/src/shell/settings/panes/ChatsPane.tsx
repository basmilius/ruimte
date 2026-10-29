import { useTranslation } from 'react-i18next';
import {
    rememberReadingWidth,
    rememberSendKey,
    useChatPreferences,
    CHAT_SEND_KEYS,
    sendKeyHint,
    sendKeyLabel,
    CHAT_READING_WIDTHS,
    readingWidthHint,
    readingWidthLabel
} from '@adecore/agents-react/chat';
import { isApplePlatform } from '@/desktop/bridge';
import { MachineSwitchSection } from '@/shell/settings/MachineSwitchSection';
import { SettingsRow } from '@adecore/ui/settings';
import { Select, Switch } from '@adecore/ui';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings } from '@/state/settings';

const STREAMING_MODES = ['words', 'blocks', 'whole'] as const;

/* How a chat reads and sends, apart from what its agent may do: that stays under Agents. */
export function ChatsPane() {
    const { t } = useTranslation('settings');
    const chatStreaming = useSettings((s) => s.chatStreaming);
    const hideToolCalls = useSettings((s) => s.chatHideToolCalls);
    const update = useSettings((s) => s.update);
    const readingWidth = useChatPreferences((preferences) => preferences.readingWidth);
    const sendKey = useChatPreferences((preferences) => preferences.sendKey);
    const apple = isApplePlatform();

    return (
        <>
            <SettingsSection title={t('chats.replies.title')}>
                <SettingsRow
                    searchId="chats.streaming"
                    label={t('chats.streaming.label')}
                    description={t(`chats.streaming.${chatStreaming}.description`)}
                    control={
                        <Select
                            value={chatStreaming}
                            label={t('chats.streaming.label')}
                            align="end"
                            items={STREAMING_MODES.map((mode) => ({
                                value: mode,
                                label: t(`chats.streaming.${mode}.label`),
                                description: t(`chats.streaming.${mode}.description`)
                            }))}
                            onValueChange={(value) => update({ chatStreaming: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="chats.readingWidth"
                    label={t('chats.readingWidth.label')}
                    description={t('chats.readingWidth.description')}
                    control={
                        <Select
                            value={readingWidth}
                            label={t('chats.readingWidth.label')}
                            align="end"
                            items={CHAT_READING_WIDTHS.map((width) => ({
                                value: width,
                                label: readingWidthLabel(width),
                                description: readingWidthHint(width)
                            }))}
                            onValueChange={rememberReadingWidth}
                        />
                    }
                />
                {/* The setting hides; the row asks whether to show, so on means more, like every other switch here. */}
                <SettingsRow
                    searchId="chats.showToolCalls"
                    label={t('chats.showToolCalls.label')}
                    description={t('chats.showToolCalls.description')}
                    control={
                        <Switch
                            checked={!hideToolCalls}
                            onCheckedChange={(checked) => update({ chatHideToolCalls: !checked })}
                            label={t('chats.showToolCalls.label')}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('chats.sending.title')}>
                <SettingsRow
                    searchId="chats.sendKey"
                    label={t('chats.sendKey.label')}
                    description={t('chats.sendKey.description')}
                    control={
                        <Select
                            value={sendKey}
                            label={t('chats.sendKey.label')}
                            align="end"
                            items={CHAT_SEND_KEYS.map((key) => ({ value: key, label: sendKeyLabel(key, apple), description: sendKeyHint(key, apple) }))}
                            onValueChange={rememberSendKey}
                        />
                    }
                />
                <SettingSwitchRow id="chats.steerByDefault" setting="chatSteerByDefault" />
            </SettingsSection>
            <SettingsSection title={t('chats.views.title')}>
                <SettingSwitchRow id="chats.showViews" setting="agentsShowViews" />
                <SettingSwitchRow id="chats.mapTiles" setting="chatMapTiles" />
            </SettingsSection>
            <MachineSwitchSection title={t('chats.agents.title')} settings={['visualReplies']} />
        </>
    );
}
