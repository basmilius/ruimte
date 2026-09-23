import i18next from 'i18next';
import { isCanvasView, isDiagramView, isDrawingView, isSessionView, type AgentKind, type ProviderInfo } from '@ruimte/contracts';
import { addAgentNode, addAgentView, type AgentTarget } from '@/agents/nodes';
import { createNodeAction, createViewAction, groupSelectionAction } from '@/actions/client-actions';
import { toWorld } from '@/canvas/math';
import { askDeleteView, askOpenAsView, askViewSettings, canOpenAsView, newSeparatorView, newSubheaderView, putOnCanvas, showOnCanvas } from '@/project/views';
import { copyDiagramJson, copyDiagramPng, copyDiagramSvg, openDiagramJson, saveDiagramPng, saveDiagramSvg } from '@/diagram/export';
import { copyDrawingPng, copyDrawingSvg, saveDrawingPng, saveDrawingSvg } from '@/drawing/export';
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
                          label: i18next.t(`shell:palette.newAgent.${target}`, { name: provider.name }),
                          agent: provider.kind,
                          run: () => void addAgentNode(target, provider, centerWorld())
                      }
                  ]
                : []),
            {
                id: `agent-view-${target}-${provider.kind}`,
                label: i18next.t(`shell:palette.newAgentView.${target}`, { name: provider.name }),
                hint: i18next.t('shell:palette.hints.withoutCanvas'),
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
            label: i18next.t('shell:palette.moveNodeTo', { view: view.name }),
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
                      run: () => createViewAction('canvas')
                  },
                  ...(activeViewId
                      ? [
                            { id: 'view-settings', label: i18next.t('shell:viewMenu.viewSettings'), run: () => askViewSettings(activeViewId) },
                            { id: 'view-delete', label: i18next.t('shell:viewMenu.deleteView'), run: () => askDeleteView(activeViewId) }
                        ]
                      : []),
                  { id: 'view-new-drawing', label: i18next.t('shell:palette.commands.newDrawingView'), run: () => createViewAction('drawing') },
                  { id: 'view-new-diagram', label: i18next.t('shell:palette.commands.newDiagramView'), run: () => createViewAction('diagram') },
                  ...(folder
                      ? [
                            {
                                id: 'view-new-file',
                                label: i18next.t('shell:palette.commands.newFileView'),
                                run: () => useUi.getState().openFilePicker({ kind: 'view' })
                            }
                        ]
                      : []),
                  { id: 'view-new-terminal', label: i18next.t('shell:palette.commands.newTerminalView'), run: () => createViewAction('terminal') },
                  { id: 'view-new-separator', label: i18next.t('shell:palette.commands.newSeparator'), run: () => void newSeparatorView() },
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
                                run: () => void putOnCanvas(activeView.id)
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
                                run: () => createNodeAction('terminal')
                            },
                            {
                                id: 'add-chat',
                                label: i18next.t('shell:palette.commands.newChat'),
                                shortcut: ADD_NODE_SHORTCUTS.chat,
                                run: () => createNodeAction('chat')
                            },
                            {
                                id: 'add-browser',
                                label: i18next.t('shell:palette.commands.newBrowser'),
                                shortcut: ADD_NODE_SHORTCUTS.browser,
                                run: () => createNodeAction('browser')
                            },
                            {
                                id: 'add-group',
                                label: i18next.t('shell:palette.commands.newGroup'),
                                shortcut: ADD_NODE_SHORTCUTS.group,
                                run: () => createNodeAction('group')
                            },
                            {
                                id: 'add-note',
                                label: i18next.t('shell:palette.commands.newNote'),
                                shortcut: ADD_NODE_SHORTCUTS.note,
                                run: () => createNodeAction('note')
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
                                run: () => void focusedCanvas().getState().addText(centerWorld())
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
                                    run: () => focusedCanvas().getState().applyLayout(layout.name)
                                },
                                {
                                    id: `layout-delete-${layout.name}`,
                                    label: i18next.t('shell:palette.deleteLayout', { name: layout.name }),
                                    run: () => focusedCanvas().getState().deleteLayout(layout.name)
                                }
                            ]),
                            {
                                id: 'lock',
                                label: anyLocked ? i18next.t('shell:dock.unlockEverything') : i18next.t('shell:dock.lockEverything'),
                                run: () => focusedCanvas().getState().setAllLocks(!anyLocked)
                            }
                        ]
                      : []),
                  // A drawing has a camera of its own, so the same three rows act on whichever is on screen.
                  ...(onCanvas || drawing || diagram
                      ? [
                            { id: 'fit', label: i18next.t('shell:dock.zoomToFit'), shortcut: CANVAS_SHORTCUTS.fitAll, run: () => zoomTarget().fitAll() },
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
                                run: () => void showOnCanvas(activeView.id)
                            },
                            {
                                id: 'diagram-copy-json',
                                label: i18next.t('shell:palette.commands.diagramCopyJson'),
                                run: () => void copyDiagramJson(focusedDiagram())
                            },
                            {
                                id: 'diagram-copy-png',
                                label: i18next.t('shell:palette.commands.diagramCopyPng'),
                                run: () => void copyDiagramPng(focusedDiagram())
                            },
                            {
                                id: 'diagram-save-png',
                                label: i18next.t('shell:palette.commands.diagramSavePng'),
                                run: () => void saveDiagramPng(focusedDiagram())
                            },
                            {
                                id: 'diagram-copy-svg',
                                label: i18next.t('shell:palette.commands.diagramCopySvg'),
                                run: () => void copyDiagramSvg(focusedDiagram())
                            },
                            {
                                id: 'diagram-save-svg',
                                label: i18next.t('shell:palette.commands.diagramSaveSvg'),
                                run: () => void saveDiagramSvg(focusedDiagram())
                            }
                        ]
                      : []),
                  ...(drawing && activeView
                      ? [
                            {
                                id: 'drawing-show-on-canvas',
                                label: i18next.t('shell:palette.commands.drawingOnCanvas'),
                                run: () => void showOnCanvas(activeView.id)
                            },
                            {
                                id: 'drawing-copy-png',
                                label: i18next.t('shell:palette.commands.drawingCopyPng'),
                                run: () => void copyDrawingPng(focusedDrawing())
                            },
                            {
                                id: 'drawing-save-png',
                                label: i18next.t('shell:palette.commands.drawingSavePng'),
                                run: () => void saveDrawingPng(focusedDrawing())
                            },
                            {
                                id: 'drawing-copy-svg',
                                label: i18next.t('shell:palette.commands.drawingCopySvg'),
                                run: () => void copyDrawingSvg(focusedDrawing())
                            },
                            {
                                id: 'drawing-save-svg',
                                label: i18next.t('shell:palette.commands.drawingSaveSvg'),
                                run: () => void saveDrawingSvg(focusedDrawing())
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
