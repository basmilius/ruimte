import type { ProjectCanvasLine } from '@ruimte/contracts';
import type { gapFrames } from '../../src/canvas/element-frames';
import type { mappedNodes } from '../../src/canvas/minimap-geometry';
import type { CanvasNode } from '../../src/state/canvas-model';

interface CanvasDetailsApi {
    gapFrames: typeof gapFrames;
    mappedNodes: typeof mappedNodes;
}

export function measureCanvasDetails(before: CanvasDetailsApi, after: CanvasDetailsApi) {
    let checksum = 0;

    const batch = (run: () => unknown, iterations: number): number => {
        const started = performance.now();

        for (let index = 0; index < iterations; index++) {
            const result = run();
            checksum += Array.isArray(result) ? result.length : ((result as Record<string, { x: number }>)['node-1']?.x ?? 0);
        }

        return (performance.now() - started) / iterations;
    };

    const iterationsFor = (run: () => unknown): number => {
        let iterations = 1;

        while (batch(run, iterations) * iterations < 10 && iterations < 1_048_576) {
            iterations *= 2;
        }

        return iterations;
    };

    const distribution = (samples: number[]) => {
        const sorted = [...samples].sort((left, right) => left - right);

        return { medianMs: sorted[15]!, p95Ms: sorted[29]!, samplesMs: samples };
    };

    const results = [];

    for (const size of [100, 1000, 10_000]) {
        const nodes: Record<string, CanvasNode> = {};
        const lines: Record<string, ProjectCanvasLine> = {};
        const hidden = new Set<string>();

        for (let index = 0; index < size; index++) {
            const id = `node-${index}`;
            nodes[id] = { id, kind: index % 10 === 0 ? 'group' : 'note', title: id, x: index, y: index, w: 200, h: 100 } as CanvasNode;
            lines[`line-${index}`] = { id: `line-${index}`, x: index, y: index, endX: index + 100, endY: index + 50 } as ProjectCanvasLine;

            if (index % 5 === 1) {
                hidden.add(id);
                hidden.add(`line-${index}`);
            }
        }

        for (const operation of ['gapFrames', 'mappedNodes'] as const) {
            const original = () => (operation === 'gapFrames' ? before.gapFrames({ nodes, lines, hidden }) : before.mappedNodes(nodes, hidden));
            const changed = () => (operation === 'gapFrames' ? after.gapFrames({ nodes, lines, hidden }) : after.mappedNodes(nodes, hidden));

            if (JSON.stringify(changed()) !== JSON.stringify(original())) {
                throw new Error(`Different results for ${operation}/${size}`);
            }

            const beforeIterations = iterationsFor(original);
            const afterIterations = iterationsFor(changed);
            const originalSamples: number[] = [];
            const changedSamples: number[] = [];

            for (let sample = 0; sample < 31; sample++) {
                if (sample % 2 === 0) {
                    originalSamples.push(batch(original, beforeIterations));
                    changedSamples.push(batch(changed, afterIterations));
                } else {
                    changedSamples.push(batch(changed, afterIterations));
                    originalSamples.push(batch(original, beforeIterations));
                }
            }

            const baseline = distribution(originalSamples);
            const candidate = distribution(changedSamples);
            results.push({
                name: `${operation}/${size}`,
                beforeIterations,
                afterIterations,
                baseline,
                candidate,
                speedup: baseline.medianMs / candidate.medianMs
            });
        }
    }

    return { samples: 31, checksum, results };
}
