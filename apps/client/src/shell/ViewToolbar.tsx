import { Folder } from 'lucide-react';
import { isCanvasView, type ProjectViewKind } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { useNodeHost } from '@/nodes/node-host';
import { activeViewOf, useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const lastSegment = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path;

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'terminal']);

/* Whether the bar has view content to fence off. A canvas and a chat have none. */
export const useHasViewToolbar = (): boolean => {
    const view = useDocument((s) => activeViewOf(s));
    const page = useUi((s) => s.page);
    return page === null && view !== null && KINDS_WITH_TOOLBAR.has(view.kind);
};

/*
 * What a view of its own puts in the toolbar, where a node would have its header: the folder and
 * the permission mode of a terminal, the navigation bar of a browser. A canvas view has nothing
 * here; its nodes carry their own headers. It takes the room between the two separators, which is
 * what lets a browser's address field run the width of the bar.
 */
export function ViewToolbar() {
    const view = useDocument((s) => activeViewOf(s));
    const focused = useDocument((s) => s.bodyFocused);
    const page = useUi((s) => s.page);
    const projectFolder = useProject((s) => s.current?.folder ?? null);
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');

    // A page fills the column, so a terminal's folder pill would stand over it.
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
    const folder = host?.cwd ?? projectFolder;
    const mode = RUNTIME_MODES.find((entry) => entry.id === host?.runtimeMode);
    return (
        <div className="flex min-w-0 grow items-center gap-1.5">
            {folder && (
                <Tooltip label={folder}>
                    <Pill icon={<Icon icon={Folder} size={12} />}>{lastSegment(folder)}</Pill>
                </Tooltip>
            )}
            {mode && (
                <Tooltip label={mode.hint}>
                    <Pill>{mode.label}</Pill>
                </Tooltip>
            )}
        </div>
    );
}
