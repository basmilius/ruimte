import { ToolRefusal, field, lengthOf, orNote } from '@adecore/agents/context';
import type { AgentLineageStore, Notice } from '@adecore/agents/coordination';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import {
    isCanvasView,
    isHiddenCanvasView,
    type AgentKind,
    type ModelSelection,
    type ProjectCanvasView,
    type ProjectContent,
    type RuntimeMode
} from '@ruimte/contracts';
import { z } from 'zod';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { CheckoutHost } from '../git/worktree-host.ts';
import type { HiddenAgentStore } from '../projects/hidden-agents.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { ProjectMutation, ProjectStore } from '../projects/project-store.ts';
import { referencesDirectly } from '../projects/references.ts';
import type { UntrustedFolders } from '../projects/untrusted.ts';
import type { StartClaims } from './start-claims.ts';

// The tools and actions reach the one sanitizer through the module they already import.
export { DRY_RUN_PREVIEW, field, lengthOf, orNote, requiredField } from '@adecore/agents/context';

/* Where a message went: onto a screen now, into a turn the chat is owed, or into a queue it waits in. */
export interface NoticeDelivery {
    at: 'now' | 'waiting';
    detail: string;
    /* Whether the receiving chat is owed a turn on this message; the daemon's outbox is what opens it. */
    wake: boolean;
    /* Whether the message may join the turn the chat is running. */
    inTurn?: boolean;
}

/*
 * What a tool reaches the daemon through: the daemon's own services, each typed by what a tool may
 * call of it. An interface so a test can hand in a store of its own. These are the fields every tool
 * stands on; each agent feature adds the ones it needs by declaring them on this interface beside its
 * descriptor (`src/agent-features`), and builds them in the same file.
 */
export interface CanvasHost {
    projects: ProjectHost;
    hiddenAgents?: HiddenAgentStore;
    /* What a retried `agent_start` with the same `request_id` answers with; absent, a request id is ignored. */
    startClaims?: StartClaims;
    lineage: LineageHost;
    checkouts: CheckoutHost;
    machine: MachineHost;
    /* Ends the shell or the CLI behind a node; a canvas that is removed takes its sessions with it. */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
    messages: MessageHost;
    /* What came from another machine and so never runs on the configuration of its files; absent on a host that works with none. */
    untrusted?: Pick<UntrustedFolders, 'node' | 'inFolder' | 'fromPeer'>;
    /* When a person's snooze on a node ends, in epoch milliseconds; absent on a host without snoozes. */
    snoozes?: { until(nodeId: string): number | null };
}

/*
 * The projects of this machine; every write of a tool goes through `mutate`, which refuses a document that
 * moved past `expectedRev`. A tool changes the content only; what a move of a view between projects reads
 * besides is the store's own.
 */
export type ProjectHost = Pick<ProjectStore, 'locate' | 'read' | 'revision' | 'showView' | 'machineOfNode'> & {
    mutate<T>(projectId: string, apply: (content: ProjectContent) => ProjectMutation<T> | Promise<ProjectMutation<T>>, expectedRev?: number): Promise<T>;
};

/* Who made a node and how deep it sits, kept under `$RUIMTE_HOME` and across a restart, never in the project an agent can rewrite. */
type LineageHost = Pick<AgentLineageStore, 'depthOf' | 'madeBy' | 'put'>;

/* The machine's switches a tool is held to; `agentsDeleteAnyView` lets an agent remove a view it did not make,
   and `nodeSize` is the size a person on the machine gave new nodes of a kind. */
export type MachineHost = Pick<EndpointIdentity, 'agentsDeleteAnyView' | 'nodeSize'>;

/* What starting an agent node takes. */
export interface AgentStartHost {
    /* The agent CLIs this machine has; a tool that starts one refuses the rest by name. */
    installedAgents(): Promise<AgentKind[]>;
    /* Holds the first prompt of a node against its id until the session or the chat for it is made; a chat hears `brief` beside it. */
    holdPrompt(projectId: string, nodeId: string, prompt: string, brief?: string): Promise<void>;
    /* Owes the start of an agent node's chat or terminal, which the daemon makes whether or not a client shows the node. */
    startAgent(start: AgentStart): Promise<void>;
    /* The widest mode an agent this node opens may run in: its own, as far as the daemon knows it. */
    modeOf(nodeId: string): RuntimeMode;
    /* The CLI and the account the agent of a node runs under; null for a node that runs none. */
    accountOf?(nodeId: string): NodeAccount | null;
    /* The accounts of a CLI a project turned off, which a child of that project never inherits. */
    accountsOff?(projectId: string, kind: AgentKind): readonly string[];
    /* The mode a person picked for terminal agents, from the clients connected now; undefined with none. */
    terminalModePreference(): RuntimeMode | undefined;
    /* The model and options a person picked for new chats of this CLI, from the clients connected now; undefined with none. */
    preferredSelection(kind: AgentKind): ModelSelection | undefined;
    /* The agent nodes this caller has opened and not lost, which is what caps one caller in a loop. */
    openedCount(callerId: string): number;
}

