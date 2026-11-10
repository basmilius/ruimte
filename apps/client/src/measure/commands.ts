import { defineBehaviors, type CommandBehavior } from '@/commands/behavior';
import type { MeasureVariant } from '@/measure/scene';

/* Dev only. The module loads on first use, so the recorder never ships and only watches a page someone measures. */
function measure() {
    return import('@/measure/run');
}

function scene(variant: MeasureVariant): CommandBehavior {
    return { run: () => void measure().then((module) => module.buildMeasureScene(variant)), offered: () => import.meta.env.DEV };
}

export const MEASURE_BEHAVIORS = defineBehaviors({
    'measure-scene': scene('scene'),
    'measure-scene-grid': scene('grid'),
    'measure-scene-files': scene('files'),
    'measure-scene-chats': scene('chats'),
    'measure-scene-terminals': scene('terminals'),
    'measure-copy': { run: () => void measure().then((module) => module.copyMeasurements()), offered: () => import.meta.env.DEV }
});
