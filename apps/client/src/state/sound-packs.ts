import type { TFunction } from 'i18next';
import { isBuiltInPack, SOUND_PACKS, type CustomSoundPack } from '@/state/sounds';

/* A pack's name as a person reads it: a built-in one in their language, their own as they named it. */
export function soundPackName(id: string, custom: readonly CustomSoundPack[], t: TFunction<'settings'>): string {
    return isBuiltInPack(id) ? t(`agents.sounds.packs.${id}`) : (custom.find((pack) => pack.id === id)?.name ?? id);
}

/* Every pack a person can pick, the built-in ones first. */
export function soundPackItems(custom: readonly CustomSoundPack[], t: TFunction<'settings'>): { value: string; label: string }[] {
    return [...SOUND_PACKS, ...custom.map((pack) => pack.id)].map((id) => ({ value: id, label: soundPackName(id, custom, t) }));
}
