import type { MachineActionName, MachineInput, MachineOutput } from './client';

export type { MachineActionName, MachineActions, MachineInput, MachineOutput } from './client';

/**
 * Why a call came back without its answer. `permission-denied`: the manifest does not ask for the permission. `no-project`: no
 * project with a folder is open. `no-canvas`: no canvas is in front. `not-found`: what it names is not there. `outside-project`: a
 * path leaves the project folder. `refused`: the machine or the person said no. `limit`: too many calls in a while. `timeout`: no
 * answer in time. `unavailable`: the machine, or `server/`, cannot answer now. `failed`: anything else, with its message.
 */
export type ExtensionErrorCode =
    | 'permission-denied'
    | 'no-project'
    | 'no-canvas'
    | 'not-found'
    | 'outside-project'
    | 'refused'
    | 'limit'
    | 'timeout'
    | 'unavailable'
    | 'failed';

/**
 * What a call that can fail answers: its value, or why not. Only a wrong argument throws. A call with nothing to answer,
 * a `Result<void>`, answers `{ ok: true, value: undefined }` with the key `value` there.
 */
export type Result<Value, Code extends string = ExtensionErrorCode> = { ok: true; value: Value } | { ok: false; error: { code: Code; message: string } };

/** A value as it crosses to the machine and back. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

export interface NodeRef {
    id: string;
}

export interface ViewRef {
    id: string;
}

export interface ProjectRef {
    id: string;
}

/** Where an agent is, the same word everywhere it shows. */
export type AgentStatus = 'idle' | 'running' | 'needsYou' | 'stopped';

/** A chat on the machine, as `chats.list` answers it. Its id is the id of its node. */
export interface ChatSummary {
    id: string;
    provider: string;
    status: AgentStatus;
    model: string | null;
    cwd: string;
}

/** What the client can call. The default export of `server/index.ts`. A method that throws reaches the client as `failed`, with its message. */
export function defineServer<Api extends Record<string, (...args: never[]) => Promise<unknown>>>(api: Api): Api;

/** The machine's events `server/` can follow, with what each says. */
export interface ServerEvents {
    /** A chat changed what it is doing. Needs `chats.read`. */
    'chat.status': { chat: ChatSummary };
    /** Something new in a chat's thread; `chats.read` reads it. Needs `chats.read`. */
    'chat.event': { chatId: string };
    /** The agent in a terminal changed what it is doing. Needs `terminals.read`. */
    'session.status': { nodeId: string; status: AgentStatus };
    /** A launch started, came up, is being stopped or ended. `exitCode` is null until it ended. Needs `launches.read`. */
    'launch.status': { project: ProjectRef; launch: string; state: 'starting' | 'running' | 'stopping' | 'exited'; exitCode: number | null };
    /** The first client opened a project on this machine. Needs `projects.read`. */
    'project.opened': { project: ProjectInfo };
    /** The last client closed a project, so nothing of it runs here any more. Needs `projects.read`. */
    'project.closed': { project: ProjectRef };
}

/**
 * Follows a machine event, behind its permission; any other name is refused. With `filter.project` only the events of that
 * project are heard. Set `"autostart": true` to follow them with no client open.
 */
export function onEvent<Name extends keyof ServerEvents>(
    name: Name,
    listener: (event: ServerEvents[Name]) => void,
    filter?: { project?: ProjectRef }
): () => void;

/** Says something to every client of this machine, where `useServerEvent(name)` hears `payload`, or undefined without one. */
export function emit<Payload>(name: string, payload?: Payload): void;

/** What an agent reads of a node along a line, also with no client open. */
export function defineNodeContext<Data>(nodeType: string, read: (node: { data: Data }) => Promise<{ text: string }[]> | { text: string }[]): void;

/**
 * Needs `agents.tools`. Any agent Ruimte starts on this machine can then find it with `tool_list` and call it with `tool_run`.
 * Having it starts `server/` with the machine, since an agent can only find what is running. It answers in text. Type `Input`
 * after `parameters`, a JSON Schema.
 */
export function defineAgentTool<Input extends object = { [key: string]: Json | undefined }>(tool: {
    id: string;
    description: string;
    parameters?: object;
    run(input: Input, context: { caller: string }): string | Promise<string>;
}): void;

/** Needs the permission `clock`. Runs on this process's own clock: `every` is like 30s, 5m or 1h, of at least 10 seconds and at most 596 hours. */
export function schedule(task: { id: string; every: string; run(): void | Promise<void> }): void;

