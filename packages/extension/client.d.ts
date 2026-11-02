import type { ComponentType } from 'react';

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

/** What a method of `server/` answers once it crossed as JSON: `undefined`, and so a method that returns nothing, arrives as `null`. */
export type Returned<Value> = Value extends undefined | void ? null : Value;

/** A component is always handed over as a lazy import: `() => import('./Panel')`. */
export type LazyComponent<Props = {}> = () => Promise<{ default: ComponentType<Props> }>;
export type Surface<Props = {}> = { component: LazyComponent<Props> } | { frame: string };

export interface PanelHandle<Params = void> {
    open(params: Params): void;
    close(): void;
    setBadge(text: string | null): void;
    setTitle(title: string): void;
}

export interface NodeRef {
    id: string;
}

export interface ViewRef {
    id: string;
}

export interface ProjectRef {
    id: string;
}

/** `icon` names a Lucide icon. Without one, a surface shows the extension's `assets/icon.svg`. */
export function definePanel<Params = void>(panel: { id: string; title: string; icon?: string; minWidth?: number } & Surface<{ params: Params | undefined }>): PanelHandle<Params>;
export function defineSidebarCard(card: { id: string; title: string; component: LazyComponent }): void;
/** `params` is kept with the view in the project, so it is JSON. */
export function defineView<Params = Json>(view: { id: string; title: string; icon?: string } & Surface<{ params: Params }>): { open(params?: Params): void };
export function defineNode<Data = Json>(
    node: {
        id: string;
        title: string;
        icon?: string;
        size?: { width: number; height: number };
        initialData?: Data;
        dataVersion?: number;
        /** `stored` is what an older `dataVersion` kept, which only the extension knows the shape of. */
        migrate?: (stored: Json, fromVersion: number) => Data;
        /** Where "Add" shows. By default the Extensions submenu of the canvas menu, at the spot clicked, and the command palette. */
        addFrom?: Partial<Slots>;
    } & Surface
): void;
/** Over the whole canvas, under Ruimte's own controls such as the minimap in the bottom right. It lets clicks through; set `pointer-events: auto` on what takes them. */
export function defineCanvasOverlay(overlay: { id: string; component: LazyComponent }): void;
/** Opens every file with these extensions in your component, with Ruimte's own view one click away. */
export function defineFileViewer(viewer: { id: string; title: string; extensions: string[]; component: LazyComponent<{ file: FileInfo & { text: string | null } }> }): void;
/** Draws a fenced block of this language in a chat and in markdown, on this client. Elsewhere it stays code. */
export function defineMarkdownBlock(block: { language: string; component: LazyComponent<{ source: string }> }): void;
/** Your own UI over the app: Ruimte draws the header with `title` and a close button, and animates it; you draw the body. `open` answers what `close` was given, or null when a person dismissed it. */
export function defineOverlay<Params = void, Answer = void>(overlay: {
    id: string;
    title: string;
    size?: 'sm';
    component: LazyComponent<{ params: Params; close(answer?: Answer): void }>;
}): { open(params: Params): Promise<Answer | null>; close(): void };
/** A call of a tool in a chat, as the thread holds it. */
export interface ToolCall {
    name: string;
    input: Json;
    output: string | null;
    state: string;
}

