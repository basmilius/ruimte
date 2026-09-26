import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FadingWords } from '@/chat/ui/FadingWords';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { useVoice } from '@/voice/state';
import { VoiceWaveform } from '@/voice/VoiceWaveform';

function VoiceOverlayContent({ visible }: { visible: boolean }) {
    const { t } = useTranslation('voice');
    const phase = useVoice((state) => state.phase);
    const error = useVoice((state) => state.error);
    const transcript = useVoice((state) => state.transcript);
    const caption = useRef<HTMLParagraphElement>(null);
    const latest = transcript.at(-1);
    const currentText = error ?? (phase === 'listening' ? latest?.text : null) ?? t(`phase.${phase}`);
    const currentKey = error ? 'error' : phase === 'listening' && latest ? latest.id : phase;
    const [displayed, setDisplayed] = useState({ text: currentText, key: currentKey });
    if (visible && (displayed.text !== currentText || displayed.key !== currentKey)) {
        setDisplayed({ text: currentText, key: currentKey });
    }

    useEffect(() => {
        if (caption.current) {
            caption.current.scrollTop = caption.current.scrollHeight;
        }
    }, [displayed.text]);

    return (
        <div className="flex justify-center px-6 pt-20 pb-8 before:absolute before:inset-0 before:bg-gradient-to-t before:from-bg before:via-bg/90 before:to-transparent">
            <button
                type="button"
                className="pointer-events-auto relative flex w-full max-w-lg flex-col items-center gap-3 rounded-xl px-4 py-2 text-center text-text"
                aria-label={t('button')}
                onClick={() => useVoice.getState().setOpen(true)}
            >
                <p ref={caption} className="max-h-24 overflow-y-auto text-sm leading-6 whitespace-pre-wrap [text-wrap:pretty]" role="status" aria-live="polite">
                    <FadingWords key={displayed.key} text={displayed.text} />
                </p>
                <VoiceWaveform phase={phase} compact />
            </button>
        </div>
    );
}

export function VoiceOverlay() {
    const { t } = useTranslation('voice');
    const open = useVoice((state) => state.open);
    const phase = useVoice((state) => state.phase);
    const visible = !open && phase !== 'idle';
    const [present, setPresent] = useState(visible);
    if (visible && !present) {
        setPresent(true);
    }

    useEffect(() => {
        if (visible || !present) {
            return;
        }
        // Reduced motion and background tabs may skip transitionend.
        const timer = window.setTimeout(() => setPresent(false), 200);
        return () => window.clearTimeout(timer);
    }, [visible, present]);

    return (
        <div
            className="pointer-events-none fixed inset-x-0 bottom-0 z-40 transition-[opacity,translate] duration-150 ease-out data-[visible=true]:duration-200"
            data-visible={visible}
            style={{ opacity: visible ? 1 : 0, translate: visible ? '0 0' : '0 8px' }}
            inert={!visible}
            aria-hidden={!visible}
            onTransitionEnd={(event) => {
                if (!visible && event.target === event.currentTarget && event.propertyName === 'opacity') {
                    setPresent(false);
                }
            }}
        >
            {present && (
                <ErrorBoundary label={t('displayFailed')} resetKeys={[phase]} compact className="mx-6 mb-8">
                    <VoiceOverlayContent visible={visible} />
                </ErrorBoundary>
            )}
        </div>
    );
}
