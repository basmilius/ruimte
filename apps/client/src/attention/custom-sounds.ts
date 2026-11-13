import { objectStoreRunner } from '@/endpoint/indexed-db';
import { useSettings } from '@/state/settings';
import { newCustomPackId, SOUND_EVENTS, withProjectSounds, DEFAULT_SOUND_PACK, type CustomSoundPack, type SoundEvent } from '@/state/sounds';

/* A megabyte holds any alert sound; more is a song someone picked by mistake. */
export const SOUND_FILE_MAX_BYTES = 1_000_000;

/* An alert that outlasts this plays over the next one. */
export const SOUND_FILE_MAX_SECONDS = 5;

export type SoundFileRefusal = 'too-large' | 'too-long' | 'unreadable';

/* Where the files of a person's own packs are kept: this client's, never a machine's or a project's. */
export interface CustomSoundFiles {
    read(pack: string, event: SoundEvent): Promise<Blob | null>;
    write(pack: string, event: SoundEvent, file: Blob): Promise<void>;
    remove(pack: string, event: SoundEvent): Promise<void>;
}

function fileKey(pack: string, event: SoundEvent): string {
    return `${pack}/${event}`;
}

function indexedDbFiles(): CustomSoundFiles {
    const run = objectStoreRunner('ruimte.sounds', 'files');

    return {
        read: async (pack, event) => (await run<Blob | undefined>('readonly', (store) => store.get(fileKey(pack, event)))) ?? null,
        write: async (pack, event, file) => {
            await run('readwrite', (store) => store.put(file, fileKey(pack, event)));
        },
        remove: async (pack, event) => {
            await run('readwrite', (store) => store.delete(fileKey(pack, event)));
        }
    };
}

let files: CustomSoundFiles | null = null;

export function customSoundFiles(): CustomSoundFiles {
    files ??= indexedDbFiles();

    return files;
}

/* Replaces the store, for a test; null puts IndexedDB back. */
export function setCustomSoundFiles(next: CustomSoundFiles | null): void {
    files = next;
}

/* How long a sound file plays, in seconds, as the page's own decoder reads it; it rejects for a file the page cannot play. */
export function soundFileSeconds(file: Blob): Promise<number> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        const done = (settle: () => void): void => {
            URL.revokeObjectURL(url);
            settle();
        };

        audio.preload = 'metadata';
        audio.onloadedmetadata = () => done(() => resolve(audio.duration));
        audio.onerror = () => done(() => reject(new Error('The page cannot play this file')));
        audio.src = url;
    });
}

/* Why a file cannot be a notification sound, or null when it can. */
let secondsOf = soundFileSeconds;

/* Replaces how a file's length is read, for a test without a decoder; null puts the page's own back. */
export function setSoundFileSeconds(next: ((file: Blob) => Promise<number>) | null): void {
    secondsOf = next ?? soundFileSeconds;
}

export async function soundFileRefusal(file: Blob): Promise<SoundFileRefusal | null> {
    if (file.size > SOUND_FILE_MAX_BYTES) {
        return 'too-large';
    }

    try {
        const seconds = await secondsOf(file);

        return Number.isFinite(seconds) && seconds <= SOUND_FILE_MAX_SECONDS ? null : 'too-long';
    } catch {
        return 'unreadable';
    }
}

function packs(): CustomSoundPack[] {
    return useSettings.getState().customSoundPacks;
}

/*
 * A new pack of a person's own, without files yet, and the pack in use from now on: of the project named
 * by `projectKey`, which leaves the settings' pack as it is, or else of the settings.
 */
export function addCustomSoundPack(name: string, projectKey?: string): string {
    const id = newCustomPackId();
    const settings = useSettings.getState();
    const customSoundPacks = [...packs(), { id, name, files: {} }];

    if (projectKey === undefined) {
        settings.update({ customSoundPacks, soundPack: id });
    } else {
        settings.update({
            customSoundPacks,
            projectSounds: withProjectSounds(settings.projectSounds, projectKey, { ...settings.projectSounds[projectKey], pack: id })
        });
    }

    return id;
}

export function renameCustomSoundPack(id: string, name: string): void {
    useSettings.getState().update({ customSoundPacks: packs().map((pack) => (pack.id === id ? { ...pack, name } : pack)) });
}

/* Keeps a file as the sound of one event of a pack, or says why not. The file is stored before the settings name it. */
export async function setCustomSound(id: string, event: SoundEvent, file: File): Promise<SoundFileRefusal | null> {
    const refusal = await soundFileRefusal(file);

    if (refusal !== null) {
        return refusal;
    }

    await customSoundFiles().write(id, event, file);
    useSettings
        .getState()
        .update({ customSoundPacks: packs().map((pack) => (pack.id === id ? { ...pack, files: { ...pack.files, [event]: file.name } } : pack)) });

    return null;
}

/* Turns an event off in a pack, or on again: on, it plays the pack's file or, without one, what the settings play. */
export function setCustomSoundOff(id: string, event: SoundEvent, off: boolean): void {
    useSettings.getState().update({
        customSoundPacks: packs().map((pack) => {
            if (pack.id !== id) {
                return pack;
            }

            const { off: _before, ...rest } = pack;
            const events = SOUND_EVENTS.filter((candidate) => (candidate === event ? off : pack.off?.includes(candidate) === true));

            return events.length === 0 ? rest : { ...rest, off: events };
        })
    });
}

/* Removes a pack and its files. Whatever used it, the settings or a project, follows the settings' pack again. */
export async function removeCustomSoundPack(id: string): Promise<void> {
    const settings = useSettings.getState();
    const projects = Object.entries(settings.projectSounds).reduce(
        (kept, [key, sounds]) => (sounds.pack === id ? withProjectSounds(kept, key, { silent: sounds.silent }) : kept),
        settings.projectSounds
    );

    settings.update({
        customSoundPacks: packs().filter((pack) => pack.id !== id),
        soundPack: settings.soundPack === id ? DEFAULT_SOUND_PACK : settings.soundPack,
        projectSounds: projects
    });

    await Promise.all(SOUND_EVENTS.map((event) => customSoundFiles().remove(id, event)));
}
