import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushAttention } from './attention.ts';

test('read acknowledgments survive restarts and cannot clear a newer turn', () => {
    const folder = mkdtempSync(join(tmpdir(), 'ruimte-push-read-'));
    try {
        const path = join(folder, 'attention.json');
        const ledger = new PushAttention(path, () => 1000);
        const first = ledger.notify('agent');
        const second = ledger.notify('agent');
        expect(second.issuedAt).toBeGreaterThan(first.issuedAt);
        ledger.read('agent', first.issuedAt);
        expect(ledger.isRead('agent', first.issuedAt)).toBe(true);
        expect(ledger.isRead('agent', second.issuedAt)).toBe(false);
        expect(ledger.read('agent', second.issuedAt + 100)).toBeNull();
        const restored = new PushAttention(path, () => 1000);
        expect(restored.snapshot()).toEqual(ledger.snapshot());
        expect(restored.read('agent', first.issuedAt)).toBeNull();
        expect(restored.read('other-machine-node', first.issuedAt)).toBeNull();
    } finally {
        rmSync(folder, { recursive: true });
    }
});
