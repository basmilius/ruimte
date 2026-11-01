import { resolve } from 'node:path';
import { measureCanvasDetails } from './canvas-details';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source apps/client/testing/performance/benchmark-details.ts <baseline checkout>');
}

const candidateRoot = resolve(import.meta.dir, '../../../..');

async function load(root: string) {
    const [frames, minimap] = await Promise.all([
        import(resolve(root, 'apps/client/src/canvas/element-frames.ts')),
        import(resolve(root, 'apps/client/src/canvas/minimap-geometry.ts'))
    ]);

    return { ...frames, ...minimap };
}

const before = await load(resolve(baselineRoot));
const after = await load(candidateRoot);

console.log(
    JSON.stringify(
        { runtime: Bun.version, platform: `${process.platform}/${process.arch}`, baselineRoot, candidateRoot, ...measureCanvasDetails(before, after) },
        null,
        2
    )
);
