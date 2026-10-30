import { startVoice, stopVoice } from '@/voice/controller';
import { createVoiceShortcut } from '@/voice/shortcut';
import { useVoice } from '@/voice/state';
import { cancelDictation, stopDictation, toggleFocusedDictation, useDictation } from '@/dictation/controller';
import { useEffect } from 'react';
import { isCanvasView, isDiagramView } from '@ruimte/contracts';
import { browserRegistry } from '@/browser/registry';
import { CANVAS_SHORTCUTS, VIEW_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform } from '@/desktop/bridge';
import { countCommand } from '@/desktop/usage';
import {
    closeCellAction,
    closeTabAction,
    createNodeAction,
    createViewAction,
    fitAction,
    focusCellAction,
    groupSelectionAction,
    historyAction,
    selectAllAction,
    splitAction,
    toggleFlagAction
} from '@/actions/client-actions';
import { runChosenLaunch, stopChosenLaunch } from '@/launches/actions';
import { toggleRoutines } from '@/routines/stage';
import { machineAnswers } from '@/transport/features';
import { showView, stepView, viewAtIndex, viewStepTarget } from '@/project/views';
import { undoLatestDeletion } from '@/project/view-trash';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { isInNodeBody } from '@/canvas/node-body';
import { answerCanvasPaste } from '@/canvas/canvas-paste';
import { pointerInWorld } from '@/canvas/pointer';
import { followSpaceRelease, holdSpace, releaseSpace, spaceWorksTarget } from '@/canvas/space-pan';
import { setGapModifierDown } from '@/canvas/gap-modifier';
import { cancelCanvasGesture } from '@/canvas/gesture-cancel';
import { focusPromptStack, isInPromptStack, leavePromptStack } from '@/canvas/prompt-stack';
import { useSubagentView, stepEffortFromComposer, stepTimelineMessage } from '@adecore/agents-react/chat';
import { openFocusedFind } from '@/find/hosts';
import { focusedCanvas, maximizeTargetOf, zoomNodeTargetOf, type CanvasState } from '@/state/canvas';
import { focusedDiagram } from '@/state/diagram';
import { drawingHasSomethingToClear, focusedDrawing } from '@/state/drawing';
import { isScratchProject, useProject } from '@/state/project';
import { commandForKey, type WorkspaceCommandId } from '@/shell/command-table';
import { revealNextWaiting } from '@/shell/next-waiting';
import { openAttentionQueue } from '@/attention/queue';
import { focusViewRow } from '@/shell/sidebar-focus';
import { isLeaveNodeShortcut } from '@/terminal/keymap';
import { pool, transportFor } from '@/transport';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { useRoutinesStage } from '@/routines/stage';
import { cellAt, cellCount, focusDirection, isTabHost, type SplitDirection } from '@/shell/split';
import { cameraHistoryStep } from '@/state/canvas-camera-history';
import { nodeNavigationTarget } from '@/state/canvas-navigation-slice';
import { matchesShortcut, type Shortcut, isInFloatingLayer } from '@adecore/ui';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { windowWorkspace } from '@/state/window';
import { focusedChatComposerKey, keyboardChatKey } from '@/chat/focused-chat';

function workspaceEndpointId(): string | null {
    return windowWorkspace()?.connection.endpointId ?? null;
}

/* The command table's rows this listener binds that act in one of four directions, or on a kind of node. */
const FOCUS_DIRECTIONS: Partial<Record<WorkspaceCommandId, SplitDirection>> = {
    'focus-left': 'left',
    'focus-right': 'right',
    'focus-up': 'up',
    'focus-down': 'down'
};

const NODE_DIRECTIONS: Partial<Record<WorkspaceCommandId, SplitDirection>> = {
    'node-left': 'left',
    'node-right': 'right',
    'node-up': 'up',
    'node-down': 'down'
};

const ADD_NODE_KINDS: Partial<Record<WorkspaceCommandId, Parameters<typeof createNodeAction>[0]>> = {
    'add-terminal': 'terminal',
    'add-chat': 'chat',
    'add-browser': 'browser',
    'add-group': 'group',
    'add-note': 'note'
};

