import {
    isCanvasView,
    isHiddenCanvasView,
    type AgentInfo,
    type AgentKind,
    type ChatDelivery,
    type ChatInfo,
    type ContextSource,
    type AgentStatus,
    type BrowserDriveAction,
    type ChatAttachment,
    type ChatItem,
    type ChatForkResult,
    type ChatVisual,
    type CliVersion,
    type GitDiffResult,
    type LaunchConfig,
    type LaunchConfigEntry,
    type LaunchConfigKind,
    type LaunchStartResult,
    type LaunchStatus,
    type ProjectCanvasView,
    type ProjectContent,
    type RegistryCatalog,
    type Routine,
    type RoutineListResult,
    type RoutineRunNowResult,
    type UsageLimitsSnapshot,
    type RuntimeMode,
    type ModelSelection,
    type VisualAppearance,
    type VisualHeight,
    type VisualLayout,
    type Worktree,
    type WorktreeMergePayload,
    type WorktreeMergeResult
} from '@ruimte/contracts';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { z } from 'zod';
import type { DriveOutcome, ShotOutcome } from '../browser/drive.ts';
import type { ComputerUse } from '../computer/computer-use.ts';
import type { ProposalAnswer, ProposalAsk } from '../projects/project-proposals.ts';
import type { SecretAsk, SecretOutcome } from '../secrets/secret-requests.ts';
import type { DeviceDriver } from '../devices/agent-driver.ts';
import type { DatabaseAgentHost } from '../database/agent-databases.ts';
import { referencesDirectly, type Reference } from '../context/references.ts';
import type { AgentLanguage } from '../language/agent-language.ts';
import type { AgentLineageStore, Notice, ChatRequests, TaskVerbs } from '@adecore/agents/coordination';
import type { ContextReading } from '../context/context-store.ts';
import type { NoticeDelivery } from '../context/notices.ts';
import type { PlanStore } from '../plans/plan-store.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { HiddenAgentStore } from '../agents/hidden-agents.ts';
import type { AgentForkInput, ForkOpener } from '../chat/fork.ts';
import type { StartClaims } from '../actions/start-claims.ts';
import type { VisualPreview } from '../visuals/renderer.ts';
import type { StartRemoteAgentPayload } from '../outbox/outbox.ts';
import type { ProjectMutation, ProjectStore } from '../projects/project-store.ts';
import type { DiagramStore } from '../projects/diagram-store.ts';
import type { DrawingStore } from '../projects/drawing-store.ts';
import type { ReachHost } from './reach.ts';
import type { SnoozeStore } from '../push/snoozes.ts';
import type { TemplateStore } from '../templates/template-store.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { UntrustedFolders } from '../peering/untrusted.ts';
import type { Artifacts } from '../artifacts/artifacts.ts';
import {
    field,
    REVISION_FLAG,
    VerbRefusal,
    createVerbRegistry,
    lengthOf,
    orNote,
    type Action as RegistryAction,
    type Noun as RegistryNoun,
    type Verb as RegistryVerb,
    type VerbEntry as RegistryVerbEntry
} from '@adecore/agents/context';

// The verbs reach the one sanitizer and the registry through the toolkit they already import.
export { field } from '@adecore/agents/context';
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
} from '@adecore/agents/context';

/* A worktree a verb asks for: a new branch named after a title, or the branch it was given. */
export type WorktreeWant = ({ fresh: string } | { branch: string }) & { base?: string };

/* What an agent may read of the CLIs a person installs and updates in Settings, Providers. */
export interface ProviderInstallHost {
    catalog(refresh: boolean): Promise<RegistryCatalog>;
    versions(refresh: boolean): Promise<CliVersion[]>;
}

/* The plan windows the CLIs of this machine reported, as last read; a verb only reports them and never asks again. */
interface PlanLimitsHost {
    snapshot(): UsageLimitsSnapshot;
    now(): number;
}

/*
 * What a verb reaches the daemon through: the daemon's own services, each typed by what a verb may
 * call of it, so a new capability is a method of its service and a name here. An interface so a
 * test can hand in a store of its own.
 */
