import { resolve } from 'node:path';
import { groupMembershipCases } from '../apps/client/testing/performance/group-membership-cases';
import { type PerformanceCase, measurePairs } from '../apps/client/testing/performance/paired';
import * as afterGroups from '../packages/contracts/src/node-defaults';

const beforeRoot = process.argv[2];

if (!beforeRoot) {
    throw new Error('Usage: bun --conditions=source scripts/benchmark-collections.ts <materialized before root> [name filter]');
}

const afterPlan = await import(Bun.resolveSync('@adecore/plan', resolve(import.meta.dir, '../packages/contracts')));
const adecoreRoot = process.env.ADECORE_PATH ?? resolve(import.meta.dir, '../../adecore');
const { planCollectionCases } = await import(resolve(adecoreRoot, 'scripts/plan-collection-performance-cases.ts'));
const beforeTree = await import(resolve(beforeRoot, 'adecore/packages/plan/src/tree.ts'));
const beforeText = await import(resolve(beforeRoot, 'adecore/packages/plan/src/text.ts'));
const beforeGroups = await import(resolve(beforeRoot, 'ruimte/packages/contracts/src/node-defaults.ts'));
const cases: PerformanceCase[] = [...planCollectionCases({ ...beforeTree, ...beforeText }, afterPlan), ...groupMembershipCases(beforeGroups, afterGroups)];
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
console.log(JSON.stringify(measurePairs(filter ? cases.filter((entry) => filter.test(entry.name)) : cases), null, 2));
