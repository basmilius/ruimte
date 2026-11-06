import { showViewOnCanvasAction } from '@/action-port/person-actions';
import { defineBehaviors, type CommandBehavior } from '@/commands/behavior';
import { copyDiagram, exportDiagram, openDiagramJson } from '@/diagram/diagram-actions';
import { focusedDiagram } from '@/state/diagram';
import { useDocument } from '@/state/document';

const onDiagram = (moment: { inWorkspace: boolean; diagram: boolean; activeView: unknown }): boolean =>
    moment.inWorkspace && moment.diagram && moment.activeView !== null;

function acting(run: () => void): CommandBehavior {
    return { run, offered: onDiagram };
}

function withActiveView(run: (viewId: string) => void): () => void {
    return () => {
        const id = useDocument.getState().activeViewId;
        if (id !== null) {
            run(id);
        }
    };
}

export const DIAGRAM_BEHAVIORS = defineBehaviors({
    'diagram-open-json': {
        run: withActiveView(openDiagramJson),
        offered: (moment) => onDiagram(moment) && moment.folder !== null
    },
    'diagram-show-on-canvas': acting(withActiveView((id) => void showViewOnCanvasAction(id))),
    'diagram-copy-json': acting(() => copyDiagram(focusedDiagram(), 'json')),
    'diagram-copy-png': acting(() => copyDiagram(focusedDiagram(), 'png')),
    'diagram-save-png': acting(() => exportDiagram(focusedDiagram(), 'png')),
    'diagram-copy-svg': acting(() => copyDiagram(focusedDiagram(), 'svg')),
    'diagram-save-svg': acting(() => exportDiagram(focusedDiagram(), 'svg'))
});
