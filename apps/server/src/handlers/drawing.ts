import { drawingScene } from '@adecore/drawing';
import type { Area } from '../area.ts';
import type { DrawingStore } from '../projects/drawing-store.ts';
import { viewFileHandlers } from './view-files.ts';

export interface DrawingDeps {
    store: DrawingStore;
}

export function drawingArea({ store }: DrawingDeps): Area {
    return {
        name: 'drawing',
        sources: [store],
        handlers: (dispatcher) => {
            const handlers = viewFileHandlers(store);

            dispatcher.register('drawing.paths', (payload) => handlers.scene(payload, drawingScene));
            dispatcher.register('drawing.open', handlers.open);
            dispatcher.register('drawing.save', handlers.save);
            dispatcher.register('drawing.close', handlers.close);
            dispatcher.register('drawing.copy', handlers.copy);
        },
        stop: [{ phase: 'end', label: 'Closing drawings', run: () => store.closeAll() }]
    };
}