export interface CanvasHost {
    projects: ProjectHost;
    hiddenAgents?: HiddenAgentStore;
    /* What a retried `agent --request-id` answers with; absent, a request id is ignored. */
    startClaims?: StartClaims;
    lineage: LineageHost;
    starts: AgentStartHost;
    checkouts: CheckoutHost;
    machine: MachineHost;
    /* Ends the shell or the CLI behind a node; a canvas that is removed takes its sessions with it. */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
    messages: MessageHost;
    /* Replaces the diagram of a view, whether or not anyone has its project open, and answers the new rev. */
    diagrams: Pick<DiagramStore, 'write'> & Partial<Pick<DiagramStore, 'read'>>;
    /* Reads and edits the drawing of a view, whether or not anyone has its project open; absent on a host that keeps none. */
    drawings?: Pick<DrawingStore, 'read' | 'edit'>;
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
    /* The thread of a chat, loaded or only on disk, for a reader that does not attach and wakes nothing; absent on a host without chats. */
    chatThreads?: ChatThreadHost;
    /* What a terminal agent does, which Voice reads where a window would read its status. */
    terminals?: TerminalAgentHost;
    /* Prompting or clearing a chat, which only Voice does through an action; an agent sends through `notify`. */
    chatPrompts?: ChatPromptHost;
    /* Forks a chat an agent opened into a child of that agent; absent on a host that forks none. */
    forks?: AgentForkHost;
    /* Operating the apps of this machine through its helper; absent on a host without one. */
    computer?: ComputerHost;
    /* Seeing and operating the device under a device node; absent on a host without devices. */
    devices?: DeviceDriveHost;
    /* What a person linked into a session, which `list` and `read` answer with. */
    context?: ContextHost;
    /* The launches of a project, as an agent may see and run them; absent on a host that runs none. */
    launches?: LaunchHost;
    /* The pages the caller's own chat shows above its replies; absent on a host that keeps none. */
    visuals?: VisualHost;
    /* The images and models the caller's own chat holds from its agent; absent on a host that keeps none. */
    agentImages?: AgentImageHost;
    /* The databases of the caller's project as an agent may reach them; absent on a host without them. */
    databases?: DatabaseAgentHost;
    /* The project's running language servers as an agent may ask them; absent on a host without them. */
    language?: LanguageAgentHost;
    /* The ACP registry and the versions of the agent CLIs, which an agent reads and only a person installs from; absent on a host without them. */
    providerInstalls?: ProviderInstallHost;
    /* What the plans of this machine's accounts have left; absent on a host that reads none. */
    planLimits?: PlanLimitsHost;
    /* The cards in which an agent asks a person for a launch's secret; absent on a host that keeps none. */
    secrets?: SecretHost;
    /* The cards in which an agent in Chats suggests a project; absent on a host that keeps none. */
    proposals?: ProposalHost;
    /* The machines this machine can give tasks to; absent on a host that links to none. */
    remote?: RemoteAgentHost;
    /* What came from another machine and so never runs on the configuration of its files; absent on a host that works with none. */
    untrusted?: Pick<UntrustedFolders, 'node' | 'inFolder' | 'fromPeer'>;
    /* When a person's snooze on a node ends, in epoch milliseconds; absent on a host without snoozes. */
    snoozes?: Pick<SnoozeStore, 'until'>;
    /* The Output of the caller's project, where results that should stay are kept; absent on a host that keeps none. */
    artifacts?: Pick<Artifacts, 'publish' | 'list' | 'read'>;
    /* The routines of the caller's project as an agent may reach them; absent on a host that keeps none. */
    routines?: RoutineAgentHost;
    /* The editor templates an agent lists and adds to; absent on a host that keeps none. */
    templates?: Pick<TemplateStore, 'listForAgent' | 'addByAgent' | 'checkAgentAdd'>;
    /* The other open projects an agent may reach with `--project`; absent on a host that reaches none. */
    reach?: ReachHost;
}

/*
 * The routines of a project as an agent reaches them. Its save never approves and is narrowed to its
 * mode ceiling, with the caller written down as its maker; a run starts only one a person approved.
 */
export interface RoutineAgentHost {
    list(projectId: string): Promise<RoutineListResult>;
    /* `shared` places a new routine; one that exists stays in the file it is in. */
    save(projectId: string, routine: Routine, ceiling: RuntimeMode, caller: string, shared: boolean): Promise<{ routine: Routine; shared: boolean }>;
    pause(projectId: string, routineId: string): Promise<void>;
    resume(projectId: string, routineId: string): Promise<void>;
    runNow(projectId: string, routineId: string): Promise<RoutineRunNowResult>;
}

