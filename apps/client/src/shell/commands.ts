import { isCanvasView, isDrawingView, isSessionView, type AgentKind, type ProviderInfo } from '@ruimte/contracts';
import { addAgentNode, addAgentView, type AgentTarget } from '@/agents/nodes';
import { toWorld } from '@/canvas/math';
import {
    askDeleteView,
    askOpenAsView,
    askRenameView,
    canOpenAsView,
    newCanvasView,
    newDrawingView,
    newSeparatorView,
    newTerminalView,
    putOnCanvas,
    showOnCanvas
} from '@/project/views';
import { copyDrawingPng, copyDrawingSvg, saveDrawingPng, saveDrawingSvg } from '@/drawing/export';
import { separatorFor, startFolder } from '@/shell/palette-browse';
import { useCanvas, type AddNodeOptions, type NodeKind } from '@/state/canvas';
import { useDrawing } from '@/state/drawing';
import { activeViewOf, useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { providersOf } from '@/state/providers';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useTheme } from '@/state/theme';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';

export interface Command {
    id: string;
    label: string;
    hint?: string;
    /* Shown next to the label; the chord itself lives in the keyboard handler. */
    shortcut?: string;
    /* Draws this row with the CLI's brand mark instead of the generic action icon. */
    agent?: AgentKind;
    run(): void;
}

/*
 * The one way into browsing a folder: the palette, on the machine the app is pointed at, in the
 * folder in hand or that machine's home. Every entry point lands here, the project menu included,
 * because a native dialog cannot see the file system of another machine.
 */
export const openFolderBrowser = (): void => {
    const endpointId = useEndpoints.getState().activeId;
    const info = serverInfoOf(endpointId);
    const { current, currentEndpointId: on } = useProject.getState();
    useUi.getState().openPalette(startFolder(on === endpointId ? (current?.folder ?? null) : null, info.home, separatorFor(info.platform)));
};

/* Whichever surface is on screen owns the zoom rows in the palette. */
const zoomTarget = (): Pick<ReturnType<typeof useCanvas.getState>, 'fitAll' | 'zoomToSelection' | 'zoomTo'> => {
    const view = activeViewOf(useDocument.getState());
    return view && isDrawingView(view) ? useDrawing.getState() : useCanvas.getState();
};

const centerWorld = () => {
    const s = useCanvas.getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
};

export const addNodeAtCenter = (kind: NodeKind, options?: AddNodeOptions): string => useCanvas.getState().addNode(kind, centerWorld(), options);

/*
 * One command per agent CLI per kind of node, from the daemon's catalog. A CLI that is not there
 * keeps its row and opens the Agents settings, so the palette explains instead of failing.
 */
const agentCommands = (target: AgentTarget, providers: ProviderInfo[]): Command[] =>
    providers
        .filter((provider) => provider.capabilities[target])
        .flatMap((provider) => {
            const missing = (): void => useUi.getState().setSettings({ open: true, section: 'agents' });
            return [
                {
                    id: `agent-${target}-${provider.kind}`,
                    label: `New ${provider.name} ${target}`,
                    hint: provider.installed ? undefined : 'Not installed',
                    agent: provider.kind,
                    run: () => (provider.installed ? void addAgentNode(target, provider, centerWorld()) : missing())
                },
                {
                    id: `agent-view-${target}-${provider.kind}`,
                    label: `New ${provider.name} ${target} view`,
                    hint: provider.installed ? 'Without a canvas' : 'Not installed',
                    agent: provider.kind,
                    run: () => (provider.installed ? void addAgentView(target, provider) : missing())
                }
            ];
        });

/*
 * Moving a node to another view is one command per target: the palette has no second step, and a
 * project rarely has enough views for that to grow long.
 */
const moveNodeCommands = (): Command[] => {
    const { selection, nodes } = useCanvas.getState();
    const node = selection.length === 1 ? nodes[selection[0]!] : undefined;
    if (!node || node.kind === 'group') {
        return [];
    }
    const { views, activeViewId } = useDocument.getState();
    return views
        .filter((view) => isCanvasView(view) && view.id !== activeViewId)
        .map((view) => ({
            id: `view-move-${view.id}`,
            label: `Move node to ${view.name}`,
            hint: node.title,
            run: () => useDocument.getState().moveNodeToView(node.id, view.id)
        }));
};

