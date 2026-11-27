import type { SelectItem } from '@adecore/ui';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/state/settings';
import { soundPackItems } from '@/state/sound-packs';
import { packSound, type SoundEvent } from '@/state/sounds';
import { playSound } from './sounds';

/* The three notes of a finished turn say the most about the voice of a pack. */
const SAMPLE: SoundEvent = 'finished';

/* Every pack a person can pick, each with a button that plays a sample, so comparing packs does not close the list. */
export function useSoundPackItems(): SelectItem<string>[] {
    const { t } = useTranslation('settings');
    const soundPack = useSettings((s) => s.soundPack);
    const customSoundPacks = useSettings((s) => s.customSoundPacks);

    return soundPackItems(customSoundPacks, t).map((item) => {
        const sound = packSound({ soundPack, customSoundPacks }, item.value, SAMPLE);

        if (sound === null) {
            return item;
        }

        return { ...item, action: { icon: Play, label: t('agents.sounds.playPack', { pack: item.label }), run: () => playSound(sound) } };
    });
}
