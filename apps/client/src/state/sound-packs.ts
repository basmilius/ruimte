import { labelCollator } from '@adecore/ui/format';
import type { TFunction } from 'i18next';
import { isBuiltInPack, NO_SOUND_PACK, SOUND_PACKS, type CustomSoundPack } from '@/state/sounds';

/* A pack's name as a person reads it: a built-in one in their language, their own as they named it. */
export function soundPackName(id: string, custom: readonly CustomSoundPack[], t: TFunction<'settings'>): string {
    if (id === NO_SOUND_PACK) {
        return t('agents.sounds.none');
    }

    return isBuiltInPack(id) ? t(`agents.sounds.packs.${id}`) : (custom.find((pack) => pack.id === id)?.name ?? id);
}

/*
 * Every pack a person can pick: no sound first and set apart, then the built-in ones by their name in the
 * person's language, then their own. The last one is set apart too, from the row that makes a new pack,
 * which every list puts under them.
 */
export function soundPackItems(custom: readonly CustomSoundPack[], t: TFunction<'settings'>): { value: string; label: string; separatorAfter?: boolean }[] {
    const order = labelCollator();
    const named = (id: string) => ({ value: id, label: soundPackName(id, custom, t) });
    const builtIn = SOUND_PACKS.map(named).sort((one, other) => order.compare(one.label, other.label));
    const items = [named(NO_SOUND_PACK), ...builtIn, ...custom.map((pack) => named(pack.id))];

    return items.map((item, i) => (i === 0 || i === items.length - 1 ? { ...item, separatorAfter: true } : item));
}
