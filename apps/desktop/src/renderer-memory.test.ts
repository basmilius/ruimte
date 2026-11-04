import { describe, expect, test } from 'bun:test';
import { RendererMemory } from './renderer-memory';

describe('RendererMemory', () => {
    test('reports the last size, the peak and how long the renderer ran', () => {
        const memory = new RendererMemory();
        memory.sample([{ contentsId: 1, workingSetKb: 512 * 1024, guests: 1 }], 0);
        memory.sample([{ contentsId: 1, workingSetKb: 2048 * 1024, guests: 3 }], 30 * 60_000);
        memory.sample([{ contentsId: 1, workingSetKb: 1536 * 1024, guests: 2 }], 90 * 60_000);

        expect(memory.reportOf(1, 91 * 60_000)).toEqual({ memoryMb: 1536, peakMemoryMb: 2048, uptimeMin: 91, guests: 2 });
    });

    test('forgets a window that closed, and knows nothing of one it never sampled', () => {
        const memory = new RendererMemory();
        memory.sample([{ contentsId: 1, workingSetKb: 1024, guests: 0 }], 0);
        memory.sample([{ contentsId: 2, workingSetKb: 1024, guests: 0 }], 1000);

        expect(memory.reportOf(1, 2000)).toBeNull();
        expect(memory.reportOf(3, 2000)).toBeNull();
    });
});
