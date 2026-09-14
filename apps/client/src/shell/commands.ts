import { isCanvasView, isDiagramView, isDrawingView, isSessionView, type AgentKind, type ProviderInfo } from '@ruimte/contracts';
import { addAgentNode, addAgentView, type AgentTarget } from '@/agents/nodes';
import { toWorld } from '@/canvas/math';
import {
    askDeleteView,
    askOpenAsView,
    askRenameView,
    canOpenAsView,
    newCanvasView,
    newDiagramView,
    newDrawingView,
    newSeparatorView,
    newTerminalView,
    putOnCanvas,
    showOnCanvas
} from '@/project/views';
import { copyDiagramJson, copyDiagramPng, copyDiagramSvg, openDiagramJson, saveDiagramPng, saveDiagramSvg } from '@/diagram/export';
import { copyDrawingPng, copyDrawingSvg, saveDrawingPng, saveDrawingSvg } from '@/drawing/export';
import { focusedCanvas, type AddNodeOptions, type CanvasState, type NodeKind } from '@/state/canvas';
import { focusedDiagram } from '@/state/diagram';
import { focusedDrawing } from '@/state/drawing';
import { activeViewOf, useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { providersOf } from '@/state/providers';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useTheme } from '@/state/theme';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import type { Shortcut } from '@/ui/shortcut';

export interface Command {
    id: string;
    label: string;
    hint?: string;
    /* Shown next to the label; the handler binds the same value. */
    shortcut?: Shortcut;
    /* Draws this row with the CLI's brand mark instead of the generic action icon. */
    agent?: AgentKind;
    run(): void;
}

/* Whichever surface is on screen owns the zoom rows in the palette. */
const zoomTarget = (): Pick<CanvasState, 'fitAll' | 'zoomToSelection' | 'zoomTo'> => {
    const view = activeViewOf(useDocument.getState());
    if (view && isDrawingView(view)) {
        return focusedDrawing().getState();
    }
    return view && isDiagramView(view) ? focusedDiagram().getState() : focusedCanvas().getState();
};

const centerWorld = () => {
    const s = focusedCanvas().getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
};

export const addNodeAtCenter = (kind: NodeKind, options?: AddNodeOptions): string | null => focusedCanvas().getState().addNode(kind, centerWorld(), options);

export const addAgentNodeAtCenter = (target: AgentTarget, provider: ProviderInfo): string | null => addAgentNode(target, provider, centerWorld());

/*
 * One command per agent CLI per kind of node, from the daemon's catalog. A CLI that is not
 * installed is left out: the Agents settings pane is where that gets fixed, not the palette.
 */
const agentCommands = (target: AgentTarget, providers: ProviderInfo[], onCanvas: boolean): Command[] =>
    providers
        .filter((provider) => provider.installed && provider.capabilities[target])
        .flatMap((provider) => [
            ...(onCanvas
                ? [
                      {
                          id: `agent-${target}-${provider.kind}`,
                          label: `New ${provider.name} ${target}`,
                          agent: provider.kind,
                          run: () => void addAgentNode(target, provider, centerWorld())
                      }
                  ]
                : []),
            {
                id: `agent-view-${target}-${provider.kind}`,
                label: `New ${provider.name} ${target} view`,
                hint: 'Without a canvas',
                agent: provider.kind,
                run: () => void addAgentView(target, provider)
            }
        ]);

/*
 * Moving a node to another view is one command per target: the palette has no second step, and a
 * project rarely has enough views for that to grow long.
 */