const DIAGRAM_COMMANDS: readonly WorkspaceCommandId[] = ['edit-undo', 'edit-redo', 'fit', 'zoom-selection', 'zoom-reset'];

/* The canvas keeps its own keys to itself while a view of its own has the focus; a loose view is one, and is no project view. */
function onStandaloneView(): boolean {
    const state = useDocument.getState();
    if (state.activeViewId === null) {
        return false;
    }
    const view = activeViewOf(state);
    return view === null || !isCanvasView(view);
}

/*
 * A view of its own has no canvas to fall back to, so leaving its body puts the keyboard on its row
 * in the sidebar. A chat leaves on Escape; a terminal hands Escape to the program it runs and leaves
 * on the same shortcut a terminal node uses.
 */
function leaveStandaloneView(e: KeyboardEvent): void {
    const state = useDocument.getState();
    const view = activeViewOf(state);
    if (view === null || !state.bodyFocused) {
        return;
    }
    const leaving = view.kind === 'terminal' ? isLeaveNodeShortcut(e, isApplePlatform()) : !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!leaving) {
        return;
    }
    // A drawing clears its draft, its selection and its tool first, also when its own listener hears the key after this one.
    if (view.kind === 'drawing' && drawingHasSomethingToClear(focusedDrawing().getState())) {
        return;
    }
    e.preventDefault();
    state.setBodyFocused(false);
    focusViewRow(view.id);
}

/* The tab in front of the focused cell when that cell is a tab host, else null. */
function focusedHostTab(): string | null {
    const { layout } = useDocument.getState();
    const cell = layout === null ? null : cellAt(layout, layout.focus);
    return cell !== null && isTabHost(cell) ? cell.viewId : null;
}

/* What the close key takes: the tab in front of a host, or the loose view that fills its cell alone, which has the same guards. */
function focusedClosableTab(): string | null {
    const state = useDocument.getState();
    const hosted = focusedHostTab();
    if (hosted !== null) {
        return hosted;
    }
    return state.activeViewId !== null && activeViewOf(state) === null ? state.activeViewId : null;
}

/* The page the keyboard means: a browser view in the focused cell, or the active browser node on its canvas. */
function focusedBrowserKey(): string | null {
    const endpointId = workspaceEndpointId();
    const view = activeViewOf(useDocument.getState());
    if (endpointId === null || view === null) {
        return null;
    }
    if (!isCanvasView(view)) {
        return view.kind === 'browser' ? endpointKey(endpointId, view.id) : null;
    }
    const { bodyFocusId, nodes } = focusedCanvas().getState();
    return bodyFocusId !== null && nodes[bodyFocusId]?.kind === 'browser' ? endpointKey(endpointId, bodyFocusId) : null;
}

export function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) {
        return false;
    }
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

type Matches = (shortcut: Shortcut) => boolean;

/* The command table's row a key is for this listener (`commandForKey`), or null. */
type Command = WorkspaceCommandId | null;

/* Escape steps out of a node's content, a text being edited or a link being aimed. */
function escapeCanvas(e: KeyboardEvent, s: CanvasState): void {
    // An open popup or dialog owns Escape. It closes itself, and the node it belongs to stays focused.
    if (isInFloatingLayer(e.target)) {
        return;
    }
    if (onStandaloneView()) {
        leaveStandaloneView(e);
        return;
    }
    if (s.lineTool !== null) {
        s.setLineTool(null);
    } else if (s.linkDraft?.aiming) {
        s.setLinkDraft(null);
    } else if (s.editingTextId) {
        s.setEditingText(null);
    } else if (s.bodyFocusId === null) {
        s.clearSelection();
    }
    /* Escape steps out of the content and leaves the node selected, since a press on its
       header put the keyboard there: the keys that act on a node work again right away. */
    s.setBodyFocus(null);
    (document.activeElement as HTMLElement | null)?.blur();
}

