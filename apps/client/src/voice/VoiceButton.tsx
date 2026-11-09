import { IconButton } from '@adecore/ui';
import { Mic } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '@/state/ui';
import { useKeyOf } from '@/surface/shortcut-overrides';
import { fireAndForget } from '@/transport-api/transport';
import { refreshVoiceCredential, useVoice, useVoicePanelOpen } from '@/voice/state';

export function VoiceButton() {
    const { t } = useTranslation('voice');
    const configured = useVoice((state) => state.credential?.configured === true);
    const open = useVoicePanelOpen();
    const active = useVoice((state) => state.phase === 'connecting' || state.phase === 'listening');
    const key = useKeyOf('voice-control');

    useEffect(() => {
        void fireAndForget('refreshVoiceCredential', refreshVoiceCredential());
    }, []);

    if (!configured) {
        return null;
    }
    return (
        <IconButton
            icon={Mic}
            label={t('shortcut')}
            kbd={key}
            tooltipSide="left"
            aria-pressed={open}
            active={active}
            onClick={() => useUi.getState().togglePanel('voice')}
        />
    );
}
