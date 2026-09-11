import { isCanvasView, type ProjectViewKind } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'terminal']);

const modeOf = (host: NodeHost | null) => RUNTIME_MODES.find((entry) => entry.id === host?.runtimeMode);

/* Whether the bar has view content to fence off, which is what the separators around it wait for. A
   browser always brings its navigation, a terminal only the mode of an agent running in it; a canvas
   and a chat bring nothing. */
export const useHasViewToolbar = (): boolean => {
    const view = useDocument((s) => activeViewOf(s));
    const page = useUi((s) => s.page);
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');
    if (page !== null || view === null || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return false;
    }
    return view.kind === 'browser' || modeOf(host) !== undefined;
};

/*
 * What a view of its own puts in the toolbar, where a node would have its header: the permission
 * mode of a terminal, the navigation bar of a browser. A canvas view has nothing here; its nodes
 * carry their own headers. It takes the room between the two separators, which is what lets a
 * browser's address field run the width of the bar.
 */
export function ViewToolbar() {
    const view = useDocument((s) => activeViewOf(s));
    const focused = useDocument((s) => s.bodyFocused);
    const page = useUi((s) => s.page);
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');

    // A page fills the column, so a terminal's mode pill would stand over it.
    if (page !== null || !view || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return null;
    }
    if (view.kind === 'browser') {
        return (
            <div className="app-no-drag flex min-w-0 grow items-center gap-2">
                <BrowserToolbar id={view.id} focused={focused} />
            </div>
        );
    }
    const mode = modeOf(host);
    if (!mode) {
        return null;
    }
    return (
        <div className="flex min-w-0 grow items-center gap-1.5">
            <Tooltip label={mode.hint}>
                <Pill>{mode.label}</Pill>
            </Tooltip>
        </div>
    );
}
