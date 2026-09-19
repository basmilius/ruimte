import { renderDiagram } from '../render/scenes.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { DiagramStore } from '../projects/diagram-store.ts';
import { viewFileHandlers } from './view-files.ts';

export const registerDiagramHandlers = (dispatcher: Dispatcher, store: DiagramStore): void => {
    const handlers = viewFileHandlers(store);

    dispatcher.register('diagram.layout', (payload) => handlers.scene(payload, renderDiagram));
    dispatcher.register('diagram.open', handlers.open);
    dispatcher.register('diagram.save', handlers.save);
    dispatcher.register('diagram.close', handlers.close);
    dispatcher.register('diagram.copy', handlers.copy);
};
