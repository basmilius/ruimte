import { endpointKey } from '@/state/keys';

/* What a session can announce, in the order the settings list them. */
export const SOUND_EVENTS = ['question', 'alert', 'limit', 'error', 'finished'] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/* The motif every built-in pack plays for an event, which is its file's name: the motif says what happened, the pack where. */
export const SOUND_MOTIFS: Readonly<Record<SoundEvent, string>> = { question: 'rise', alert: 'chime', limit: 'fall', error: 'knock', finished: 'trio' };

/* The packs `scripts/make-sounds.ts` writes, in the order a person picks from. */
export const SOUND_PACKS = ['marimba', 'marimba-low', 'kalimba', 'kalimba-low', 'log', 'vibes', 'tine', 'music-box', 'string'] as const;
export type BuiltInSoundPack = (typeof SOUND_PACKS)[number];

/* Also what a stored built-in pack that is gone reads as, so a person who chose one still hears a sound. */
export const DEFAULT_SOUND_PACK: BuiltInSoundPack = 'marimba-low';

/* The choice that plays nothing: what notifies still does, without a sound. */
export const NO_SOUND_PACK = 'none';

const CUSTOM_PREFIX = 'custom-';

/* Which events raise a notification. Whether one sounds is the pack's. */
export type NotifyEvents = Record<SoundEvent, boolean>;

/* A question and an alert someone asked for always notified, so they start on. The rest waits for a person. */
export const DEFAULT_NOTIFY_EVENTS: NotifyEvents = { question: true, alert: true, limit: false, error: false, finished: false };

/* A pack of a person's own files. The files live in this client's IndexedDB; this is their index. */
export interface CustomSoundPack {
    id: string;
    name: string;

    /* The name of the file picked for each event that has one, as the person's computer named it. */
    files: Partial<Record<SoundEvent, string>>;

    /* The events a person turned off in this pack. An event that is neither off nor has a file sounds as in the settings. */
    off?: SoundEvent[];
}

export interface ProjectSounds {
    /* Absent follows the pack of the settings. */
    pack?: string;
}

export interface SoundSettings {
    soundPack: string;
    customSoundPacks: readonly CustomSoundPack[];
    projectSounds: Readonly<Record<string, ProjectSounds>>;
}

export interface SoundChoice {
    pack: string;
    event: SoundEvent;
}

export function isBuiltInPack(id: string): id is BuiltInSoundPack {
    return (SOUND_PACKS as readonly string[]).includes(id);
}

export function isCustomPack(id: string): boolean {
    return id.startsWith(CUSTOM_PREFIX);
}

export function newCustomPackId(): string {
    return `${CUSTOM_PREFIX}${crypto.randomUUID()}`;
}

export function projectSoundKey(endpointId: string, projectId: string): string {
    return endpointKey(endpointId, projectId);
}

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/* What a blob may hold about notifications: today's keys, and the two a switch per event was a sound switch under. */
export interface StoredAnnouncements {
    notifyEvents?: unknown;
    soundPack?: unknown;
    soundEvents?: unknown;
    agentsTurnSound?: unknown;
}

/*
 * The switches and the pack of a stored blob. One from before `notifyEvents` held a sound switch per
 * event (`soundEvents`, and before that `agentsTurnSound` for the two alerts the desktop raised), and it
 * reads as what it did then: a question and an alert always notified, the other events only while
 * their sound was on, and a blob with every sound off played none.
 */
export function announcementsFrom(stored: StoredAnnouncements, custom: readonly CustomSoundPack[]): { notifyEvents: NotifyEvents; soundPack: string } {
    const events = record(stored.notifyEvents);

    if (events !== null) {
        return {
            notifyEvents: Object.fromEntries(SOUND_EVENTS.map((event) => [event, events[event] === true])) as NotifyEvents,
            soundPack: soundPackFrom(stored.soundPack, custom)
        };
    }

    const sounds = record(stored.soundEvents);
    const heard = SOUND_EVENTS.filter((event) =>
        sounds === null ? stored.agentsTurnSound === true && (event === 'question' || event === 'alert') : sounds[event] === true
    );

    return {
        notifyEvents: Object.fromEntries(SOUND_EVENTS.map((event) => [event, DEFAULT_NOTIFY_EVENTS[event] || heard.includes(event)])) as NotifyEvents,
        soundPack: heard.length === 0 ? NO_SOUND_PACK : soundPackFrom(stored.soundPack, custom)
    };
}

