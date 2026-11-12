import { useSettings } from '@/state/settings';
import { isBuiltInPack, projectSoundKey, soundFor, type SoundChoice, type SoundEvent } from '@/state/sounds';
import { customSoundFiles } from './custom-sounds';

/* The same sound within this long plays once, so a team that finishes together sounds once. */
const REPEAT_MS = 1_000;

/* What playing stands on, so a test hears what would have sounded without a speaker, a clock or a second window. */
export interface SoundPorts {
    play(url: string): Promise<void>;
    now(): number;

    /* Whether this window is the one that plays the sound of `tag`; an alert every window hears is claimed by one. */
    claim(tag: string): Promise<boolean>;
}

const REAL_PORTS: SoundPorts = {
    play: (url) => new Audio(url).play(),
    now: () => Date.now(),
    claim: (tag) => {
        if (typeof navigator === 'undefined' || navigator.locks === undefined) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            void navigator.locks.request(`ruimte-sound-${tag}`, { ifAvailable: true }, (lock) => {
                resolve(lock !== null);

                // Held for as long as another window may still get the same alert.
                return lock === null ? undefined : new Promise<void>((release) => setTimeout(release, REPEAT_MS));
            });
        });
    }
};

let ports = REAL_PORTS;
const lastPlayed = new Map<string, number>();

/* Replaces what playing stands on, for a test; the returned function puts the real ones back. */
export function setSoundPorts(next: Partial<SoundPorts>): () => void {
    ports = { ...REAL_PORTS, ...next };
    lastPlayed.clear();

    return () => {
        ports = REAL_PORTS;
        lastPlayed.clear();
    };
}

async function start(choice: SoundChoice): Promise<void> {
    if (isBuiltInPack(choice.pack)) {
        const { builtInSoundUrl } = await import('./sound-urls');

        await ports.play(builtInSoundUrl(choice.pack, choice.event));

        return;
    }

    const file = await customSoundFiles().read(choice.pack, choice.event);

    if (file === null) {
        return;
    }

    const url = URL.createObjectURL(file);

    try {
        await ports.play(url);
    } finally {
        // The element has the file once it plays, so the address can go.
        URL.revokeObjectURL(url);
    }
}

/*
 * Plays a sound, at most once a second per sound. A play the page refuses (a browser tab nobody clicked
 * in yet) or a file that went missing is logged and dropped: a sound is never worth an error on screen.
 */
export function playSound(choice: SoundChoice, tag?: string): void {
    const key = `${choice.pack}/${choice.event}`;
    const now = ports.now();

    if (now - (lastPlayed.get(key) ?? -REPEAT_MS) < REPEAT_MS) {
        return;
    }

    lastPlayed.set(key, now);

    void (async () => {
        if (tag !== undefined && !(await ports.claim(tag))) {
            return;
        }

        await start(choice);
    })().catch((e: unknown) => console.warn(`The ${key} sound did not play`, e));
}

/* Plays what an event sounds like for a project, if it sounds at all there. A null project is an event no project owns. */
export function playEventSound(event: SoundEvent, project: { endpointId: string; projectId: string } | null, tag?: string): void {
    const choice = soundFor(useSettings.getState(), event, project === null ? null : projectSoundKey(project.endpointId, project.projectId));

    if (choice !== null) {
        playSound(choice, tag);
    }
}
