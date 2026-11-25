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
 * Every pack a person can pick: no sound first and set apart, then the built-in ones, then their own. The
 * last one is set apart too, from the row that makes a new pack, which every list puts under them.
 */
export function soundPackItems(custom: readonly CustomSoundPack[], t: TFunction<'settings'>): { value: string; label: string; separatorAfter?: boolean }[] {
    const ids = [NO_SOUND_PACK, ...SOUND_PACKS, ...custom.map((pack) => pack.id)];

    return ids.map((id, i) => ({
        value: id,
        label: soundPackName(id, custom, t),
        ...(id === NO_SOUND_PACK || i === ids.length - 1 ? { separatorAfter: true } : {})
    }));
}
