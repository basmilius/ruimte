import { IconButton } from '@adecore/ui';
import { CircleAlert, Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKeyOf } from '@/shell/shortcut-overrides';
import type { DictationPhase } from './controller';

/* The microphone button of a field or a terminal; `phase` is `idle` while another target dictates. */
export function DictationButton({
    phase,
    error,
    disabled,
    size,
    onToggle
}: {
    phase: DictationPhase;
    error: string | null;
    disabled: boolean;
    size?: 'sm';
    onToggle(): void;
}) {
    const { t } = useTranslation('voice');
    const working = phase === 'starting' || phase === 'finishing';
    const recording = phase === 'listening';
    const key = useKeyOf('dictation');

    return (
        <IconButton
            icon={recording ? Square : error ? CircleAlert : Mic}
            busy={working}
            size={size}
            label={error || (working ? t(`dictation.${phase}`) : recording ? t('dictation.stop') : t('dictation.start'))}
            kbd={key}
            aria-pressed={recording}
            aria-busy={working}
            className={error ? 'text-status-error' : recording ? 'text-accent' : undefined}
            disabled={disabled}
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
            onClick={onToggle}
        />
    );
}
