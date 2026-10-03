import {
    isCanvasView,
    type AgentKind,
    type ContextSource,
    type AgentStatus,
    type BrowserDriveAction,
    type DiagramContent,
    type GitDiffResult,
    type LaunchConfigKind,
    type LaunchStartResult,
    type LaunchStatus,
    type ProjectCanvasView,
    type ProjectContent,
    type RuntimeMode,
    type ModelSelection,
    type Worktree,
    type WorktreeMergePayload,
    type WorktreeMergeResult
} from '@ruimte/contracts';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { z } from 'zod';
import type { DriveOutcome, ShotOutcome } from '../browser/drive.ts';
import type { ComputerUse } from '../computer/computer-use.ts';
import type { DeviceDriver } from '../devices/agent-driver.ts';
import type { Notice } from '@ruimte/agents/messages/notice-store';
import type { NoticeDelivery } from '../context/notices.ts';
import type { PlanStore } from '../plans/plan-store.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { HiddenAgentStore } from '../agents/hidden-agents.ts';
import type { ProjectMutation } from '../projects/project-store.ts';
import { field } from '@ruimte/agents/context/refusal';
import type { ChatRequests } from '@ruimte/agents/tasks/waiting-child';
import type { TaskVerbs } from '@ruimte/agents/tasks/wiring';
import {
    REVISION_FLAG,
    VerbRefusal,
    createVerbRegistry,
    lengthOf,
    orNote,
    type Action as RegistryAction,
    type Noun as RegistryNoun,
    type Verb as RegistryVerb,
    type VerbEntry as RegistryVerbEntry
} from '@ruimte/agents/context/verb';

// The verbs reach the one sanitizer and the registry through the toolkit they already import.
export { field } from '@ruimte/agents/context/refusal';
export {
    DRY_RUN_FLAG,
    DRY_RUN_PREVIEW,
    REVISION_FLAG,
    VerbRefusal,
    lengthOf,
    orNote,
    requiredField,
    type ContextVerb,
    type VerbHelp
} from '@ruimte/agents/context/verb';

/* A worktree a verb asks for: a new branch named after a title, or the branch it was given. */
export type WorktreeWant = { fresh: string } | { branch: string };

