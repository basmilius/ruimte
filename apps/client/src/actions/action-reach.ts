import { ActionRefusal, type ActionOutput } from '@ruimte/actions';
import {
    isCanvasView,
    isUnknownNode,
    isUnknownView,
    type AgentKind,
    type ProjectNode,
    type ProjectView,
    type ProviderInfo,
    storedPathOf
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { listed } from '@/actions/words';
import { toWorld } from '@/canvas-model/math';
import { browserRouteAvailable } from '@/clients/browser/owner-route';
import { locateView } from '@/layout/split';
import { basenameOf } from '@/paths/file-path';
import type { ViewDeletionFacts } from '@/project/view-deletion';
import type { AgentTarget, AgentSession } from '@/state/agent-availability';
import { liveCanvas, type CanvasState } from '@/state/canvas';
import { currentEndpointId } from '@/state/current-endpoint';
import { useDocument, type DocumentState } from '@/state/document';
import { useProject } from '@/state/project';

/* What the canvas, view and layout actions share: finding what they act on, and refusing what they cannot. */

export function kindOf(view: ProjectView): ActionOutput<'view.focus'>['kind'] {
    return isUnknownView(view) ? 'unknown' : view.kind;
}
export function kindOfNode(node: ProjectNode): ActionOutput<'node.focus'>['kind'] {
    return isUnknownNode(node) ? 'unknown' : node.kind;
}

/* A view in any cell of the grid. Only a view on screen has an editor, and so anything to act on. */
export function isOnScreen(state: DocumentState, viewId: string): boolean {
    return state.layout !== null && locateView(state.layout, viewId) !== null;
}

/* The focus says nothing here: a blur that lands after a press in another cell still means the canvas it left. */
export function canvasOnScreen(document: StoreApi<DocumentState>, viewId: string): { view: ProjectView & { kind: 'canvas' }; canvas: CanvasState } {
    const state = document.getState();
    const view = state.views.find((candidate) => candidate.id === viewId);
    const canvas = isOnScreen(state, viewId) ? liveCanvas(viewId) : null;
    if (!view || !isCanvasView(view) || canvas === null) {
        throw new ActionRefusal('inactive-canvas', 'Open the target canvas before changing its nodes.');
    }
    return { view, canvas };
}

/* A node of a canvas on screen, with that canvas. */
export function nodeOnScreen(document: StoreApi<DocumentState>, viewId: string, nodeId: string) {
    const { view, canvas } = canvasOnScreen(document, viewId);
    const node = canvas.nodes[nodeId];
    if (!node) {
        throw new ActionRefusal('unknown-node', `No node with id “${nodeId}” exists on “${view.name}”.`);
    }
    return { view, canvas, node };
}

/* What a canvas holds after a change, since the state read before it is a snapshot. */
export function canvasNow(document: StoreApi<DocumentState>, viewId: string): CanvasState {
    return canvasOnScreen(document, viewId).canvas;
}

export function centerWorld(canvas: CanvasState) {
    return toWorld(canvas.camera, {
        x: canvas.viewport.w / 2,
        y: canvas.viewport.h / 2
    });
}

export function quoted(names: readonly string[]): string {
    return listed(names.map((name) => `“${name}”`));
}

export function hasNode(id: string) {
    return (canvas: CanvasState): boolean => canvas.nodes[id] !== undefined;
}

export function historyUndo(viewId: string, expectedDepth: number, stillThere?: (canvas: CanvasState) => boolean, steps = 1) {
    return () => {
        const current = canvasNow(useDocument, viewId);
        if (current.past.length !== expectedDepth || (stillThere && !stillThere(current))) {
            throw new ActionRefusal('stale-undo', 'The canvas changed after this action, so it cannot be safely undone here.');
        }
        for (let i = 0; i < steps; i++) {
            current.undo();
        }
    };
}

export function unknownView(viewId: string): ActionRefusal {
    return new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);
}

