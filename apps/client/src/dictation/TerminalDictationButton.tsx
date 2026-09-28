import { useEffect } from 'react';
import { CircleAlert, Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEndpointId } from '@/state/keys';
import { ErrorBoundary, IconButton } from '@basmilius/react-ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { observeSpeech, toggleDictation, useDictation } from './controller';
import { terminalTargetKey, useTerminalDictationTargets } from './terminal-targets';

export function TerminalDictationButton(props: { terminalId: string | null }) {
    const { t } = useTranslation('voice');
    return (
        <ErrorBoundary label={t('dictation.failed')} compact className="contents">
            <Control {...props} />
        </ErrorBoundary>
    );
}

function Control({ terminalId }: { terminalId: string | null }) {
    const { t } = useTranslation('voice');
    const endpointId = useEndpointId();
    const target = useTerminalDictationTargets((state) => (terminalId ? state.targets.get(terminalTargetKey(endpointId, terminalId)) : undefined));
    const enabled = useDictation((state) => state.model?.enabled === true);
    const phase = useDictation((state) => (target && state.targetId === target.id ? state.phase : 'idle'));
    const error = useDictation((state) => (target && state.targetId === target.id ? state.error : null));
    useEffect(observeSpeech, []);
    if (!enabled) {
        return null;
    }
    const working = phase === 'starting' || phase === 'finishing';
    const recording = phase === 'listening';
    const label = error || (working ? t(`dictation.${phase}`) : recording ? t('dictation.stop') : t('dictation.start'));
    return (
        <IconButton
            icon={recording ? Square : error ? CircleAlert : Mic}
            busy={working}
            label={label}
            kbd={CANVAS_SHORTCUTS.dictation}
            className={error ? 'text-status-error' : recording ? 'text-accent' : undefined}
            disabled={!target || phase === 'finishing'}
            aria-pressed={recording}
            aria-busy={working}
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
            onClick={() => {
                if (target) {
                    toggleDictation(target);
                }
            }}
        />
    );
}
