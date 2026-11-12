import { SOUND_MOTIFS, type BuiltInSoundPack, type SoundEvent } from '@/state/sounds';

/*
 * Where the build put a built-in sound. The bundler turns this one expression into a module per file, which
 * is why it stands in a module of its own that loads on the first sound, outside what the start screen preloads.
 */
export function builtInSoundUrl(pack: BuiltInSoundPack, event: SoundEvent): string {
    return new URL(`./sounds/${pack}/${SOUND_MOTIFS[event]}.wav`, import.meta.url).href;
}
