import { endpointKey } from '@/state/keys';

/* What a session can announce with a sound, in the order the settings list them. */
export const SOUND_EVENTS = ['question', 'alert', 'limit', 'error', 'finished'] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/* The motif every built-in pack plays for an event, which is its file's name: the motif says what happened, the pack where. */
export const SOUND_MOTIFS: Readonly<Record<SoundEvent, string>> = { question: 'rise', alert: 'chime', limit: 'fall', error: 'knock', finished: 'trio' };

/* The packs `scripts/make-sounds.ts` writes: five synthesized voices, then five recorded instruments. */
export const SOUND_PACKS = ['bar', 'glass', 'wood', 'string', 'air', 'grand', 'felt', 'nylon', 'steel', 'duo'] as const;
export type BuiltInSoundPack = (typeof SOUND_PACKS)[number];

export const DEFAULT_SOUND_PACK: BuiltInSoundPack = 'bar';

const CUSTOM_PREFIX = 'custom-';

export type SoundEvents = Record<SoundEvent, boolean>;

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
    silent?: boolean;

    /* Absent follows the pack of the settings. */
    pack?: string;
}

export interface SoundSettings {
    soundPack: string;
    soundEvents: SoundEvents;
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

/* Every event is off until a person turns it on. `legacy` is the one switch there was before, which covered the two alerts the desktop raised. */
export function soundEventsFrom(stored: unknown, legacy: unknown): SoundEvents {
    const events = record(stored);

    return Object.fromEntries(
        SOUND_EVENTS.map((event) => [event, events === null ? legacy === true && (event === 'question' || event === 'alert') : events[event] === true])
    ) as SoundEvents;
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
    return typeof id === 'string' && (isBuiltInPack(id) || custom.some((pack) => pack.id === id));
}

export function soundPackFrom(stored: unknown, custom: readonly CustomSoundPack[]): string {
    return knownPack(stored, custom) ? stored : DEFAULT_SOUND_PACK;
}

/* A project that follows the settings in everything is left out, so the map holds only what a person chose. */
export function projectSoundsFrom(stored: unknown, custom: readonly CustomSoundPack[]): Record<string, ProjectSounds> {
    const projects = record(stored) ?? {};

    return Object.fromEntries(
        Object.entries(projects).flatMap(([key, value]) => {
            const choice = record(value);
            const sounds: ProjectSounds = {
                ...(choice?.silent === true ? { silent: true } : {}),
                ...(knownPack(choice?.pack, custom) ? { pack: choice.pack } : {})
            };

            return Object.keys(sounds).length === 0 ? [] : [[key, sounds]];
        })
    );
}

/* The settings after a project's choice changed; a choice that says nothing drops the project from the map. */
export function withProjectSounds(projects: Readonly<Record<string, ProjectSounds>>, key: string, sounds: ProjectSounds): Record<string, ProjectSounds> {
    const { [key]: _before, ...rest } = projects;
    const kept: ProjectSounds = { ...(sounds.silent === true ? { silent: true } : {}), ...(sounds.pack === undefined ? {} : { pack: sounds.pack }) };

    return Object.keys(kept).length === 0 ? rest : { ...rest, [key]: kept };
}

/*
 * The sound a pack makes for an event, or null where a person turned the event off in it. A pack of a
 * person's own without a file for the event sounds as the pack of the settings does, and that one, when
 * it has no file either, as the default pack, so a pack with one file of its own is never silent elsewhere.
 */
export function packSound(settings: Pick<SoundSettings, 'soundPack' | 'customSoundPacks'>, pack: string, event: SoundEvent): SoundChoice | null {
    const tried = new Set<string>();
    let current = pack;

    while (!isBuiltInPack(current)) {
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
 * The sound an event makes for a project, or null for none: the event is off, in the settings or in the
 * pack, or the project is silent. `projectKey` null is an event no project owns.
 */
export function soundFor(settings: SoundSettings, event: SoundEvent, projectKey: string | null): SoundChoice | null {
    const project = projectKey === null ? undefined : settings.projectSounds[projectKey];

    if (!settings.soundEvents[event] || project?.silent === true) {
        return null;
    }

    return packSound(settings, project?.pack ?? settings.soundPack, event);
}
