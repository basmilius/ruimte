import type { groupMemberIds, GroupFrame, GroupItem } from '../../../../packages/contracts/src/node-defaults';
import type { PerformanceCase } from './paired';

type Membership = { groupMemberIds: typeof groupMemberIds };

function observe(result: string[]): string {
    const sink = globalThis as typeof globalThis & { __ruimteMembershipResult?: unknown };
    sink.__ruimteMembershipResult = result;

    return String(result.length);
}

export function groupMembershipCases(before: Membership, after: Membership): PerformanceCase[] {
    const cases: PerformanceCase[] = [];

    for (const size of [0, 1, 10, 100, 500, 1000]) {
        const items: GroupItem[] = Array.from({ length: size }, (_, index) => ({
            id: `item-${index}`,
            x: (index % 25) * 40,
            y: Math.floor(index / 25) * 40,
            w: 20,
            h: 20
        }));

        for (const collapsed of [false, true]) {
            const frame: GroupFrame = {
                id: 'group',
                x: 0,
                y: 0,
                w: 500,
                h: 500,
                collapsed,
                memberIds: items.filter((_, index) => index % 2 === 0).map((item) => item.id)
            };
            const run = (api: Membership): string[] => api.groupMemberIds(frame, items);

            if (JSON.stringify(run(before)) !== JSON.stringify(run(after))) {
                throw new Error('Group members differ');
            }

            cases.push({
                name: `groupMemberIds/${size}/${collapsed ? 'collapsed' : 'open'}`,
                before: () => observe(run(before)),
                after: () => observe(run(after))
            });
        }
    }

    return cases;
}
