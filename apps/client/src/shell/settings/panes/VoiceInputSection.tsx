import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VOICE_LANGUAGES } from '@ruimte/contracts';
import { DEFAULT_MICROPHONE_ID, listMicrophones, type MicrophoneDevice } from '@/audio/microphone';
import { useSettings } from '@/state/settings';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Select } from '@ruimte/ui/Select';

export function VoiceInputSection() {
    const { t } = useTranslation('settings');
    const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
    const [microphonesAvailable, setMicrophonesAvailable] = useState(() => navigator.mediaDevices !== undefined);
    const language = useSettings((state) => state.voiceLanguage);
    const microphoneId = useSettings((state) => state.voiceInputDeviceId);
    const updateSettings = useSettings((state) => state.update);
    useEffect(() => {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices) {
            return;
        }
        let current = true;
        let permission: PermissionStatus | null = null;
        const refresh = (): void => {
            void listMicrophones()
                .then((devices) => {
                    if (current) {
                        setMicrophones(devices);
                        setMicrophonesAvailable(true);
                    }
                })
                .catch(() => {
                    if (current) {
                        setMicrophonesAvailable(false);
                    }
                });
        };
        refresh();
        mediaDevices.addEventListener('devicechange', refresh);
        void navigator.permissions
            ?.query({ name: 'microphone' as PermissionName })
            .then((status) => {
                if (!current) {
                    return;
                }
                permission = status;
                permission.addEventListener('change', refresh);
            })
            .catch(() => undefined);
        return () => {
            current = false;
            mediaDevices.removeEventListener('devicechange', refresh);
            permission?.removeEventListener('change', refresh);
        };
    }, []);

    const microphoneItems = [
        { value: DEFAULT_MICROPHONE_ID, label: t('voice.microphone.systemDefault'), description: t('voice.microphone.systemDefaultHint') },
        ...microphones.map((device) => ({ value: device.id, label: device.label })),
        ...(microphoneId !== DEFAULT_MICROPHONE_ID && !microphones.some((device) => device.id === microphoneId)
            ? [{ value: microphoneId, label: t('voice.microphone.unavailable'), description: t('voice.microphone.unavailableHint'), disabled: true }]
            : [])
    ];

    return (
        <SettingsSection title={t('voice.input.title')} description={t('voice.input.description')}>
            <SettingsRow
                searchId="voice.microphone"
                label={t('voice.conversation.microphone.label')}
                description={microphonesAvailable ? t('voice.conversation.microphone.description') : t('voice.conversation.microphone.unavailableDescription')}
                control={
                    <Select
                        value={microphoneId}
                        items={microphoneItems}
                        label={t('voice.conversation.microphone.selectLabel')}
                        align="end"
                        className="max-w-72"
                        onValueChange={(voiceInputDeviceId) => updateSettings({ voiceInputDeviceId })}
                    />
                }
            />
            <SettingsRow
                searchId="voice.language"
                label={t('voice.conversation.language.label')}
                description={t('voice.conversation.language.description')}
                control={
                    <Select
                        value={language}
                        items={VOICE_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))}
                        label={t('voice.conversation.language.selectLabel')}
                        align="end"
                        onValueChange={(voiceLanguage) => updateSettings({ voiceLanguage })}
                    />
                }
            />
        </SettingsSection>
    );
}