const moveNodeCommands = (): Command[] => {
    const { selection, nodes } = focusedCanvas().getState();
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

/*
 * What an empty palette offers: the handful of rows worth a place before anything is typed. The
 * rest of the list is one keystroke away, and a palette that opens on forty rows is a list to read
 * rather than a place to start typing.
 */
export const OPENING_COMMAND_IDS: readonly string[] = ['add-chat', 'add-terminal', 'view-new', 'find-in-files', 'open-folder', 'usage', 'settings'];

/* Everything the palette can do besides jumping to a node. One list, so the dock and the keys agree. */
export const appCommands = (): Command[] => {
    const canvas = focusedCanvas().getState();
    const anyLocked = Object.values(canvas.locks).some(Boolean);
    const folder = useProject.getState().current?.folder ?? null;
    const { activeViewId, views } = useDocument.getState();
    const activeView = views.find((view) => view.id === activeViewId) ?? null;
    const selected = canvas.selection.length === 1 ? canvas.nodes[canvas.selection[0]!] : undefined;
    const drawing = activeView !== null && isDrawingView(activeView);
    const diagram = activeView !== null && isDiagramView(activeView);
    /* A row that writes into a canvas is offered only while one is on screen. In a chat or a
       terminal view "New note" and "Zoom to fit" would act on a surface nobody is looking at. */
    const onCanvas = activeView !== null && isCanvasView(activeView);
    const project = useProject.getState().current !== null;
    return [
        { id: 'open-folder', label: 'Open a folder as a project', run: () => useUi.getState().openFolderBrowser() },
        ...(folder
            ? [{ id: 'find-in-files', label: 'Find in files', shortcut: APP_SHORTCUTS.findInFiles, run: () => useUi.getState().openFindInFiles() }]
            : []),
        ...(folder
            ? [
                  {
                      id: 'reveal',
                      label: `Open project in ${fileManagerName(serverInfoOf(currentEndpointId()).platform)}`,
                      run: () =>
                          void transportFor(currentEndpointId())
                              ?.request('fs.reveal', { path: folder })
                              .catch(() => undefined)
                  }
              ]
            : []),
        /* Everything that writes into a canvas or the list of views. With no project open there
           is no file behind any of it, so these rows are not offered rather than quietly lost. */
        ...(project
            ? [
                  { id: 'view-new', label: 'New canvas view', shortcut: CANVAS_SHORTCUTS.newView, run: () => void newCanvasView() },
                  ...(activeViewId
                      ? [
                            { id: 'view-rename', label: 'Rename view', run: () => askRenameView(activeViewId) },
                            { id: 'view-delete', label: 'Delete view', run: () => askDeleteView(activeViewId) }
                        ]
                      : []),
                  { id: 'view-new-drawing', label: 'New drawing view', run: () => void newDrawingView() },
                  { id: 'view-new-diagram', label: 'New diagram view', run: () => void newDiagramView() },
                  ...(folder ? [{ id: 'view-new-file', label: 'New file view', run: () => useUi.getState().openFilePicker({ kind: 'view' }) }] : []),
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
                  ...agentCommands('chat', providersOf(currentEndpointId()).providers, onCanvas),
                  ...agentCommands('terminal', providersOf(currentEndpointId()).providers, onCanvas),
                  ...(onCanvas
                      ? [
                            ...moveNodeCommands(),
                            { id: 'add-terminal', label: 'New terminal', shortcut: ADD_NODE_SHORTCUTS.terminal, run: () => void addNodeAtCenter('terminal') },
                            { id: 'add-chat', label: 'New chat', shortcut: ADD_NODE_SHORTCUTS.chat, run: () => void addNodeAtCenter('chat') },
                            { id: 'add-browser', label: 'New browser', shortcut: ADD_NODE_SHORTCUTS.browser, run: () => void addNodeAtCenter('browser') },
                            { id: 'add-group', label: 'New group', shortcut: ADD_NODE_SHORTCUTS.group, run: () => void addNodeAtCenter('group') },
                            { id: 'add-note', label: 'New note', shortcut: ADD_NODE_SHORTCUTS.note, run: () => void addNodeAtCenter('note') },
                            ...(folder
                                ? [
                                      {
                                          id: 'add-file',
                                          label: 'Show a file on the canvas',
                                          hint: 'Read-only',
                                          run: () => useUi.getState().openFilePicker({ kind: 'node', at: centerWorld() })
                                      }
                                  ]
                                : []),
                            {
                                id: 'group-selection',
                                label: 'Group selection',
                                hint: canvas.selection.length === 0 ? 'Select nodes first' : undefined,
                                shortcut: CANVAS_SHORTCUTS.group,
                                run: () => void focusedCanvas().getState().groupSelection()
                            },
                            { id: 'add-text', label: 'New text', run: () => void focusedCanvas().getState().addText(centerWorld()) },
                            {
                                id: 'layout-save',
                                label: 'Save layout as',
                                hint: 'Remember where everything sits',
                                run: () => useUi.getState().setLayoutDialogOpen(true)
                            },
                            ...canvas.layouts.flatMap((layout) => [
                                {
                                    id: `layout-apply-${layout.name}`,
                                    label: `Apply layout: ${layout.name}`,
                                    run: () => focusedCanvas().getState().applyLayout(layout.name)
                                },
                                {
                                    id: `layout-delete-${layout.name}`,
                                    label: `Delete layout: ${layout.name}`,
                                    run: () => focusedCanvas().getState().deleteLayout(layout.name)
                                }
                            ]),
                            {
                                id: 'lock',
                                label: anyLocked ? 'Unlock everything' : 'Lock everything',
                                run: () => focusedCanvas().getState().setAllLocks(!anyLocked)
                            }
                        ]
                      : []),
                  // A drawing has a camera of its own, so the same three rows act on whichever is on screen.
                  ...(onCanvas || drawing || diagram
                      ? [
                            { id: 'fit', label: 'Zoom to fit', shortcut: CANVAS_SHORTCUTS.fitAll, run: () => zoomTarget().fitAll() },
                            {
                                id: 'zoom-selection',
                                label: 'Zoom to selection',
                                shortcut: CANVAS_SHORTCUTS.zoomSelection,
                                run: () => zoomTarget().zoomToSelection()
                            },
                            { id: 'zoom-reset', label: 'Zoom to 100%', shortcut: CANVAS_SHORTCUTS.zoomReset, run: () => zoomTarget().zoomTo(1) }
                        ]
                      : []),
                  ...(diagram && activeView
                      ? [
                            ...(useProject.getState().current?.folder
                                ? [{ id: 'diagram-open-json', label: 'Open the diagram as JSON', run: () => openDiagramJson(activeView.id) }]
                                : []),
                            { id: 'diagram-copy-json', label: 'Copy the diagram as JSON', run: () => void copyDiagramJson(focusedDiagram()) },
                            { id: 'diagram-copy-png', label: 'Copy the diagram as PNG', run: () => void copyDiagramPng(focusedDiagram()) },
                            { id: 'diagram-save-png', label: 'Save the diagram as PNG', run: () => void saveDiagramPng(focusedDiagram()) },
                            { id: 'diagram-copy-svg', label: 'Copy the diagram as SVG', run: () => void copyDiagramSvg(focusedDiagram()) },
                            { id: 'diagram-save-svg', label: 'Save the diagram as SVG', run: () => void saveDiagramSvg(focusedDiagram()) }
                        ]
                      : []),
                  ...(drawing && activeView
                      ? [
                            { id: 'drawing-show-on-canvas', label: 'Show the drawing on canvas', run: () => void showOnCanvas(activeView.id) },
                            { id: 'drawing-copy-png', label: 'Copy the drawing as PNG', run: () => void copyDrawingPng(focusedDrawing()) },
                            { id: 'drawing-save-png', label: 'Save the drawing as PNG', run: () => void saveDrawingPng(focusedDrawing()) },
                            { id: 'drawing-copy-svg', label: 'Copy the drawing as SVG', run: () => void copyDrawingSvg(focusedDrawing()) },
                            { id: 'drawing-save-svg', label: 'Save the drawing as SVG', run: () => void saveDrawingSvg(focusedDrawing()) }
                        ]
                      : [])
              ]
            : []),
        { id: 'usage', label: 'Usage', hint: 'Cost, tokens and plan limits', run: () => useUi.getState().togglePage('usage') },
        { id: 'sidebar', label: 'Toggle sidebar', shortcut: APP_SHORTCUTS.sidebar, run: () => useUi.getState().toggleSidebar() },
        { id: 'panel-preview', label: 'Toggle preview panel', run: () => useUi.getState().togglePreview() },
        { id: 'panel-files', label: 'Toggle files panel', run: () => useUi.getState().togglePanel('files') },
        { id: 'panel-git', label: 'Toggle git panel', run: () => useUi.getState().togglePanel('git') },
        { id: 'panel-processes', label: 'Toggle processes panel', run: () => useUi.getState().togglePanel('processes') },
        { id: 'theme', label: 'Toggle light and dark', run: () => useTheme.getState().toggle() },
        { id: 'settings', label: 'Settings', shortcut: APP_SHORTCUTS.settings, run: () => useUi.getState().setSettings({ open: true }) },
        { id: 'settings-keyboard', label: 'Keyboard shortcuts', run: () => useUi.getState().setSettings({ open: true, section: 'keyboard' }) },
        {
            id: 'settings-machines',
            label: 'Machines',
            hint: 'Pair with a machine elsewhere',
            run: () => useUi.getState().setSettings({ open: true, section: 'machines' })
        }
    ];
};