/* The keys about the window, its cells and its views, which answer from anywhere. Answers whether the key is spoken for. */
function answerWindowKey(e: KeyboardEvent, s: CanvasState, is: Matches, command: Command, apple: boolean): boolean {
    if (command === 'zoom-node' && !onStandaloneView() && !isInFloatingLayer(e.target) && !useUi.getState().settings.open) {
        if (zoomNodeTargetOf(s) !== null) {
            e.preventDefault();
            s.zoomToNode();
        }
        return true;
    }
    // A surface with nothing to search lets the key go, so a browser tab still gets its own find.
    if (command === 'find' || command === 'find-replace') {
        if (!isInFloatingLayer(e.target) && !useUi.getState().settings.open && openFocusedFind(command === 'find' ? undefined : { replace: true })) {
            e.preventDefault();
        }
        return true;
    }
    /* The grid answers from anywhere, a focused node or a text field included: splitting,
       closing and stepping between cells are about the window, not about what is in a cell. */
    if (command === 'split-right' || command === 'split-down') {
        e.preventDefault();
        splitAction(command === 'split-down' ? 'down' : 'right');
        return true;
    }
    /* A node on the canvas goes first (`maximizeTargetOf`); without one the key is the grid's,
       and with one cell and nothing maximized it is let go, since there is nothing to fill. */
    if (command === 'cell-maximize') {
        const node = onStandaloneView() ? null : maximizeTargetOf(s);
        if (node !== null) {
            e.preventDefault();
            s.toggleMaximizedNode(node);
            return true;
        }
        const state = useDocument.getState();
        if (state.maximized !== null || (state.layout !== null && cellCount(state.layout) > 1)) {
            e.preventDefault();
            state.toggleMaximized();
        }
        return true;
    }
    const direction = command === null ? undefined : FOCUS_DIRECTIONS[command];
    if (direction) {
        const layout = useDocument.getState().layout;

        if (layout !== null && focusDirection(layout, direction) !== layout) {
            e.preventDefault();
            focusCellAction(direction);
        }

        return true;
    }
    /* Stepping between the tabs of the focused host, whatever the host holds: a terminal in it hands
       the key back (`terminal/keymap.ts`) so it never reaches the PTY. It never leaves the cell, so
       the grid's own keys stay where they are. */
    if ((command === 'tab-next' || command === 'tab-previous') && focusedHostTab() !== null) {
        e.preventDefault();
        useDocument.getState().stepTab(command === 'tab-next' ? 1 : -1);
        return true;
    }
    // Moving the tab in front along its strip is as much about the host as stepping is.
    if (command === 'tab-move-left' || command === 'tab-move-right') {
        const tab = focusedHostTab();
        if (tab !== null) {
            e.preventDefault();
            useDocument.getState().moveTab(tab, command === 'tab-move-right' ? 1 : -1);
            return true;
        }
    }
    /* A host closes its tab in front, and the cell goes with the last one (`state/document.ts`), so
       one shortcut walks out of a stack of tabs and then out of the cell that held them. A file
       with unsaved changes is saved first, and a table with edits nobody submitted asks first.
       Off macOS the window menu's Close answers Ctrl+W, so the shortcut is always taken there,
       even with nothing to close. */
    if (command === 'close-cell') {
        const tab = focusedClosableTab();
        if (tab !== null) {
            e.preventDefault();
            closeTabAction(tab);
            return true;
        }
        const layout = useDocument.getState().layout;
        const closes = layout !== null;
        if (closes || !apple) {
            e.preventDefault();
        }
        if (closes) {
            closeCellAction();
        }
        return true;
    }
    // The views answer from anywhere, a focused node included: they are how you leave one.
    const viewIndex = VIEW_SHORTCUTS.findIndex((candidate) => is(candidate));
    if (viewIndex !== -1) {
        e.preventDefault();
        const view = viewAtIndex(viewIndex + 1);
        if (view) {
            showView(view.id);
        }
        return true;
    }
    // Mod+Alt+[ and ] because Mod+[ and ] belong to a page, the editor's history and a drawing's order.
    if (command === 'camera-back' || command === 'camera-forward') {
        if (
            !isInFloatingLayer(e.target) &&
            !useUi.getState().settings.open &&
            !onStandaloneView() &&
            cameraHistoryStep(s, command === 'camera-forward' ? 1 : -1) !== null
        ) {
            e.preventDefault();
            s.stepCamera(command === 'camera-forward' ? 1 : -1);
        }
        return true;
    }
    /* With the keyboard inside the page these never get here; the guest preload sends them instead.
       Only a focused browser takes them, so a drawing keeps them for its order. */
    if (is(CANVAS_SHORTCUTS.browserBack) || is(CANVAS_SHORTCUTS.browserForward)) {
        const key = focusedBrowserKey();
        if (key !== null) {
            e.preventDefault();
            if (is(CANVAS_SHORTCUTS.browserForward)) {
                browserRegistry.forward(key);
            } else {
                browserRegistry.back(key);
            }
            return true;
        }
    }
    /* From the thread only: the composer keeps these for its prompt recall (`terminal/keymap.ts`). Nothing
       is taken when the chat has no message that way, so the canvas still moves between nodes. */
    if (is(CANVAS_SHORTCUTS.previousMessage) || is(CANVAS_SHORTCUTS.nextMessage)) {
        const key = keyboardChatKey();
        if (key !== null && !isInFloatingLayer(e.target) && stepTimelineMessage(key, is(CANVAS_SHORTCUTS.nextMessage) ? 1 : -1)) {
            e.preventDefault();
            return true;
        }
    }
    /* The chat the menu's row means: the shell drops an accelerator for a key the page saw, and off
       macOS registers none, so this listener is the only way the key the menu shows acts. */
    if (command === 'chat-effort-up' || command === 'chat-effort-down') {
        const key = focusedChatComposerKey();
        if (key !== null && !isInFloatingLayer(e.target) && stepEffortFromComposer(key, command === 'chat-effort-up' ? 'up' : 'down')) {
            e.preventDefault();
            return true;
        }
    }
    if (command === 'view-previous' || command === 'view-next') {
        const delta = command === 'view-next' ? 1 : -1;

        if (viewStepTarget(delta) !== null) {
            e.preventDefault();
            stepView(delta);
        }

        return true;
    }
    if (command === 'view-new') {
        e.preventDefault();
        void createViewAction('canvas');
        return true;
    }
    // From anywhere, a terminal included: the point is to answer without first leaving what you type in.
    if (command === 'prompts') {
        if (focusPromptStack()) {
            e.preventDefault();
        }
        return true;
    }
    if (command === 'attention-queue') {
        e.preventDefault();
        openAttentionQueue();
        return true;
    }
    if (command === 'needs-you-next') {
        if (revealNextWaiting()) {
            e.preventDefault();
        }
        return true;
    }
    if (command === 'routines') {
        if (machineAnswers(pool.statusOf(currentEndpointId()), 'routine.list')) {
            e.preventDefault();
            toggleRoutines();
        }
        return true;
    }
    if (command === 'panel-toggle') {
        e.preventDefault();
        useUi.getState().togglePanel();
        return true;
    }
    // From anywhere but a popup, so a flag goes on a chat view while its composer has the keyboard.
    if (command === 'flag-toggle') {
        if (!isInFloatingLayer(e.target)) {
            e.preventDefault();
            toggleFlagAction();
        }
        return true;
    }
    // From anywhere but a popup, a terminal included: restarting the server is what you do while typing.
    if (command === 'launch-run' || command === 'launch-stop') {
        // The Chats project has no launches, and its keys fall through to whatever has the focus.
        if (isScratchProject(useProject.getState().current)) {
            return true;
        }
        if (!isInFloatingLayer(e.target)) {
            e.preventDefault();
            if (command === 'launch-stop') {
                stopChosenLaunch();
            } else {
                runChosenLaunch();
            }
        }
        return true;
    }
    return false;
}