/** Draws these tools' calls in a chat, by their exact name, instead of the thread's own view. */
export function defineToolResult(result: { id: string; tools: string[]; component: LazyComponent<{ call: ToolCall }> }): void;
/** Rows in the command palette for what a person types. It waits for a pause in the typing; a slow or failing one costs only its own rows. */
export function definePaletteSource(source: { id: string; title: string; search(query: string): Promise<{ id: string; title: string; detail?: string; run(): void }[]> }): void;
/** After `/` in a chat. It expands into the prompt, and the person still sends it. */
export function defineSlashCommand(command: { name: string; description: string; run(args: string): string | Promise<string> }): void;
/** Things from outside the project for `#` in a chat. Picking one puts what `read` answers in the prompt. */
export function defineReference(reference: { id: string; title: string; list(): Promise<{ id: string; name: string }[]>; read(item: { id: string; name: string }): Promise<string> }): void;
/** Opens a changed file with these extensions in your component, with Ruimte's own diff one click away. */
export function defineDiffViewer(viewer: { id: string; title: string; extensions: string[]; component: LazyComponent<{ file: FileInfo; diff: string }> }): void;
/** An icon from your pack, by its path, for files with these extensions. */
export function defineFileIcon(icon: { extensions: string[]; path: string }): void;
/** What a person can ask for by voice, through extension.voiceList and extension.voiceRun. It answers in words. Type `Input` after `parameters`, a JSON Schema. */
export function defineVoiceAction<Input extends object = { [key: string]: Json | undefined }>(action: {
    id: string;
    description: string;
    parameters?: object;
    run(input: Input): string | Promise<string>;
}): void;
/** New from a template, under Extensions in the canvas menu. */
export function defineTemplate(template: { id: string; title: string; icon?: string; create(context: BaseContext & { at: { x: number; y: number } }): void | Promise<void> }): void;
export function defineCommand(command: { id: string; title: string; run: () => void | Promise<void> }): void;
export interface SettingField {
    key: string;
    type: 'boolean' | 'text' | 'select';
    label: string;
    description?: string;
    default: boolean | string;
    options?: { value: string; label: string }[];
}

/** A section of an extension's settings page: a title over a card of fields, like Ruimte's own settings. */
export interface SettingGroup {
    title?: string;
    description?: string;
    fields: SettingField[];
}

/** Your own component, or `fields` (one card) or `groups` (a card per group) that Ruimte draws. Read a field with `useSetting`; keys are unique across groups. */
export function defineExtensionSettings(settings: { component: LazyComponent; keywords?: string[] } | { fields: SettingField[] } | { groups: SettingGroup[] }): void;
export function useSetting<Value extends boolean | string>(key: string): Value;
export function useMachine(): { id: string };
export function useTheme(): { side: 'light' | 'dark' };
/** The chat of this id on the machine in front, or null when it has none. */
export function useChat(id: string): ChatSummary | null;

/** Where an agent is, the same word everywhere it shows. */
export type AgentStatus = 'idle' | 'running' | 'needsYou' | 'stopped';

export interface AgentInfo {
    provider: string;
    account: string | null;
    status: AgentStatus;
    cwd: string | null;
    branch: string | null;
    worktree: string | null;
}

/** A chat on the machine, as `chats.list` answers it. Its id is the id of its node. */
export interface ChatSummary {
    id: string;
    provider: string;
    status: AgentStatus;
    model: string | null;
    cwd: string;
}

export interface NodeInfo {
    id: string;
    kind: string;
    title: string;
    color: string | null;
    bounds: { x: number; y: number; width: number; height: number };
    groupId: string | null;
    viewId: string;
    machine: string | null;
    linkedTo: string[];
    agent?: AgentInfo;
    path?: string;
    url?: string;
    extension?: { id: string; type: string };
}

export interface FileInfo {
    path: string;
    name: string;
    extension: string;
}

/** What every slot, action and widget is told. */
export interface BaseContext {
    project: { id: string; name: string; folder: string | null };
    view: { id: string; kind: string; name: string } | null;
    machine: { id: string };
    theme: 'light' | 'dark';
}

/** `false` hides it, `true` shows it, an object also changes what it shows there. */
export type SlotAnswer = boolean | { title?: string; icon?: string; disabled?: boolean | string; badge?: string; order?: number };
export type Slot<Context> = true | ((context: BaseContext & Context) => SlotAnswer);

/** What each place tells. */
export interface SlotContexts {
    selectionBar: { nodes: NodeInfo[] };
    nodeHeader: { node: NodeInfo };
    /** `nodes` is the selection if the node is in it. */
    nodeMenu: { node: NodeInfo; nodes: NodeInfo[] };
    canvasMenu: { at: { x: number; y: number } };
    viewToolbar: {};
    viewMenu: { target: { id: string; kind: string } };
    panelHeader: { panel: string };
    commandPalette: { nodes: NodeInfo[] };
    sidebarRow: { node: NodeInfo };
    tabMenu: { target: { id: string } };
    emptyCanvas: {};
    startScreen: {};
    projectBanner: {};
    threadHeader: { chat: { id: string }; node: NodeInfo };
    emptyThread: { chat: { id: string } };
    toolActions: { chat: { id: string }; tool: ToolCall };
    fileRowBadge: { file: FileInfo };
    fileBreadcrumb: { file: FileInfo };
    terminalMenu: { node: NodeInfo };
    browserMenu: {};
    textMenu: { text: { id: string } };
    noteToolbar: { node: NodeInfo };
    routineMenu: { routine: { id: string } };
    composer: { chat: { id: string }; node: NodeInfo };
    projectMenu: {};
    sidebarFooter: {};
    editorStatusBar: { file: FileInfo };
    messageActions: { chat: { id: string }; message: { id: string; kind: 'user' | 'assistant'; text: string } };
    lineMenu: { from: NodeInfo; to: NodeInfo };
    fileMenu: { file: FileInfo; files: FileInfo[] };
    editorToolbar: { file: FileInfo };
    editorMenu: { file: FileInfo; files: FileInfo[] };
    diffToolbar: { repository: string };
    terminalToolbar: { node: NodeInfo };
    browserToolbar: { node: NodeInfo; url: string };
}

