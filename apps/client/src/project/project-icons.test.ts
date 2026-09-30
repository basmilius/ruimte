import { describe, expect, test } from 'bun:test';
import { PROJECT_ICON_NAMES } from '@ruimte/contracts';
import { PROJECT_ICON_GLYPHS, PROJECT_ICON_GROUPS, PROJECT_ICON_KEYWORDS } from '@/project/project-icons';

const grouped = PROJECT_ICON_GROUPS.flatMap((group) => Object.keys(group.icons));

describe('the project icon groups', () => {
    test('hold every name of the contracts exactly once', () => {
        for (const name of PROJECT_ICON_NAMES) {
            expect(grouped.filter((candidate) => candidate === name)).toHaveLength(1);
        }
    });

    test('hold no name outside the contracts', () => {
        for (const name of grouped) {
            expect(PROJECT_ICON_NAMES as readonly string[]).toContain(name);
        }
    });

    test('draw the flat list in group order', () => {
        expect(Object.keys(PROJECT_ICON_GLYPHS)).toEqual(grouped);
    });

    test('only give keywords to a name in the set', () => {
        for (const name of Object.keys(PROJECT_ICON_KEYWORDS)) {
            expect(grouped).toContain(name);
        }
    });
});