function answerDiagramKey(e: KeyboardEvent, command: Command): boolean {
    /* A diagram has an undo and a camera of its own and nothing else a key reaches; a drawing binds
       its keys in its view, since a drawing has the keyboard the way a terminal has it. */
    const active = activeViewOf(useDocument.getState());
    if (active !== null && isDiagramView(active) && command !== null && DIAGRAM_COMMANDS.includes(command)) {
        if (isTypingTarget(e.target) || isInFloatingLayer(e.target) || useUi.getState().settings.open) {
            return true;
        }
        e.preventDefault();
        if (command === 'edit-undo' || command === 'edit-redo') {
            historyAction(command === 'edit-redo' ? 'redo' : 'undo');
        } else if (command === 'fit') {
            fitAction();
        } else if (command === 'zoom-selection') {
            focusedDiagram().getState().zoomToSelection();
        } else {
            focusedDiagram().getState().zoomTo(1);
        }
        return true;
    }
    return false;
}

/* A dialog owns the keyboard while it is up; Backspace there must not delete nodes. Nor may
   a key reach the canvas that is parked behind a view of its own. */
function keyboardOnCanvas(target: EventTarget | null, s: CanvasState): boolean {
    return !(
        isTypingTarget(target) ||
        isInNodeBody(target) ||
        s.bodyFocusId !== null ||
        s.gesturing ||
        isInFloatingLayer(target) ||
        useUi.getState().settings.open ||
        onStandaloneView()
    );
}