export const agents: {
    /** Needs `agents.run`. One hidden prompt on a CLI of the person, with the answer whole. */
    run(options: { prompt: string; context?: string[]; provider?: string }): Promise<Result<{ text: string }>>;
    /**
     * Needs `agents.start`. A chat a person sees, supervised at most: on the canvas `view`, beside `near`, or a view of its own in the sidebar without one.
     * With `folder` instead of `project` it works in the project this machine knows in that folder, as a view of that project, or answers `not-found`. With `hidden` it stays out of the sidebar, for a chat the client draws with `Chat`.
     */
    start(
        options: ({ project: ProjectRef; folder?: undefined } | { folder: string; project?: undefined }) & {
            view?: ViewRef;
            near?: NodeRef[];
            prompt?: string;
            provider?: string;
            title?: string;
            hidden?: boolean;
        }
    ): Promise<Result<NodeRef>>;
};

/** `list` and `read` need `chats.read`, `send` needs `chats.send`. */
export const chats: {
    list(): Promise<Result<ChatSummary[]>>;
    /** The thread as text, as an agent reads it. */
    read(chatId: string): Promise<Result<string>>;
    /** Wakes the chat. At most 20 messages per chat per hour, past which it answers `limit`. */
    send(chatId: string, text: string): Promise<Result<void>>;
};

/** A project of this machine, as a provider is asked about it. */
export interface ProjectInfo extends ProjectRef {
    name: string;
    folder: string;
}

/**
 * What a provider has Ruimte start: a program and its arguments. Ruimte runs it, so the session, its scrollback, its
 * status and its stop stay Ruimte's, and the provider never reads what the program writes.
 */
export interface SpawnDescription {
    command: string;
    args?: string[];
    /** Variables on top of the person's own. */
    env?: Record<string, string>;
    /** Where it starts instead of the terminal's own folder: a folder of the project or of one of its worktrees. */
    cwd?: string;
}

/**
 * Needs `terminals.profiles`. Proposed: name `terminalProfiles` under `proposed` in the manifest, and the id under
 * `provides.terminalProfiles`, which is how the menu of a new terminal lists it before `server/` runs. Picking it
 * starts `server/` and asks `spawn`; `available` hides it in a project where it has nothing to open, asked while
 * `server/` runs. Throws for an id the manifest does not list.
 */
export function defineTerminalProfile(profile: {
    id: string;
    title: string;
    /** A Lucide name. */
    icon?: string;
    available?(project: ProjectInfo): boolean | Promise<boolean>;
    spawn(context: { project: ProjectInfo; cwd: string }): SpawnDescription | Promise<SpawnDescription>;
}): void;

/** A launch as a source describes it. Ruimte starts what `spawn` says, in a session of its own, once a person approved it. */
export interface LaunchDescription {
    /** Its own within the source, of lowercase letters, digits and dashes. */
    id: string;
    name: string;
    /** A service stays up, a task runs to its end. */
    kind: 'service' | 'task';
    spawn: SpawnDescription;
    /** A digest of every file that decides what runs. A change to it asks a person again. */
    fingerprint: string;
    /** The port a service listens on, which tells when it is up. */
    port?: number;
}

/**
 * Needs `launches.provide`. Proposed: name `launchSources` under `proposed` in the manifest, and the id under
 * `provides.launchSources`, which starts `server/` once a project's launches are read. Its launches show beside a person's
 * own, under `title`, and start only after a person approved them on this machine: the command, the folder, the variables
 * and the fingerprint together. At most 64 launches per source. Throws for an id the manifest does not list.
 */
export function defineLaunchSource(source: {
    id: string;
    title: string;
    list(project: ProjectInfo): LaunchDescription[] | Promise<LaunchDescription[]>;
    /** Call `changed` when the list should be read again, such as after the file it comes from changed. Answers how to stop. */
    watch?(project: ProjectInfo, changed: () => void): (() => void) | Promise<() => void>;
}): void;

/** A place in a file, counted from 1 as a person reads it, and what is wrong there. */
export interface Problem {
    line: number;
    /** The start of the line without one. */
    column?: number;
    /** It ends where it starts without these. */
    endLine?: number;
    endColumn?: number;
    severity: 'error' | 'warning' | 'information' | 'hint';
    message: string;
    /** The rule it broke, as the source names it. */
    code?: string;
}

export interface FileProblems {
    /** Relative to the project folder. */
    path: string;
    problems: Problem[];
}