/* What a verb reaches the daemon through; an interface so a test can hand in a store of its own. */
export interface CanvasHost {
    hiddenAgents?: HiddenAgentStore;
    locate(id: string): IndexedPlace | null;
    read(projectId: string): Promise<ProjectContent>;
    /* The rev of the project file; read it before the content, so a write in between only makes it older. */
    revision(projectId: string): Promise<number>;
    /* A document that moved past `expectedRev` refuses with `rev-conflict` and writes nothing. */
    mutate<T>(projectId: string, apply: (content: ProjectContent) => ProjectMutation<T> | Promise<ProjectMutation<T>>, expectedRev?: number): Promise<T>;
    /* The worktrees of the repository the folder is in; empty when it is not in one. */
    worktreePaths(folder: string): Promise<string[]>;
    /* The local branches of the repository the folder is in; null when it is in none. */
    branchesOf(folder: string): Promise<string[] | null>;
    /*
     * A worktree under the machine's worktrees folder, made from HEAD when the branch is new. `fresh`
     * is always a new one, on the first free branch after that name; `branch` takes that branch and
     * may answer a worktree it already has, unless that one was made for another node.
     */
    addWorktree(folder: string, want: WorktreeWant, projectId: string): Promise<{ worktree: Worktree; created: boolean }>;
    /* Writes the node a worktree was made for into the register, once the node exists. */
    claimWorktree(folder: string, path: string, nodeId: string): Promise<void>;
    /* Takes back a worktree this call made, when the write it was made for is refused. */
    removeWorktree(folder: string, path: string): Promise<unknown>;
    /* The widest mode an agent this node opens may run in: its own, as far as the daemon knows it. */
    modeOf(nodeId: string): RuntimeMode;
    /* The CLI and the account the agent of a node runs under; null for a node that runs none. */
    accountOf?(nodeId: string): NodeAccount | null;
    /* The mode a person picked for terminal agents, from the clients connected now; undefined with none. */
    terminalModePreference(): RuntimeMode | undefined;
    /* The agent CLIs this machine has; a verb that starts one refuses the rest by name. */
    installedAgents(): Promise<AgentKind[]>;
    /* Holds the first prompt of a node against its id until the session or the chat for it is made. */
    holdPrompt(projectId: string, nodeId: string, prompt: string): Promise<void>;
    /* Owes the start of an agent node's chat or terminal, which the daemon makes whether or not a client shows the node. */
    startAgent(start: AgentStart): Promise<void>;
    /* How deep in the chain of agents opening agents this node sits; 0 for one a person opened. */
    depthOf(nodeId: string): number;
    /* The agent nodes this caller has opened and not lost, which is what caps one caller in a loop. */
    openedCount(callerId: string): number;
    /* Writes down who made a node, outside the project and across a restart. */
    recordMade(record: { projectId: string; nodeId: string; openedBy: string; depth: number; agent: boolean; ceiling?: RuntimeMode }): Promise<void>;
    /* Who made a node, or null for one a person made; what `node delete` asks before it removes one. */
    madeBy(nodeId: string): string | null;
    /* Whether this machine lets an agent remove a view it did not make (`agentsDeleteAnyView` in `endpoint.json`). */
    agentsDeleteAnyView(): boolean;
    /* Tells every client to show this view of this project; false when nobody had it on screen to tell. */
    showView(projectId: string, viewId: string, by: string): boolean;
    /* Ends the shell or the CLI behind a node; a canvas that is removed takes its sessions with it. */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
    alert(nodeId: string, text: string): void;
    /* Puts a message in front of another node's agent, and says whether it landed or is waiting. */
    notify(notice: Omit<Notice, 'createdAt'>): Promise<NoticeDelivery>;
    /* Replaces the diagram of a view, whether or not anyone has its project open, and answers the new rev. */
    writeDiagram(projectId: string, viewId: string, content: DiagramContent): Promise<number>;
    /* The tasks a chat gives the nodes it opens with `--task`, kept by the daemon outside the project. */
    tasks: TaskHost;
    /* The plans of the caller's own chat, kept beside its record. */
    plans: Pick<PlanStore, 'read' | 'create' | 'apply' | 'delete'>;
    /* Reading and merging the worktrees of the project's repository; a host without git has none. */
    worktrees?: WorktreeHost;
    /* Driving the page under a browser node, wherever that page is open; absent on a host without one. */
    browsers?: BrowserDriveHost;
    /* What runs in an agent node now, which is what an operation of `agent` or `team` is read from. */
    agents?: AgentStateHost;
    /* What the chats of agent nodes ask and wait on, which `answer` reaches. */
    requests?: ChatRequestHost;
    /* Operating the apps of this machine through its helper; absent on a host without one. */
    computer?: ComputerHost;
    /* Seeing and operating the device under a device node; absent on a host without devices. */
    devices?: DeviceDriveHost;
    /* What a person linked into a session, which `list` and `read` answer with. */
    context?: ContextHost;
    /* The launches of a project, as an agent may see and run them; absent on a host that runs none. */
    launches?: LaunchHost;
}

/* A launch of a project as an agent sees it: what it is, whether a person approved it here, and what runs of it now. */
export interface LaunchReading {
    launchId: string;
    name: string;
    kind: LaunchConfigKind;
    /* A group counts as approved once every launch it starts is. */
    approved: boolean;
    url: string | null;
    port: number | null;
    members: string[];
    /* Null for one that has not run since the daemon started, and for a group. */
    status: LaunchStatus | null;
}

/*
 * The launches of a project. Every start through here is an agent's, so only a launch a person
 * approved on this machine starts, and a stop is Ctrl+C and then SIGTERM, never a kill.
 */
export interface LaunchHost {
    list(projectId: string): Promise<LaunchReading[]>;
    /* The screen and scrollback of the launch's terminal; null when it has not run since the daemon started. */
    text(projectId: string, launchId: string): Promise<string | null>;
    start(projectId: string, launchId: string, restart: boolean): Promise<LaunchStartResult>;
    /* How many of its launches ran and are being stopped. */
    stop(projectId: string, launchId: string): Promise<number>;
}

