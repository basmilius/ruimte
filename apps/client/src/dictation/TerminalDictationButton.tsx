import { useEffect } from 'react';
import { CircleAlert, LoaderCircle, Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEndpointId } from '@/state/keys';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
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
    if (!enabled) return null;
    const working = phase === 'starting' || phase === 'finishing';
    const recording = phase === 'listening';
    const label = error || (working ? t(`dictation.${phase}`) : recording ? t('dictation.stop') : t('dictation.start'));
    return (
        <Tooltip label={label} kbd={CANVAS_SHORTCUTS.dictation} name>
            <button
                type="button"
                className={`icon-btn ${error ? 'text-status-error' : recording ? 'text-accent' : ''}`}
                disabled={!target || phase === 'finishing'}
                aria-pressed={recording}
                aria-busy={working}
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={() => {
                    if (target) toggleDictation(target);
                }}
            >
                <Icon
                    icon={working ? LoaderCircle : recording ? Square : error ? CircleAlert : Mic}
                    size={16}
                    className={working ? 'animate-spin motion-reduce:animate-none' : undefined}
                />
            </button>
        </Tooltip>
    );
}
