import { deepStrictEqual, strictEqual } from 'node:assert';
import { resolve } from 'node:path';

const root = process.argv[2];

if (!root) {
    throw new Error('Usage: bun --conditions=source scripts/check-protocol-equivalence.ts <adecore before checkout>');
}

const after = await import(Bun.resolveSync('@adecore/agent-contracts/envelope', resolve(import.meta.dir, '../packages/contracts')));
const before = await import(resolve(root, 'packages/agent-contracts/src/envelope.ts'));
let seed = 98113;

function random(maximum: number): number {
    seed = Math.imul(seed, 1664525) + 1013904223;

    return (seed >>> 0) % maximum;
}

const values = [null, undefined, false, true, 0, 1, '', 'event', 'future', [], {}, { nested: [null, 42] }];
let checks = 0;

for (let index = 0; index < 12000; index++) {
    const frame: Record<string, unknown> = {};

    for (const key of ['id', 'type', 'event', 'payload', 'ok', 'result', 'error', 'future']) {
        if (random(3) !== 0) {
            frame[key] = values[random(values.length)];
        }
    }

    if (index % 3 === 0) {
        Object.assign(frame, { type: 'event', event: `event-${index}`, payload: { index } });
    } else if (index % 3 === 1) {
        Object.assign(frame, { id: `reply-${index}`, ok: index % 2 === 0, result: { index }, error: { code: 'failure', message: '' } });
    }

    const input = index % 19 === 0 ? values[random(values.length)] : frame;
    const original = before.parseServerFrame(input);
    const changed = after.parseServerFrame(input);
    deepStrictEqual(changed, original, `Frame ${index}`);

    if (changed.ok && original.ok) {
        if ('event' in changed.value && 'event' in original.value) {
            strictEqual(changed.value.payload, original.value.payload);
        } else if ('result' in changed.value && 'result' in original.value) {
            strictEqual(changed.value.result, original.value.result);
        }
    }

    checks++;
}

console.log(
    JSON.stringify(
        {
            seed: 98113,
            checks,
            result: 'identical',
            includes: ['valid and malformed envelopes', 'reply precedence', 'extra fields stripped', 'payload and result identity', 'complete diagnostics']
        },
        null,
        2
    )
);
