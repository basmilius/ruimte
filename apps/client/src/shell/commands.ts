import i18next from 'i18next';
import { isCanvasView, isDiagramView, isDrawingView, isSessionView, type AgentKind, type ProviderInfo, type SplitLayout } from '@ruimte/contracts';
import type { AgentTarget } from '@/agents/nodes';
import {
    applyLayoutAction,
    closeCellsRightOfAction,
    closeOtherCellsAction,
    closeTabAction,
    createNodeAction,
    createTextAction,
    createViewAction,
    deleteLayoutAction,
    fitAction,
    groupSelectionAction,
    moveNodeToViewAction,
    placeViewOnCanvasAction,
    setLocksAction,
    showViewOnCanvasAction,
    toggleFlagAction
} from '@/actions/client-actions';
import { toWorld } from '@/canvas/math';
import { openNewConsole } from '@/database/console-file';
import { useDatabasePanel } from '@/database/state';
import { focusedLanguage } from '@/language/focused-language';
import { languageCommandRows } from '@/language/language-commands';
import { editorCommandRows } from '@/shell/editor-commands';
import { editorShortcut } from '@/shell/editor-keymap';
import { stepFocusedEditorFind } from '@/shell/panels/use-editor-find';
import { keepAwakeAvailable, setKeepAwake } from '@/state/keep-awake';
import { newChat, newChatMachine, offersNewChat, useNewChat } from '@/project/new-chat';
import { canMoveToNewWindow, canOpenWindows, moveToNewWindow, openNewWindow } from '@/project/windows';
import { openFocusedFind } from '@/find/hosts';
import { askDeleteView, askOpenAsView, askViewSettings, canOpenAsView, newSubheaderView } from '@/project/views';
import { copyDiagram, exportDiagram, openDiagramJson } from '@/diagram/diagram-actions';
import { copyDrawing, exportDrawing } from '@/drawing/drawing-actions';
import { focusedCanvas, maximizedNodeOf, maximizeTargetOf, type CanvasState } from '@/state/canvas';
import { focusedDiagram } from '@/state/diagram';
import { focusedDrawing } from '@/state/drawing';
import { chosenLaunchId, startLaunch, stopLaunch } from '@/launches/actions';
import { launchViews } from '@/launches/model';
import { useLaunches } from '@/launches/state';
import { activeViewOf, useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { openOnboarding } from '@/onboarding/open';
import { isScratchProject, shownFolderOf, useProject } from '@/state/project';
import { windowWorkspace } from '@/state/window';
import { hasLocalMachine } from '@/state/local-machine';
import { providersOf } from '@adecore/agents-react/state/providers';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useTheme } from '@/state/theme';
import { useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { runAppShortcut } from '@/shell/app-shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { canSplit, cellAt, cellCount, cellsRightOf, isTabHost, maximizedCell } from '@/shell/split';
import type { Shortcut } from '@adecore/ui';

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
function zoomTarget(): Pick<CanvasState, 'zoomToSelection' | 'zoomTo'> {
    const view = activeViewOf(useDocument.getState());
    if (view && isDrawingView(view)) {
        return focusedDrawing().getState();
    }
    return view && isDiagramView(view) ? focusedDiagram().getState() : focusedCanvas().getState();
}

function centerWorld() {
    const s = focusedCanvas().getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
}

/*
 * One command per agent CLI per kind of node, from the daemon's catalog. A CLI that is not
 * installed is left out: the Agents settings pane is where that gets fixed, not the palette.
 */
function agentCommands(target: AgentTarget, providers: ProviderInfo[], onCanvas: boolean): Command[] {
    return providers
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
}

/*
 * Moving a node to another view is one command per target: the palette has no second step, and a
 * project rarely has enough views for that to grow long.
 */
function moveNodeCommands(): Command[] {
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
}

/* One row per launch that says what a press does to it now, so a launch that runs offers its restart and its stop. */
function launchCommands(): Command[] {
    const { current, currentEndpointId } = useProject.getState();
    if (current === null || currentEndpointId === null) {
        return [];
    }
    const key = endpointKey(currentEndpointId, current.projectId);
    const { documents, statuses } = useLaunches.getState();
    const document = documents[key];
    if (document === undefined) {
        return [];
    }
    const views = launchViews(document, statuses[key] ?? {});
    return [
        ...document.launches.flatMap((launch): Command[] =>
            views.get(launch.id)?.live === true
                ? [
                      {
                          id: `launch-restart-${launch.id}`,
                          label: i18next.t('launches:palette.restart', { name: launch.name }),
                          run: () => void startLaunch(launch.id, { restart: true })
                      },
                      {
                          id: `launch-stop-${launch.id}`,
                          label: i18next.t('launches:palette.stop', { name: launch.name }),
                          run: () => void stopLaunch(launch.id)
                      }
                  ]
                : [
                      {
                          id: `launch-start-${launch.id}`,
                          label: i18next.t('launches:palette.start', { name: launch.name }),
                          run: () => void startLaunch(launch.id)
                      }
                  ]
        ),
        {
            id: 'launches-edit',
            label: i18next.t('launches:menu.edit'),
            run: () => useLaunches.getState().setDialog({ kind: 'edit', launchId: chosenLaunchId() })
        }
    ];
}

/* What the focused host can do with its tabs: only the rows that would do something right now. */
function tabCommands(layout: SplitLayout | null): Command[] {
    const cell = layout === null ? null : cellAt(layout, layout.focus);
    if (layout === null || cell === null || !isTabHost(cell)) {
        return [];
    }
    const tabs = cell.tabs ?? [];
    const index = tabs.indexOf(cell.viewId);
    const document = useDocument.getState();
    return [
        { id: 'tab-close', label: i18next.t('shell:menu.closeTab'), shortcut: CANVAS_SHORTCUTS.closeCell, run: () => closeTabAction(cell.viewId) },
        ...(tabs.length > 1
            ? [
                  { id: 'tab-next', label: i18next.t('shell:menu.nextTab'), shortcut: CANVAS_SHORTCUTS.nextTab, run: () => document.stepTab(1) },
                  { id: 'tab-previous', label: i18next.t('shell:menu.previousTab'), shortcut: CANVAS_SHORTCUTS.previousTab, run: () => document.stepTab(-1) }
              ]
            : []),
        ...(index > 0
            ? [
                  {
                      id: 'tab-move-left',
                      label: i18next.t('shell:viewMenu.moveTabLeft'),
                      shortcut: CANVAS_SHORTCUTS.moveTabLeft,
                      run: () => document.moveTab(cell.viewId, -1)
                  }
              ]
            : []),
        ...(index < tabs.length - 1
            ? [
                  {
                      id: 'tab-move-right',
                      label: i18next.t('shell:viewMenu.moveTabRight'),
                      shortcut: CANVAS_SHORTCUTS.moveTabRight,
                      run: () => document.moveTab(cell.viewId, 1)
                  }
              ]
            : []),
        ...(tabs.length > 1 && canSplit(layout, layout.focus, 'right', cell.viewId)
            ? [{ id: 'tab-split-off', label: i18next.t('shell:viewMenu.moveTabToNewCell'), run: () => void document.splitTabOff(cell.viewId) }]
            : []),
        ...(tabs.length === 1 ? [{ id: 'tab-ungroup', label: i18next.t('shell:viewMenu.ungroup'), run: () => document.ungroupCell(layout.focus) }] : [])
    ];
}

/*
 * What an empty palette offers: the handful of rows worth a place before anything is typed. The
 * rest of the list is one keystroke away, and a palette that opens on forty rows is a list to read
 * rather than a place to start typing.
 */
export const OPENING_COMMAND_IDS: readonly string[] = ['add-chat', 'add-terminal', 'view-new', 'find-in-files', 'open-folder', 'usage', 'settings'];

/* Everything the palette can do besides jumping to a node. One list, so the dock and the keys agree. */
export function appCommands(): Command[] {
    const canvas = focusedCanvas().getState();
    const anyLocked = Object.values(canvas.locks).some(Boolean);
    const current = useProject.getState().current;
    const folder = shownFolderOf(current);
    const scratch = isScratchProject(current);
    const { activeViewId, views, layout, maximized } = useDocument.getState();
    const filling = maximizedCell(layout, maximized) !== null;
    const activeView = views.find((view) => view.id === activeViewId) ?? null;
    const selected = canvas.selection.length === 1 ? canvas.nodes[canvas.selection[0]!] : undefined;
    const drawing = activeView !== null && isDrawingView(activeView);
    const diagram = activeView !== null && isDiagramView(activeView);
    /* A row that writes into a canvas is offered only while one is on screen. In a chat or a
       terminal view "New note" and "Zoom to fit" would act on a surface nobody is looking at. */
    const onCanvas = activeView !== null && isCanvasView(activeView);
    const maximizeTarget = onCanvas ? maximizeTargetOf(canvas) : null;
    /* The start screen is outside every project, so only the rows about the window are offered there. */
    const inWorkspace = windowWorkspace() !== null;
    return [
        ...(canOpenWindows()
            ? [{ id: 'window-new', label: i18next.t('shell:palette.commands.newWindow'), shortcut: APP_SHORTCUTS.newWindow, run: () => openNewWindow() }]
            : []),
        ...(inWorkspace && canMoveToNewWindow()
            ? [{ id: 'window-move', label: i18next.t('shell:palette.commands.moveToNewWindow'), run: () => void moveToNewWindow() }]
            : []),
        { id: 'open-folder', label: i18next.t('shell:palette.commands.openFolder'), run: () => useUi.getState().openFolderBrowser() },
        ...(offersNewChat(newChatMachine(), useNewChat.getState().refused)
            ? [{ id: 'chat-new', label: i18next.t('shell:chats.newChat'), hint: i18next.t('shell:chats.name'), shortcut: APP_SHORTCUTS.newChat, run: newChat }]
            : []),
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
        ...(inWorkspace ? languageCommandRows() : []),
        ...(inWorkspace ? editorCommandRows() : []),
        ...(inWorkspace
            ? [
                  {
                      id: 'find-replace',
                      label: i18next.t('shell:palette.commands.findReplace'),
                      shortcut: CANVAS_SHORTCUTS.findReplace,
                      run: () => {
                          requestAnimationFrame(() => {
                              openFocusedFind({ replace: true });
                          });
                      }
                  }
              ]
            : []),
        ...(inWorkspace
            ? [
                  {
                      id: 'find-next',
                      label: i18next.t('shell:palette.commands.findNext'),
                      shortcut: editorShortcut('findNext'),
                      // A frame later: the palette hands the focus back as it closes, and that focus says which editor is meant.
                      run: () => {
                          requestAnimationFrame(() => {
                              stepFocusedEditorFind(1);
                          });
                      }
                  },
                  {
                      id: 'find-previous',
                      label: i18next.t('shell:palette.commands.findPrevious'),
                      shortcut: editorShortcut('findPrevious'),
                      run: () => {
                          requestAnimationFrame(() => {
                              stepFocusedEditorFind(-1);
                          });
                      }
                  }
              ]
            : []),
        ...(inWorkspace
            ? [
                  {
                      id: 'next-problem',
                      label: i18next.t('shell:palette.commands.nextProblem'),
                      shortcut: CANVAS_SHORTCUTS.nextProblem,
                      // After the palette has handed the focus back, which is what says which editor is meant.
                      run: () => {
                          requestAnimationFrame(() => {
                              focusedLanguage()?.diagnostics.step(1);
                          });
                      }
                  },
                  {
                      id: 'next-highlight',
                      label: i18next.t('shell:palette.commands.nextHighlight'),
                      shortcut: CANVAS_SHORTCUTS.nextHighlight,
                      run: () => {
                          requestAnimationFrame(() => {
                              focusedLanguage()?.highlights.step(1);
                          });
                      }
                  },
                  {
                      id: 'previous-highlight',
                      label: i18next.t('shell:palette.commands.previousHighlight'),
                      shortcut: CANVAS_SHORTCUTS.previousHighlight,
                      run: () => {
                          requestAnimationFrame(() => {
                              focusedLanguage()?.highlights.step(-1);
                          });
                      }
                  },
                  {
                      id: 'previous-problem',
                      label: i18next.t('shell:palette.commands.previousProblem'),
                      shortcut: CANVAS_SHORTCUTS.previousProblem,
                      run: () => {
                          requestAnimationFrame(() => {
                              focusedLanguage()?.diagnostics.step(-1);
                          });
                      }
                  }
              ]
            : []),
        ...(folder && inWorkspace
            ? [
                  {
                      id: 'file-new',
                      label: i18next.t('shell:palette.commands.newFile'),
                      // A frame later: the palette hands the focus back as it closes, and the field that names the file would lose it.
                      run: () => {
                          requestAnimationFrame(() => useFiles.getState().requestCreate('file'));
                      }
                  },
                  {
                      id: 'folder-new',
                      label: i18next.t('shell:palette.commands.newFolder'),
                      run: () => {
                          requestAnimationFrame(() => useFiles.getState().requestCreate('directory'));
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
                            { id: 'view-delete', label: i18next.t('shell:viewMenu.deleteView'), run: () => askDeleteView(activeViewId) },
                            {
                                id: 'flag-toggle',
                                label: i18next.t('shell:palette.commands.toggleFlag'),
                                hint: i18next.t('shell:palette.hints.toggleFlag'),
                                shortcut: CANVAS_SHORTCUTS.toggleFlag,
                                run: toggleFlagAction
                            }
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
                  ...tabCommands(layout),
                  ...(layout !== null && cellCount(layout) > 1
                      ? [
                            {
                                id: 'cell-maximize',
                                label: i18next.t(filling ? 'shell:viewMenu.restoreSplit' : 'shell:viewMenu.maximizeCell'),
                                // The key goes to a node first, so this row only shows it when no node would take it.
                                ...(maximizeTarget === null ? { shortcut: CANVAS_SHORTCUTS.maximizeCell } : {}),
                                run: () => useDocument.getState().toggleMaximized()
                            },
                            {
                                id: 'cell-close-others',
                                label: i18next.t('shell:palette.commands.closeOtherCells'),
                                run: () => closeOtherCellsAction(layout.focus)
                            },
                            ...(cellsRightOf(layout, layout.focus) > 0
                                ? [
                                      {
                                          id: 'cell-close-right',
                                          label: i18next.t('shell:palette.commands.closeCellsRight'),
                                          run: () => closeCellsRightOfAction(layout.focus)
                                      }
                                  ]
                                : [])
                        ]
                      : []),
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
                  ...(maximizeTarget !== null
                      ? [
                            {
                                id: 'node-maximize',
                                label: i18next.t(maximizedNodeOf(canvas) === null ? 'canvas:node.maximize' : 'canvas:node.restore'),
                                shortcut: CANVAS_SHORTCUTS.maximizeCell,
                                run: () => focusedCanvas().getState().toggleMaximizedNode(maximizeTarget)
                            }
                        ]
                      : []),
                  ...(diagram && activeView
                      ? [
                            ...(folder
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
            id: 'models',
            label: i18next.t('shell:menu.compareModels'),
            run: () => useUi.getState().setModelsOpen(true)
        },
        ...(inWorkspace
            ? [
                  {
                      id: 'sidebar',
                      label: i18next.t('shell:palette.commands.toggleSidebar'),
                      shortcut: APP_SHORTCUTS.sidebar,
                      run: () => useUi.getState().toggleSidebar()
                  },
                  ...(scratch
                      ? []
                      : [
                            { id: 'panel-files', label: i18next.t('shell:palette.commands.toggleFiles'), run: () => useUi.getState().togglePanel('files') },
                            {
                                id: 'panel-databases',
                                label: i18next.t('shell:palette.commands.toggleDatabases'),
                                run: () => useUi.getState().togglePanel('databases')
                            },
                            { id: 'panel-git', label: i18next.t('shell:palette.commands.toggleGit'), run: () => useUi.getState().togglePanel('git') },
                            {
                                id: 'database-console-new',
                                label: i18next.t('shell:palette.commands.newDatabaseConsole'),
                                run: () => void openNewConsole()
                            },
                            {
                                id: 'database-connections',
                                label: i18next.t('shell:palette.commands.databaseConnections'),
                                run: () => useDatabasePanel.getState().openConnections()
                            },
                            {
                                id: 'panel-problems',
                                label: i18next.t('shell:palette.commands.toggleProblems'),
                                run: () => useUi.getState().togglePanel('problems')
                            }
                        ]),
                  { id: 'panel-processes', label: i18next.t('shell:palette.commands.toggleProcesses'), run: () => useUi.getState().togglePanel('processes') }
              ]
            : []),
        ...(inWorkspace && !scratch ? launchCommands() : []),
        { id: 'theme', label: i18next.t('shell:palette.commands.toggleTheme'), run: () => useTheme.getState().toggle() },
        ...(keepAwakeAvailable()
            ? [
                  {
                      id: 'keep-awake-off',
                      label: i18next.t('shell:palette.commands.keepAwakeOff'),
                      run: () => setKeepAwake({ keepAwake: 'off' })
                  },
                  {
                      id: 'keep-awake-working',
                      label: i18next.t('shell:palette.commands.keepAwakeWorking'),
                      run: () => setKeepAwake({ keepAwake: 'working' })
                  },
                  {
                      id: 'keep-awake-always',
                      label: i18next.t('shell:palette.commands.keepAwakeAlways'),
                      run: () => setKeepAwake({ keepAwake: 'always' })
                  }
              ]
            : []),
        {
            id: 'settings',
            label: i18next.t('shell:settingsDialog.title'),
            shortcut: APP_SHORTCUTS.settings,
            run: () => useUi.getState().setSettings({ open: true })
        },
        {
            // The key works only while the dialog is up, so the row shows none.
            id: 'settings-search',
            label: i18next.t('shell:palette.commands.searchSettings'),
            run: () => runAppShortcut('settings-search')
        },
        {
            id: 'settings-keyboard',
            label: i18next.t('shell:palette.commands.keyboardShortcuts'),
            run: () => useUi.getState().setSettings({ open: true, section: 'keyboard' })
        },
        {
            id: 'settings-editor',
            label: i18next.t('shell:palette.commands.editorSettings'),
            run: () => useUi.getState().setSettings({ open: true, section: 'editor' })
        },
        {
            id: 'settings-machines',
            label: i18next.t('shell:palette.commands.remote'),
            hint: i18next.t('shell:palette.hints.remote'),
            run: () => useUi.getState().setSettings({ open: true, section: 'machines' })
        },
        {
            id: 'settings-computer',
            label: i18next.t('shell:palette.commands.computerUse'),
            run: () => useUi.getState().setSettings({ open: true, section: 'computer' })
        },
        // About the machine this window runs beside, so only a client with one has it.
        ...(hasLocalMachine() ? [{ id: 'onboarding', label: i18next.t('shell:palette.commands.onboarding'), run: () => openOnboarding() }] : [])
    ];
}