export type SlotName = keyof SlotContexts;
export type Slots<Place extends SlotName = SlotName> = { [Key in Place]: Slot<SlotContexts[Key]> };
export type ContextOf<Place extends SlotName> = { [Key in Place]: BaseContext & SlotContexts[Key] }[Place];

/** Runs the action from code, with what its `run` reads beside the context of the window in front. */
export interface ActionHandle<Context extends object = object> {
    run(context?: Partial<BaseContext> & Partial<Context>): Promise<void>;
    useRunning(): boolean;
}

/**
 * While `run` is pending, its nodes show a spinner that also stops it through `signal`, and a throw reaches the person.
 * Without `slots` it only shows where a menu puts it, and gets that menu's context. Type it with `defineAction<Context>`.
 */
export function defineAction<Place extends SlotName>(action: {
    id: string;
    title: string;
    icon?: string;
    /** Like mod+shift+k. Needs mod or alt. It gets the context of the command palette. */
    shortcut?: string;
    slots: Slots<Place>;
    run(context: ContextOf<Place> & { slot: Place; signal: AbortSignal }): void | Promise<void>;
}): ActionHandle<SlotContexts[Place]>;
export function defineAction<Context extends object = {}>(action: {
    id: string;
    title: string;
    icon?: string;
    shortcut?: string;
    run(context: BaseContext & Context & { slot: string; signal: AbortSignal }): void | Promise<void>;
}): ActionHandle<Context>;

export type MenuItem = ActionHandle | 'separator' | { title: string; run(): void; checked?: boolean } | { title: string; items: MenuItem[] };

/** A menu of your own: a submenu in a menu, a dropdown in a bar. */
export function defineMenu<Place extends SlotName>(menu: { id: string; title: string; icon?: string; slots: Slots<Place>; items: MenuItem[] | ((context: ContextOf<Place>) => MenuItem[]) }): void;

/** Your own React in a slot. */
export function defineWidget<Place extends SlotName>(widget: { id: string; slots: Slots<Place>; component: LazyComponent<{ context: ContextOf<Place> }> }): void;

/**
 * Each method calls `server/` on the machine in front and answers a Result: `failed` with the message of what it threw,
 * `not-found` for a method it lacks, `unavailable` while it cannot run. `.use()` suspends until it answers, and keeps that
 * answer for the same arguments until `.reload()` with them drops it, or the connection to the machine comes back. Every
 * surface that read it then asks again. The value crosses as JSON, see {@link Returned}.
 */
export type ServerClient<Server> = {
    [Method in keyof Server]: Server[Method] extends (...args: infer Args) => Promise<infer Value>
        ? ((...args: Args) => Promise<Result<Returned<Value>>>) & { use(...args: Args): Result<Returned<Value>>; reload(...args: Args): void }
        : never;
};

export function useServer<Server>(): ServerClient<Server>;
/** Hears what `emit` says in `server/`, with the payload it was given. */
export function useServerEvent<Payload>(name: string, listener: (payload: Payload) => void): void;
export function useNodeData<Data>(): [Data, (next: Data) => void];
/** `computer` stays on this computer. `project` and `machine` live on the machine, where `server/` reads `machine` keys too. */
export function useStorage<Value>(key: string, initial: Value, scope?: 'computer' | 'project' | 'machine'): [Value, (next: Value) => void];
export function useProject(): ProjectRef & { name: string };
export function useActiveView(): ViewRef;
export function useViews(): { id: string; kind: string; name: string }[];
export function useSelection(): NodeInfo[];
export function useNode(id: string): NodeInfo;
export function useNodes(filter?: (node: NodeInfo) => boolean): NodeInfo[];
/** Words from `locales/<language>.json`, English as the fallback, and every number and date through `format`. */
export function useLocale(): { language: string; t(key: string, values?: Record<string, string | number>): string; format: typeof import('@adecore/ui/format') };

