import i18next from 'i18next';
import { useSettings } from '@/state/settings';
import { packSound, type SoundEvent } from '@/state/sounds';
import { playSound } from './sounds';
import { mayNotify, raiseNotification } from './system-notification';

/* The preview on screen, closed before the next so trying every event leaves one notification behind. */
let shown: Notification | null = null;

function line(event: SoundEvent): string {
    if (event === 'alert') {
        return i18next.t('settings:agents.notify.sampleAlert');
    }

    return i18next.t(`shell:notifications.${event === 'question' ? 'needsYou' : event}`);
}

/*
 * Shows a person what an event is like on this computer, whether or not it is on: its notification, and
 * its sound while the pack of the settings has one.
 */
export function previewEvent(event: SoundEvent): void {
    const settings = useSettings.getState();
    const sound = packSound(settings, settings.soundPack, event);

    if (mayNotify()) {
        shown?.close();
        shown = raiseNotification(i18next.t('settings:agents.notify.sample'), { body: line(event), silent: true }, () => undefined);
    }

    if (sound !== null) {
        playSound(sound);
    }
}