/* Everything the palette can do besides jumping to a node. One list, so the dock and the keys agree. */
export const appCommands = (): Command[] => {
    const canvas = useCanvas.getState();
    const anyLocked = Object.values(canvas.locks).some(Boolean);
    const folder = useProject.getState().current?.folder ?? null;
    const { activeViewId, views } = useDocument.getState();
    const activeView = views.find((view) => view.id === activeViewId) ?? null;
    const selected = canvas.selection.length === 1 ? canvas.nodes[canvas.selection[0]!] : undefined;
    const drawing = activeView !== null && isDrawingView(activeView);
    return [
        { id: 'open-folder', label: 'Open a folder as a project', run: openFolderBrowser },
        ...(folder ? [{ id: 'find-in-files', label: 'Find in files', shortcut: '⌘⇧F', run: () => useUi.getState().openFindInFiles() }] : []),
        ...(folder
            ? [
                  {
                      id: 'reveal',
                      label: `Open project in ${fileManagerName(serverInfoOf(currentEndpointId()).platform)}`,
                      run: () => void transport.request('fs.reveal', { path: folder }).catch(() => undefined)
                  }
              ]
            : []),
        { id: 'view-new', label: 'New canvas view', shortcut: '⌘T', run: () => void newCanvasView() },
        ...(activeViewId
            ? [
                  { id: 'view-rename', label: 'Rename view', run: () => askRenameView(activeViewId) },
                  { id: 'view-delete', label: 'Delete view', run: () => askDeleteView(activeViewId) }
              ]
            : []),
        { id: 'view-new-drawing', label: 'New drawing view', run: () => void newDrawingView() },
        { id: 'view-new-terminal', label: 'New terminal view', run: () => void newTerminalView() },
        { id: 'view-new-separator', label: 'New separator', run: () => void newSeparatorView() },
        {
            id: 'view-new-browser',
            label: 'New browser view',
            run: () => useUi.getState().setViewDialog({ kind: 'new-browser' })
        },
        ...(selected && canOpenAsView(selected.kind)
            ? [{ id: 'view-promote', label: 'Open as view', hint: selected.title, run: () => askOpenAsView(selected.id) }]
            : []),
        ...(activeView && isSessionView(activeView)
            ? [{ id: 'view-demote', label: 'Put on canvas', hint: activeView.name, run: () => void putOnCanvas(activeView.id) }]
            : []),
        ...moveNodeCommands(),
        { id: 'add-terminal', label: 'New terminal', shortcut: '⌥T', run: () => void addNodeAtCenter('terminal') },
        { id: 'add-chat', label: 'New chat', shortcut: '⌥C', run: () => void addNodeAtCenter('chat') },
        ...agentCommands('chat', providersOf(currentEndpointId()).providers),
        ...agentCommands('terminal', providersOf(currentEndpointId()).providers),
        { id: 'add-browser', label: 'New browser', shortcut: '⌥B', run: () => void addNodeAtCenter('browser') },
        { id: 'add-group', label: 'New group', shortcut: '⌥G', run: () => void addNodeAtCenter('group') },
        { id: 'add-note', label: 'New note', shortcut: '⌥N', run: () => void addNodeAtCenter('note') },
        {
            id: 'group-selection',
            label: 'Group selection',
            hint: canvas.selection.length === 0 ? 'Select nodes first' : undefined,
            shortcut: '⌘G',
            run: () => void useCanvas.getState().groupSelection()
        },
        { id: 'add-text', label: 'New text', run: () => void useCanvas.getState().addText(centerWorld()) },
        { id: 'layout-save', label: 'Save layout as', hint: 'Remember where everything sits', run: () => useUi.getState().setLayoutDialogOpen(true) },
        ...canvas.layouts.flatMap((layout) => [
            { id: `layout-apply-${layout.name}`, label: `Apply layout: ${layout.name}`, run: () => useCanvas.getState().applyLayout(layout.name) },
            { id: `layout-delete-${layout.name}`, label: `Delete layout: ${layout.name}`, run: () => useCanvas.getState().deleteLayout(layout.name) }
        ]),
        // A drawing has a camera of its own, so the same three rows act on whichever is on screen.
        { id: 'fit', label: 'Zoom to fit', shortcut: '⇧1', run: () => zoomTarget().fitAll() },
        { id: 'zoom-selection', label: 'Zoom to selection', shortcut: '⇧2', run: () => zoomTarget().zoomToSelection() },
        { id: 'zoom-reset', label: 'Zoom to 100%', shortcut: '⌘0', run: () => zoomTarget().zoomTo(1) },
        ...(drawing && activeView
            ? [
                  { id: 'drawing-show-on-canvas', label: 'Show the drawing on canvas', run: () => void showOnCanvas(activeView.id) },
                  { id: 'drawing-copy-png', label: 'Copy the drawing as PNG', run: () => void copyDrawingPng() },
                  { id: 'drawing-save-png', label: 'Save the drawing as PNG', run: () => void saveDrawingPng() },
                  { id: 'drawing-copy-svg', label: 'Copy the drawing as SVG', run: () => void copyDrawingSvg() },
                  { id: 'drawing-save-svg', label: 'Save the drawing as SVG', run: () => void saveDrawingSvg() }
              ]
            : []),
        { id: 'lock', label: anyLocked ? 'Unlock everything' : 'Lock everything', run: () => useCanvas.getState().setAllLocks(!anyLocked) },
        { id: 'usage', label: 'Usage', hint: 'Cost, tokens and limits of both CLIs', run: () => useUi.getState().togglePage('usage') },
        { id: 'sidebar', label: 'Toggle sidebar', shortcut: '⌘B', run: () => useUi.getState().toggleSidebar() },
        { id: 'panel-preview', label: 'Toggle preview panel', run: () => useUi.getState().togglePreview() },
        { id: 'panel-files', label: 'Toggle files panel', run: () => useUi.getState().togglePanel('files') },
        { id: 'panel-git', label: 'Toggle git panel', run: () => useUi.getState().togglePanel('git') },
        { id: 'theme', label: 'Toggle light and dark', run: () => useTheme.getState().toggle() },
        { id: 'settings', label: 'Settings', shortcut: '⌘,', run: () => useUi.getState().setSettings({ open: true }) },
        { id: 'settings-keyboard', label: 'Keyboard shortcuts', run: () => useUi.getState().setSettings({ open: true, section: 'keyboard' }) },
        {
            id: 'settings-machines',
            label: 'Machines',
            hint: 'Pair with a daemon elsewhere',
            run: () => useUi.getState().setSettings({ open: true, section: 'machines' })
        }
    ];
};
