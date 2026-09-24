import i18next from 'i18next';
import { isCanvasView, isDiagramView, isDrawingView, isSessionView, type AgentKind, type ProviderInfo } from '@ruimte/contracts';
import type { AgentTarget } from '@/agents/nodes';
import {
    applyLayoutAction,
    createNodeAction,
    createTextAction,
    createViewAction,
    deleteLayoutAction,
    fitAction,
    groupSelectionAction,
    moveNodeToViewAction,
    placeViewOnCanvasAction,
    setLocksAction,
    showViewOnCanvasAction
} from '@/actions/client-actions';
import { toWorld } from '@/canvas/math';
import { openFocusedFind } from '@/find/hosts';
import { askDeleteView, askOpenAsView, askViewSettings, canOpenAsView, newSubheaderView } from '@/project/views';
import { copyDiagram, exportDiagram, openDiagramJson } from '@/diagram/diagram-actions';
import { copyDrawing, exportDrawing } from '@/drawing/drawing-actions';
import { focusedCanvas, type CanvasState } from '@/state/canvas';
import { focusedDiagram } from '@/state/diagram';
import { focusedDrawing } from '@/state/drawing';
import { activeViewOf, useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { windowWorkspace } from '@/state/window';
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
const zoomTarget = (): Pick<CanvasState, 'zoomToSelection' | 'zoomTo'> => {
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
                          label: i18next.t(`shell:palette.newAgent.${target}`, { name: provider.name }),
                          agent: provider.kind,
                          run: () => void createNodeAction(target, { provider: provider.kind })
                      }
                  ]
                : []),
            {
                id: `agent-view-${target}-${provider.kind}`,
                label: i18next.t(`shell:palette.newAgentView.${target}`, { name: provider.name }),
                hint: i18next.t('shell:palette.hints.withoutCanvas'),
                agent: provider.kind,
                run: () => void createViewAction(target, { provider: provider.kind })
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
            label: i18next.t('shell:palette.moveNodeTo', { view: view.name }),
            hint: node.title,
            run: () => moveNodeToViewAction(node.id, view.id)
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
    /* The start screen is outside every project, so only the rows about the window are offered there. */
    const inWorkspace = windowWorkspace() !== null;
    return [
        { id: 'open-folder', label: i18next.t('shell:palette.commands.openFolder'), run: () => useUi.getState().openFolderBrowser() },
        ...(folder
            ? [
                  {
                      id: 'find-in-files',
                      label: i18next.t('shell:palette.commands.findInFiles'),
                      shortcut: APP_SHORTCUTS.findInFiles,
                      run: () => useUi.getState().openFindInFiles()
                  }
              ]
            : []),
        ...(inWorkspace
            ? [
                  {
                      id: 'find',
                      label: i18next.t('shell:palette.commands.find'),
                      shortcut: CANVAS_SHORTCUTS.find,
                      // A frame later: the palette hands the focus back as it closes, and that focus says which surface is meant.
                      run: () => {
                          requestAnimationFrame(() => {
                              openFocusedFind();
                          });
                      }
                  }
              ]
            : []),
        ...(folder
            ? [
                  {
                      id: 'reveal',
                      label: i18next.t('shell:palette.commands.reveal', { app: fileManagerName(serverInfoOf(currentEndpointId()).platform) }),
                      run: () =>
                          void transportFor(currentEndpointId())
                              ?.request('fs.reveal', { path: folder })
                              .catch(() => undefined)
                  }
              ]
            : []),
        ...(inWorkspace
            ? [
                  {
                      id: 'view-new',
                      label: i18next.t('shell:palette.commands.newCanvasView'),
                      shortcut: CANVAS_SHORTCUTS.newView,
                      run: () => void createViewAction('canvas')
                  },
                  ...(activeViewId
                      ? [
                            { id: 'view-settings', label: i18next.t('shell:viewMenu.viewSettings'), run: () => askViewSettings(activeViewId) },
                            { id: 'view-delete', label: i18next.t('shell:viewMenu.deleteView'), run: () => askDeleteView(activeViewId) }
                        ]
                      : []),
                  { id: 'view-new-drawing', label: i18next.t('shell:palette.commands.newDrawingView'), run: () => void createViewAction('drawing') },
                  { id: 'view-new-diagram', label: i18next.t('shell:palette.commands.newDiagramView'), run: () => void createViewAction('diagram') },
                  ...(folder
                      ? [
                            {
                                id: 'view-new-file',
                                label: i18next.t('shell:palette.commands.newFileView'),
                                run: () => useUi.getState().openFilePicker({ kind: 'view' })
                            }
                        ]
                      : []),
                  { id: 'view-new-terminal', label: i18next.t('shell:palette.commands.newTerminalView'), run: () => void createViewAction('terminal') },
                  { id: 'view-new-separator', label: i18next.t('shell:palette.commands.newSeparator'), run: () => void createViewAction('separator') },
                  { id: 'view-new-subheader', label: i18next.t('shell:palette.commands.newSubheader'), run: () => void newSubheaderView() },
                  {
                      id: 'view-new-browser',
                      label: i18next.t('shell:viewDialogs.newBrowser.title'),
                      run: () => useUi.getState().setViewDialog({ kind: 'new-browser' })
                  },
                  ...(selected && canOpenAsView(selected.kind)
                      ? [
                            {
                                id: 'view-promote',
                                label: i18next.t('shell:viewDialogs.promote.confirm'),
                                hint: selected.title,
                                run: () => askOpenAsView(selected.id)
                            }
                        ]
                      : []),
                  ...(activeView && isSessionView(activeView) && views.some(isCanvasView)
                      ? [
                            {
                                id: 'view-demote',
                                label: i18next.t('shell:viewMenu.putOnCanvas'),
                                hint: activeView.name,
                                run: () => placeViewOnCanvasAction(activeView.id)
                            }
                        ]
                      : []),
                  ...agentCommands('chat', providersOf(currentEndpointId()).providers, onCanvas),
                  ...agentCommands('terminal', providersOf(currentEndpointId()).providers, onCanvas),
                  ...(onCanvas
                      ? [
                            ...moveNodeCommands(),
                            {
                                id: 'add-terminal',
                                label: i18next.t('shell:palette.commands.newTerminal'),
                                shortcut: ADD_NODE_SHORTCUTS.terminal,
                                run: () => void createNodeAction('terminal')
                            },
                            {
                                id: 'add-chat',
                                label: i18next.t('shell:palette.commands.newChat'),
                                shortcut: ADD_NODE_SHORTCUTS.chat,
                                run: () => void createNodeAction('chat')
                            },
                            {
                                id: 'add-browser',
                                label: i18next.t('shell:palette.commands.newBrowser'),
                                shortcut: ADD_NODE_SHORTCUTS.browser,
                                run: () => void createNodeAction('browser')
                            },
                            {
                                id: 'add-group',
                                label: i18next.t('shell:palette.commands.newGroup'),
                                shortcut: ADD_NODE_SHORTCUTS.group,
                                run: () => void createNodeAction('group')
                            },
                            {
                                id: 'add-note',
                                label: i18next.t('shell:palette.commands.newNote'),
                                shortcut: ADD_NODE_SHORTCUTS.note,
                                run: () => void createNodeAction('note')
                            },
                            ...(folder
                                ? [
                                      {
                                          id: 'add-file',
                                          label: i18next.t('shell:palette.commands.showFile'),
                                          hint: i18next.t('shell:palette.hints.readOnly'),
                                          run: () => useUi.getState().openFilePicker({ kind: 'node', at: centerWorld() })
                                      }
                                  ]
                                : []),
                            {
                                id: 'group-selection',
                                label: i18next.t('shell:palette.commands.groupSelection'),
                                hint: canvas.selection.length === 0 ? i18next.t('shell:palette.hints.selectFirst') : undefined,
                                shortcut: CANVAS_SHORTCUTS.group,
                                run: () => groupSelectionAction()
                            },
                            {
                                id: 'add-text',
                                label: i18next.t('shell:palette.commands.newText'),
                                run: () => createTextAction()
                            },
                            {
                                id: 'layout-save',
                                label: i18next.t('shell:palette.commands.saveLayoutAs'),
                                hint: i18next.t('shell:palette.hints.rememberLayout'),
                                run: () => useUi.getState().setLayoutDialogOpen(true)
                            },
                            ...canvas.layouts.flatMap((layout) => [
                                {
                                    id: `layout-apply-${layout.name}`,
                                    label: i18next.t('shell:palette.applyLayout', { name: layout.name }),
                                    run: () => applyLayoutAction(layout.name)
                                },
                                {
                                    id: `layout-delete-${layout.name}`,
                                    label: i18next.t('shell:palette.deleteLayout', { name: layout.name }),
                                    run: () => deleteLayoutAction(layout.name)
                                }
                            ]),
                            {
                                id: 'lock',
                                label: anyLocked ? i18next.t('shell:dock.unlockEverything') : i18next.t('shell:dock.lockEverything'),
                                run: () => setLocksAction(!anyLocked)
                            }
                        ]
                      : []),
                  // A drawing has a camera of its own, so the same three rows act on whichever is on screen.
                  ...(onCanvas || drawing || diagram
                      ? [
                            { id: 'fit', label: i18next.t('shell:dock.zoomToFit'), shortcut: CANVAS_SHORTCUTS.fitAll, run: () => fitAction() },
                            {
                                id: 'zoom-selection',
                                label: i18next.t('shell:dock.zoomToSelection'),
                                shortcut: CANVAS_SHORTCUTS.zoomSelection,
                                run: () => zoomTarget().zoomToSelection()
                            },
                            {
                                id: 'zoom-reset',
                                label: i18next.t('shell:palette.commands.zoomReset'),
                                shortcut: CANVAS_SHORTCUTS.zoomReset,
                                run: () => zoomTarget().zoomTo(1)
                            }
                        ]
                      : []),
                  ...(diagram && activeView
                      ? [
                            ...(useProject.getState().current?.folder
                                ? [
                                      {
                                          id: 'diagram-open-json',
                                          label: i18next.t('shell:palette.commands.diagramOpenJson'),
                                          run: () => openDiagramJson(activeView.id)
                                      }
                                  ]
                                : []),
                            {
                                id: 'diagram-show-on-canvas',
                                label: i18next.t('shell:palette.commands.diagramOnCanvas'),
                                run: () => void showViewOnCanvasAction(activeView.id)
                            },
                            {
                                id: 'diagram-copy-json',
                                label: i18next.t('shell:palette.commands.diagramCopyJson'),
                                run: () => copyDiagram(focusedDiagram(), 'json')
                            },
                            {
                                id: 'diagram-copy-png',
                                label: i18next.t('shell:palette.commands.diagramCopyPng'),
                                run: () => copyDiagram(focusedDiagram(), 'png')
                            },
                            {
                                id: 'diagram-save-png',
                                label: i18next.t('shell:palette.commands.diagramSavePng'),
                                run: () => exportDiagram(focusedDiagram(), 'png')
                            },
                            {
                                id: 'diagram-copy-svg',
                                label: i18next.t('shell:palette.commands.diagramCopySvg'),
                                run: () => copyDiagram(focusedDiagram(), 'svg')
                            },
                            {
                                id: 'diagram-save-svg',
                                label: i18next.t('shell:palette.commands.diagramSaveSvg'),
                                run: () => exportDiagram(focusedDiagram(), 'svg')
                            }
                        ]
                      : []),
                  ...(drawing && activeView
                      ? [
                            {
                                id: 'drawing-show-on-canvas',
                                label: i18next.t('shell:palette.commands.drawingOnCanvas'),
                                run: () => void showViewOnCanvasAction(activeView.id)
                            },
                            {
                                id: 'drawing-copy-png',
                                label: i18next.t('shell:palette.commands.drawingCopyPng'),
                                run: () => void copyDrawing(focusedDrawing(), 'png')
                            },
                            {
                                id: 'drawing-save-png',
                                label: i18next.t('shell:palette.commands.drawingSavePng'),
                                run: () => exportDrawing(focusedDrawing(), 'png')
                            },
                            {
                                id: 'drawing-copy-svg',
                                label: i18next.t('shell:palette.commands.drawingCopySvg'),
                                run: () => void copyDrawing(focusedDrawing(), 'svg')
                            },
                            {
                                id: 'drawing-save-svg',
                                label: i18next.t('shell:palette.commands.drawingSaveSvg'),
                                run: () => exportDrawing(focusedDrawing(), 'svg')
                            }
                        ]
                      : [])
              ]
            : []),
        {
            id: 'usage',
            label: i18next.t('shell:sidebar.usage'),
            hint: i18next.t('shell:palette.hints.usage'),
            run: () => useUi.getState().setUsageOpen(true)
        },
        {
            id: 'sidebar',
            label: i18next.t('shell:palette.commands.toggleSidebar'),
            shortcut: APP_SHORTCUTS.sidebar,
            run: () => useUi.getState().toggleSidebar()
        },
        { id: 'panel-files', label: i18next.t('shell:palette.commands.toggleFiles'), run: () => useUi.getState().togglePanel('files') },
        { id: 'panel-git', label: i18next.t('shell:palette.commands.toggleGit'), run: () => useUi.getState().togglePanel('git') },
        { id: 'panel-processes', label: i18next.t('shell:palette.commands.toggleProcesses'), run: () => useUi.getState().togglePanel('processes') },
        { id: 'theme', label: i18next.t('shell:palette.commands.toggleTheme'), run: () => useTheme.getState().toggle() },
        {
            id: 'settings',
            label: i18next.t('shell:settingsDialog.title'),
            shortcut: APP_SHORTCUTS.settings,
            run: () => useUi.getState().setSettings({ open: true })
        },
        {
            id: 'settings-keyboard',
            label: i18next.t('shell:palette.commands.keyboardShortcuts'),
            run: () => useUi.getState().setSettings({ open: true, section: 'keyboard' })
        },
        {
            id: 'settings-machines',
            label: i18next.t('shell:palette.commands.remote'),
            hint: i18next.t('shell:palette.hints.remote'),
            run: () => useUi.getState().setSettings({ open: true, section: 'machines' })
        }
    ];
};
