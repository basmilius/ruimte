import { deepStrictEqual, strictEqual } from 'node:assert';
import { resolve } from 'node:path';
import { groupMemberIds, type GroupFrame, type GroupItem } from '../packages/contracts/src/node-defaults';
import type { Plan, PlanItem, PlanStep, PlanStepState } from '../packages/contracts/src/plan-host';

const beforeRoot = process.argv[2];

if (!beforeRoot) {
    throw new Error('Usage: bun --conditions=source scripts/check-collection-equivalence.ts <materialized before root>');
}

const tree = await import(Bun.resolveSync('@adecore/plan', resolve(import.meta.dir, '../packages/contracts')));
const text = tree;
const before = {
    ...(await import(resolve(beforeRoot, 'adecore/packages/plan/src/tree.ts'))),
    ...(await import(resolve(beforeRoot, 'adecore/packages/plan/src/text.ts')))
};
const beforeGroup = await import(resolve(beforeRoot, 'ruimte/packages/contracts/src/node-defaults.ts'));
let seed = 97331;

function random(limit: number): number {
    seed = Math.imul(seed, 1664525) + 1013904223;

    return (seed >>> 0) % limit;
}

const states: PlanStepState[] = ['open', 'active', 'done', 'failed', 'skipped', 'blocked', 'warning', 'info'];
let comparisons = 0;

for (let iteration = 0; iteration < 1000; iteration++) {
    const leaves: PlanStep[] = Array.from({ length: random(250) }, (_, index) => ({
        type: 'step',
        id: index % 11 === 0 ? '__proto__' : `step-${index % 31}`,
        title: `Step ${index}`,
        state: states[random(states.length)],
        ...(random(3) === 0 ? { steps: [] } : {})
    }));
    const items: PlanStep[] = [];

    while (leaves.length > 0) {
        const count = 1 + random(Math.min(8, leaves.length));
        const children = leaves.splice(0, count);

        if (random(2) === 0) {
            items.push(...children);
        } else {
            items.push({ type: 'step', id: `parent-${items.length}`, title: 'Parent', state: states[random(states.length)], steps: children });
        }
    }

    const wrapped: PlanItem[] = [{ type: 'section', id: 'section', title: 'Section', items }];
    const plan: Plan = {
        id: 'plan',
        rev: 1,
        createdAt: '2026-11-01T00:00:00Z',
        meta: { title: 'Fixture', kind: iteration % 2 === 0 ? 'steps' : 'test', checks: 'anyone' },
        items: wrapped
    };
    const snapshot = structuredClone(plan);
    const pairs: Array<[unknown, unknown]> = [
        [tree.allSteps(wrapped), before.allSteps(wrapped)],
        [tree.leafSteps(wrapped), before.leafSteps(wrapped)],
        [tree.activeStepIds(plan), before.activeStepIds(plan)],
        [tree.planProgress(wrapped), before.planProgress(wrapped)],
        [text.progressText(plan), before.progressText(plan)],
        [text.renderPlanText(plan, { formatTime: (value: string) => value }), before.renderPlanText(plan, { formatTime: (value: string) => value })]
    ];

    for (const [actual, expected] of pairs) {
        deepStrictEqual(actual, expected);
        comparisons++;
    }

    for (const [actual, expected] of pairs.slice(0, 2) as Array<[PlanStep[], PlanStep[]]>) {
        actual.forEach((step, index) => strictEqual(step, expected[index]));
    }

    deepStrictEqual(plan, snapshot);
    comparisons++;
}

for (let iteration = 0; iteration < 2000; iteration++) {
    const frame: GroupFrame = {
        id: iteration % 2 === 0 ? '__proto__' : 'group',
        x: random(400) - 200,
        y: random(400) - 200,
        w: random(1000),
        h: random(1000),
        expandedHeight: random(1000),
        memberIds: []
    };
    const items: GroupItem[] = [];
    items.length = random(500);
    const inherited: Record<number, GroupItem> = {};

    for (let index = 0; index < items.length; index++) {
        const item: GroupItem = {
            id: index % 13 === 0 ? frame.id : `item-${random(45)}`,
            x: random(1600) - 800,
            y: random(1600) - 800,
            ...(random(3) === 0 ? {} : { w: random(400), h: random(400) })
        };
        Object.freeze(item);

        if (random(5) !== 0) {
            items[index] = item;
        } else if (random(2) === 0) {
            inherited[index] = item;
        }
    }

    Object.setPrototypeOf(items, Object.freeze(Object.assign(Object.create(Array.prototype), inherited)));
    Object.freeze(items);
    const ids = Array.from({ length: random(50) }, () => `item-${random(45)}`);
    ids.push(frame.id, 'missing');
    Object.freeze(ids);
    const snapshot = JSON.stringify(items);

    for (const collapsed of [false, true]) {
        const group = Object.freeze({ ...frame, memberIds: ids, collapsed });
        deepStrictEqual(groupMemberIds(group, items), beforeGroup.groupMemberIds(group, items));
        comparisons++;
    }

    strictEqual(JSON.stringify(items), snapshot);
    comparisons++;
}

strictEqual(comparisons, 13000);
console.log(
    JSON.stringify(
        {
            seed: 97331,
            planCases: 1000,
            groupCases: 2000,
            comparisons,
            includes: [
                'all step states',
                'stale parent state ignored',
                'empty child lists',
                'nested sections',
                'order and object identity',
                'duplicate and special ids',
                'sparse and inherited indices',
                'collapsed self-membership',
                'immutable inputs'
            ],
            result: 'identical'
        },
        null,
        2
    )
);
