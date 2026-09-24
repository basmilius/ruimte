import i18next from 'i18next';

/* Why a microphone would not open, in words a person can act on; null for a failure that is not about opening it. */
export const knownMicrophoneFailure = (error: unknown): string | null => {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return i18next.t('common:microphone.error.denied');
    }
    if (error instanceof DOMException && error.name === 'NotFoundError') {
        return i18next.t('common:microphone.error.missing');
    }
    return null;
};

export const microphoneFailureText = (error: unknown): string =>
    knownMicrophoneFailure(error) ?? (error instanceof Error ? error.message : i18next.t('common:microphone.error.failed'));
