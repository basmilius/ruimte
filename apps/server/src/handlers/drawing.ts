import { renderDrawing } from '../render/scenes.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { DrawingError, type DrawingStore } from '../projects/drawing-store.ts';
import { viewFileHandlers } from './view-files.ts';

export const registerDrawingHandlers = (dispatcher: Dispatcher, store: DrawingStore): void => {
    const handlers = viewFileHandlers(store, (e) => (e instanceof DrawingError ? e : null));

    dispatcher.register('drawing.paths', (payload) => handlers.scene(payload, renderDrawing));
    dispatcher.register('drawing.open', handlers.open);
    dispatcher.register('drawing.save', handlers.save);
    dispatcher.register('drawing.close', handlers.close);
    dispatcher.register('drawing.copy', handlers.copy);
};
