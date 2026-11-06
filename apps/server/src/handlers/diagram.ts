import type { Area } from '../area.ts';
import type { DiagramStore } from '../projects/diagram-store.ts';
import { renderDiagram } from '../render/scenes.ts';
import { viewFileHandlers } from './view-files.ts';

export interface DiagramDeps {
    store: DiagramStore;
}

export function diagramArea({ store }: DiagramDeps): Area {
    return {
        name: 'diagram',
        sources: [store],
        handlers: (dispatcher) => {
            const handlers = viewFileHandlers(store);

            dispatcher.register('diagram.layout', (payload) => handlers.scene(payload, renderDiagram));
            dispatcher.register('diagram.open', handlers.open);
            dispatcher.register('diagram.save', handlers.save);
            dispatcher.register('diagram.close', handlers.close);
            dispatcher.register('diagram.copy', handlers.copy);
        },
        stop: [{ phase: 'end', label: 'Closing diagrams', run: () => store.closeAll() }]
    };
}
