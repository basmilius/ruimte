import { ErrorBoundary } from '@adecore/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEndpointId } from '@/state/keys';
import { observeSpeech, toggleDictation, useDictation } from './controller';
import { DictationButton } from './DictationButton';
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
    const endpointId = useEndpointId();
    const target = useTerminalDictationTargets((state) => (terminalId ? state.targets.get(terminalTargetKey(endpointId, terminalId)) : undefined));
    const enabled = useDictation((state) => state.model?.enabled === true);
    const phase = useDictation((state) => (target && state.targetId === target.id ? state.phase : 'idle'));
    const error = useDictation((state) => (target && state.targetId === target.id ? state.error : null));
    useEffect(observeSpeech, []);
    if (!enabled) {
        return null;
    }
    return (
        <DictationButton
            phase={phase}
            error={error}
            disabled={!target || phase === 'finishing'}
            onToggle={() => {
                if (target) {
                    toggleDictation(target);
                }
            }}
        />
    );
}
