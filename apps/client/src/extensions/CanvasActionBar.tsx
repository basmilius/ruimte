import { Button, Icon } from '@adecore/ui';
import { runCanvasAction } from '@/extensions/run-canvas-action';
import { useContributions } from '@/extensions/registry';
import { useCanvas } from '@/state/canvas';

/* What extensions offer for the selection, over the canvas. It stays out of the way until something is selected. */
export function CanvasActionBar() {
    const actions = useContributions((state) => state.canvasActions);
    const selection = useCanvas((state) => state.selection);
    const shown = selection.length === 0 ? [] : actions.filter((action) => action.when(selection));

    if (shown.length === 0) {
        return null;
    }

    return (
        <div
            className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
            // A press here is no press on the canvas, which would drop the selection this acts on.
            onPointerDown={(event) => event.stopPropagation()}
        >
            {shown.map((action) => (
                <Button key={action.id} variant="ghost" size="sm" onClick={() => runCanvasAction(action, selection)}>
                    {action.icon !== undefined && <Icon icon={action.icon} size={14} />}
                    {action.title}
                </Button>
            ))}
        </div>
    );
}