/* A paste goes to what has the focus, so one aimed at a row of the sidebar or a panel is not the canvas's either. */
function pasteOnCanvas(target: EventTarget | null): boolean {
    const view = activeViewOf(useDocument.getState());
    if (view === null || !isCanvasView(view)) {
        return false;
    }
    const onSurface = target === document.body || (target instanceof Element && target.closest('[data-canvas-surface]') !== null);
    return onSurface && keyboardOnCanvas(target, focusedCanvas().getState());
}

function answerCanvasKey(e: KeyboardEvent, s: CanvasState, is: Matches, command: Command): void {
    if (!keyboardOnCanvas(e.target, s)) {
        return;
    }
    const nodeDirection = command === null ? undefined : NODE_DIRECTIONS[command];
    if (nodeDirection !== undefined) {
        if (nodeNavigationTarget(s, nodeDirection) !== null) {
            e.preventDefault();
            s.selectNeighbor(nodeDirection);
        }

        return;
    }
    const plainEnter = e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    // A card beside a node the keys stand on, which is never selected: Enter goes into it as a press does.
    if (plainEnter && s.selection.length === 0 && s.navigationId !== null && s.derivedCards[s.navigationId] !== undefined) {
        e.preventDefault();
        s.focusCard(s.navigationId);
        return;
    }
    if (plainEnter && s.selection.length === 1) {
        const node = s.nodes[s.selection[0]!];
        if (node !== undefined && node.kind !== 'group' && !s.hidden.has(node.id)) {
            e.preventDefault();
            s.activateNode(node.id);
        }
        return;
    }
    const addKind = command === null ? undefined : ADD_NODE_KINDS[command];
    if (addKind) {
        e.preventDefault();
        void createNodeAction(addKind);
    } else if (command === 'edit-undo' || command === 'edit-redo') {
        e.preventDefault();
        historyAction(command === 'edit-redo' ? 'redo' : 'undo');
    } else if (command === 'group-selection') {
        e.preventDefault();
        groupSelectionAction();
    } else if (command === 'zoom-reset') {
        e.preventDefault();
        s.zoomTo(1);
    } else if (command === 'fit') {
        e.preventDefault();
        fitAction();
    } else if (command === 'zoom-selection') {
        e.preventDefault();
        s.zoomToSelection();
    } else if (is(CANVAS_SHORTCUTS.selectAll)) {
        e.preventDefault();
        selectAllAction(focusedCanvas());
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length > 0) {
        e.preventDefault();
        const endpointId = workspaceEndpointId();
        void deleteSelectionAsking(focusedCanvas(), endpointId === null ? null : transportFor(endpointId));
    } else if (e.key === '=' || e.key === '+') {
        s.zoomTo(Math.round(s.camera.zoom * 100 + 10) / 100);
    } else if (e.key === '-') {
        s.zoomTo(Math.round(s.camera.zoom * 100 - 10) / 100);
    }
}