/**
 * Needs `problems.provide`. Proposed: name `problemSources` under `proposed` in the manifest, and the id under
 * `provides.problemSources`. Names a source `problems.report` speaks for; its problems show under `title`. Throws for
 * an id the manifest does not list.
 */
export function defineProblemSource(source: { id: string; title: string }): void;

/**
 * Needs `problems.provide`. The problems of a source show with the editor's own and in what an agent reads of the project.
 * The machine keeps them in memory, until the project closes or the extension is turned off, changed or removed.
 */
export const problems: {
    /**
     * Replaces everything this source said about these files; a file with no problems is cleared. At most 200 problems
     * per file and 500 files per source in a project, past which it answers `limit`.
     */
    report(project: ProjectRef, source: string, files: FileProblems[]): Promise<Result<void>>;
    /** Takes back everything this source said in the project. */
    clear(project: ProjectRef, source: string): Promise<Result<void>>;
};

/** Where a host provider is asked: the project, and for a code host the remote of the checkout it matched. */
export interface HostScope {
    project: ProjectInfo;
    remote?: string;
}

/**
 * Whether the provider answers for this project now. `not-configured` is a tracker's way to say the project is not one of
 * its own, which leaves it out there. `reason` is what a person reads for `signed-out` and `unreachable`, such as how to sign in.
 */
export interface HostStatus {
    state: 'ready' | 'signed-out' | 'unreachable' | 'not-configured';
    reason?: string;
    /** Whose account it reads with, as the host names them. */
    account?: string;
}

/** A page of a list. `cursor` is there while the host has more, and comes back as the `cursor` of the next ask. */
export interface HostPage<Item> {
    items: Item[];
    cursor?: string;
}

export interface HostIssueSummary {
    /** Its own name within the provider, such as `ENG-12` or `owner/repo#61`. Ruimte puts the provider's id in front. */
    id: string;
    title: string;
    state: 'open' | 'closed';
    /** The host's own word for the state, for display. */
    stateLabel?: string;
    /** An http(s) address a person opens. */
    url?: string;
    author?: string;
    assignees?: string[];
    labels?: string[];
    /** ISO 8601. */
    updatedAt?: string;
    commentCount?: number;
}

export interface HostComment {
    id: string;
    author: string;
    body: string;
    createdAt?: string;
}

export interface HostIssue extends HostIssueSummary {
    body: string;
    /** Oldest first. Ruimte keeps the newest 100. */
    comments?: HostComment[];
    /** The changes the host links to it. */
    changes?: HostChangeSummary[];
}

/** `pending`, `success`, `failure`, `neutral` or `skipped`. Any other word reads as `failure`, so say one of these for a check that passed. */
export type HostCheckState = 'pending' | 'success' | 'failure' | 'neutral' | 'skipped';

export interface HostChangeSummary {
    id: string;
    title: string;
    state: 'open' | 'closed' | 'merged';
    stateLabel?: string;
    draft?: boolean;
    url?: string;
    author?: string;
    /** The branch it comes from, and the one it goes into. */
    branch?: string;
    base?: string;
    updatedAt?: string;
    /** Its checks as one state, for a list that knows it without reading each check. */
    checkState?: HostCheckState;
}

export interface HostCheck {
    /** What `checks.log` is asked by. */
    name: string;
    state: HostCheckState;
    url?: string;
    summary?: string;
}

/** A review thread nobody resolved yet, by its first comment. */
export interface HostThread {
    id: string;
    author: string;
    body: string;
    path?: string;
    line?: number;
}

export interface HostChange extends HostChangeSummary {
    body: string;
    /** The commit its checks ran on. */
    headSha: string;
    checks?: HostCheck[];
    threads?: HostThread[];
    size?: { additions: number; deletions: number; files: number };
    /** The ids of the issues it closes once it lands. */
    closes?: string[];
}

export interface HostIssueFilter {
    /** Only what is assigned to the account the provider reads with. */
    assigned?: boolean;
    /** `open` when left out. */
    state?: 'open' | 'closed' | 'all';
    query?: string;
    cursor?: string;
}

export interface HostChangeFilter {
    /** `open` when left out. */
    state?: 'open' | 'closed' | 'merged' | 'all';
    query?: string;
    cursor?: string;
}

export interface IssueCapability {
    list(scope: HostScope, filter: HostIssueFilter): Promise<HostPage<HostIssueSummary>>;
    /** Null for an issue the host does not have. */
    read(scope: HostScope, id: string): Promise<HostIssue | null>;
    /** The id of the issue a link or a short form names, such as its address or `#12` in this project; null for text that is none of its own. */
    parse?(scope: HostScope, text: string): string | null | Promise<string | null>;
}

