import { showViewOnCanvasAction } from '@/action-port/person-actions';
import { defineBehaviors, type CommandBehavior } from '@/commands/behavior';
import { copyDrawing, exportDrawing } from '@/drawing/drawing-actions';
import { useDocument } from '@/state/document';
import { focusedDrawing } from '@/state/drawing';

const onDrawing = (moment: { inWorkspace: boolean; drawing: boolean; activeView: unknown }): boolean =>
    moment.inWorkspace && moment.drawing && moment.activeView !== null;

function acting(run: () => void): CommandBehavior {
    return { run, offered: onDrawing };
}

export const DRAWING_BEHAVIORS = defineBehaviors({
    'drawing-show-on-canvas': acting(() => {
        const id = useDocument.getState().activeViewId;
        if (id !== null) {
            void showViewOnCanvasAction(id);
        }
    }),
    'drawing-copy-png': acting(() => void copyDrawing(focusedDrawing(), 'png')),
    'drawing-save-png': acting(() => exportDrawing(focusedDrawing(), 'png')),
    'drawing-copy-svg': acting(() => void copyDrawing(focusedDrawing(), 'svg')),
    'drawing-save-svg': acting(() => exportDrawing(focusedDrawing(), 'svg'))
});