export function unknownCanvas(viewId: string): ActionRefusal {
    return new ActionRefusal('unknown-view', `No canvas view with id “${viewId}” exists in this project.`);
}

export function existingView(state: DocumentState, viewId: string): ProjectView {
    const view = state.views.find((candidate) => candidate.id === viewId);
    if (!view) {
        throw unknownView(viewId);
    }
    return view;
}

export function refuseUnreachableBrowser(kind: string, url: string | null | undefined, browserOwner: string | null | undefined): void {
    if (kind === 'browser' && !browserRouteAvailable(currentEndpointId(), url ?? '', browserOwner ?? undefined)) {
        throw new ActionRefusal('browser-owner-unavailable', 'Open this browser in Ruimte on the machine running the session.');
    }
}

/*
 * The CLI a new chat or terminal runs, as this machine reports it. A terminal that names an account
 * may run a command in place of the CLI: the shell still gets the account's environment, which is how
 * a login under that account runs.
 */
export function agentFor(
    providers: readonly ProviderInfo[],
    kind: string,
    provider: AgentKind | null,
    command: string | null,
    account: string | null = null
): { target: AgentTarget; info: ProviderInfo } | null {
    if (provider === null) {
        if (account !== null) {
            throw new ActionRefusal('missing-provider', 'An account belongs to an agent CLI. Name the provider as well.');
        }
        return null;
    }
    if (kind !== 'chat' && kind !== 'terminal') {
        throw new ActionRefusal('invalid-provider', 'Only an AI Chat or a terminal runs an agent CLI.');
    }
    if (command !== null && (account === null || kind !== 'terminal')) {
        throw new ActionRefusal('invalid-provider', 'A terminal runs either an agent CLI or a command, not both.');
    }
    const info = providers.find((entry) => entry.kind === provider);
    if (!info?.installed) {
        throw new ActionRefusal('unknown-provider', `The ${provider} CLI is not installed on this machine.`);
    }
    if (!info.capabilities[kind]) {
        throw new ActionRefusal('unsupported-provider', `${info.name} cannot run in ${kind === 'chat' ? 'an AI Chat' : 'a terminal'}.`);
    }
    return { target: kind, info };
}

/* A path as a node or a view stores it: relative inside the project folder, absolute outside it. */
export function storedFilePath(path: string): string {
    return storedPathOf(useProject.getState().current?.folder ?? null, path);
}

/* What a delete reaches besides what the document holds, in the words a confirmation reads. */
export function deletionConsequences({ unsaved, working, ending }: ViewDeletionFacts, from: string): string[] {
    return [
        ...(unsaved.length === 0 ? [] : [`Unsaved changes to ${quoted(unsaved.map(basenameOf))} will be saved first.`]),
        ...(working.length === 0 ? [] : [`${quoted(working)} ${working.length === 1 ? 'is' : 'are'} still working and will be stopped.`]),
        ...(ending.length === 0
            ? []
            : [
                  `${listed(ending.map((title) => (title === null ? 'an agent' : `“${title}”`)))} ${ending.length === 1 ? 'was' : 'were'} started from ${from} and will end too.`
              ])
    ];
}

export function sessionsEnded(sessions: number): string[] {
    return sessions === 0 ? [] : [`${sessions} ${sessions === 1 ? 'chat or terminal session' : 'chat or terminal sessions'} may be ended.`];
}

export function sessionOf(resume: string | null | undefined, cwd: string | null | undefined): AgentSession {
    return {
        ...(resume == null ? {} : { resume }),
        ...(cwd == null ? {} : { cwd })
    };
}

/* A session goes on only in the CLI that started it, so a resume without one names nothing to run. */
export function refuseResumeWithout(resume: string | null | undefined, provider: AgentKind | null): void {
    if (resume != null && provider === null) {
        throw new ActionRefusal('missing-provider', 'Name the CLI whose session goes on.');
    }
}