/* A chat's items and info as they stand, whether its CLI runs or the chat is only a record; null for no chat of that id. */
interface ChatThreadHost {
    items(chatId: string): Promise<ChatItem[] | null>;
    info?(chatId: string): Promise<ChatInfo | null>;
}

/* A prompt into a chat the machine runs, the way a person's composer sends one; Voice prompts no chat that is only a record. */
interface ChatPromptHost {
    running(chatId: string): boolean;
    send(chatId: string, text: string, delivery: ChatDelivery | undefined): Promise<{ queued: boolean; turnId: string }>;
    /* The daemon's own `chat.clear`, stopping a turn in the way: whoever calls it asked the person first. */
    clear(chatId: string): Promise<void>;
}

/* The agent a terminal runs as its hooks last told it; null for a plain shell, undefined for no session of that id. */
interface TerminalAgentHost {
    agentOf(sessionId: string): AgentInfo | null | undefined;
}

/*
 * The projects of this machine; every write of a verb goes through `mutate`, which refuses a document that
 * moved past `expectedRev`. A verb changes the content only; what a move of a view between projects reads
 * besides is the store's own.
 */
export type ProjectHost = Pick<ProjectStore, 'locate' | 'read' | 'revision' | 'showView' | 'machineOfNode'> & {
    mutate<T>(projectId: string, apply: (content: ProjectContent) => ProjectMutation<T> | Promise<ProjectMutation<T>>, expectedRev?: number): Promise<T>;
};

/* Who made a node and how deep it sits, kept under `$RUIMTE_HOME` and across a restart, never in the project an agent can rewrite. */
type LineageHost = Pick<AgentLineageStore, 'depthOf' | 'madeBy' | 'put'>;

/* The machine's switches a verb is held to; `agentsDeleteAnyView` lets an agent remove a view it did not make,
   and `nodeSize` is the size a person on the machine gave new nodes of a kind. */
export type MachineHost = Pick<EndpointIdentity, 'agentsDeleteAnyView' | 'nodeSize'>;

/* What starting an agent node takes. */
export interface AgentStartHost {
    /* The agent CLIs this machine has; a verb that starts one refuses the rest by name. */
    installedAgents(): Promise<AgentKind[]>;
    /* Holds the first prompt of a node against its id until the session or the chat for it is made; a chat hears `brief` beside it. */
    holdPrompt(projectId: string, nodeId: string, prompt: string, brief?: string): Promise<void>;
    /* Owes the start of an agent node's chat or terminal, which the daemon makes whether or not a client shows the node. */
    startAgent(start: AgentStart): Promise<void>;
    /* The widest mode an agent this node opens may run in: its own, as far as the daemon knows it. */
    modeOf(nodeId: string): RuntimeMode;
    /* The CLI and the account the agent of a node runs under; null for a node that runs none. */
    accountOf?(nodeId: string): NodeAccount | null;
    /* The mode a person picked for terminal agents, from the clients connected now; undefined with none. */
    terminalModePreference(): RuntimeMode | undefined;
    /* The model and options a person picked for new chats of this CLI, from the clients connected now; undefined with none. */
    preferredSelection(kind: AgentKind): ModelSelection | undefined;
    /* The agent nodes this caller has opened and not lost, which is what caps one caller in a loop. */
    openedCount(callerId: string): number;
}

/* The other machines an agent may give work to, and the owing of that work. */
interface RemoteAgentHost {
    /* The machines a project is linked to; `ready` is whether this machine holds the link that lets it work in them. */
    machines(projectId: string): Array<{ machineId: string; label: string; remoteProjectId: string; ready: boolean }>;
    /* Owes the start of a task on another machine for the node that stands for it here. */
    give(projectId: string, nodeId: string, work: StartRemoteAgentPayload): Promise<void>;
}