export interface ContextHost {
    list(targetId: string): Pick<ContextSource, 'id' | 'kind' | 'title'>[];
    /* One linked source as text; a source it cannot answer throws a `CodedError` that says why. */
    read(targetId: string, sourceId: string, tail: number | null, subagent: string | null): Promise<string>;
}

/*
 * What runs in an agent node as far as the daemon knows it: a start still owed in the outbox, the
 * status its hooks or its chat report, ended along with the node that opened it, a chat at rest
 * whose last turn was stopped before it finished, or nothing at all.
 */
export type AgentState = 'owed' | 'ended' | 'stopped' | 'none' | AgentStatus;

export interface AgentStateHost {
    stateOf(nodeId: string): Promise<AgentState>;
    /* The node that started this one as an agent through agent or team; null for any other node. */
    startedBy(nodeId: string): string | null;
    /* Stops the turn a chat node is working on; false when it is no chat or has no turn going. */
    cancelTurn(nodeId: string): boolean;
}

/* The questions and approvals a chat node asks, as its own thread holds them. */
export type ChatRequestHost = ChatRequests;

/*
 * What a verb reaches a page through. One door for both kinds of page: one this machine runs itself
 * and one a client holds in a <webview>. Null is the answer when nobody has the page open at all.
 */
export interface BrowserDriveHost {
    drive(browserId: string, action: BrowserDriveAction): Promise<DriveOutcome | null>;
    /* Writes a png of the page under the machine's own folder; null when nobody has the page open. */
    shot(browserId: string): Promise<ShotOutcome | null>;
}

/* What an agent's `computer` call reaches: the setting, and the rules every call passes before the helper acts. */
export type ComputerHost = Pick<ComputerUse, 'enabled' | 'apps' | 'operate' | 'treeView'>;

/* What an agent's `device` call reaches: the device a node points at, a shot of it and the gestures on it. */
export type DeviceDriveHost = Pick<
    DeviceDriver,
    'find' | 'screen' | 'abilities' | 'tree' | 'shot' | 'tap' | 'tapElement' | 'swipe' | 'button' | 'type' | 'launch'
>;

export interface WorktreeHost {
    /* Every worktree of the repository a folder is in, with the work each holds. */
    list(folder: string): Promise<Worktree[]>;
    /* Everything a worktree holds over where it was made from, uncommitted and untracked files included. */
    diff(path: string, base: string | undefined): Promise<GitDiffResult>;
    /*
     * Merges a worktree under the limits an agent is held to: its loose work committed first, only
     * into a clean checkout, a conflict taken back and refused, no agent stopped and nothing removed.
     */
    merge(payload: Omit<WorktreeMergePayload, 'actionId' | 'stopAgent' | 'commitFirst' | 'into' | 'remove'>): Promise<WorktreeMergeResult>;
}

export type TaskHost = TaskVerbs;

export interface NodeAccount {
    kind: AgentKind;
    // Absent is the CLI's default account.
    account?: string;
}

export interface AgentStart {
    projectId: string;
    nodeId: string;
    /* The node that ran the verb; a chat hands its permission mode on to a chat it opens. */
    openedBy: string;
    node: 'chat' | 'terminal';
    provider: AgentKind;
    /* Where a client mounting the node would start it: its own directory, else the project folder. */
    cwd: string | null;
    /* The mode `--mode` asked for, and for a terminal the mode it was written down with; absent leaves a chat to the daemon. */
    runtimeMode?: RuntimeMode;
    selection?: ModelSelection;
    /* The account it starts under: its opener's, when that runs the same CLI. */
    account?: string;
}

export interface VerbCall {
    /* The session or chat id the bearer token speaks for. */
    caller: string;
    host: CanvasHost;
    /* What `--revision` named: the rev of the project file the caller read before it decided on this write. */
    expectedRevision?: number;
}

export type Verb = RegistryVerb<VerbCall>;

export type Action = RegistryAction<VerbCall>;