export interface ClientEvents {
    'node.added': { node: NodeInfo };
    'node.removed': { id: string };
    'node.changed': { node: NodeInfo };
    'selection.changed': { nodes: NodeInfo[] };
    'view.changed': { viewId: string | null };
    'project.opened': { projectId: string };
    'agent.status': { nodeId: string; status: AgentStatus };
    'chat.turnFinished': { chatId: string };
}

export function useEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void): void;
export function onEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void): () => void;
/** Needs the permission `agents.status`. */
export function useAgents(): { id: string; title: string; status: AgentStatus }[];

/** Needs the permission `usage.read`. `used` runs from 0 to 1. */
export function useUsageLimits(): { provider: string; plan: string | null; windows: { label: string; used: number; resetsAt: number | null }[] }[];

export const host: {
    /** Marks work that is no action as busy: a spinner on `nodes` until it is done, which also stops it through the signal. */
    busy<Value>(work: { title: string; nodes?: NodeRef[] }, run: (signal: AbortSignal) => Value | Promise<Value>): Promise<Value>;
    notify(text: string, options?: { tone?: 'neutral' | 'error'; action?: { title: string; run(): void } }): void;
    /** Null when the person closed the picker. */
    pickFolder(initial?: string): Promise<string | null>;
    openSettings(): void;
    confirm(options: { title: string; body: string; danger?: boolean }): Promise<boolean>;
    /** Null when the person dismissed it. */
    prompt(options: { title: string; placeholder?: string; initial?: string }): Promise<string | null>;
    /** Null when the person dismissed it. */
    pick<Item>(options: { title: string; items: readonly Item[]; label(item: Item): string }): Promise<Item | null>;
    openUrl(url: string): void;
    copy(text: string): void;
};

export interface FileEntry {
    path: string;
    name: string;
    kind: 'file' | 'directory' | 'symlink' | 'other';
}

/** The project folder only, so a path outside it answers `outside-project`. Needs `files.read` or `files.write`, except `open`. */
export const files: {
    readText(path: string): Promise<Result<string>>;
    write(path: string, text: string): Promise<Result<void>>;
    list(folder: string): Promise<Result<FileEntry[]>>;
    /** Calls back when the file or anything under the folder changes. Answers how to stop. */
    watch(path: string, listener: () => void): Result<() => void>;
    open(path: string): void;
};

export interface GitFileStatus {
    /** Relative to the root of the repository. */
    path: string;
    state: 'staged' | 'unstaged' | 'untracked' | 'conflicted';
    /** The porcelain letter, such as `M`, `A`, `D` or `?`. */
    status: string;
    added: number;
    deleted: number;
    binary: boolean;
}

export interface GitStatus {
    /** False outside a repository, with everything below empty. */
    repository: boolean;
    root: string | null;
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
    files: GitFileStatus[];
    /** More files changed than `files` holds. */
    truncated: boolean;
}

export interface GitFileDiff {
    path: string;
    /** The unified diff, empty for a binary file or one too large. */
    diff: string;
    added: number;
    deleted: number;
    binary: boolean;
    kind: 'add' | 'update' | 'delete' | null;
}

export interface GitCommit {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    /** Epoch milliseconds of the author date. */
    at: number;
    refs: string[];
}

/** Needs `git.read`. `repository` is a folder in the project, the project folder by default. */
export const git: {
    status(options?: { repository?: string }): Promise<Result<GitStatus>>;
    /** What changed in one file of the working tree, or in the index with `staged`. */
    diff(options: { path: string; repository?: string; staged?: boolean }): Promise<Result<GitFileDiff>>;
    /** The newest commits first, 30 by default. */
    log(options?: { repository?: string; limit?: number }): Promise<Result<GitCommit[]>>;
};