/* The repository a project folder is in, as far as a node that starts in it goes. */
export interface CheckoutHost {
    /* The worktrees of the repository the folder is in; empty when it is not in one. */
    paths(folder: string): Promise<string[]>;
    /* The local branches of the repository the folder is in; null when it is in none. */
    branches(folder: string): Promise<string[] | null>;
    /*
     * A worktree under the machine's worktrees folder, made from HEAD when the branch is new. `fresh`
     * is always a new one, on the first free branch after that name; `branch` takes that branch and
     * may answer a worktree it already has, unless that one was made for another node.
     */
    add(folder: string, want: WorktreeWant, projectId: string): Promise<{ worktree: Worktree; created: boolean }>;
    /* Writes the node a worktree was made for into the register, once the node exists. */
    claim(folder: string, path: string, nodeId: string): Promise<void>;
    /* Takes back a worktree this call made, when the write it was made for is refused. */
    remove(folder: string, path: string): Promise<unknown>;
}

/* What one node says to another, or to a person. */
export interface MessageHost {
    alert(nodeId: string, text: string): void;
    /* Puts a message in front of another node's agent, and says whether it landed or is waiting. */
    notify(notice: Omit<Notice, 'createdAt'>): Promise<NoticeDelivery>;
}

/* Only what became of a card ever comes back; the value goes from the person's card to the store. */
export interface SecretHost {
    ask(ask: SecretAsk, waitMs?: number): Promise<{ requestId: string; outcome: SecretOutcome }>;
}

/* A suggestion makes nothing: it only raises the card, and what became of it comes back. */
interface ProposalHost {
    /* Whether the chat is a chat view of the Chats project, the only place a project is suggested from. */
    inChats(chatId: string): boolean;
    propose(ask: ProposalAsk): Promise<ProposalAnswer>;
}

export type LanguageAgentHost = Pick<
    AgentLanguage,
    'diagnostics' | 'hover' | 'definition' | 'references' | 'symbols' | 'sqlFile' | 'problems' | 'supertypes' | 'subtypes'
>;

/* `enabled` is the machine's switch that lets an agent show a new visual. */
export interface VisualHost {
    enabled(): boolean;
    writeSource?(chatId: string, name: string, html: string): Promise<string>;
    /* Refuses with the store's own code, `visual-invalid` or `visual-too-large`, and a message that says what to change. */
    publish(chatId: string, input: { title: string; html: string; maxHeight?: number; layout?: VisualLayout; heights?: VisualHeight[] }): Promise<ChatVisual>;
    list(chatId: string): Promise<ChatVisual[]>;
    remove(chatId: string, visualId: string): Promise<ChatVisual[]>;
    /* Refuses with `preview-unavailable`, `preview-timeout` or `preview-failed`; absent on a host that renders no page. */
    preview?(chatId: string, input: { html: string; width: number; appearance: VisualAppearance }): Promise<VisualPreview>;
    /* Undefined when measuring took too long or failed, which never stops a page from being shown. */
    measure?(html: string): Promise<VisualHeight[] | undefined>;
}