export type Noun = RegistryNoun<VerbCall>;

export type VerbEntry = RegistryVerbEntry<VerbCall>;

export const { defineVerb, defineAction, defineNoun, defineHelp, dryRunVerbNames, dryRunLine } = createVerbRegistry<VerbCall>({ cli: 'ruimte-context' });

/* Two things an agent keeps mixing up, so the line is in the root of `help` and in the detail of each verb it is about. */
export const SCOPE_LINE =
    'scope\tlist and read are what a person linked into this session; node, link, browser, device, view, task, agent, team, done, notify, alert, answer, worktree and launches are the project itself, and plan is the chat of the caller, computer the apps of this machine\ta node you add is readable through read only once a line joins it to you, and a terminal or a chat only once that line runs from it into you';

/* What `help` says of the last row of every list of the project file. */
export const REVISION_ROW = `revision\tThe last row is revision and the revision of the project file; --${REVISION_FLAG} on a write that follows refuses it once the project moved on`;

/* What `help` says of `--revision` on every verb that writes the project file. */
export const REVISION_LINE = `flag\t--${REVISION_FLAG} N\toptional\tThe revision of the project a list printed, which this call was decided on; refused with rev-conflict and nothing written once the project moved on`;

/* What a dry run calls the node it is not making, so the edge it names still has two ends; a team
   puts the role's title in it, since its rows are otherwise the same for two roles of one CLI. */
export const newNode = (name = 'new node'): string => `<${name}>`;

export const NEW_NODE = newNode();

/* The project the caller is in, from the index of every known project: an open one would miss an agent whose person switched away. */
export const placeOf = (call: VerbCall): IndexedPlace => {
    const place = call.host.locate(call.caller);
    if (!place) {
        throw new VerbRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }
    return place;
};

export { MAX_TITLE_LENGTH } from '@ruimte/actions';

/* Said wherever a verb takes a name, since neither half of it can be read off the canvas. */
export const TITLE_LINE = `titles\tA name is at most ${MAX_TITLE_LENGTH} characters and is never unique: two nodes may carry the same one, and an id is what names a node`;

/* One title schema for every verb that takes one, so the same limit is refused in the same sentence. */
export const titleField = (name: string, needs: string): z.ZodString =>
    z
        .string({ error: needs })
        .trim()
        .min(1, needs)
        .max(MAX_TITLE_LENGTH, {
            error: (issue) => `${name} is ${lengthOf(issue.input)} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        });

export const canvasLines = (content: ProjectContent): string[] =>
    orNote(
        content.views.filter(isCanvasView).map((view) => `canvas\t${view.id}\t${field(view.name)}`),
        'This project has no canvas; a node only ever lands on one'
    );

/* What `node new`, `agent` and `team` say when the caller is on no canvas: where the node goes is not all that changes. */
export const OPENING_OFF_CANVAS =
    'A node opens on a canvas; name which one with --view (ruimte-context view list lists them). A line only joins two nodes of one canvas, so the edge column shows -';

/* The canvas an id names, refused with the canvases there are when it names none. */
export const canvasNamed = (content: ProjectContent, viewId: string): ProjectCanvasView => {
    const named = content.views.find((candidate) => candidate.id === viewId);
    if (!named || !isCanvasView(named)) {
        throw new VerbRefusal('not-a-canvas', `${viewId} is not a canvas of this project`, canvasLines(content));
    }
    return named;
};

/*
 * The canvas a verb works on: the one `--view` names, else the one the caller is a node on. Ids
 * only, never names, so an agent cannot aim at a canvas by naming something else after it.
 */
export const canvasFor = (
    content: ProjectContent,
    place: IndexedPlace,
    view: string | undefined,
    offCanvas = 'This session is not on a canvas; name one with --view'
): ProjectCanvasView => {
    if (view !== undefined) {
        return canvasNamed(content, view);
    }
    const own = place.canvasId === null ? undefined : content.views.find((candidate) => candidate.id === place.canvasId);
    if (!own || !isCanvasView(own)) {
        throw new VerbRefusal('view-required', offCanvas, canvasLines(content));
    }
    return own;
};