export function customSoundPacksFrom(stored: unknown): CustomSoundPack[] {
    if (!Array.isArray(stored)) {
        return [];
    }

    return stored.flatMap((entry) => {
        const pack = record(entry);

        if (pack === null || typeof pack.id !== 'string' || !isCustomPack(pack.id) || typeof pack.name !== 'string') {
            return [];
        }

        const files = record(pack.files) ?? {};
        const off = SOUND_EVENTS.filter((event) => Array.isArray(pack.off) && pack.off.includes(event));

        return [
            {
                id: pack.id,
                name: pack.name,
                files: Object.fromEntries(SOUND_EVENTS.flatMap((event) => (typeof files[event] === 'string' ? [[event, files[event]]] : []))),
                ...(off.length === 0 ? {} : { off })
            }
        ];
    });
}

function knownPack(id: unknown, custom: readonly CustomSoundPack[]): id is string {
    return typeof id === 'string' && (id === NO_SOUND_PACK || isBuiltInPack(id) || custom.some((pack) => pack.id === id));
}

export function soundPackFrom(stored: unknown, custom: readonly CustomSoundPack[]): string {
    return knownPack(stored, custom) ? stored : DEFAULT_SOUND_PACK;
}

/*
 * A project that follows the settings is left out, so the map holds only what a person chose. The
 * `silent` switch a project had before reads as the pack that plays nothing, and a built-in pack that
 * is gone as the default one. A pack of a person's own that is gone follows the settings.
 */
export function projectSoundsFrom(stored: unknown, custom: readonly CustomSoundPack[]): Record<string, ProjectSounds> {
    const projects = record(stored) ?? {};

    return Object.fromEntries(
        Object.entries(projects).flatMap(([key, value]) => {
            const choice = record(value);

            if (choice?.silent === true) {
                return [[key, { pack: NO_SOUND_PACK }]];
            }

            if (knownPack(choice?.pack, custom)) {
                return [[key, { pack: choice.pack }]];
            }

            return typeof choice?.pack === 'string' && !isCustomPack(choice.pack) ? [[key, { pack: DEFAULT_SOUND_PACK }]] : [];
        })
    );
}

/* The settings after a project's choice changed; a choice that says nothing drops the project from the map. */
export function withProjectSounds(projects: Readonly<Record<string, ProjectSounds>>, key: string, sounds: ProjectSounds): Record<string, ProjectSounds> {
    const { [key]: _before, ...rest } = projects;

    return sounds.pack === undefined ? rest : { ...rest, [key]: { pack: sounds.pack } };
}

/*
 * The sound a pack makes for an event, or null where it makes none: the pack plays nothing, or a person
 * turned the event off in it. A pack of a person's own without a file for the event sounds as the pack
 * of the settings does, and that one, when it has no file either, as the default pack.
 */
export function packSound(settings: Pick<SoundSettings, 'soundPack' | 'customSoundPacks'>, pack: string, event: SoundEvent): SoundChoice | null {
    const tried = new Set<string>();
    let current = pack;

    while (!isBuiltInPack(current)) {
        if (current === NO_SOUND_PACK) {
            return null;
        }

        const own = settings.customSoundPacks.find((custom) => custom.id === current);

        if (own?.off?.includes(event)) {
            return null;
        }

        if (own?.files[event] !== undefined) {
            return { pack: current, event };
        }

        tried.add(current);
        current = tried.has(settings.soundPack) ? DEFAULT_SOUND_PACK : settings.soundPack;
    }

    return { pack: current, event };
}

/*
 * The sound an event makes for a project, in the project's pack or else the settings', or null where
 * that pack makes none. `projectKey` null is an event no project owns.
 */
export function soundFor(settings: SoundSettings, event: SoundEvent, projectKey: string | null): SoundChoice | null {
    const project = projectKey === null ? undefined : settings.projectSounds[projectKey];

    return packSound(settings, project?.pack ?? settings.soundPack, event);
}