/** `list` and `read` need `chats.read`, `send` needs `chats.send`. */
export const chats: {
    list(): Promise<Result<ChatSummary[]>>;
    /** The thread as text, as an agent reads it. */
    read(chatId: string): Promise<Result<string>>;
    send(chatId: string, text: string): Promise<Result<void>>;
};

export interface LaunchSummary {
    id: string;
    name: string;
    kind: 'service' | 'task' | 'group';
    /** Null when it has not run since the machine started, and for a group. */
    state: 'starting' | 'running' | 'stopping' | 'exited' | null;
    exitCode: number | null;
    /** Whether a person approved it on this machine; only then does it start. */
    approved: boolean;
    port: number | null;
    url: string | null;
    /** The launches a group starts. */
    members: string[];
}

export interface RoutineSummary {
    id: string;
    title: string;
    kind: 'agent' | 'command' | 'launch';
    approved: boolean;
    paused: boolean;
    /** Epoch milliseconds of its next run, or null when none is due. */
    next: number | null;
    lastRun: { state: 'skipped' | 'starting' | 'running' | 'needsYou' | 'limit' | 'done' | 'failed'; at: number } | null;
}

export interface ArtifactFileInfo {
    name: string;
    mime: string;
    size: number;
}

export interface ArtifactInfo {
    id: string;
    title: string;
    kind: string;
    key: string | null;
    /** Epoch milliseconds. */
    createdAt: number;
}

export interface ArtifactSummary extends ArtifactInfo {
    latest: { id: string; number: number; createdAt: number; files: ArtifactFileInfo[] };
    versions: number;
}

export interface BrowserState {
    node: NodeRef;
    /** Whether anyone has the page open; with nobody, `page` is null. */
    open: boolean;
    page: { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean } | null;
    error: string | null;
}

export interface DeviceInfo {
    name: string;
    platform: 'ios' | 'android';
    kind: 'simulator' | 'physical';
    runtime: string;
}

export interface DeviceState {
    node: NodeRef;
    device: DeviceInfo;
    /** False when this machine has no such device right now. */
    present: boolean;
    state: 'booted' | 'shutdown' | 'transitioning' | null;
    /** The size of the last shot, which `tap` counts its pixels in. */
    screen: { width: number; height: number } | null;
    buttons: string[];
    can: { shot: boolean; input: boolean; type: boolean; launch: boolean };
}

/** Each action of the machine an extension may call, with what it takes and answers. */
export interface MachineActions {
    'launch.list': { input: {}; output: { launches: LaunchSummary[] } };
    /** `launch` is an id, or a name no other launch carries. `tail` keeps the last lines. */
    'launch.read': { input: { launch: string; tail?: number }; output: { id: string; name: string; text: string | null } };
    'launch.start': { input: { launch: string }; output: { id: string; name: string } };
    'launch.restart': { input: { launch: string }; output: { id: string; name: string } };
    'launch.stop': { input: { launch: string }; output: { id: string; name: string; stopping: number } };
    'routine.list': { input: {}; output: { routines: RoutineSummary[] } };
    'routine.run': { input: { routine: string }; output: { id: string; title: string; runId: string } };
    'routine.pause': { input: { routine: string }; output: { id: string; title: string } };
    'routine.resume': { input: { routine: string }; output: { id: string; title: string } };
    'artifact.list': { input: {}; output: { artifacts: ArtifactSummary[] } };
    /** The latest version and its first file unless `version` and `file` say otherwise. `text` is null for a file that is no text. */
    'artifact.read': {
        input: { artifact: string; version?: string; file?: number };
        output: { artifact: ArtifactInfo; version: { id: string; number: number }; file: ArtifactFileInfo; text: string | null; truncated: boolean };
    };
    /** Files sent beforehand under `upload`; the same `key` makes a new version of the same artifact. */
    'artifact.publish': {
        input: {
            upload: string;
            files: { name: string; size: number }[];
            title?: string;
            kind?: 'report' | 'image' | 'build' | 'export' | 'recording' | 'page';
            key?: string;
            requestId: string;
        };
        output: { artifact: ArtifactInfo; version: { id: string; number: number }; existing: boolean };
    };
    'browser.inspect': { input: { node: NodeRef }; output: BrowserState };
    'browser.navigate': { input: { node: NodeRef; url: string }; output: BrowserState };
    'browser.back': { input: { node: NodeRef }; output: BrowserState };
    'browser.forward': { input: { node: NodeRef }; output: BrowserState };
    'browser.reload': { input: { node: NodeRef; hard?: boolean }; output: BrowserState };
    /** `path` is a png on the machine, or null when nobody has the page open. */
    'browser.screenshot': { input: { node: NodeRef }; output: BrowserState & { path: string | null } };
    'device.list': { input: {}; output: { devices: (DeviceInfo & { id: string; state: 'booted' | 'shutdown' | 'transitioning' })[] } };
    'device.inspect': { input: { node: NodeRef }; output: DeviceState };
    /** A png on the machine, outside the project folder. */
    'device.screenshot': { input: { node: NodeRef }; output: { node: NodeRef; path: string; width: number; height: number } };
    /** A pixel of the last shot, counted from its top-left corner. */
    'device.tap': { input: { node: NodeRef; x: number; y: number }; output: { node: NodeRef } };
    /** `app` is a bundle id on iOS or a package name on Android. */
    'device.launch': { input: { node: NodeRef; app: string }; output: { node: NodeRef } };
}

