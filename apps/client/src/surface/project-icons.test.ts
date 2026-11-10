import { expect, test } from 'bun:test';
import { PROJECT_ICON_NAMES } from '@ruimte/contracts';
import { PROJECT_ICON_GROUPS } from '@/surface/project-icons';

test('the picker offers every stored project icon exactly once', () => {
    const grouped = PROJECT_ICON_GROUPS.flatMap((group) => Object.keys(group.icons));
    expect(grouped.toSorted()).toEqual([...PROJECT_ICON_NAMES].sort());
});
