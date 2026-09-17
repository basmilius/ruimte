import { useEffect } from 'react';
import { Mic } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { closeVoicePanel } from '@/voice/controller';
import { refreshVoiceCredential, useVoice } from '@/voice/state';

export function VoiceButton() {
    const configured = useVoice((state) => state.credential?.configured === true);
    const open = useVoice((state) => state.open);
    const active = useVoice((state) => state.phase === 'connecting' || state.phase === 'listening');

    useEffect(() => {
        void refreshVoiceCredential().catch(() => undefined);
    }, []);

    if (!configured) {
        return null;
    }
    return (
        <Tooltip label="Voice" name>
            <button
                className="icon-btn"
                aria-pressed={open}
                data-active={active || undefined}
                onClick={() => (open ? closeVoicePanel() : useVoice.getState().setOpen(true))}
            >
                <Icon icon={Mic} size={16} />
            </button>
        </Tooltip>
    );
}
