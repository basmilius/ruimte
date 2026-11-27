import { Switch, ErrorBoundary, FormError, messageOf } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop } from '@/desktop/bridge';
import { cancelDictation, observeSpeech, useDictation } from '@/dictation/controller';
import { SettingsSection } from '@/machines/SettingsSection';

export function DictationSection() {
    const { t } = useTranslation('voice');
    return (
        <ErrorBoundary label={t('dictation.failed')} className="relative" compact>
            <Section />
        </ErrorBoundary>
    );
}

function Section() {
    const { t } = useTranslation('voice');
    const speech = useDictation((state) => state.speech);
    const [error, setError] = useState<string | null>(null);
    const bridge = desktop()?.speech;

    useEffect(observeSpeech, []);

    const setEnabled = async (enabled: boolean): Promise<void> => {
        if (!bridge) {
            return;
        }

        if (!enabled) {
            cancelDictation();
        }

        setError(null);

        try {
            await bridge.setEnabled(enabled);
        } catch (error) {
            setError(messageOf(error));
        }
    };

    return (
        <SettingsSection title={t('dictation.title')} description={t('dictation.description')} scope="computer">
            <SettingsRow
                searchId="voice.dictation"
                label={t('dictation.enable')}
                description={!bridge?.state ? t('dictation.desktopOnly') : speech?.phase === 'unavailable' ? t('dictation.unavailable') : t('dictation.hint')}
                control={
                    <Switch
                        checked={speech?.enabled === true}
                        disabled={!bridge?.state || !speech || speech.phase === 'unavailable'}
                        label={t('dictation.enable')}
                        onCheckedChange={(enabled) => void setEnabled(enabled)}
                    />
                }
            >
                {(error || speech?.error) && <FormError>{error || speech?.error}</FormError>}
            </SettingsRow>
        </SettingsSection>
    );
}
