import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { idleVoiceBands, type IdleVoiceBands } from '@/voice/idle-waveform';
import { useVoice, type VoicePhase } from '@/voice/state';

const waveformHeight = (value: number): string => `${Math.max(2, value * 26).toFixed(2)}px`;

function useDisplayedWaveform(phase: VoicePhase, inputBands: number[], outputBands: number[]): IdleVoiceBands {
    const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const count = inputBands.length;
    const phaseRef = useRef(phase);
    const liveBandsRef = useRef<IdleVoiceBands>({ input: inputBands, output: outputBands });
    const [bands, setBands] = useState(() => idleVoiceBands(0, count));
    const displayedRef = useRef(bands);

    useEffect(() => {
        phaseRef.current = phase;
        liveBandsRef.current = { input: inputBands, output: outputBands };
    }, [phase, inputBands, outputBands]);

    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const changed = () => setReducedMotion(query.matches);
        query.addEventListener('change', changed);
        return () => query.removeEventListener('change', changed);
    }, []);

    useEffect(() => {
        if (reducedMotion) {
            return;
        }
        let frame = 0;
        let previous = performance.now();
        const animate = (now: number) => {
            const target = phaseRef.current === 'listening' ? liveBandsRef.current : idleVoiceBands(now, count);
            const response = 1 - Math.exp(-(now - previous) / 110);
            previous = now;
            const current = displayedRef.current;
            const next = {
                input: Array.from({ length: count }, (_, index) => {
                    const value = target.input[index] ?? 0;
                    return (current.input[index] ?? value) + (value - (current.input[index] ?? value)) * response;
                }),
                output: Array.from({ length: count }, (_, index) => {
                    const value = target.output[index] ?? 0;
                    return (current.output[index] ?? value) + (value - (current.output[index] ?? value)) * response;
                })
            };
            displayedRef.current = next;
            setBands(next);
            frame = window.requestAnimationFrame(animate);
        };
        frame = window.requestAnimationFrame(animate);
        return () => window.cancelAnimationFrame(frame);
    }, [count, reducedMotion]);

    if (!reducedMotion) {
        return bands;
    }
    return phase === 'listening' ? { input: inputBands, output: outputBands } : idleVoiceBands(0, count);
}

export function VoiceWaveform({ phase, compact = false }: { phase: VoicePhase; compact?: boolean }) {
    const { t } = useTranslation('voice');
    const inputBands = useVoice((state) => state.inputBands);
    const outputBands = useVoice((state) => state.outputBands);
    const listening = phase === 'listening';
    const displayed = useDisplayedWaveform(phase, inputBands, outputBands);
    const inputSpeaking = listening && Math.max(0, ...inputBands) > 0.06;
    const outputSpeaking = listening && Math.max(0, ...outputBands) > 0.04;
    const inputLabel = listening ? (inputSpeaking ? 'speaking' : 'listening') : 'idle';
    const outputLabel = listening ? (outputSpeaking ? 'speaking' : 'listening') : 'idle';

    return (
        <section
            className={
                compact
                    ? 'w-full'
                    : 'relative z-10 shrink-0 px-4 pt-4 pb-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-gradient-to-b after:from-surface after:to-transparent'
            }
            aria-label={t('waveform')}
        >
            {!compact && (
                <div className="flex items-center justify-between text-xs font-medium tracking-wide uppercase tabular-nums">
                    <span className={inputSpeaking ? 'text-text' : 'text-text-muted'}>
                        {t('speaker.person')} · {inputLabel}
                    </span>
                    <span className={outputSpeaking ? 'text-accent' : 'text-text-muted'}>
                        {t('speaker.assistant')} · {outputLabel}
                    </span>
                </div>
            )}
            <div className="relative mt-3 flex h-14 items-center gap-0.5" role="img" aria-label={t('waveformLines')}>
                <span className="absolute inset-x-0 top-1/2 z-10 h-px bg-surface" />
                {displayed.input.map((input, index) => {
                    const output = displayed.output[index] ?? 0;
                    return (
                        <span key={index} className="relative h-full min-w-0 grow" aria-hidden="true">
                            <span
                                className="voice-waveform-input absolute right-0 bottom-1/2 left-0 rounded-t-sm bg-accent/60"
                                style={{ height: waveformHeight(input) }}
                            />
                            <span
                                className="voice-waveform-output absolute top-1/2 right-0 left-0 rounded-b-sm bg-accent"
                                style={{ height: waveformHeight(output) }}
                            />
                        </span>
                    );
                })}
            </div>
        </section>
    );
}
