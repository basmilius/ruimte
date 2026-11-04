import { resolve } from 'node:path';
import { measurePairs } from '../apps/client/testing/performance/paired';
import { protocolCases } from '../apps/client/testing/performance/protocol-cases';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source scripts/benchmark-protocol.ts <adecore before checkout>');
}

const after = await import(Bun.resolveSync('@adecore/agent-contracts/envelope', resolve(import.meta.dir, '../packages/contracts')));
const before = await import(resolve(baselineRoot, 'packages/agent-contracts/src/envelope.ts'));
console.log(JSON.stringify(measurePairs(protocolCases(before, after)), null, 2));