export type MachineActionName = keyof MachineActions;
export type MachineInput<Name extends MachineActionName> = MachineActions[Name]['input'];
export type MachineOutput<Name extends MachineActionName> = MachineActions[Name]['output'];

/** The machine's own actions, in the project in front: `launches.start({ launch })` is `launch.start`. `list` and `read` need `launches.read`, the rest `launches.run`. */
export const launches: {
    list(): Promise<Result<MachineOutput<'launch.list'>>>;
    read(input: MachineInput<'launch.read'>): Promise<Result<MachineOutput<'launch.read'>>>;
    start(input: MachineInput<'launch.start'>): Promise<Result<MachineOutput<'launch.start'>>>;
    restart(input: MachineInput<'launch.restart'>): Promise<Result<MachineOutput<'launch.restart'>>>;
    stop(input: MachineInput<'launch.stop'>): Promise<Result<MachineOutput<'launch.stop'>>>;
};
/** `list` needs `routines.read`, the rest `routines.run`. */
export const routines: {
    list(): Promise<Result<MachineOutput<'routine.list'>>>;
    run(input: MachineInput<'routine.run'>): Promise<Result<MachineOutput<'routine.run'>>>;
    pause(input: MachineInput<'routine.pause'>): Promise<Result<MachineOutput<'routine.pause'>>>;
    resume(input: MachineInput<'routine.resume'>): Promise<Result<MachineOutput<'routine.resume'>>>;
};
/** `list` and `read` need `artifacts.read`, `publish` `artifacts.write`. */
export const artifacts: {
    list(): Promise<Result<MachineOutput<'artifact.list'>>>;
    read(input: MachineInput<'artifact.read'>): Promise<Result<MachineOutput<'artifact.read'>>>;
    publish(input: MachineInput<'artifact.publish'>): Promise<Result<MachineOutput<'artifact.publish'>>>;
};
/** Needs `browser.control`. */
export const browser: {
    inspect(input: MachineInput<'browser.inspect'>): Promise<Result<MachineOutput<'browser.inspect'>>>;
    navigate(input: MachineInput<'browser.navigate'>): Promise<Result<MachineOutput<'browser.navigate'>>>;
    back(input: MachineInput<'browser.back'>): Promise<Result<MachineOutput<'browser.back'>>>;
    forward(input: MachineInput<'browser.forward'>): Promise<Result<MachineOutput<'browser.forward'>>>;
    reload(input: MachineInput<'browser.reload'>): Promise<Result<MachineOutput<'browser.reload'>>>;
    screenshot(input: MachineInput<'browser.screenshot'>): Promise<Result<MachineOutput<'browser.screenshot'>>>;
};
/** Needs `devices.control`. */
export const devices: {
    list(): Promise<Result<MachineOutput<'device.list'>>>;
    inspect(input: MachineInput<'device.inspect'>): Promise<Result<MachineOutput<'device.inspect'>>>;
    screenshot(input: MachineInput<'device.screenshot'>): Promise<Result<MachineOutput<'device.screenshot'>>>;
    tap(input: MachineInput<'device.tap'>): Promise<Result<MachineOutput<'device.tap'>>>;
    launch(input: MachineInput<'device.launch'>): Promise<Result<MachineOutput<'device.launch'>>>;
};

