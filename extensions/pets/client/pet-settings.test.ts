import { describe, expect, test } from 'bun:test';
import { petSettingsFrom } from '@extensions/pets/client/pet-settings';
import english from '@extensions/pets/locales/en.json';
import dutch from '@extensions/pets/locales/nl.json';

describe('pets', () => {
    test('stay away until a person turns them on, and only a stored true does', () => {
        expect(petSettingsFrom({}).pets).toBe(false);
        expect(petSettingsFrom({ pets: true }).pets).toBe(true);
        expect(petSettingsFrom({ pets: 'yes' as unknown as boolean }).pets).toBe(false);
    });

    test('start as the buddies and keep the sets a person picked, custom ones for the pets to look up', () => {
        expect(petSettingsFrom({}).petsSets).toEqual(['buddies']);
        expect(petSettingsFrom({ petsSets: ['animals', 'custom:abc'] }).petsSets).toEqual(['animals', 'custom:abc']);
        expect(petSettingsFrom({ petsSets: ['animals', 'animals', '', 3 as unknown as string] }).petsSets).toEqual(['animals']);
        expect(petSettingsFrom({ petsSets: [] }).petsSets).toEqual(['buddies']);
        expect(petSettingsFrom({ petsSets: 'animals' as unknown as string[] }).petsSets).toEqual(['buddies']);
    });

    test('keep a hand-edited list of sets small', () => {
        const many = Array.from({ length: 1000 }, (_, i) => `custom:${i}`);
        expect(petSettingsFrom({ petsSets: many }).petsSets).toHaveLength(32);
        expect(petSettingsFrom({ petsSets: [`custom:${'x'.repeat(100)}`, 'animals'] }).petsSets).toEqual(['animals']);
    });

    test('take the one choice of a client from before sets could be combined as a set of one', () => {
        const legacy = (petsSprite: unknown) => petSettingsFrom({ petsSprite } as Parameters<typeof petSettingsFrom>[0]).petsSets;
        expect(legacy('animals')).toEqual(['animals']);
        expect(legacy('custom:abc')).toEqual(['custom:abc']);
        expect(legacy('')).toEqual(['buddies']);
        expect(legacy(3)).toEqual(['buddies']);
        // Once sets are stored, they are what counts.
        expect(petSettingsFrom({ petsSets: ['buddies', 'animals'], petsSprite: 'custom:abc' } as Parameters<typeof petSettingsFrom>[0]).petsSets).toEqual([
            'buddies',
            'animals'
        ]);
    });

    test('let the visitor come unless a stored false keeps it away', () => {
        expect(petSettingsFrom({}).petsVisitor).toBe(true);
        expect(petSettingsFrom({ petsVisitor: false }).petsVisitor).toBe(false);
        expect(petSettingsFrom({ petsVisitor: 0 as unknown as boolean }).petsVisitor).toBe(true);
    });

    test('give a chat or a terminal in a view of its own its pet until a stored false keeps it away', () => {
        expect(petSettingsFrom({}).petsInViews).toBe(true);
        expect(petSettingsFrom({ petsInViews: false }).petsInViews).toBe(false);
        expect(petSettingsFrom({ petsInViews: 'no' as unknown as boolean }).petsInViews).toBe(true);
    });

    test('beam pets in and out by gathering unless a stored style or Random says otherwise', () => {
        expect(petSettingsFrom({}).petsBeam).toBe('gather');
        expect(petSettingsFrom({ petsBeam: 'portal' }).petsBeam).toBe('portal');
        expect(petSettingsFrom({ petsBeam: 'random' }).petsBeam).toBe('random');
        expect(petSettingsFrom({ petsBeam: 'warp' as unknown as 'portal' }).petsBeam).toBe('gather');
    });

    test('keep the figure given to each CLI, and leave out what is no name of a set', () => {
        expect(petSettingsFrom({}).petsByAgent).toEqual({});
        expect(petSettingsFrom({ petsByAgent: { claude: 'custom:tabby', codex: 'animals' } }).petsByAgent).toEqual({
            claude: 'custom:tabby',
            codex: 'animals'
        });
        expect(petSettingsFrom({ petsByAgent: { claude: 3, codex: '', '': 'animals' } as unknown as Record<string, string> }).petsByAgent).toEqual({});
        expect(petSettingsFrom({ petsByAgent: ['animals'] as unknown as Record<string, string> }).petsByAgent).toEqual({});
    });

    test('take the kids of sub-agents along until a person turns them off', () => {
        expect(petSettingsFrom({}).petsSubagents).toBe(true);
        expect(petSettingsFrom({ petsSubagents: false }).petsSubagents).toBe(false);
        expect(petSettingsFrom({ petsSubagents: 'no' as unknown as boolean }).petsSubagents).toBe(true);
    });

    test('keep pets on their nodes unless a stored choice sends them to the bottom of the screen', () => {
        expect(petSettingsFrom({}).petsPlace).toBe('nodes');
        expect(petSettingsFrom({ petsPlace: 'screen' }).petsPlace).toBe('screen');
        expect(petSettingsFrom({ petsPlace: 'ceiling' as unknown as 'screen' }).petsPlace).toBe('nodes');
    });
});

describe('the words of the pets', () => {
    function keysOf(words: object, prefix = ''): string[] {
        return Object.entries(words).flatMap(([key, value]) =>
            typeof value === 'object' && value !== null ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]
        );
    }

    test('hold the same keys in English and Dutch', () => {
        expect(keysOf(dutch).toSorted()).toEqual(keysOf(english).toSorted());
    });
});
