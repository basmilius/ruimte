import i18next from 'i18next';
import { knownMicrophoneFailure } from '@/audio/microphone-failure';
import { DictationError } from './engine';

/* What a person reads when dictation stops on a failure. A code or a message from Chromium or the helper never reaches them. */
export const dictationFailureText = (error: unknown): string => {
    if (error instanceof DictationError) {
        return i18next.t(`voice:dictation.errors.${error.code}`);
    }
    return knownMicrophoneFailure(error) ?? i18next.t('voice:dictation.errors.unknown');
};