export const terminals: {
    /** Needs `terminals.read`. What the terminal shows now. */
    read(terminal: NodeRef): Promise<Result<string>>;
    /** Needs `canvas.write`. Opens a shell and types nothing: only a person types in a terminal. */
    open(options?: { title?: string; cwd?: string; near?: NodeRef[] }): Result<NodeRef>;
};

/** A cell as the database gave it: a large number, a decimal or a date as the text the server writes for it. Bytes come as hex and a long text cut off, each with its whole `length`. */
export type DatabaseValue =
    | string
    | number
    | boolean
    | null
    | { kind: 'binary'; hex: string; length: number }
    | { kind: 'longText'; preview: string; length: number };

/** Needs `database.read`. One SELECT or WITH statement on a read-only session, as for an agent. */
export const database: {
    connections(): Promise<Result<{ id: string; name: string }[]>>;
    query(connection: string, sql: string): Promise<Result<{ columns: string[]; rows: DatabaseValue[][]; hasMore: boolean }>>;
};

/** Needs `views.write`, except `open`. */
export const views: {
    open(view: ViewRef): void;
    createCanvas(name: string): Result<ViewRef>;
    rename(view: ViewRef, name: string): Result<void>;
};

export interface ContextSource {
    id: string;
    /** Such as `text`, `terminal`, `chat`, `browser`, `file` or `extension`; a newer Ruimte may add one. */
    kind: string;
    title: string;
    text: string;
}

/** Needs the permission `context.read`. */
export const context: {
    /** Each node in `nodes` and every node on `view`, each once. Naming neither reads nothing. */
    read(of: { nodes?: NodeRef[]; view?: ViewRef }): Promise<Result<ContextSource[]>>;
};

export const agents: {
    /** Needs `agents.run`. One hidden prompt on a CLI of the person, with the answer whole. */
    run(options: { prompt: string; context?: string[]; provider?: string }): Promise<Result<{ text: string }>>;
    /** Needs `agents.run`. The same, in pieces as the CLI writes them. A failure is the last piece. */
    stream(options: { prompt: string; context?: string[]; provider?: string; signal?: AbortSignal }): AsyncIterable<Result<{ text: string }>>;
    /** Needs `agents.start`. A chat a person sees and can stop, supervised at most: on the canvas in front, or a view of its own in the sidebar with none there. */
    start(options: { prompt?: string; provider?: string; title?: string; near?: NodeRef[] }): Promise<Result<NodeRef>>;
};

/** An accent of Ruimte, which follows the theme. */
export type NodeColor =
    | 'red'
    | 'orange'
    | 'amber'
    | 'yellow'
    | 'lime'
    | 'green'
    | 'emerald'
    | 'teal'
    | 'cyan'
    | 'sky'
    | 'blue'
    | 'indigo'
    | 'violet'
    | 'purple'
    | 'fuchsia'
    | 'pink'
    | 'rose';

/** Needs `canvas.write`, except `reveal` and `select`. What makes a node answers `no-canvas` without a canvas in front. */
export const canvas: {
    createNote(note: { title?: string; text: string; near?: NodeRef[]; color?: NodeColor }): Result<NodeRef>;
    arrange(nodes: NodeRef[], layout: 'row' | 'column' | 'grid'): Result<void>;
    /** A person confirms first; `refused` when they did not. */
    remove(nodes: NodeRef[]): Promise<Result<void>>;
    createFile(path: string, options?: { near?: NodeRef[] }): Result<NodeRef>;
    createBrowser(url: string, options?: { near?: NodeRef[] }): Result<NodeRef>;
    /** A node of this extension's own, by the id it gave `defineNode`. */
    createNode<Data>(type: string, options?: { data?: Data; title?: string; near?: NodeRef[] }): Result<NodeRef>;
    update(node: NodeRef, patch: { title?: string; x?: number; y?: number; width?: number; height?: number }): Result<void>;
    writeNote(node: NodeRef, text: string): Result<void>;
    group(nodes: NodeRef[]): Result<NodeRef>;
    link(from: NodeRef, to: NodeRef): Result<void>;
    unlink(from: NodeRef, to: NodeRef): Result<void>;
    select(nodes: NodeRef[]): void;
    reveal(target: NodeRef): void;
};
