import { create } from 'zustand';
import { z } from 'zod';
import { BEAM_SETTINGS, type BeamSetting } from '@extensions/pets/client/beam';
import { SETTINGS_STORAGE_KEY } from '@/state/settings';
import { storedJson } from '@/state/stored-json';

export const PET_SETTINGS_STORAGE_KEY = 'ruimte.pets';

export type PetsPlace = 'nodes' | 'screen';

export interface PetSettings {
    /* Whether a pet stands on every agent's node and says when it waits on you. Off to start with: a canvas is quiet until a person asks for company. */
    pets: boolean;
    /* Where the pets are: on their nodes, or along the bottom of the screen, around the dock (`canvas/roam.ts`). */
    petsPlace: PetsPlace;
    /* The sets pets come from, each a built-in set (`PET_SETS`) or `custom:<id>` for one a person added (`custom-sprites.ts`). Never empty. */
    petsSets: string[];
    /* Whether, while Pets is off, a pet now and then drops by beside a node for a moment. On to start with. */
    petsVisitor: boolean;
    /* Whether a pet takes a smaller one along for each sub-agent of its chat at work (`kids.ts`). On to start with, since it only shows once Pets is on. */
    petsSubagents: boolean;
    /* Whether a chat or a terminal open as a view of its own has its pet too (`ViewPet.tsx`). On to start with, since it only shows once Pets is on. */
    petsInViews: boolean;
    /* A figure set per CLI, by its kind, as `petsSets` names one; a CLI without one takes its pets from `petsSets`. */
    petsByAgent: Record<string, string>;
    /* How a pet comes and goes (`beam.ts`), the same for every pet. */
    petsBeam: BeamSetting;
}

interface PetSettingsStore extends PetSettings {
    update(patch: Partial<PetSettings>): void;
    reload(): void;
}

// More than the built-in sets and every figure a client may keep, so a hand-edited list cannot slow the picker.
const MAX_PET_SETS = 32;
const MAX_PET_SET_LENGTH = 64;

const AnyObject = z.custom<Record<string, unknown>>((stored) => typeof stored === 'object' && stored !== null);
const storedPets = storedJson<Record<string, unknown>, PetSettings>(PET_SETTINGS_STORAGE_KEY, AnyObject);
const storedAppSettings = storedJson<Record<string, unknown>, Record<string, unknown>>(SETTINGS_STORAGE_KEY, AnyObject);

/*
 * The stored sets, or the one choice before sets could be combined, under `petsSprite`, as a set of
 * one. Each once and never none. Whether a custom set is still there is the pets' own question, so a
 * name stays in the list when its sprite is gone.
 */
function petSetsFrom(stored: unknown, legacy: unknown): string[] {
    const named: unknown[] = Array.isArray(stored) ? stored : [legacy];
    const sets = [...new Set(named.filter((set): set is string => typeof set === 'string' && set !== '' && set.length <= MAX_PET_SET_LENGTH))];

    return sets.length > 0 ? sets.slice(0, MAX_PET_SETS) : ['buddies'];
}

/* A CLI is named by a short word, and a person gives a figure to the few CLIs they use. */
const MAX_PET_AGENTS = 16;
const MAX_PET_AGENT_LENGTH = 64;

/* The figure set given to each CLI, as `petsSets` names one; anything else stored is left out. */
function petsByAgentFrom(stored: unknown): Record<string, string> {
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
        return {};
    }

    const named = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= MAX_PET_SET_LENGTH;
    const entries = Object.entries(stored).filter(([agent, set]) => agent !== '' && agent.length <= MAX_PET_AGENT_LENGTH && named(set));

    return Object.fromEntries(entries.slice(0, MAX_PET_AGENTS));
}

export function petSettingsFrom(stored: Record<string, unknown>): PetSettings {
    return {
        // Only a stored `true` brings the pets, and only a stored `false` keeps the visitor, the kids or the view's pet away.
        pets: stored.pets === true,
        petsPlace: stored.petsPlace === 'screen' ? 'screen' : 'nodes',
        petsSets: petSetsFrom(stored.petsSets, stored.petsSprite),
        petsVisitor: stored.petsVisitor !== false,
        petsSubagents: stored.petsSubagents !== false,
        petsInViews: stored.petsInViews !== false,
        petsByAgent: petsByAgentFrom(stored.petsByAgent),
        petsBeam: BEAM_SETTINGS.find((each) => each === stored.petsBeam) ?? 'gather'
    };
}

/* Pets were part of the app's settings before they became a built-in, so that blob is the first answer until this one has its own. */
function read(): PetSettings {
    try {
        return petSettingsFrom(storedPets.read() ?? storedAppSettings.read() ?? {});
    } catch {
        return petSettingsFrom({});
    }
}

function settingsOf(state: PetSettingsStore): PetSettings {
    const { update: _update, reload: _reload, ...settings } = state;

    return settings;
}

export const usePetSettings = create<PetSettingsStore>((set, get) => {
    const initial = read();

    // Written at once: the app's next save of its own settings drops these fields from its blob.
    if (storedPets.read() === null) {
        storedPets.write(initial);
    }

    return {
        ...initial,
        update(patch) {
            const next = { ...settingsOf(get()), ...patch };

            // Storage that refuses still leaves the setting on for this session.
            storedPets.write(next);
            set(next);
        },
        reload() {
            set(read());
        }
    };
});
