import { messageOf } from '@adecore/ui';
import i18next from 'i18next';

/* Why a microphone would not open, in words a person can act on; null for a failure that is not about opening it. */
export function knownMicrophoneFailure(error: unknown): string | null {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return i18next.t('common:microphone.error.denied');
    }
    if (error instanceof DOMException && error.name === 'NotFoundError') {
        return i18next.t('common:microphone.error.missing');
    }
    // What Chromium reports when macOS holds the microphone back without asking, or another app holds it.
    if (error instanceof DOMException && error.name === 'NotReadableError') {
        return i18next.t('common:microphone.error.unreadable');
    }
    return null;
}

export function microphoneFailureText(error: unknown): string {
    return knownMicrophoneFailure(error) ?? messageOf(error, i18next.t('common:microphone.error.failed'));
}