/* Puts an image or a model the caller's agent has of its own in the thread of its chat; the bytes arrive checked. */
interface AgentImageHost {
    attach(chatId: string, upload: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatAttachment>;
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
    /* The launches as their files hold them, which an agent's edit starts from. */
    entries(projectId: string): Promise<LaunchConfigEntry[]>;
    /* Never an approval: the launch is held until a person approves it as it stands. One that exists keeps its file. */
    save(projectId: string, launch: LaunchConfig, shared: boolean): Promise<void>;
}

export interface ContextHost {
    list(targetId: string): Pick<ContextSource, 'id' | 'kind' | 'title'>[];
    /* One linked source as text; a source it cannot answer throws a `CodedError` that says why. */
    answer(targetId: string, sourceId: string, tail: number | null, subagent: string | null): Promise<ContextReading>;
    /* A source the caller reads without a line, such as a node of the canvas a chat view names. */
    answerSource(targetId: string, source: ContextSource, tail: number | null, subagent: string | null, projectId?: string): Promise<ContextReading>;
    /* What a person pointed this agent at with `#` or `@` in its messages, read again at every call. */
    referenced?(targetId: string): Reference[];
    /* The source behind an id the caller may read, by a line, a reference or as its own child; null for any other. */
    sourceFor?(targetId: string, sourceId: string): ContextSource | null;
}

/* Whether a person pointed the caller at this very id, which lets it write and operate there as a line does. */
export function referencedBy(host: Pick<CanvasHost, 'context'>, caller: string, id: string): boolean {
    return referencesDirectly(host.context?.referenced?.(caller) ?? [], id);
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

export type ChatRequestHost = ChatRequests;

interface AgentForkHost {
    fork(input: AgentForkInput, opener: ForkOpener): Promise<ChatForkResult & { title: string }>;
}

/*
 * What a verb reaches a page through. One door for both kinds of page: one this machine runs itself
 * and one a client holds in a <webview>. Null is the answer when nobody has the page open at all.
 */
export interface BrowserDriveHost {
    drive(browserId: string, action: BrowserDriveAction): Promise<DriveOutcome | null>;
    /* Writes a png of the page under the machine's own folder; null when nobody has the page open. */
    shot(browserId: string): Promise<ShotOutcome | null>;
}

export type ComputerHost = Pick<ComputerUse, 'enabled' | 'apps' | 'operate' | 'treeView'>;

export type DeviceDriveHost = Pick<
    DeviceDriver,
    | 'list'
    | 'find'
    | 'screen'
    | 'abilities'
    | 'power'
    | 'tree'
    | 'shot'
    | 'tap'
    | 'tapElement'
    | 'swipe'
    | 'button'
    | 'type'
    | 'launch'
    | 'act'
    | 'clipboard'
    | 'record'
>;

export interface WorktreeHost {
    list(folder: string): Promise<Worktree[]>;
    /* Everything a worktree holds over where it was made from, uncommitted and untracked files included. */
    diff(path: string, base: string | undefined): Promise<GitDiffResult>;
    /*
     * Merges a worktree under the limits an agent is held to: its loose work committed first, only
     * into a clean checkout, a conflict taken back and refused, no agent stopped and nothing removed.
     */
    merge(payload: Omit<WorktreeMergePayload, 'actionId' | 'stopAgent' | 'commitFirst' | 'into' | 'remove'>): Promise<WorktreeMergeResult>;
}

type TaskHost = TaskVerbs;

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
    /* The other project `--project` named, as the route checked it; absent, the verb works in the caller's own. */
    reached?: IndexedPlace;
    /* The rev of the project file the caller read before it decided on this write. */
    expectedRevision?: number;
}

export type Verb = RegistryVerb<VerbCall>;

export type Action = RegistryAction<VerbCall>;

export type Noun = RegistryNoun<VerbCall>;

export type VerbEntry = RegistryVerbEntry<VerbCall>;

export const { defineVerb, defineAction, defineNoun, defineHelp, dryRunVerbNames, dryRunLine } = createVerbRegistry<VerbCall>({ cli: 'ruimte-context' });

/* Two things an agent keeps mixing up, so the line is in the root of `help` and in the detail of each verb it is about. */
export const SCOPE_LINE =
    'scope\tlist and read are what a person linked into this session; node, link, browser, device, view, task, agent, team, done, notify, alert, answer, worktree, launches, routine, database and language are the project itself, project list names the other open projects that --project reaches on view list, node list, link list, read, notify, agent, team and task new, while a person lets agents reach them, artifact is the Output of the project, plan, visual and chat are the chat of the caller, secret is a card in that chat for a launch, template the editor templates of the person on this machine and of the project, computer the apps of this machine\ta node you add is readable through read only once a line joins it to you, and a terminal or a chat only once that line runs from it into you; a chat view has no lines and reads and operates every node of the canvas it names with --view';

/* What a snooze means to an agent, said wherever a list prints the column. */
export const SNOOZE_LINE =
    'snoozed\tThe moment, an ISO time in UTC, until which the person put that node aside, or - for none: until then they get no alert when it waits on them, so a question or an approval from it may sit unanswered that long; it ends early once the person answered what it waited on. Only a person snoozes a node or wakes it, no verb does';

/* The snooze on a node as the actions hand it on: an ISO time, or null for none. */
export function snoozedAt(host: Pick<CanvasHost, 'snoozes'>, nodeId: string): string | null {
    const until = host.snoozes?.until(nodeId) ?? null;
    return until === null ? null : new Date(until).toISOString();
}

/* What `help` says of the last row of every list of the project file. */
export const REVISION_ROW = `revision\tThe last row is revision and the revision of the project file; --${REVISION_FLAG} on a write that follows refuses it once the project moved on`;

/* What `help` says of `--revision` on every verb that writes the project file. */
export const REVISION_LINE = `flag\t--${REVISION_FLAG} N\toptional\tThe revision of the project a list printed, which this call was decided on; refused with rev-conflict and nothing written once the project moved on`;

/* What a dry run calls the node it is not making, so the edge it names still has two ends; a team
   puts the role's title in it, since its rows are otherwise the same for two roles of one CLI. */
export function newNode(name = 'new node'): string {
    return `<${name}>`;
}

export const NEW_NODE = newNode();

/*
 * The project the verb works in: the one `--project` reached, else the caller's own, from the index
 * of every known project, since an open one would miss an agent whose person switched away.
 */
export function placeOf(call: VerbCall): IndexedPlace {
    if (call.reached !== undefined) {
        return call.reached;
    }
    const place = call.host.projects.locate(call.caller);
    if (!place) {
        throw new VerbRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }
    return place;
}

export { MAX_TITLE_LENGTH } from '@ruimte/actions';

/* Said wherever a verb takes a name, since neither half of it can be read off the canvas. */
export const TITLE_LINE = `titles\tA name is at most ${MAX_TITLE_LENGTH} characters and is never unique: two nodes may carry the same one, and an id is what names a node`;

/* One title schema for every verb that takes one, so the same limit is refused in the same sentence. */
export function titleField(name: string, needs: string): z.ZodString {
    return z
        .string({ error: needs })
        .trim()
        .min(1, needs)
        .max(MAX_TITLE_LENGTH, {
            error: (issue) => `${name} is ${lengthOf(issue.input)} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        });
}

/* A required text flag of `command`, trimmed and capped at `max` characters. */
export function textFlag(command: string, flag: string, max: number, what: string): z.ZodString {
    const needs = `${command} needs --${flag}, ${what}`;
    return z.string({ error: needs }).trim().min(1, needs).max(max, `--${flag} is at most ${max} characters`);
}

/* A verb's one argument: `needs` when it is missing or empty, `tooMany` when more follow it. */
export function oneArgument(needs: string, tooMany: string) {
    return z.tuple([z.string().min(1, needs)], { error: (issue) => (issue.code === 'too_big' ? tooMany : needs) });
}

export const VIEW_FLAG = z.string().min(1, '--view needs the id of a canvas').optional();

export const TAIL_FLAG = z.coerce
    .number({ error: '--tail needs a positive whole number' })
    .int('--tail needs a positive whole number')
    .positive('--tail needs a positive whole number')
    .optional();

/* A flag that carries JSON, refused with `message` when it does not parse. */
export function jsonFlag(message: string) {
    return z.string().transform((text, context) => {
        try {
            return JSON.parse(text) as unknown;
        } catch {
            context.addIssue({ code: 'custom', message });
            return z.NEVER;
        }
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

/* What `node new`, `agent` and `team` say when the caller is on no canvas: where the node goes is not all that changes. */
export const OPENING_OFF_CANVAS =
    'A node opens on a canvas; name which one with --view (ruimte-context view list lists them). A line only joins two nodes of one canvas, so the edge column shows -';

/* The canvas an id names, refused with the canvases there are when it names none. */
export function canvasNamed(content: ProjectContent, viewId: string): ProjectCanvasView {
    const named = content.views.find((candidate) => candidate.id === viewId);
    // The canvas of another machine's nodes is that machine's to draw, so it answers as one that does not exist.
    if (!named || !isCanvasView(named) || isHiddenCanvasView(named)) {
        throw new VerbRefusal('not-a-canvas', `${viewId} is not a canvas of this project`, canvasLines(content));
    }
    return named;
}

/*
 * The canvas a verb works on: the one `--view` names, else the one the caller is a node on. Ids
 * only, never names, so an agent cannot aim at a canvas by naming something else after it.
 */
export function canvasFor(
    content: ProjectContent,
    place: IndexedPlace,
    view: string | undefined,
    offCanvas = 'This session is not on a canvas; name one with --view'
): ProjectCanvasView {
    if (view !== undefined) {
        return canvasNamed(content, view);
    }
    const own = place.canvasId === null ? undefined : content.views.find((candidate) => candidate.id === place.canvasId);
    if (!own || !isCanvasView(own)) {
        throw new VerbRefusal('view-required', offCanvas, canvasLines(content));
    }
    return own;
}
