import { describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { designSlug, freeDesignFolder } from './design-folder';

function design(id: string, path: string): ProjectView {
    return { kind: 'design', id, name: id, node: {}, path };
}

describe('the folder of a new design', () => {
    test('is the name in lowercase words joined by dashes, without accents', () => {
        expect(designSlug('Onboarding')).toBe('onboarding');
        expect(designSlug('Pitch deck: Q4!')).toBe('pitch-deck-q4');
        expect(designSlug('Café crème')).toBe('cafe-creme');
        expect(designSlug('  --  ')).toBe('design');
    });

    test('is a name with a number when another design of the project has that folder', () => {
        expect(freeDesignFolder([], 'Onboarding')).toBe('onboarding');
        expect(freeDesignFolder([design('a', 'onboarding')], 'Onboarding')).toBe('onboarding-2');
        expect(freeDesignFolder([design('a', 'onboarding'), design('b', 'onboarding-2')], 'Onboarding')).toBe('onboarding-3');
    });

    test('skips the folder of a design node on a canvas too', () => {
        const canvas: ProjectView = {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'board', kind: 'design', title: 'Design', x: 0, y: 0, w: 480, h: 640, path: 'design' }],
            texts: [],
            edges: [],
            layouts: []
        };
        expect(freeDesignFolder([canvas], 'Design')).toBe('design-2');
    });

    test('skips a folder a removed design left on disk, so a new design never opens on its files', () => {
        expect(freeDesignFolder([], 'Design', ['design'])).toBe('design-2');
        expect(freeDesignFolder([design('a', 'design-2')], 'Design', ['design'])).toBe('design-3');
    });
});
