import { isCanvasView, type ProjectView, type ProjectViewKind } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { useHasSubagentControls, useSubagentTrail } from '@/chat/subagent-view';
import { ForkPill } from '@/chat/ui/ForkPill';
import { SubagentBreadcrumb, SubagentButton } from '@/chat/ui/SubagentControls';
import { useChatRow } from '@/state/chats';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { activeViewOf, useDocument } from '@/state/document';
import { BTN_GROUP } from '@/ui/classes';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'terminal', 'file', 'diagram', 'chat']);

const modeOf = (host: NodeHost | null) => RUNTIME_MODES.find((entry) => entry.id === host?.runtimeMode);

/* Whether a view has content for the bar, which is what the separators around it wait for. A browser
   always brings its navigation, a file and a diagram their own controls, a terminal only the mode of an agent
   running in it, a chat only its sub-agents once it has any and where it was forked from; a canvas brings nothing. */
export const useHasViewToolbar = (view: ProjectView | null): boolean => {
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');
    const subagents = useHasSubagentControls(view?.kind === 'chat' ? view.id : '');
    const forked = useIsFork(view);
    if (view === null || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return false;
    }
    if (view.kind === 'chat') {
        return subagents || forked;
    }
    return view.kind === 'browser' || view.kind === 'file' || view.kind === 'diagram' || modeOf(host) !== undefined;
};

const useIsFork = (view: ProjectView | null): boolean => useChatRow(view?.kind === 'chat' ? view.id : '', (row) => row?.info.forkOf !== undefined);

/* Whether a chat view shows its sub-agents in its place, where its title turns into the first crumb and needs no separator after it. */
export const useShowsSubagents = (view: ProjectView | null): boolean => useSubagentTrail(view?.kind === 'chat' ? view.id : '').trail.length > 0;

/* The view the window's toolbar speaks for: the one in the focused cell. */
export const useToolbarView = (): ProjectView | null => useDocument((s) => activeViewOf(s));

/*
 * What a view of its own puts in a toolbar, where a node would have its header: the permission mode
 * of a terminal, the navigation bar of a browser, the controls of a file, the sub-agents of a chat. A
 * canvas view has nothing here; its nodes carry their own headers. It takes the room it is given,
 * which is what lets a browser's address field run the width of the bar.
 *
 * Which bar that is depends on the grid: with one cell the window's toolbar speaks for the view, and
 * with the views side by side every cell carries its own (`shell/CellToolbar.tsx`).
 */
export function ViewToolbar({
    view,
    focused,
    chatTitle
}: {
    view: ProjectView | null;
    focused: boolean;
    /* For a bar that does not draw the view's name itself, so the breadcrumb of a chat opens with it. */
    chatTitle?: string;
}) {
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');
    const { mount } = useFileToolbarSlot();
    const hasSubagents = useHasSubagentControls(view?.kind === 'chat' ? view.id : '');
    const forked = useIsFork(view);

    if (!view || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return null;
    }
    if (view.kind === 'browser') {
        return (
            <div className="flex min-w-0 grow items-center gap-2">
                <BrowserToolbar id={view.id} focused={focused} />
            </div>
        );
    }
    if (view.kind === 'file' || view.kind === 'diagram') {
        // Empty until the body has rendered, which is what fills it: the controls belong to the
        // renderer that draws the file or the diagram, and only that one knows which it has. The box
        // grows over the slack of the bar, so it drags the window and only its controls opt out.
        return <div ref={mount} className="flex min-w-0 grow items-center justify-end gap-1" />;
    }
    if (view.kind === 'chat') {
        if (!hasSubagents && !forked) {
            return null;
        }
        return (
            <div className="flex min-w-0 grow items-center gap-1.5">
                {hasSubagents && <SubagentBreadcrumb chatId={view.id} title={chatTitle} className="grow" />}
                {forked && <ForkPill chatId={view.id} />}
                {hasSubagents && (
                    <div className={`${BTN_GROUP} ml-auto shrink-0`}>
                        <SubagentButton chatId={view.id} />
                    </div>
                )}
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
