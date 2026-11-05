import { Button, ErrorBoundary, ScrollArea, TextArea } from '@adecore/ui';
import { useEffect, useId, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useEndpointId } from '@/state/current-endpoint';
import { observeSpeech, registerDictationTarget, useDictation } from './controller';
import { terminalDictationText } from './terminal';
import { registerTerminalDictationTarget, terminalTargetKey } from './terminal-targets';

function TerminalControl({
    terminalId,
    targetRef,
    paste,
    disabled
}: {
    terminalId: string;
    targetRef: RefObject<HTMLElement | null>;
    paste(text: string): void;
    disabled: boolean;
}) {
    const { t } = useTranslation('voice');
    const endpointId = useEndpointId();
    const id = useId();
    const [draft, setDraft] = useState<string | null>(null);
    const text = useDictation((state) => (state.targetId === id && state.phase !== 'error' ? state.text : ''));
    const error = useDictation((state) => (state.targetId === id ? state.error : null));
    useEffect(observeSpeech, []);
    useEffect(() => {
        const element = targetRef.current;
        if (!element || disabled) {
            return;
        }
        const target = { id, element, capture: () => ({ insert: (text: string) => setDraft(terminalDictationText(text)) }) };
        const unregister = registerDictationTarget(target);
        const unregisterTerminal = registerTerminalDictationTarget(terminalTargetKey(endpointId, terminalId), target);
        return () => {
            unregisterTerminal();
            unregister();
        };
    }, [id, endpointId, terminalId, targetRef, disabled]);
    return (
        <div className="relative shrink-0 bg-term-bg" onPointerDown={(event) => event.stopPropagation()}>
            {text && (
                <ScrollArea
                    render={<p />}
                    className="max-h-32"
                    viewportClassName="whitespace-pre-wrap break-words p-2 text-sm text-text"
                    aria-label={t('dictation.preview')}
                >
                    {text}
                </ScrollArea>
            )}
            {error && (
                <span role="alert" className="sr-only">
                    {error}
                </span>
            )}
            {draft !== null && (
                <div className="flex flex-col gap-2 border-t border-border p-2">
                    <TextArea
                        resize="vertical"
                        className="w-full"
                        aria-label={t('dictation.terminalDraft')}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                    />
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            disabled={disabled || !draft.trim()}
                            onClick={() => {
                                paste(terminalDictationText(draft));
                                setDraft(null);
                            }}
                        >
                            {t('dictation.paste')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>
                            {t('dictation.discard')}
                        </Button>
                        <span className="text-xs text-text-muted">{t('dictation.noEnter')}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export function TerminalDictation(props: Parameters<typeof TerminalControl>[0]) {
    const { t } = useTranslation('voice');
    return (
        <ErrorBoundary label={t('dictation.failed')} className="relative" compact>
            <TerminalControl {...props} />
        </ErrorBoundary>
    );
}
