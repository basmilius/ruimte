import i18next from 'i18next';
import {
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isSessionView,
    type AgentKind,
    type LaunchesDocument,
    type ProviderInfo,
    type SplitLayout
} from '@ruimte/contracts';
import type { AgentTarget } from '@/agents/nodes';
import { availableAgents } from '@/agents/creation';
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
    arrangeGroupAction,
    groupSelectionAction,
    moveNodeToViewAction,
    placeViewOnCanvasAction,
    setLocksAction,
    showViewOnCanvasAction,
    toggleFlagAction
} from '@/actions/client-actions';
import { centerWorld } from '@/actions/action-reach';
import { groupArrangeable } from '@/canvas/arrange-group';
import { openNewConsole } from '@/database/console-file';
import { useDatabasePanel } from '@/database/state';
import { refreshSqlSchemas } from '@/database/sql-bindings';
import { languageForCommand } from '@/language/focused-language';
import { languageCommandRows } from '@/language/language-commands';
import { editorCommandRows } from '@/shell/editor-commands';
import { stepFocusedEditorFind } from '@/shell/panels/use-editor-find';
import { keepAwakeAvailable, setKeepAwake } from '@/state/keep-awake';
import { newChat, newChatMachine, offersNewChat, useNewChat } from '@/project/new-chat';
import { canMoveToNewWindow, canOpenWindows, moveToNewWindow, openNewWindow } from '@/project/windows';
import { stepMove, stepWindowTab, useWindowTabs } from '@/project/window-tabs';
import { useSettings } from '@/state/settings';
import { openFocusedFind } from '@/find/hosts';
import { askDeleteView, askOpenAsView, askViewSettings, canOpenAsView, newSubheaderView } from '@/project/views';
import { copyDiagram, exportDiagram, openDiagramJson } from '@/diagram/diagram-actions';
import { copyDrawing, exportDrawing } from '@/drawing/drawing-actions';
import { focusedCanvas, maximizedNodeOf, maximizeTargetOf, zoomNodeTargetOf, type CanvasState } from '@/state/canvas';
import { focusedDiagram } from '@/state/diagram';
import { focusedDrawing } from '@/state/drawing';
import { afterSettleCandidates, chooseAfterSettle, chosenLaunchId, startLaunch, stopLaunch } from '@/launches/actions';
import { launchViews } from '@/launches/model';
import { useLaunches } from '@/launches/state';
import { activeViewOf, useDocument } from '@/state/document';
import { nextWaitingTitle, revealNextWaiting } from '@/shell/next-waiting';
import { hasPrWatch, stopPrWatch } from '@/shell/pr-watch-actions';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { openOnboarding } from '@/onboarding/open';
import { pullRequestCommands } from '@/shell/pull-request-commands';
import { prReposOfCurrent, type PrRepo } from '@/state/pr-repos';
import { isScratchProject, shownFolderOf, useProject } from '@/state/project';
import { windowWorkspace } from '@/state/window';
import { hasLocalMachine } from '@/state/local-machine';
import { providersOf } from '@adecore/agents-react/state';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useTheme } from '@/state/theme';
import { useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { pool, transportFor } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { openRoutineForm } from '@/routines/form-state';
import { toggleRoutines } from '@/routines/stage';
import { activeViewFacts } from '@/shell/menu/context';
import { runAppShortcut } from '@/shell/app-shortcuts';
import { canSplit, cellAt, cellCount, cellsRightOf, isTabHost, maximizedCell } from '@/shell/split';
import type { Shortcut } from '@adecore/ui';
import { sendFromComposer, stepEffortFromComposer, stepTimelineMessage } from '@adecore/agents-react/chat';
import { focusedChatId } from '@/chat/focused-chat';
import { shownChatOfNode } from '@/design/design-chat';
import { restartChatSession } from '@/chat/restart-session';
import { COMMANDS, type PaletteCommandId } from '@/shell/command-table';
import { isNotePreviewLocked, setNotePreviewLocked } from '@/state/note-previews';
import type { MeasureVariant } from '@/measure/scene';

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

/* A frame later: the palette hands the focus back as it closes, and that focus says which surface or editor is meant. */
function afterPaletteCloses(run: () => void): () => void {
    return () => {
        requestAnimationFrame(() => run());
    };
}

interface RowOptions {
    hint?: string;
    /* Words that follow the moment, in place of the table's. */
    label?: string;
    values?: Record<string, string>;
    /* The key the row shows when it is not the table's, or null for none. */
    shortcut?: Shortcut | null;
}

/* A row of the command table: its words and its key are the table's (`shell/command-table.ts`), what it does is here. */
function row(id: PaletteCommandId, run: () => void, options: RowOptions = {}): Command {
    const spec = COMMANDS[id];
    const shortcut = options.shortcut === undefined ? spec.shortcut : (options.shortcut ?? undefined);
    return {
        id,
        label: options.label ?? i18next.t(`shell:palette.commands.${spec.key}`, options.values ?? {}),
        ...(options.hint === undefined ? {} : { hint: options.hint }),
        ...(shortcut === undefined ? {} : { shortcut }),
        run
    };
}

/* Whichever surface is on screen owns the zoom rows in the palette. */
function zoomTarget(): Pick<CanvasState, 'zoomToSelection' | 'zoomTo'> {
    const view = activeViewOf(useDocument.getState());
    if (view && isDrawingView(view)) {
        return focusedDrawing().getState();
    }
    return view && isDiagramView(view) ? focusedDiagram().getState() : focusedCanvas().getState();
}

/*
 * One command per agent CLI per kind of node, from the daemon's catalog. A CLI that is not
 * installed is left out: the Agents settings pane is where that gets fixed, not the palette.
 */
function agentCommands(target: AgentTarget, providers: ProviderInfo[], onCanvas: boolean): Command[] {
    return availableAgents(providers, target).flatMap((provider) => [
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
        row('launches-edit', () => useLaunches.getState().setDialog({ kind: 'edit', launchId: chosenLaunchId() })),
        ...afterSettleCommands(document)
    ];
}

/* Choosing the task that runs after a worktree chat settles; the chosen one comes back only while it waits on approval again. */
function afterSettleCommands(document: LaunchesDocument): Command[] {
    const chosen = document.afterSettle;
    return [
        ...afterSettleCandidates(document).flatMap((launch): Command[] =>
            chosen?.launchId === launch.id && chosen.approved
                ? []
                : [
                      {
                          id: `launch-after-settle-${launch.id}`,
                          label: i18next.t(chosen?.launchId === launch.id ? 'launches:palette.afterSettleApprove' : 'launches:palette.afterSettle', {
                              name: launch.name
                          }),
                          run: () => void chooseAfterSettle(launch.id)
                      }
                  ]
        ),
        ...(chosen === undefined ? [] : [row('launches-after-settle-off', () => void chooseAfterSettle(null))])
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
        row('tab-close', () => closeTabAction(cell.viewId)),
        ...(tabs.length > 1 ? [row('tab-next', () => document.stepTab(1)), row('tab-previous', () => document.stepTab(-1))] : []),
        ...(index > 0 ? [row('tab-move-left', () => document.moveTab(cell.viewId, -1))] : []),
        ...(index < tabs.length - 1 ? [row('tab-move-right', () => document.moveTab(cell.viewId, 1))] : []),
        ...(tabs.length > 1 && canSplit(layout, layout.focus, 'right', cell.viewId)
            ? [row('tab-split-off', () => void document.splitTabOff(cell.viewId))]
            : []),
        ...(tabs.length === 1 ? [row('tab-ungroup', () => document.ungroupCell(layout.focus))] : [])
    ];
}

/* Moving the project on screen along the strip of project tabs, while the window has that strip. */
function projectTabCommands(): Command[] {
    const { tabs } = useWindowTabs.getState();
    const key = tabs.active;
    if (useSettings.getState().projectNavigation !== 'tabs' || key === null) {
        return [];
    }
    return [
        ...(stepMove(tabs, key, -1) === tabs ? [] : [row('project-tab-move-left', () => stepWindowTab(key, -1))]),
        ...(stepMove(tabs, key, 1) === tabs ? [] : [row('project-tab-move-right', () => stepWindowTab(key, 1))])
    ];
}

/* The handful of rows an empty palette offers; a palette that opens on forty rows is a list to read rather than a place to type. */
export const OPENING_COMMAND_IDS: readonly string[] = ['add-chat', 'add-terminal', 'view-new', 'find-in-files', 'open-folder', 'usage', 'settings'];

/* Dev only. The module loads on first use, so the recorder never ships and only watches a page someone measures. */
function measureCommands(): Command[] {
    const measure = () => import('@/measure/run');
    const scene = (variant: MeasureVariant) => () => void measure().then((module) => module.buildMeasureScene(variant));
    return [
        row('measure-scene', scene('scene')),
        row('measure-scene-grid', scene('grid')),
        row('measure-scene-files', scene('files')),
        row('measure-scene-chats', scene('chats')),
        row('measure-scene-terminals', scene('terminals')),
        row('measure-copy', () => void measure().then((module) => module.copyMeasurements()))
    ];
}

/* Every row the palette offers besides the jumps, each only while it can act. */
export function appCommands(prRepos: readonly PrRepo[] = prReposOfCurrent()): Command[] {
    const canvas = focusedCanvas().getState();
    const anyLocked = Object.values(canvas.locks).some(Boolean);
    const current = useProject.getState().current;
    const folder = shownFolderOf(current);
    const scratch = isScratchProject(current);
    const { activeViewId, views, layout, maximized } = useDocument.getState();
    const filling = maximizedCell(layout, maximized) !== null;
    const activeView = views.find((view) => view.id === activeViewId) ?? null;
    const selected = canvas.selection.length === 1 ? canvas.nodes[canvas.selection[0]!] : undefined;
    // A design acts as the chat it shows.
    const selectedChat = selected === undefined ? null : shownChatOfNode(selected);
    const drawing = activeView !== null && isDrawingView(activeView);
    const diagram = activeView !== null && isDiagramView(activeView);
    /* A row that writes into a canvas is offered only while one is on screen. In a chat or a
       terminal view "New note" and "Zoom to fit" would act on a surface nobody is looking at. */
    const onCanvas = activeView !== null && isCanvasView(activeView);
    const maximizeTarget = onCanvas ? maximizeTargetOf(canvas) : null;
    /* The start screen is outside every project, so only the rows about the window are offered there. */
    const inWorkspace = windowWorkspace() !== null;
    const chat = inWorkspace ? focusedChatId() : null;
    const chatKey = chat === null ? '' : endpointKey(endpointOfNodeId(chat), chat);
    // The palette cannot grey a row, so a chat that works offers none; the menu says why.
    const leaving = inWorkspace ? activeViewFacts() : null;
    const leavingChatId = leaving !== null && leaving.offers.moveToProject && !leaving.working ? leaving.view.id : null;
    return [
        ...(canOpenWindows() ? [row('window-new', () => openNewWindow())] : []),
        ...(inWorkspace && canMoveToNewWindow() ? [row('window-move', () => void moveToNewWindow())] : []),
        ...projectTabCommands(),
        row('open-folder', () => useUi.getState().openFolderBrowser()),
        ...(offersNewChat(newChatMachine(), useNewChat.getState().refused) ? [row('chat-new', newChat, { hint: i18next.t('shell:chats.name') })] : []),
        ...(folder && !scratch
            ? [
                  row('chat-new-worktree', () => useUi.getState().setNewWorktreeChatOpen(true), { hint: i18next.t('shell:chats.name') }),
                  row('issue-start', () => useUi.getState().setIssueStartOpen(true), { hint: i18next.t('shell:chats.name') })
              ]
            : []),
        ...(chat !== null
            ? [
                  // A frame later, so the keyboard the new chat takes is not handed back to the old one as the palette closes.
                  row(
                      'chat-send-new',
                      afterPaletteCloses(() => sendFromComposer(chatKey, 'and-new'))
                  ),
                  row('chat-restart', () => void restartChatSession(chat)),
                  row('chat-effort-up', () => stepEffortFromComposer(chatKey, 'up')),
                  row('chat-effort-down', () => stepEffortFromComposer(chatKey, 'down')),
                  row('chat-message-previous', () => stepTimelineMessage(chatKey, -1)),
                  row('chat-message-next', () => stepTimelineMessage(chatKey, 1))
              ]
            : []),
        ...(leavingChatId !== null
            ? [
                  row('chat-make-project', () => useUi.getState().setMoveChatDialog({ chatId: leavingChatId, mode: 'make', projectId: null })),
                  row('chat-move-to-project', () => useUi.getState().setMoveChatDialog({ chatId: leavingChatId, mode: 'pick', projectId: null }))
              ]
            : []),
        ...(selectedChat !== null && selected !== undefined && hasPrWatch(endpointOfNodeId(selected.id), selectedChat)
            ? [row('pr-watch-stop', () => void stopPrWatch(endpointOfNodeId(selected.id), selectedChat))]
            : []),
        ...(folder
            ? [
                  row('find-in-files', () => useUi.getState().openFindInFiles()),
                  ...pullRequestCommands(folder, prRepos, (cwd) => useUi.getState().setPullRequestDialog({ cwd }))
              ]
            : []),
        ...(inWorkspace
            ? [
                  row('search-chats', () => useUi.getState().openChatSearch()),
                  row(
                      'find',
                      afterPaletteCloses(() => openFocusedFind())
                  ),
                  ...languageCommandRows(),
                  ...editorCommandRows(),
                  row(
                      'find-replace',
                      afterPaletteCloses(() => openFocusedFind({ replace: true }))
                  ),
                  row(
                      'find-next',
                      afterPaletteCloses(() => stepFocusedEditorFind(1))
                  ),
                  row(
                      'find-previous',
                      afterPaletteCloses(() => stepFocusedEditorFind(-1))
                  ),
                  row(
                      'next-problem',
                      afterPaletteCloses(() => languageForCommand()?.diagnostics.step(1))
                  ),
                  row(
                      'next-highlight',
                      afterPaletteCloses(() => languageForCommand()?.highlights.step(1))
                  ),
                  row(
                      'previous-highlight',
                      afterPaletteCloses(() => languageForCommand()?.highlights.step(-1))
                  ),
                  row(
                      'previous-problem',
                      afterPaletteCloses(() => languageForCommand()?.diagnostics.step(-1))
                  )
              ]
            : []),
        ...(folder && inWorkspace
            ? [
                  row(
                      'file-new',
                      afterPaletteCloses(() => useFiles.getState().requestCreate('file'))
                  ),
                  row(
                      'folder-new',
                      afterPaletteCloses(() => useFiles.getState().requestCreate('directory'))
                  )
              ]
            : []),
        ...(folder
            ? [
                  row(
                      'reveal',
                      () =>
                          void transportFor(currentEndpointId())
                              ?.request('fs.reveal', { path: folder })
                              .catch(() => undefined),
                      { values: { app: fileManagerName(serverInfoOf(currentEndpointId()).platform) } }
                  )
              ]
            : []),
        ...(inWorkspace
            ? [
                  row('view-new', () => void createViewAction('canvas')),
                  row(
                      'needs-you-next',
                      afterPaletteCloses(() => void revealNextWaiting()),
                      { hint: nextWaitingTitle() ?? i18next.t('shell:palette.hints.nothingWaits') }
                  ),
                  ...(activeViewId
                      ? [
                            row('view-settings', () => askViewSettings(activeViewId)),
                            row('view-delete', () => askDeleteView(activeViewId)),
                            row('flag-toggle', toggleFlagAction, { hint: i18next.t('shell:palette.hints.toggleFlag') })
                        ]
                      : []),
                  row('view-new-drawing', () => void createViewAction('drawing')),
                  row('view-new-diagram', () => void createViewAction('diagram')),
                  ...(folder ? [row('view-new-file', () => useUi.getState().openFilePicker({ kind: 'view' }))] : []),
                  row('view-new-terminal', () => void createViewAction('terminal')),
                  row('view-new-separator', () => void createViewAction('separator')),
                  row('view-new-subheader', () => void newSubheaderView()),
                  ...tabCommands(layout),
                  ...(layout !== null && cellCount(layout) > 1
                      ? [
                            row('cell-maximize', () => useDocument.getState().toggleMaximized(), {
                                ...(filling ? { label: i18next.t('shell:viewMenu.restoreSplit') } : {}),
                                // The key goes to a node first, so this row only shows it when no node would take it.
                                ...(maximizeTarget === null ? {} : { shortcut: null })
                            }),
                            row('cell-close-others', () => closeOtherCellsAction(layout.focus)),
                            ...(cellsRightOf(layout, layout.focus) > 0 ? [row('cell-close-right', () => closeCellsRightOfAction(layout.focus))] : [])
                        ]
                      : []),
                  row('view-new-browser', () => useUi.getState().setViewDialog({ kind: 'new-browser' })),
                  ...(selected && canOpenAsView(selected.kind) ? [row('view-promote', () => askOpenAsView(selected.id), { hint: selected.title })] : []),
                  ...(activeView && isSessionView(activeView) && views.some(isCanvasView)
                      ? [row('view-demote', () => placeViewOnCanvasAction(activeView.id), { hint: activeView.name })]
                      : []),
                  ...agentCommands('chat', providersOf(currentEndpointId()).providers, onCanvas),
                  ...agentCommands('terminal', providersOf(currentEndpointId()).providers, onCanvas),
                  ...(onCanvas
                      ? [
                            ...moveNodeCommands(),
                            row('add-terminal', () => void createNodeAction('terminal')),
                            row('add-chat', () => void createNodeAction('chat')),
                            row('add-browser', () => void createNodeAction('browser')),
                            row('add-group', () => void createNodeAction('group')),
                            row('add-note', () => void createNodeAction('note')),
                            ...(folder
                                ? [
                                      row('add-file', () => useUi.getState().openFilePicker({ kind: 'node', at: centerWorld(focusedCanvas().getState()) }), {
                                          hint: i18next.t('shell:palette.hints.readOnly')
                                      })
                                  ]
                                : []),
                            row('group-selection', () => groupSelectionAction(), {
                                ...(canvas.selection.length === 0 ? { hint: i18next.t('shell:palette.hints.selectFirst') } : {})
                            }),
                            ...(canvas.selection.length === 1 && groupArrangeable(canvas.nodes[canvas.selection[0]!], canvas.locks)
                                ? [row('group-arrange', () => arrangeGroupAction(canvas.viewId, canvas.selection[0]!))]
                                : []),
                            row('add-text', () => createTextAction()),
                            row('layout-save', () => useUi.getState().setLayoutDialogOpen(true), { hint: i18next.t('shell:palette.hints.rememberLayout') }),
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
                            row('lock', () => setLocksAction(!anyLocked), anyLocked ? { label: i18next.t('shell:palette.commands.unlockAll') } : {})
                        ]
                      : []),
                  // A drawing has a camera of its own, so the same three rows act on whichever is on screen.
                  ...(onCanvas || drawing || diagram
                      ? [
                            row('fit', () => fitAction()),
                            row('zoom-selection', () => zoomTarget().zoomToSelection()),
                            row('zoom-reset', () => zoomTarget().zoomTo(1))
                        ]
                      : []),
                  ...(onCanvas
                      ? [
                            ...(
                                [
                                    { id: 'node-left', direction: 'left' },
                                    { id: 'node-right', direction: 'right' },
                                    { id: 'node-up', direction: 'up' },
                                    { id: 'node-down', direction: 'down' }
                                ] as const
                            ).map(({ id, direction }) => row(id, () => focusedCanvas().getState().selectNeighbor(direction))),
                            row('camera-back', () => focusedCanvas().getState().stepCamera(-1)),
                            row('camera-forward', () => focusedCanvas().getState().stepCamera(1)),
                            ...(zoomNodeTargetOf(canvas) !== null ? [row('zoom-node', () => focusedCanvas().getState().zoomToNode())] : [])
                        ]
                      : []),
                  ...(maximizeTarget !== null
                      ? [
                            row(
                                'node-maximize',
                                () => focusedCanvas().getState().toggleMaximizedNode(maximizeTarget),
                                maximizedNodeOf(canvas) === null ? {} : { label: i18next.t('canvas:node.restore') }
                            )
                        ]
                      : []),
                  ...(maximizeTarget !== null && canvas.nodes[maximizeTarget]?.kind === 'note' && (canvas.nodes[maximizeTarget]?.body ?? '').trim() !== ''
                      ? [
                            row(
                                'note-lock-preview',
                                () => setNotePreviewLocked(maximizeTarget, !isNotePreviewLocked(maximizeTarget)),
                                isNotePreviewLocked(maximizeTarget) ? { label: i18next.t('canvas:note.unlockPreview') } : {}
                            )
                        ]
                      : []),
                  ...(diagram && activeView
                      ? [
                            ...(folder ? [row('diagram-open-json', () => openDiagramJson(activeView.id))] : []),
                            row('diagram-show-on-canvas', () => void showViewOnCanvasAction(activeView.id)),
                            row('diagram-copy-json', () => copyDiagram(focusedDiagram(), 'json')),
                            row('diagram-copy-png', () => copyDiagram(focusedDiagram(), 'png')),
                            row('diagram-save-png', () => exportDiagram(focusedDiagram(), 'png')),
                            row('diagram-copy-svg', () => copyDiagram(focusedDiagram(), 'svg')),
                            row('diagram-save-svg', () => exportDiagram(focusedDiagram(), 'svg'))
                        ]
                      : []),
                  ...(drawing && activeView
                      ? [
                            row('drawing-show-on-canvas', () => void showViewOnCanvasAction(activeView.id)),
                            row('drawing-copy-png', () => void copyDrawing(focusedDrawing(), 'png')),
                            row('drawing-save-png', () => exportDrawing(focusedDrawing(), 'png')),
                            row('drawing-copy-svg', () => void copyDrawing(focusedDrawing(), 'svg')),
                            row('drawing-save-svg', () => exportDrawing(focusedDrawing(), 'svg'))
                        ]
                      : [])
              ]
            : []),
        row('usage', () => useUi.getState().setUsageOpen(true), { hint: i18next.t('shell:palette.hints.usage') }),
        row('models', () => useUi.getState().setModelsOpen(true)),
        ...(import.meta.env.DEV ? measureCommands() : []),
        ...(inWorkspace
            ? [
                  row('sidebar', () => useUi.getState().toggleSidebar()),
                  row('panel-output', () => useUi.getState().togglePanel('output')),
                  ...(machineAnswers(pool.statusOf(currentEndpointId()), 'routine.list')
                      ? [
                            row('routines', toggleRoutines),
                            row('routine-new', () => {
                                const projectId = useProject.getState().current?.projectId;
                                if (projectId !== undefined) {
                                    openRoutineForm({ projectId });
                                }
                            })
                        ]
                      : []),
                  ...(scratch
                      ? []
                      : [
                            row('panel-files', () => useUi.getState().togglePanel('files')),
                            row('panel-databases', () => useUi.getState().togglePanel('databases')),
                            row('panel-git', () => useUi.getState().togglePanel('git')),
                            row('database-console-new', () => void openNewConsole()),
                            row('database-connections', () => useDatabasePanel.getState().openConnections()),
                            row('database-schemas-refresh', () => void refreshSqlSchemas()),
                            row('panel-problems', () => useUi.getState().togglePanel('problems'))
                        ]),
                  row('panel-processes', () => useUi.getState().togglePanel('processes'))
              ]
            : []),
        ...(inWorkspace && !scratch ? launchCommands() : []),
        row('theme', () => useTheme.getState().toggle()),
        ...(keepAwakeAvailable()
            ? [
                  row('keep-awake-off', () => setKeepAwake({ keepAwake: 'off' })),
                  row('keep-awake-working', () => setKeepAwake({ keepAwake: 'working' })),
                  row('keep-awake-always', () => setKeepAwake({ keepAwake: 'always' }))
              ]
            : []),
        row('settings', () => useUi.getState().setSettings({ open: true })),
        // The key works only while the dialog is up, so the row shows none.
        row('settings-search', () => runAppShortcut('settings-search'), { shortcut: null }),
        row('settings-keyboard', () => useUi.getState().setSettings({ open: true, section: 'keyboard' })),
        row('settings-editor', () => useUi.getState().setSettings({ open: true, section: 'editor' })),
        row('settings-machines', () => useUi.getState().setSettings({ open: true, section: 'machines' }), { hint: i18next.t('shell:palette.hints.remote') }),
        row('settings-computer', () => useUi.getState().setSettings({ open: true, section: 'agents', target: 'computer.enable' })),
        // About the machine this window runs beside, so only a client with one has it.
        ...(hasLocalMachine() ? [row('onboarding', () => openOnboarding())] : [])
    ];
}
