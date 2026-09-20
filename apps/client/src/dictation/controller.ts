import { create } from 'zustand';
import i18next from 'i18next';
import type { SpeechState } from '@ruimte/desktop-bridge';
import { claimMicrophone } from '@/audio/ownership';
import { desktop } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { helperEngine } from './helper';
import { applyChunk, EMPTY_TRANSCRIPT, transcriptText } from './transcript';
import type { DictationSession } from './engine';

export const SPEECH_LOCALES: Record<string, string> = {
    ar: 'ar-AR',
    zh: 'zh-CN',
    cs: 'cs-CZ',
    da: 'da-DK',
    nl: 'nl-NL',
    en: 'en-GB',
    fi: 'fi-FI',
    fr: 'fr-FR',
    de: 'de-DE',
    hi: 'hi-IN',
    hu: 'hu-HU',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    no: 'nb-NO',
    pl: 'pl-PL',
    pt: 'pt-PT',
    ro: 'ro-RO',
    ru: 'ru-RU',
    es: 'es-ES',
    sv: 'sv-SE',
    tr: 'tr-TR',
    uk: 'uk-UA',
    vi: 'vi-VN'
};

export interface DictationInsertion {
    insert(text: string): void;
    preview?(text: string): void;
    levels?(bands: readonly number[] | null): void;
    dispose?(): void;
}
export interface DictationTarget {
    id: string;
    element: HTMLElement;
    capture(): DictationInsertion | null;
}
interface State {
    model: SpeechState | null;
    targetId: string | null;
    phase: 'idle' | 'starting' | 'listening' | 'finishing' | 'error';
    text: string;
    error: string | null;
    bands: number[];
}
export const useDictation = create<State>(() => ({ model: null, targetId: null, phase: 'idle', text: '', error: null, bands: [] }));
const targets = new Map<HTMLElement, DictationTarget>();
let session: DictationSession | null = null;
let generation = 0;
let releaseAudio: (() => void) | null = null;
let insertion: DictationInsertion | null = null;
let observers = 0;
let releaseModel: (() => void) | null = null;

export const observeSpeech = (): (() => void) => {
    const bridge = desktop()?.speech;
    if (!bridge?.state) {
        return () => undefined;
    }
    if (observers++ === 0) {
        let active = true;
        let receivedEvent = false;
        const receive = (model: SpeechState): void => {
            if (!active) {
                return;
            }
            useDictation.setState({ model });
            if (!model.enabled) {
                cancelDictation();
            }
        };
        const off = bridge.onState((model) => {
            receivedEvent = true;
            receive(model);
        });
        releaseModel = () => {
            active = false;
            off();
        };
        void bridge
            .state()
            .then((model) => {
                if (!receivedEvent) {
                    receive(model);
                }
            })
            .catch(() => undefined);
    }
    return () => {
        if (--observers === 0) {
            releaseModel?.();
            releaseModel = null;
            cancelDictation();
        }
    };
};

export const registerDictationTarget = (target: DictationTarget): (() => void) => {
    targets.set(target.element, target);
    return () => {
        targets.delete(target.element);
        if (useDictation.getState().targetId === target.id) {
            cancelDictation();
        }
    };
};

export const cancelDictation = (): void => {
    generation++;
    const current = session;
    session = null;
    insertion?.dispose?.();
    insertion = null;
    releaseAudio?.();
    releaseAudio = null;
    current?.cancel();
    useDictation.setState({ targetId: null, phase: 'idle', text: '', error: null, bands: [] });
};

export const stopDictation = (): void => {
    if (useDictation.getState().phase === 'starting') {
        cancelDictation();
        return;
    }
    if (useDictation.getState().phase !== 'listening') {
        return;
    }
    useDictation.setState({ phase: 'finishing' });
    insertion?.levels?.(null);
    session?.stop();
};

export const toggleDictation = (target: DictationTarget): void => {
    const state = useDictation.getState();
    if (state.targetId === target.id && state.phase !== 'error') {
        stopDictation();
        return;
    }
    if (!state.model?.enabled || state.model.phase !== 'ready') {
        return;
    }
    cancelDictation();
    const captured = target.capture();
    if (!captured) {
        return;
    }
    insertion = captured;
    const token = generation;
    const language = SPEECH_LOCALES[useSettings.getState().voiceLanguage];
    if (!language) {
        insertion.dispose?.();
        insertion = null;
        useDictation.setState({ targetId: target.id, phase: 'error', error: i18next.t('voice:dictation.unsupportedLanguage') });
        return;
    }
    releaseAudio = claimMicrophone(cancelDictation);
    useDictation.setState({ targetId: target.id, phase: 'starting', text: '', error: null, bands: [] });
    let finalText: string | null = null;
    let failed = false;
    try {
        session = helperEngine.start(
            { language, deviceId: useSettings.getState().voiceInputDeviceId },
            {
                onReady: () => {
                    if (generation === token) {
                        useDictation.setState({ phase: 'listening' });
                        captured.levels?.([]);
                    }
                },
                onChunk: (chunk) => {
                    if (generation !== token) {
                        return;
                    }
                    const text = transcriptText(applyChunk(EMPTY_TRANSCRIPT, chunk));
                    captured.preview?.(text);
                    useDictation.setState({ text });
                    if (chunk.final) {
                        finalText = chunk.text;
                    }
                },
                onBands: (bands) => {
                    if (generation === token) {
                        if (useDictation.getState().phase === 'listening') captured.levels?.(bands);
                        useDictation.setState({ bands });
                    }
                },
                onError: (error) => {
                    if (generation !== token) {
                        return;
                    }
                    failed = true;
                    useDictation.setState({ phase: 'error', error: error.message });
                },
                onEnd: () => {
                    if (generation !== token) {
                        return;
                    }
                    session = null;
                    releaseAudio?.();
                    releaseAudio = null;
                    const commit = !failed && finalText !== null && useDictation.getState().phase === 'finishing' && target.element.isConnected;
                    try {
                        if (commit && finalText !== null && finalText.trim() !== '') {
                            captured.insert(finalText);
                        }
                    } catch (error) {
                        failed = true;
                        useDictation.setState({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
                    }
                    captured.dispose?.();
                    insertion = null;
                    if (!failed) {
                        useDictation.setState({ targetId: null, phase: 'idle', text: '', bands: [] });
                    }
                }
            }
        );
    } catch (error) {
        cancelDictation();
        useDictation.setState({ targetId: target.id, phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
};

export const toggleFocusedDictation = (): boolean => {
    if (session) {
        stopDictation();
        return true;
    }
    let element = document.activeElement;
    while (element instanceof HTMLElement) {
        const target = targets.get(element);
        if (target && useDictation.getState().model?.enabled) {
            toggleDictation(target);
            return true;
        }
        element = element.parentElement;
    }
    return false;
};
