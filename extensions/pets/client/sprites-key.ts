/*
 * The storage key of the pets a person added, apart from their store, so every window can follow it
 * without loading the store before a canvas or the settings ask for pets.
 */
export const PET_SPRITES_KEY = 'sprites';

// Where they lived before pets ran on the extension API.
export const LEGACY_SPRITES_KEY = 'ruimte.pets.sprites';

let reloadSprites: (() => void) | null = null;

/* Set by the store once it is loaded; until then there is nothing in memory to bring up to date. */
export function onPetSpritesChanged(reload: () => void): void {
    reloadSprites = reload;
}

/* Another window wrote the key. */
export function petSpritesChanged(): void {
    reloadSprites?.();
}