/* What one node says to another, or to a person. */
export interface MessageHost {
    alert(nodeId: string, text: string): void;
    /* Puts a message in front of another node's agent, and says whether it landed or is waiting. */
    notify(notice: Omit<Notice, 'createdAt'>): Promise<NoticeDelivery>;
}

export function referencedBy(host: Pick<CanvasHost, 'context'>, caller: string, id: string): boolean {
    return referencesDirectly(host.context?.referenced?.(caller) ?? [], id);
}

export interface NodeAccount {
    kind: AgentKind;
    // Absent is the CLI's default account.
    account?: string;
}

export interface AgentStart {
    projectId: string;
    nodeId: string;
    /* The node that called the tool; a chat hands its permission mode on to a chat it opens. */
    openedBy: string;
    node: 'chat' | 'terminal';
    provider: AgentKind;
    /* Where a client mounting the node would start it: its own directory, else the project folder. */
    cwd: string | null;
    /* The mode the field `mode` asked for, and for a terminal the mode it was written down with; absent leaves a chat to the daemon. */
    runtimeMode?: RuntimeMode;
    selection?: ModelSelection;
    /* The account it starts under: its opener's, when that runs the same CLI. */
    account?: string;
}

/* What a call of an agent carries, whether it came in as a tool call or as an action an agent caused. */
export interface AgentCall {
    /* The session or chat id the bearer token speaks for. */
    caller: string;
    host: CanvasHost;
    /* The other project the field `project` named, as `runTool` checked it; absent, the call works in the caller's own. */
    reached?: IndexedPlace;
    /* The rev of the project file the caller read before it decided on this write. */
    expectedRevision?: number;
}

/* The snooze on a node as the actions hand it on: an ISO time, or null for none. */
export function snoozedAt(host: Pick<CanvasHost, 'snoozes'>, nodeId: string): string | null {
    const until = host.snoozes?.until(nodeId) ?? null;
    return until === null ? null : new Date(until).toISOString();
}

/* What a dry run calls the node it is not making, so the edge it names still has two ends; a team
   puts the role's title in it, since its rows are otherwise the same for two roles of one CLI. */
export function newNode(name = 'new node'): string {
    return `<${name}>`;
}

export const NEW_NODE = newNode();

/*
 * The project the call works in: the one `project` reached, else the caller's own, from the index
 * of every known project, since an open one would miss an agent whose person switched away.
 */
export function placeOf(call: AgentCall): IndexedPlace {
    if (call.reached !== undefined) {
        return call.reached;
    }
    const place = call.host.projects.locate(call.caller);
    if (!place) {
        throw new ToolRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }
    return place;
}

export { MAX_TITLE_LENGTH } from '@ruimte/actions';

/* One title schema for every tool that takes one, so the same limit is refused in the same sentence. */
export function titleField(name: string, needs: string): z.ZodString {
    return z
        .string({ error: needs })
        .trim()
        .min(1, needs)
        .max(MAX_TITLE_LENGTH, {
            error: (issue) => `${name} is ${lengthOf(issue.input)} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        });
}

export function yesNo(value: boolean): string {
    return value ? 'yes' : 'no';
}

export function canvasLines(content: ProjectContent): string[] {
    return orNote(
        content.views
            .filter((view): view is ProjectCanvasView => isCanvasView(view) && !isHiddenCanvasView(view))
            .map((view) => `canvas\t${view.id}\t${field(view.name)}`),
        'This project has no canvas; a node only ever lands on one'
    );
}

/* What `node_new`, `agent_start` and `agent_team` say when the caller is on no canvas: where the node goes is not all that changes. */
export const OPENING_OFF_CANVAS =
    'A node opens on a canvas; name which one with view (view_list lists them). A line only joins two nodes of one canvas, so the edge column shows -';

/* The canvas an id names, refused with the canvases there are when it names none. */
export function canvasNamed(content: ProjectContent, viewId: string): ProjectCanvasView {
    const named = content.views.find((candidate) => candidate.id === viewId);
    // The canvas of another machine's nodes is that machine's to draw, so it answers as one that does not exist.
    if (!named || !isCanvasView(named) || isHiddenCanvasView(named)) {
        throw new ToolRefusal('not-a-canvas', `${viewId} is not a canvas of this project`, canvasLines(content));
    }
    return named;
}

/*
 * The canvas a tool works on: the one `view` names, else the one the caller is a node on. Ids
 * only, never names, so an agent cannot aim at a canvas by naming something else after it.
 */
export function canvasFor(
    content: ProjectContent,
    place: IndexedPlace,
    view: string | undefined,
    offCanvas = 'This session is not on a canvas; name one with view'
): ProjectCanvasView {
    if (view !== undefined) {
        return canvasNamed(content, view);
    }
    const own = place.canvasId === null ? undefined : content.views.find((candidate) => candidate.id === place.canvasId);
    if (!own || !isCanvasView(own)) {
        throw new ToolRefusal('view-required', offCanvas, canvasLines(content));
    }
    return own;
}
