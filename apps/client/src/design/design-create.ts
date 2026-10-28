import { designPlaces, type ProviderInfo } from '@ruimte/contracts';
import { agentNodeOptions, type AgentSession } from '@/agents/nodes';
import type { Point } from '@/canvas/math';
import { freeDesignFolder } from '@/design/design-folder';
import { designFoldersOnDisk } from '@/design/design-read';
import type { StoreApi } from 'zustand';
import type { CanvasState } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId, useEndpointId } from '@/state/keys';
import { shownFolderOf, useProject } from '@/state/project';
import { useMachineAnswers } from '@/transport/features';

/* Whether a design is offered at all, in every place that adds one: a project without a folder has nowhere to keep its pages. */
export function useDesignOffered(): boolean {
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    // The request came with designs, so a machine without it would keep the node and know nothing of its folder.
    const supported = useMachineAnswers(useEndpointId(), 'artifact.saveFolder');
    return hasFolder && supported;
}

/* "Design", then "Design 2", over every design of the project, a view of its own or a node on a canvas. */
function freeDesignName(names: readonly string[]): string {
    const taken = new Set(names);
    let name = 'Design';
    for (let number = 2; taken.has(name); number++) {
        name = `Design ${number}`;
    }
    return name;
}

/*
 * A design node at `at` on the canvas in front, its chat on the CLI a person picked and its folder one no
 * other design of the project has, on disk or in the document. A person names it, so the first prompt and
 * the CLI's own name for the session leave its name alone, as they leave a design view's.
 */
export async function addDesignNode(canvas: StoreApi<CanvasState>, provider: ProviderInfo, at: Point, session: AgentSession = {}): Promise<string | null> {
    // Read before the document, since the list may change while the disk answers.
    const onDisk = await designFoldersOnDisk(currentEndpointId(), shownFolderOf(useProject.getState().current));
    const views = useDocument.getState().exportViews();
    const title = freeDesignName(designPlaces(views).map((design) => design.name));
    const id = canvas.getState().addNode('design', at, { ...agentNodeOptions('chat', provider, session), title, path: freeDesignFolder(views, title, onDisk) });
    if (id !== null) {
        canvas.getState().renameNode(id, title, 'user');
    }
    return id;
}