export interface ChangeCapability {
    list(scope: HostScope, filter: HostChangeFilter): Promise<HostPage<HostChangeSummary>>;
    /** With its checks and the review threads nobody resolved. Null for a change the host does not have. */
    read(scope: HostScope, id: string): Promise<HostChange | null>;
    /** The id of the open change that comes from this branch, or null. */
    forBranch(scope: HostScope, branch: string): Promise<string | null>;
}

export interface CheckCapability {
    /** What a check of a change wrote, by the name `read` gave it. Ruimte keeps the end. Null for a check without a log. */
    log(scope: HostScope, change: string, check: string): Promise<{ text: string } | null>;
}

/**
 * Needs `hosts.provide`. Proposed: name `hostProviders` under `proposed` in the manifest, and the id under
 * `provides.hostProviders`. Supplies the issues, changes and checks of a project to Ruimte's own Issues panel and to the
 * tools agents read them with; Ruimte draws them and keeps which chat works on which issue. With `match` it is a code
 * host, asked for every repository of a project whose remote it says is its own. Without it, it is a tracker, asked
 * `status` for every project, where `not-configured` leaves it out. Say only what you can: nothing asks for a part you
 * left out. Everything you answer is cut to what Ruimte holds of one issue or change. Throws for an id the manifest does not list.
 */
export function defineHostProvider(provider: {
    /** Also what the name of every issue and change starts with, as in `tracker:ENG-12`. */
    id: string;
    title: string;
    /** Whether a checkout's remote, as git has it, is this host's. */
    match?(remote: string): boolean;
    status(scope: HostScope): HostStatus | Promise<HostStatus>;
    issues?: IssueCapability;
    changes?: ChangeCapability;
    checks?: CheckCapability;
}): void;

export interface FileEntry {
    path: string;
    name: string;
    kind: 'file' | 'directory' | 'symlink' | 'other';
}

/** The folder of a project only, so a path outside it answers `outside-project`. Needs `files.read`. */
export const files: {
    readText(project: ProjectRef, path: string): Promise<Result<string>>;
    list(project: ProjectRef, folder: string): Promise<Result<FileEntry[]>>;
    /** Calls back when the file or anything under the folder changes. Answers how to stop. */
    watch(project: ProjectRef, path: string, listener: () => void): Promise<Result<() => void>>;
};

export interface OpenTerminal {
    project: ProjectRef;
    /** A profile of this extension, by its id. Without one it is a plain shell. */
    profile?: string;
    title?: string;
    cwd?: string;
    /** Beside the first of these, on its canvas. Without one the terminal is a view of its own. */
    near?: NodeRef[];
}

export const terminals: {
    /** Needs `terminals.read`. What the terminal shows now. */
    read(terminal: NodeRef): Promise<Result<string>>;
    /** Needs `canvas.write`. Opens a terminal and starts it, so `write` reaches it at once. */
    open(options: OpenTerminal): Promise<Result<NodeRef>>;
    /**
     * Needs `terminals.write`. Types `text` as it is, so end a line with `\n` to run it. Answers `refused` for a terminal this
     * extension did not open itself, and while an agent in it waits for the person.
     */
    write(terminal: NodeRef, text: string): Promise<Result<void>>;
};

export const storage: {
    get<Value>(key: string): Promise<Value | undefined>;
    set<Value>(key: string, value: Value): Promise<void>;
    delete(key: string): Promise<void>;
};

/** Kept readable only by the person who runs the machine. */
export const secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
};

export const machine: {
    platform: string;
    dataFolder: string;
    /** An action of the machine in a project, such as `launch.start`, within what your manifest asks for. */
    run<Name extends MachineActionName>(project: ProjectRef, action: Name, input: MachineInput<Name>): Promise<Result<MachineOutput<Name>>>;
};

/**
 * Needs `languages.servers`. Adds a server, listed in Settings like one a person added, and started without asking: installing the extension
 * was the approval. Calling it again with the same name changes it, and removing the extension removes it unless a person edited it.
 */
export function defineLanguageServer(server: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    languages: string[];
    patterns: string[];
}): Promise<Result<void>>;

export const log: {
    info(message: string): void;
    /** `error` is what a `catch` caught, of any shape. */
    error(message: string, error?: unknown): void;
};
