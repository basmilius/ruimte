import { isCanvasView, type ProjectViewKind } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'terminal', 'file']);

const modeOf = (host: NodeHost | null) => RUNTIME_MODES.find((entry) => entry.id === host?.runtimeMode);

/* Whether the bar has view content to fence off, which is what the separators around it wait for. A
   browser always brings its navigation and a file its own controls, a terminal only the mode of an
   agent running in it; a canvas and a chat bring nothing. */
export const useHasViewToolbar = (): boolean => {
    const view = useDocument((s) => activeViewOf(s));
    const page = useUi((s) => s.page);
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');
    if (page !== null || view === null || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return false;
    }
    return view.kind === 'browser' || view.kind === 'file' || modeOf(host) !== undefined;
};

/*
 * What a view of its own puts in the toolbar, where a node would have its header: the permission
 * mode of a terminal, the navigation bar of a browser, the controls of a file. A canvas view has
 * nothing here; its nodes carry their own headers. It takes the room between the two separators,
 * which is what lets a browser's address field run the width of the bar.
 */
export function ViewToolbar() {
    const view = useDocument((s) => activeViewOf(s));
    const focused = useDocument((s) => s.bodyFocused);
    const page = useUi((s) => s.page);
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');
    const { mount } = useFileToolbarSlot();

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
    if (view.kind === 'file') {
        // Empty until the body has rendered, which is what fills it: the controls belong to the
        // renderer that draws the file, and only that one knows which the file has.
        return <div ref={mount} className="app-no-drag flex min-w-0 grow items-center justify-end gap-1" />;
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