/* Bind once per workspace so a split grid does not run the same project shortcut in every canvas. */
export function useCanvasShortcuts(): void {
    useEffect(() => {
        const voiceShortcut = createVoiceShortcut({
            available: () => useVoice.getState().credential?.configured === true,
            active: () => ['connecting', 'listening', 'closing'].includes(useVoice.getState().phase),
            start: () => {
                void startVoice();
            },
            stop: stopVoice
        });
        let dictationPress: number | null = null;
        const onBlur = (): void => {
            setGapModifierDown(false);
            voiceShortcut.blur();
            dictationPress = null;
            cancelDictation();
        };
        const onKeyDown = (e: KeyboardEvent): void => {
            // A key something on the page already acted on is that thing's: the views of a database cell mark the keys they took that way.
            if (e.defaultPrevented || e.isComposing) {
                return;
            }
            // Routines covers the view stage, so the canvas and the cells under it are out of reach of the keyboard too.
            if (useRoutinesStage.getState().open) {
                return;
            }
            const s = focusedCanvas().getState();
            if (e.code === 'Space' && !isTypingTarget(e.target) && !spaceWorksTarget(e.target)) {
                holdSpace();
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape') {
                escapeCanvas(e, s);
                return;
            }
            const apple = isApplePlatform();
            const is: Matches = (target) => matchesShortcut(target, e, apple);
            const command = commandForKey('workspace', e, apple);
            if (!answerWindowKey(e, s, is, command, apple) && !answerDiagramKey(e, command)) {
                answerCanvasKey(e, s, is, command);
            }
            // A key counts once something acted on it; one that was let go is whatever has the focus's.
            if (command !== null && e.defaultPrevented) {
                countCommand(command, 'shortcut');
            }
        };
        /* In the capture phase, because leaving the node and leaving a view of its own listen on the
           window too, and only stopping the key here keeps them from also acting on it. */
        const onKeyDownCapture = (e: KeyboardEvent): void => {
            setGapModifierDown(e.altKey);
            if (!e.isComposing && !isInFloatingLayer(e.target) && matchesShortcut(CANVAS_SHORTCUTS.voiceControl, e, isApplePlatform())) {
                if (voiceShortcut.press(e.timeStamp, e.repeat)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
            if (!e.isComposing && !isInFloatingLayer(e.target) && matchesShortcut(CANVAS_SHORTCUTS.dictation, e, isApplePlatform())) {
                if (e.repeat) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                const starting = useDictation.getState().phase === 'idle' || useDictation.getState().phase === 'error';
                if (toggleFocusedDictation()) {
                    dictationPress = starting ? e.timeStamp : null;
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
            /* A deleted view comes back before any history hears the key: the deletion is the newest
               step there is, and a drawing or a diagram in front would take the key for its own. */
            if (
                !e.isComposing &&
                !isTypingTarget(e.target) &&
                !isInFloatingLayer(e.target) &&
                commandForKey('workspace', e, isApplePlatform()) === 'edit-undo' &&
                undoLatestDeletion(useDocument)
            ) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (e.key === 'Escape' && useDictation.getState().targetId !== null) {
                cancelDictation();
                dictationPress = null;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) {
                return;
            }
            if (isInFloatingLayer(e.target)) {
                return;
            }
            if (cancelCanvasGesture(focusedCanvas())) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            // A card of a prompt stack hands the keyboard back, before a chat or a node behind it hears the key.
            if (isInPromptStack(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                leavePromptStack();
                return;
            }
            if (isTypingTarget(e.target)) {
                return;
            }
            // A chat that shows a sub-agent goes one level back up first, the way a drawing clears its selection before it lets go of the keyboard.
            const key = keyboardChatKey();
            if (key !== null && useSubagentView.getState().back(key)) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        const onKeyUp = (e: KeyboardEvent): void => {
            setGapModifierDown(e.altKey);
            voiceShortcut.release(e);
            if (dictationPress !== null && (e.code === 'KeyD' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift')) {
                if (e.timeStamp - dictationPress >= 400) {
                    stopDictation();
                }
                dictationPress = null;
            }
            if (e.code === 'Space') {
                releaseSpace();
            }
        };
        const onPaste = (e: ClipboardEvent): void => {
            answerCanvasPaste(e, {
                onCanvas: pasteOnCanvas,
                pointer: () => pointerInWorld(focusedCanvas()),
                createNote: (content, at) => {
                    void createNodeAction('note', { content, ...(at === null ? {} : { at }) });
                }
            });
        };
        const stopSpaceRelease = followSpaceRelease();
        window.addEventListener('paste', onPaste);
        window.addEventListener('keydown', onKeyDownCapture, true);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('paste', onPaste);
            window.removeEventListener('keydown', onKeyDownCapture, true);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onBlur);
            stopSpaceRelease();
            setGapModifierDown(false);
            voiceShortcut.blur();
            cancelDictation();
        };
    }, []);
}
