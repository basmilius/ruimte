import i18next from 'i18next';
import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import {
    clipText,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isSessionView,
    isUnknownNode,
    lineEndOf,
    nodeColorOf,
    nodeColorPatch,
    type ProjectNode,
    type ProviderInfo,
    nodeChats
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { agentNodeOptions } from '@/agents/nodes';
import { LOCK_KEYS } from '@/canvas/locks';
import { centerOf } from '@adecore/drawing';
import { isMeasured, visibleRect } from '@/canvas/math';
import { liesWithin, nearestFreeNodeRect } from '@/canvas/place-node';
import { useDesignChat } from '@/design/design-chat';
import { nodeDeletionFacts, saveNodeFiles, type ViewDeletionMachine } from '@/project/view-deletion';
import { nodesOfView } from '@/project/view-nodes';
import { basenameOf } from '@/shell/panels/files-tree';
import { liveCanvas, type AddNodeOptions, type CanvasState, type Locks, type NodeKind } from '@/state/canvas';
import { liveDiagram } from '@/state/diagram';
import type { DocumentState } from '@/state/document';
import { liveDrawing } from '@/state/drawing';
import { defaultNodeSize } from '@/state/node-size';
import {
    agentFor,
    canvasNow,
    canvasOnScreen,
    centerWorld,
    deletionConsequences,
    hasNode,
    historyUndo,
    isOnScreen,
    kindOfNode,
    nodeOnScreen,
    quoted,
    refuseResumeWithout,
    refuseUnreachableBrowser,
    sessionOf,
    sessionsEnded,
    storedFilePath,
    unknownCanvas
} from '@/actions/action-reach';

/* What the canvas actions reach outside the document; a test hands in a fake of each. */
export interface CanvasReach {
    /* The agent CLIs of the machine the project runs on. */
    providers(): readonly ProviderInfo[];
    viewDeletion: ViewDeletionMachine;
}

/* A name needs no editor, so a rename also reaches a canvas on no cell, through the view the document keeps. */
function nodeToName(document: StoreApi<DocumentState>, viewId: string, nodeId: string): ProjectNode | undefined {
    const view = document.getState().views.find((candidate) => candidate.id === viewId);
    if (!view || !isCanvasView(view)) {
        throw unknownCanvas(viewId);
    }
    return nodesOfView(view).find((node) => node.id === nodeId);
}

function addNodeInFreeSpace(canvas: CanvasState, kind: NodeKind, options: AddNodeOptions): string | null {
    const visible = isMeasured(canvas.viewport) ? visibleRect(canvas.camera, canvas.viewport) : undefined;
    const placed = nearestFreeNodeRect(Object.values(canvas.nodes), defaultNodeSize(kind), centerWorld(canvas), visible);
    const id = canvas.addNode(kind, centerOf(placed), options);
    // With no free room in view it lands beside the rest, and the camera goes to it.
    if (id !== null && visible !== undefined && !liesWithin(visible, placed)) {
        canvas.goToNode(id);
    }
    return id;
}

/* The editor of a view on screen: a canvas, a drawing and a diagram each keep their own history and camera. */
function editorOnScreen(document: StoreApi<DocumentState>, viewId: string, doing: string) {
    const state = document.getState();
    const view = state.views.find((candidate) => candidate.id === viewId);
    const refusal = () => new ActionRefusal('inactive-view', `Open the target canvas, drawing or diagram before ${doing}.`);
    if (!view || !(isCanvasView(view) || isDrawingView(view) || isDiagramView(view))) {
        throw refusal();
    }
    const live = isCanvasView(view) ? liveCanvas : isDrawingView(view) ? liveDrawing : liveDiagram;
    if (!isOnScreen(state, viewId) || live(viewId) === null) {
        throw refusal();
    }
    return { view, editor: () => live(viewId)! };
}

function linesOf(canvas: CanvasState, nodeId: string): number {
    return canvas.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;
}

function linesRemoved(lines: number): string {
    return `${lines} ${lines === 1 ? 'line' : 'lines'} drawn to it will be removed.`;
}

/* The nodes a delete takes: the ones named, and what a collapsed group among them hides. */
function goingWith(canvas: CanvasState, nodeIds: readonly string[]): ProjectNode[] {
    const going = new Set(
        nodeIds.flatMap((id) => {
            const node = canvas.nodes[id];
            return node?.kind === 'group' && node.collapsed ? [id, ...(node.memberIds ?? [])] : [id];
        })
    );
    return [...going].flatMap((id) => canvas.nodes[id] ?? []);
}

/* The nodes, texts, lines, groups, layouts, locks and history of a canvas on screen. */
export function canvasActions(document: StoreApi<DocumentState>, reach: CanvasReach): ActionHandlers<void> {
    const { providers, viewDeletion } = reach;
    return {
        'node.focus': ({ viewId, nodeId }) => {
            // A later chat of a design is no node: the design that holds it goes in front, on that chat.
            const holderId = lineEndOf(Object.values(canvasOnScreen(document, viewId).canvas.nodes), nodeId);
            const { view, canvas, node } = nodeOnScreen(document, viewId, holderId);
            if (holderId !== nodeId) {
                useDesignChat.getState().pick(holderId, nodeId);
            }
            canvas.goToNode(holderId);
            return {
                output: {
                    viewId,
                    view: view.name,
                    nodeId,
                    node: node.title,
                    kind: kindOfNode(node)
                }
            };
        },
        'node.rename': ({ viewId, nodeId, name }) => {
            const node = nodeToName(document, viewId, nodeId);
            if (!node || isUnknownNode(node)) {
                throw new ActionRefusal('unknown-node', `No renameable node with id “${nodeId}” exists on this canvas.`);
            }
            const previousName = node.title;
            const previousSource = node.titleSource ?? null;
            document.getState().renameNodeOnView(viewId, nodeId, name);
            const changed = nodeToName(document, viewId, nodeId)?.title === name && (previousName !== name || previousSource !== 'user');
            return {
                output: {
                    viewId,
                    nodeId,
                    kind: node.kind,
                    previousName,
                    name,
                    changed
                },
                ...(changed
                    ? {
                          undo: () => {
                              const current = nodeToName(document, viewId, nodeId);
                              if (!current || current.title !== name || current.titleSource !== 'user') {
                                  throw new ActionRefusal('stale-undo', `“${name}” is no longer the current name of this node.`);
                              }
                              document.getState().renameNodeOnView(viewId, nodeId, previousName, previousSource);
                          }
                      }
                    : {})
            };
        },
        'node.setColor': ({ viewId, nodeId, color }) => {
            const { canvas } = canvasOnScreen(document, viewId);
            const node = canvas.nodes[nodeId];
            if (!node || isUnknownNode(node)) {
                throw new ActionRefusal('unknown-node', `No node with id “${nodeId}” exists on this canvas to color.`);
            }
            const patch = nodeColorPatch(node, color);
            // A note that already shows the color still changes when an old paper goes, so the file says what it shows.
            const changed = node.accent !== patch.accent || ('color' in patch && node.color !== undefined);
            const output = { viewId, nodeId, kind: node.kind, color, previousColor: nodeColorOf(node), changed };
            if (!changed) {
                return { output };
            }
            const colorAfter = 'color' in patch ? undefined : node.color;
            const depth = canvas.past.length;
            canvas.setNodeColor(nodeId, color);
            return {
                output,
                undo: () => {
                    const current: CanvasState | null = liveCanvas(viewId);
                    const now = current?.nodes[nodeId];
                    if (current === null || now === undefined || current.past.length !== depth + 1 || now.accent !== patch.accent || now.color !== colorAfter) {
                        throw new ActionRefusal('stale-undo', 'The canvas changed after the node was colored, so it cannot be safely undone here.');
                    }
                    current.undo();
                }
            };
        },
        'node.create': ({
            viewId,
            kind,
            title,
            content,
            url,
            browserOwner,
            command,
            path,
            provider,
            account,
            at,
            cwd,
            resume,
            issue,
            artifact,
            artifactVersion,
            routine
        }) => {
            refuseUnreachableBrowser(kind, url, browserOwner);
            const { view, canvas } = canvasOnScreen(document, viewId);
            refuseResumeWithout(resume, provider);
            const agent = agentFor(providers(), kind, provider, command, account ?? null);
            if (kind === 'file' && path === null) {
                throw new ActionRefusal('missing-path', 'Name the file a file node shows.');
            }
            if (kind === 'artifact' && artifact == null) {
                throw new ActionRefusal('missing-artifact', 'Name the artifact an artifact node shows.');
            }
            if (kind === 'routine' && routine == null) {
                throw new ActionRefusal('missing-routine', 'Name the routine a routine node shows.');
            }
            const depth = canvas.past.length;
            const options: AddNodeOptions = {
                ...(agent === null ? {} : agentNodeOptions(agent.target, agent.info, sessionOf(resume, cwd))),
                ...(agent !== null && account != null ? { account } : {}),
                ...(agent === null && cwd != null && (kind === 'chat' || kind === 'terminal') ? { cwd } : {}),
                ...(issue != null && (kind === 'chat' || kind === 'terminal') ? { issue } : {}),
                ...(title
                    ? { title }
                    : kind === 'note' && content
                      ? { title: clipText(content.split('\n')[0]!, 48) }
                      : kind === 'file' && path
                        ? { title: basenameOf(path) }
                        : {}),
                ...(kind === 'browser' ? { ...(url ? { url } : {}), ...(browserOwner ? { browserOwner } : {}) } : {}),
                ...(command && kind === 'terminal' ? { command } : {}),
                ...(path && kind === 'file' ? { path: storedFilePath(path) } : {}),
                ...(kind === 'artifact' && artifact != null
                    ? { artifact: { id: artifact, ...(artifactVersion == null ? {} : { version: artifactVersion }) } }
                    : {}),
                ...(kind === 'routine' && routine != null ? { routine } : {})
            };
            const nodeId = at === null ? addNodeInFreeSpace(canvas, kind, options) : canvas.addNode(kind, at, options);
            if (!nodeId) {
                throw new ActionRefusal('node-create-failed', `Ruimte could not create the ${kind} node.`);
            }
            if (kind === 'note' && content !== null) {
                canvasNow(document, viewId).updateNode(nodeId, { body: content });
            }
            const node = canvasNow(document, viewId).nodes[nodeId]!;
            return {
                output: {
                    viewId,
                    view: view.name,
                    nodeId,
                    node: node.title,
                    kind
                },
                undo: historyUndo(viewId, depth + 1, hasNode(nodeId))
            };
        },
        'node.duplicate': ({ viewId, nodeId }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const source = canvas.nodes[nodeId];
            if (!source || isUnknownNode(source)) {
                throw new ActionRefusal('unknown-node', `No duplicable node with id “${nodeId}” exists on this canvas.`);
            }
            const depth = canvas.past.length;
            canvas.duplicateNode(nodeId);
            const copyId = canvasNow(document, viewId).selection[0];
            const copy = copyId ? canvasNow(document, viewId).nodes[copyId] : undefined;
            if (!copy) {
                throw new ActionRefusal('node-duplicate-failed', `Ruimte could not duplicate “${source.title}”.`);
            }
            return {
                output: {
                    viewId,
                    view: view.name,
                    sourceNodeId: nodeId,
                    nodeId: copy.id,
                    node: copy.title,
                    kind: kindOfNode(copy)
                },
                undo: historyUndo(viewId, depth + 1, hasNode(copy.id))
            };
        },
        'canvas.select': ({ viewId, nodeIds }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const names = nodeIds.map((id) => canvas.nodes[id]?.title ?? canvas.texts[id]?.text ?? (canvas.lines[id] ? 'Line' : undefined));
            const missing = nodeIds.find((_id, index) => names[index] === undefined);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node or text with id “${missing}” exists on “${view.name}”.`);
            }
            canvas.select([...nodeIds]);
            return { output: { viewId, view: view.name, nodeIds, nodes: names.map((name) => name!) } };
        },
        'node.delete': async ({ viewId, nodeIds }, { confirmed }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const nodes = nodeIds.map((nodeId) => canvas.nodes[nodeId]);
            const missing = nodeIds.find((_nodeId, index) => nodes[index] === undefined);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on “${view.name}”.`);
            }
            const titles = nodes.map((node) => node!.title);
            const what = nodeIds.length === 1 ? `“${titles[0]}”` : `${nodeIds.length} nodes`;
            const going = goingWith(canvas, nodeIds);
            if (!confirmed) {
                const facts = await nodeDeletionFacts(going, document.getState().exportViews(), viewDeletion);
                return {
                    confirmation: {
                        title: `Delete ${what}?`,
                        consequences: [
                            nodeIds.length === 1 ? 'The node and its connections will be removed.' : 'The nodes and their connections will be removed.',
                            ...sessionsEnded(going.reduce((count, node) => count + (node.kind === 'terminal' ? 1 : nodeChats(node).length), 0)),
                            ...deletionConsequences(facts, nodeIds.length === 1 ? 'this node' : 'these nodes')
                        ]
                    }
                };
            }
            const unsaved = await saveNodeFiles(going, viewDeletion);
            if (unsaved.length > 0) {
                throw new ActionRefusal(
                    'unsaved-files',
                    `${quoted(unsaved.map(basenameOf))} could not be saved, so ${what} ${nodeIds.length === 1 ? 'was' : 'were'} kept.`
                );
            }
            // Saving waits on the machine, and the canvas may have moved on in the meantime.
            const current = canvasNow(document, viewId);
            if (nodeIds.some((nodeId) => current.nodes[nodeId] === undefined)) {
                throw new ActionRefusal('unknown-node', `${nodeIds.length === 1 ? what : 'A node to delete'} is no longer on “${view.name}”.`);
            }
            const depth = current.past.length;
            current.select(nodeIds);
            current.deleteSelected();
            return {
                output: { viewId, view: view.name, nodeIds, nodes: titles },
                undo: historyUndo(viewId, depth + 1)
            };
        },
        'group.create': ({ viewId, nodeIds }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const missing = nodeIds.find((id) => !canvas.nodes[id]);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on this canvas.`);
            }
            const depth = canvas.past.length;
            canvas.select(nodeIds);
            const groupId = canvas.groupSelection();
            if (!groupId) {
                throw new ActionRefusal('group-create-failed', 'Select one or more non-group nodes before grouping them.');
            }
            return {
                output: { viewId, view: view.name, groupId, members: nodeIds.filter((id) => canvas.nodes[id]?.kind !== 'group') },
                undo: historyUndo(viewId, depth + 1, hasNode(groupId))
            };
        },
        'group.arrange': ({ viewId, groupId }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            if (canvas.nodes[groupId]?.kind !== 'group') {
                throw new ActionRefusal('unknown-node', `No group with id “${groupId}” exists on this canvas.`);
            }
            const depth = canvas.past.length;
            const result = canvas.arrangeGroup(groupId);
            if ('refused' in result) {
                const reasons = {
                    collapsed: i18next.t('canvas:group.arrangeCollapsed'),
                    empty: i18next.t('canvas:group.arrangeEmpty'),
                    locked: i18next.t('canvas:group.arrangeLocked'),
                    membership: i18next.t('canvas:group.arrangeRefused')
                };
                throw new ActionRefusal('arrange-refused', reasons[result.refused]);
            }
            const changed = canvasNow(document, viewId).past.length > depth;
            return {
                output: { viewId, view: view.name, groupId, nodeIds: result.moved, changed },
                ...(changed ? { undo: historyUndo(viewId, depth + 1) } : {})
            };
        },
        'link.create': ({ viewId, from, to }) => {
            if (from === null) {
                throw new ActionRefusal('missing-from', 'Name the node the line starts from.');
            }
            const { canvas } = canvasOnScreen(document, viewId);
            const targets = [...new Set(to)];
            const missing = [from, ...targets].find((id) => !canvas.nodes[id]);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on this canvas.`);
            }
            if (targets.includes(from)) {
                throw new ActionRefusal('self-link', 'A line runs between two nodes, and this one names the same node at both ends.');
            }
            const depth = canvas.past.length;
            const before = new Set(canvas.edges.map((edge) => edge.id));
            for (const target of targets) {
                canvasNow(document, viewId).addEdge(from, target);
            }
            const after = canvasNow(document, viewId);
            const lineOf = (tail: string, head: string) => after.edges.find((edge) => edge.from === tail && edge.to === head);
            const edges = targets.flatMap((target) => {
                const out = lineOf(from, target)!;
                const back = lineOf(target, from);
                return [
                    { edgeId: out.id, from, to: target, state: before.has(out.id) ? ('existing' as const) : ('new' as const), way: 'out' as const },
                    ...(back === undefined || before.has(back.id)
                        ? []
                        : [{ edgeId: back.id, from: target, to: from, state: 'new' as const, way: 'back' as const }])
                ];
            });
            const steps = after.past.length - depth;
            return {
                output: { viewId, edges },
                ...(steps === 0 ? {} : { undo: historyUndo(viewId, depth + steps, undefined, steps) })
            };
        },
        'canvas.fit': ({ viewId }) => {
            const { view, editor } = editorOnScreen(document, viewId, 'fitting it in view');
            editor().fitAll();
            return { output: { viewId, view: view.name } };
        },
        'history.undo': ({ viewId }) => {
            const { view, editor } = editorOnScreen(document, viewId, 'undoing or redoing a change in it');
            const before = editor().past.length;
            editor().undo();
            return { output: { viewId, view: view.name, changed: editor().past.length !== before } };
        },
        'history.redo': ({ viewId }) => {
            const { view, editor } = editorOnScreen(document, viewId, 'undoing or redoing a change in it');
            const before = editor().future.length;
            editor().redo();
            return { output: { viewId, view: view.name, changed: editor().future.length !== before } };
        },
        'canvasText.create': ({ viewId, text, at }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const depth = canvas.past.length;
            const textId = canvas.addText(at ?? centerWorld(canvas));
            if (text !== null) {
                const written = canvasNow(document, viewId);
                written.updateText(textId, text);
                written.setEditingText(null);
            }
            return {
                output: { viewId, view: view.name, textId },
                undo: historyUndo(viewId, depth + 1, (current) => current.texts[textId] !== undefined)
            };
        },
        'node.promoteToView': ({ viewId, nodeId }, { confirmed }) => {
            const { canvas, node } = nodeOnScreen(document, viewId, nodeId);
            if (node.kind !== 'chat' && node.kind !== 'terminal' && node.kind !== 'browser' && node.kind !== 'device' && node.kind !== 'design') {
                throw new ActionRefusal(
                    'node-not-promotable',
                    `“${node.title}” is a ${node.kind} node; only a chat, terminal, browser, device or design becomes a view.`
                );
            }
            const lines = linesOf(canvas, nodeId);
            if (lines > 0 && !confirmed) {
                return { confirmation: { title: `Open “${node.title}” as a view?`, consequences: [linesRemoved(lines)] } };
            }
            if (document.getState().openAsView(nodeId) === null) {
                throw new ActionRefusal('node-promote-failed', `Ruimte could not open “${node.title}” as a view.`);
            }
            return {
                output: { viewId, nodeId, view: node.title, kind: node.kind },
                undo: () => {
                    const current = document.getState();
                    const promoted = current.views.find((candidate) => candidate.id === nodeId);
                    if (!promoted || !isSessionView(promoted) || !current.views.some((candidate) => candidate.id === viewId && isCanvasView(candidate))) {
                        throw new ActionRefusal('stale-undo', `“${node.title}” is no longer a view of its own, or its canvas is gone.`);
                    }
                    current.putOnCanvas(nodeId, viewId);
                }
            };
        },
        'node.moveToView': ({ viewId, nodeId, targetViewId }, { confirmed }) => {
            const { view, canvas, node } = nodeOnScreen(document, viewId, nodeId);
            if (node.kind === 'group') {
                throw new ActionRefusal('node-not-movable', `The group “${node.title}” stays on its canvas; move the nodes in it one by one.`);
            }
            const target = document.getState().views.find((candidate) => candidate.id === targetViewId);
            if (!target || !isCanvasView(target)) {
                throw unknownCanvas(targetViewId);
            }
            if (targetViewId === viewId) {
                throw new ActionRefusal('same-view', `“${node.title}” is already on “${view.name}”.`);
            }
            const lines = linesOf(canvas, nodeId);
            if (lines > 0 && !confirmed) {
                return { confirmation: { title: `Move “${node.title}” to “${target.name}”?`, consequences: [linesRemoved(lines)] } };
            }
            document.getState().moveNodeToView(nodeId, targetViewId);
            const landed = document
                .getState()
                .views.some((candidate) => candidate.id === targetViewId && nodesOfView(candidate).some((each) => each.id === nodeId));
            if (!landed) {
                throw new ActionRefusal('node-move-failed', `Ruimte could not move “${node.title}” to “${target.name}”.`);
            }
            return { output: { viewId, nodeId, node: node.title, targetViewId, target: target.name } };
        },
        'layout.save': ({ viewId, name }, { confirmed }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const previous = canvas.layouts.find((layout) => layout.name === name) ?? null;
            if (previous !== null && !confirmed) {
                return {
                    confirmation: {
                        title: `Replace layout “${name}”?`,
                        consequences: [`The layout saved as “${name}” will be replaced by where everything on “${view.name}” is now.`]
                    }
                };
            }
            canvas.saveLayout(name);
            const saved = canvasNow(document, viewId).layouts.find((layout) => layout.name === name);
            return {
                output: { viewId, view: view.name, name, replaced: previous !== null },
                undo: () => {
                    const current = canvasNow(document, viewId);
                    if (current.layouts.find((layout) => layout.name === name) !== saved) {
                        throw new ActionRefusal('stale-undo', `The layout “${name}” changed after this action.`);
                    }
                    if (previous === null) {
                        current.deleteLayout(name);
                    } else {
                        current.putLayout(previous);
                    }
                }
            };
        },
        'layout.apply': ({ viewId, name }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            if (!canvas.layouts.some((layout) => layout.name === name)) {
                throw new ActionRefusal('unknown-layout', `“${view.name}” has no layout saved as “${name}”.`);
            }
            const depth = canvas.past.length;
            canvas.applyLayout(name);
            return { output: { viewId, view: view.name, name }, undo: historyUndo(viewId, depth + 1) };
        },
        'layout.delete': ({ viewId, name }, { confirmed }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const layout = canvas.layouts.find((candidate) => candidate.name === name);
            if (!layout) {
                throw new ActionRefusal('unknown-layout', `“${view.name}” has no layout saved as “${name}”.`);
            }
            if (!confirmed) {
                return {
                    confirmation: { title: `Delete layout “${name}”?`, consequences: ['The saved arrangement will be removed. The nodes stay where they are.'] }
                };
            }
            canvas.deleteLayout(name);
            return {
                output: { viewId, view: view.name, name },
                undo: () => {
                    const current = canvasNow(document, viewId);
                    if (current.layouts.some((candidate) => candidate.name === name)) {
                        throw new ActionRefusal('stale-undo', `A layout called “${name}” was saved again after this action.`);
                    }
                    current.putLayout(layout);
                }
            };
        },
        'canvas.setLocks': ({ viewId, locked, gestures }) => {
            const { view } = canvasOnScreen(document, viewId);
            for (const key of gestures ?? LOCK_KEYS) {
                const current = canvasNow(document, viewId);
                if (current.locks[key] !== locked) {
                    current.toggleLock(key);
                }
            }
            const locks: Locks = canvasNow(document, viewId).locks;
            return { output: { viewId, view: view.name, locks: { ...locks } } };
        }
    };
}
