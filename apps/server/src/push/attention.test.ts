import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('marks start the first time a ledger runs on this version, and entries from before stay behind that moment', () => {
    const folder = mkdtempSync(join(tmpdir(), 'ruimte-push-marks-'));
    try {
        const path = join(folder, 'attention.json');
        // A ledger an older version wrote: entries, and nothing about marks.
        writeFileSync(path, JSON.stringify({ entries: [{ nodeId: 'old-turn', issuedAt: 500, readThrough: 0 }] }));
        let now = 1000;
        const updated = new PushAttention(path, () => now);
        expect(updated.marksFrom).toBe(1000);
        expect(updated.snapshot()[0]!.issuedAt).toBeLessThan(updated.marksFrom);
        now = 2000;
        expect(updated.notify('new-turn').issuedAt).toBeGreaterThanOrEqual(updated.marksFrom);
        // The moment is kept, so a later restart does not move it past what ended in between.
        expect(new PushAttention(path, () => 5000).marksFrom).toBe(1000);
    } finally {
        rmSync(folder, { recursive: true });
    }
});
