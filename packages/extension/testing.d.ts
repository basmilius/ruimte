import type { ComponentType } from 'react';
import type {
    AgentInfo,
    CanvasArea,
    CanvasView,
    ClientEvents,
    ContextOf,
    ContextSource,
    DatabaseValue,
    EditorDecoration,
    FileEntry,
    GitCommit,
    GitFileDiff,
    GitStatus,
    NodeColor,
    NodeInfo,
    Returned,
    SlotContexts,
    SlotName,
    useUsageLimits
} from './client';
import type {
    ChatSummary,
    ExtensionErrorCode,
    FileProblems,
    Json,
    LaunchDescription,
    MachineCandidate,
    MachineStart,
    MachineActionName,
    MachineInput,
    MachineOutput,
    Notification,
    ReferenceItem,
    NodeRef,
    ProjectInfo,
    ProjectRef,
    Result,
    ServerEvents,
    SpawnDescription,
    ViewRef
} from './server';

type Answer<Value> = Value | Promise<Value>;

/** A node of the project a test host starts with. Only `id` is needed: a node is a note on the first view unless it says otherwise. */
export interface TestNode {
    id: string;
    kind?: string;
    title?: string;
    /** What an agent reads of it: a note's text, a terminal's screen or a chat's thread. */
    text?: string;
    color?: NodeColor | null;
    bounds?: { x: number; y: number; width: number; height: number };
    /** A collapsed group hides it. */
    hidden?: boolean;
    /** The id of the view it is on. */
    view?: string;
    linkedTo?: string[];
    /** A chat or a design always has an agent. A terminal has one only with this, which says its CLI runs there. Its `provider` is null unless this names one. */
    agent?: Partial<AgentInfo>;
    /** What `useSubagents` reads of a chat. */
    subagents?: TestSubagent[];
    path?: string;
    url?: string;
    /**
     * A node of this extension, by the id it gave `defineNode`, with what `useNodeData` reads. `dataVersion` is the version
     * that stored `data`: below the definition's own, `render` moves it up through `migrate` first, as Ruimte does.
     */
    extension?: { type: string; data?: Json; dataVersion?: number };
}

/** A sub-agent at work for a chat: running unless it says otherwise, and `node` the id of the node of a task's child. */
export interface TestSubagent {
    status?: 'running' | 'paused';
    node?: string;
}

/**
 * What the machine and the person answer the client in a test. A call that asks the machine gets what it was asked and returns the
 * value; throw `refusal(code, message)` to answer a failure. A call nothing answers is `unavailable`, except where the test host
 * keeps the state itself: the canvas, views, storage, settings, and what an agent reads of a node with `text`.
 */
export interface TestHostAnswers {
    /** How the person answers `host.confirm` and the question before `canvas.remove`. Yes by default. */
    confirm?: boolean | ((options: { title: string; body: string }) => boolean);
    /** Null, by default, is a dismissed prompt. */
    prompt?: string | null | ((options: { title: string; placeholder?: string; initial?: string }) => string | null);
    /** The label of the item the person picks, as `label` wrote it. Null, by default, is a dismissed picker. */
    pick?: string | null | ((options: { title: string; labels: string[] }) => string | null);
    pickFolder?: string | null;
    /** What an overlay closes with, by the id it gave `defineOverlay`. Null, by default, is a dismissed one. */
    overlays?: Record<string, (params: never) => unknown>;
    /**
     * `server/` as `useServer` reaches it: methods that answer, or a test server from `createTestServer`, whose `storage` is
     * then the `machine` storage of `useStorage`, as on one machine.
     */
    server?: Record<string, (...args: never[]) => unknown> | TestServer<unknown>;
    'agents.run'?(options: { prompt: string; context?: string[]; provider?: string }): Answer<{ text: string }>;
    /**
     * The pieces of the answer, in order. An async iterable is read piece by piece: a throw after some pieces ends the
     * stream with that failure, and `signal` aborts once the extension stops the stream, which then yields no more.
     */
    'agents.stream'?(options: { prompt: string; context?: string[]; provider?: string; signal: AbortSignal }): Answer<string[]> | AsyncIterable<string>;
    /** A chat node on the canvas in front by default. */
    'agents.start'?(options: { prompt?: string; provider?: string; title?: string; near?: NodeRef[]; folder?: string; hidden?: boolean }): Answer<NodeRef>;
    'chats.list'?(): Answer<ChatSummary[]>;
    'chats.send'?(chatId: string, text: string): Answer<void>;
    'files.readText'?(path: string): Answer<string>;
    'files.write'?(path: string, text: string): Answer<void>;
    'files.list'?(folder: string): Answer<FileEntry[]>;
    'git.status'?(options: { repository?: string }): Answer<GitStatus>;
    'git.diff'?(options: { path: string; repository?: string; staged?: boolean }): Answer<GitFileDiff>;
    'git.log'?(options: { repository?: string; limit?: number }): Answer<GitCommit[]>;
    'database.connections'?(): Answer<{ id: string; name: string }[]>;
    'database.query'?(connection: string, sql: string): Answer<{ columns: string[]; rows: DatabaseValue[][]; hasMore: boolean }>;
    /** What `context.read` answers; by default the `text` of each node it names and of every node on the view it names. */
    'context.read'?(of: { nodes?: NodeRef[]; view?: ViewRef }): Answer<ContextSource[]>;
    /** `launches`, `routines`, `artifacts`, `browser` and `devices`, by the action each call is: `launches.start` is `launch.start`. */
    'machine.run'?: { [Name in MachineActionName]?: (input: MachineInput<Name>, project: ProjectRef) => Answer<MachineOutput<Name>> };
    'usage.limits'?: ReturnType<typeof useUsageLimits>;
}

export interface TestHostOptions {
    /** Over `manifest.json` in the folder the test runs in, such as `{ permissions: {} }` to take every permission away. */
    manifest?: { id?: string; name?: string; permissions?: Record<string, string>; provides?: Record<string, string[]>; proposed?: string[] };
    /** `client/index.ts` by default, loaded afresh for this host. */
    entry?: string;
    /** The open project, with its views and nodes; the first view is in front. Null for no open project. */
    project?: { id?: string; name?: string; folder?: string | null; views?: { id: string; kind?: string; name?: string }[]; nodes?: TestNode[] } | null;
    /** The ids of the selected nodes. */
    selection?: string[];
    machine?: { id: string };
    theme?: 'light' | 'dark';
    /** Which `locales/<language>.json` `useLocale` reads, over `en.json`. English by default. */
    language?: string;
    /** What a person set, over the defaults of `defineExtensionSettings`. */
    settings?: Record<string, boolean | string>;
    storage?: { computer?: Record<string, Json>; project?: Record<string, Json>; machine?: Record<string, Json> };
    /** What `useProviders` lists. Claude alone by default. */
    providers?: { id: string; name: string }[];
    /** What `useCanvasView` reads and `useInView` measures against: 1280 by 800 from the origin at 100%, with no gesture, by default. */
    canvas?: { visible?: Partial<CanvasArea>; zoom?: number; gesture?: CanvasView['gesture'] };
    answers?: TestHostAnswers;
}

/** How a slot shows a definition at a place, after its function answered. */
export interface TestSlotShown {
    title: string;
    /** The Lucide name, or null for none. */
    icon: string | null;
    /** True, or the reason a person reads, when it shows but cannot be pressed. */
    disabled: boolean | string;
    badge: string | null;
    order: number;
}

/** A row of a menu as a person sees it. `run` answers as `run` of the test host does. */
export type TestMenuItem = 'separator' | { title: string; checked?: boolean; run(): Promise<Result<void>> } | { title: string; items: TestMenuItem[] };

/** What a test host recorded of a call of the API that answers a Result. */
export interface TestCall {
    /** Its path, such as `canvas.createNote` or `launches.start`. */
    method: string;
    args: unknown[];
    result: Result<unknown>;
}

/** Something drawn into the page of a `*.dom.test.tsx` file. Each step waits for what React does after it. */
/** Each step lets React finish inside `act` and waits on no timer, so it works under `jest.useFakeTimers()` too. */
export interface TestScreen {
    container: HTMLElement;
    /** What the page says, as a person reads it. */
    text(): string;
    /** The innermost element that says `text`, or null. */
    find(text: string): HTMLElement | null;
    /** Clicks the button, link or menu item that says `target`, or the element itself. */
    click(target: string | Element): Promise<void>;
    /** Types into the field whose label, placeholder or name is `target`, or the element itself. */
    type(target: string | Element, text: string): Promise<void>;
    /** Waits until `check` neither throws nor answers false, over turns of the event loop rather than a clock. */
    until(check: () => unknown): Promise<void>;
    unmount(): void;
}

/** What the extension gave a `define*`, as it gave it. */
export interface TestDefinition {
    id: string;
    title?: string;
    component?: () => Promise<{ default: ComponentType<never> }>;
    frame?: string;
    [key: string]: unknown;
}

/** A mark in the margin of an editor a test opened, with the id of the decoration that put it there and its last line filled in. */
export interface TestEditorDecoration {
    decoration: string;
    line: number;
    endLine: number;
    kind: EditorDecoration['kind'];
}

export interface TestHost {
    /** What the extension defined, in order, with the object each `define*` was given. */
    definitions: { kind: string; definition: TestDefinition }[];
    /** A definition by the id it gave, or a throw that lists the ids there are. */
    action(id: string): TestDefinition;
    menu(id: string): TestDefinition;
    widget(id: string): TestDefinition;
    panel(id: string): TestDefinition;
    view(id: string): TestDefinition;
    node(id: string): TestDefinition;
    card(id: string): TestDefinition;
    overlay(id: string): TestDefinition;
    /** The id of the language `defineLanguage` gave a file with this name or path, or null for a file none of yours covers. */
    languageOf(path: string): string | null;
    /**
     * A file of the project opening in an editor, which asks every `defineEditorDecoration` for its marks, and again after a
     * `refresh()`. `decorations()` is what the margin shows now; wait for an answer with `until` of a screen, or a turn of the
     * event loop. `close()` is the editor going, after which nothing asks for that file.
     */
    openEditor(path: string): { decorations(): TestEditorDecoration[]; close(): void };
    /** What every slot tells at this place, filled with the project, view, machine and theme, and the selection where the place tells it. A `{ id }` of a node of the project becomes its `NodeInfo`. */
    context<Place extends SlotName>(place: Place, extra?: Partial<Record<keyof SlotContexts[Place], unknown>>): ContextOf<Place>;
    /** How an action, menu or widget shows at this place, or null where it does not. An unknown place throws. */
    slot<Place extends SlotName>(definition: object, place: Place, extra?: Partial<Record<keyof SlotContexts[Place], unknown>>): TestSlotShown | null;
    /**
     * Presses an action, or the node of a `defineNode`, at this place as a person would: `refused` where it does not show or is
     * disabled, `failed` with what it threw, which also shows the person an error, as in Ruimte. An `AbortError` is the
     * person stopping it, which is no failure.
     */
    run<Place extends SlotName>(definition: object, place: Place, extra?: Partial<Record<keyof SlotContexts[Place], unknown>>): Promise<Result<void>>;
    /** A menu's rows at this place: `refused` where it does not show, `failed` with what its `items` threw. */
    menuItems<Place extends SlotName>(menu: object, place: Place, extra?: Partial<Record<keyof SlotContexts[Place], unknown>>): Result<TestMenuItem[]>;
    /** Hands a client event to `useEvent` and `onEvent`. */
    fire<Name extends keyof ClientEvents>(name: Name, payload: ClientEvents[Name]): void;
    /** What `emit` in `server/` says, to `useServerEvent`. Without a payload, the listener hears undefined. */
    emit(name: string, payload?: Json): void;
    /** Selects these nodes, as a person would, which also fires `selection.changed`. */
    select(ids: string[]): void;
    /** Changes a setting, as a person would. */
    setSetting(key: string, value: boolean | string): void;
    /** Changes a field of `defineProjectSettings` for the open project, as a person would in the settings of that project. */
    setProjectSetting(key: string, value: boolean | string): void;
    /**
     * The agent of a node, or of a chat or terminal open as a view of its own, changing what it does as the machine reports it,
     * and draws again what reads it. Null takes a terminal's agent away, as its CLI ending does.
     */
    setAgent(id: string, agent: (Partial<AgentInfo> & { subagents?: TestSubagent[] }) | null): void;
    /** A person panning, zooming or starting a gesture on the canvas, and draws again what reads it. */
    setCanvasView(view: { visible?: Partial<CanvasArea>; zoom?: number; gesture?: CanvasView['gesture'] }): void;
    /** Each view `views.focus` handed the keyboard to, by its id. */
    focused: string[];
    /** Writes a stored value as another window or `server/` would, and draws again what reads it. Undefined deletes the key. */
    setStorage(scope: 'computer' | 'project' | 'machine', key: string, value: Json | undefined): void;
    /** A file of the project changing on the machine, which calls back each `files.watch` of it or of a folder above it. */
    changeFile(path: string): void;
    /** The connection to the machine dropping and coming back: every answer `.use()` kept is dropped, so what read one asks again. */
    reconnect(): void;
    /**
     * Draws a panel, view, node, widget or card, or a component of your own, into the page, and waits for its lazy import and
     * whatever it suspends on. `node` is the node `useNodeData` reads, `params` what a panel or view gets, `context` a widget's.
     * A throw while it draws rejects. Needs a `*.dom.test.tsx` file.
     */
    render(
        drawable: TestDefinition | ComponentType<never>,
        options?: { node?: string; params?: unknown; context?: object; props?: object }
    ): Promise<TestScreen>;
    canvas: {
        /** Every node of the view in front. */
        nodes(): NodeInfo[];
        /** Each note the extension made, in order. */
        notes(): { id: string; title: string; text: string; color: string | null }[];
        /** Each line between two nodes, in order. */
        links(): { from: string; to: string }[];
        /** Each node the extension made, of any kind, as it is now. */
        created(): NodeInfo[];
        selection(): string[];
        revealed(): string[];
    };
    views(): { id: string; kind: string; name: string; active: boolean }[];
    /** What `host.notify` said, and each failure a person was shown. */
    notifications: { text: string; detail?: string; tone: 'neutral' | 'error'; action?: string }[];
    /** Each question the person was asked, with their answer. */
    dialogs: { kind: 'confirm' | 'prompt' | 'pick' | 'folder'; title: string; body?: string; answer: unknown }[];
    /** What opened: a panel, view or overlay of the extension by its id, a file by its path, a url, or settings. */
    opened: { kind: 'panel' | 'view' | 'overlay' | 'file' | 'url' | 'settings'; id?: string; params?: unknown }[];
    /** Each panel's state, by the id it gave `definePanel`. */
    panels: Record<string, { title: string; badge: string | null; open: boolean; params: unknown }>;
    copied: string[];
    server: { calls: TestCall[] };
    agents: { calls: TestCall[] };
    /** Every call that answered a Result, in order. */
    calls: TestCall[];
    /** Each terminal `terminals.open` opened, with what `terminals.write` typed into it. Any other terminal refuses a write. */
    terminals: TestTerminal[];
    /** What `useStorage` holds per scope now, changed in place. */
    storage: { computer: Record<string, Json>; project: Record<string, Json>; machine: Record<string, Json> };
    settings: Record<string, boolean | string>;
    /** Each refusal and failure, as `ruimte extension dev` prints it. */
    logs: string[];
}

/**
 * A client of Ruimte in this process, with a project in memory you seed: it loads `client/index.ts` afresh, records what the
 * extension defines and does, answers what you script and refuses with the permissions of your manifest, in the messages and
 * codes Ruimte gives. What it loaded speaks for it, and a file your test imports itself speaks for the test host created last.
 */
export function createTestHost(options?: TestHostOptions): Promise<TestHost>;

/**
 * What the machine answers `server/` in a test. Each answer gets what `server/` asked and returns the value; throw `refusal(code, message)`
 * to answer a failure. A call nothing answers is `unavailable`.
 */
export interface TestServerAnswers {
    'agents.run'?(options: { prompt: string; context?: string[]; provider?: string }): Answer<{ text: string }>;
    /** `near` holds only the first node, as the machine only uses that one. */
    'agents.start'?(options: {
        project?: ProjectRef;
        folder?: string;
        view?: ViewRef;
        near?: NodeRef[];
        prompt?: string;
        provider?: string;
        title?: string;
        hidden?: boolean;
    }): Answer<NodeRef>;
    'chats.list'?(): Answer<ChatSummary[]>;
    'chats.read'?(chatId: string): Answer<string>;
    'chats.send'?(chatId: string, text: string): Answer<void>;
    'terminals.read'?(terminal: NodeRef): Answer<string>;
    'machine.run'?: { [Name in MachineActionName]?: (input: MachineInput<Name>, project: ProjectRef) => Answer<MachineOutput<Name>> };
}

/** A terminal of the machine of a test. */
export interface TestTerminal {
    id: string;
    /** `extension` for one `terminals.open` opened, the only kind `terminals.write` types into. */
    openedBy: 'extension' | 'person';
    /** Set it to true for an agent in the terminal that waits for the person, which refuses a write. */
    needsYou: boolean;
    /** What `terminals.write` typed, in order. */
    written: string[];
    /** The terminal profile it runs, by id. */
    profile?: string;
    /** What that profile's `spawn` described when the terminal opened, in a test server. */
    spawn?: SpawnDescription;
    title?: string;
    cwd?: string;
}

export interface TestServerOptions {
    /** Over `manifest.json` in the folder the test runs in, such as `{ permissions: {} }` to take every permission away. */
    manifest?: { id?: string; permissions?: Record<string, string>; provides?: Record<string, string[]>; proposed?: string[] };
    /**
     * Where the extension came from. `dev-link` by default, as under `ruimte extension dev`; with `installed`, one that uses a
     * proposed part does not load, and `createTestServer` rejects with what a person reads in Settings.
     */
    provenance?: 'dev-link' | 'installed';
    /** The project a terminal profile is asked about. */
    project?: Partial<ProjectInfo>;
    /** Terminals that are there already, opened by a person unless one says otherwise. */
    terminals?: (Pick<TestTerminal, 'id'> & Partial<TestTerminal>)[];
    /** The text files of the project `files` reads, by their path in the project folder. */
    files?: Record<string, string>;
    /** `server/index.ts` by default. */
    entry?: string;
    storage?: Record<string, Json>;
    secrets?: Record<string, string>;
    answers?: TestServerAnswers;
}

/** A call of `server/` to the machine, with what it was answered. */
export interface TestAsk {
    method:
        | 'agents.run'
        | 'agents.start'
        | 'chats.list'
        | 'chats.read'
        | 'chats.send'
        | 'terminals.read'
        | 'terminals.open'
        | 'terminals.write'
        | 'files.readText'
        | 'files.list'
        | 'files.watch'
        | 'problems.report'
        | 'problems.clear'
        | 'machine.run'
        | 'defineLanguageServer';
    args: Json[];
    result: Result<unknown>;
}

type Method<Api, Name extends keyof Api> = Api[Name] extends (...args: infer Args) => Promise<infer Value>
    ? (...args: Args) => Promise<Result<Returned<Value>>>
    : never;

export interface TestServer<Api> {
    /** Calls a method of `server/index.ts` as the client does: its arguments and answer cross as JSON, a throw answers `failed`. */
    call<Name extends keyof Api & string>(method: Name, ...args: Parameters<Method<Api, Name>>): ReturnType<Method<Api, Name>>;
    /** What `storage` and `secrets` hold now, changed in place. */
    storage: Record<string, Json>;
    secrets: Record<string, string>;
    /** A clock of its own, from 0: `advance('5m')` runs every `schedule` task that falls due on the way, in order, and waits for each. */
    clock: { now(): number; advance(duration: string | number): Promise<void> };
    /** Hands a machine event to `onEvent`, if the manifest has its permission, as the machine would. */
    fire<Name extends keyof ServerEvents>(name: Name, payload: ServerEvents[Name]): void;
    /** What `emit` said, in order. An `emit` without a payload has none here either, as it crosses to a client. */
    emitted: { name: string; payload?: Json }[];
    /** What `server/` asked the machine, in order. */
    asked: TestAsk[];
    /** What `defineLanguageServer` added. */
    languageServers: object[];
    /** What `log` wrote, and every refusal, as `ruimte extension dev` prints it. */
    logs: string[];
    /** The terminals of the machine: those the options gave, and each one `terminals.open` opened, with what was typed into it. */
    terminals: TestTerminal[];
    /** A terminal profile `defineTerminalProfile` named, asked as the machine asks it. Throws for one it did not define. */
    profile(id: string): {
        title: string;
        icon?: string;
        available(project?: Partial<ProjectInfo>): Promise<boolean>;
        spawn(context?: { project?: Partial<ProjectInfo>; cwd?: string }): Promise<SpawnDescription>;
    };
    /**
     * A launch source `defineLaunchSource` named, asked as the machine asks it. `list` reads its launches and has the source
     * tell when they change, as the machine does; `changes` counts how often it said so, and `stop` has it stop telling, as
     * when the project closes. A launch the machine would not take is left out, with the reason in `logs`. Throws for a
     * source it did not define.
     */
    launchSource(id: string): {
        title: string;
        list(project?: Partial<ProjectInfo>): Promise<LaunchDescription[]>;
        stop(project?: Partial<ProjectInfo>): Promise<void>;
        readonly changes: number;
    };
    /**
     * A machine source `defineMachineSource` named, asked as the machine asks it. `list` reads its places, and one the
     * machine would not take is left out, with the reason in `logs`. `start` asks what starts a machine in a place by its
     * id, as the machine does before it holds the start for a person's approval: it answers the description and the lines
     * the source reported, runs nothing, and aborts the signal the source was handed once `signal` aborts. It rejects
     * for a description the machine would not take. Throws for a source it did not define.
     */
    machineSource(id: string): {
        title: string;
        list(project?: Partial<ProjectInfo>): Promise<MachineCandidate[]>;
        start(candidate: string, options?: { project?: Partial<ProjectInfo>; signal?: AbortSignal }): Promise<{ start: MachineStart; reports: string[] }>;
    };
    /**
     * A reference `defineReference` of `server/` named, asked as the machine asks it for `#` in a chat. `list` leaves
     * out a thing the machine would not take, with the reason in `logs`, and `read` answers the text that goes in the
     * prompt. Throws for a reference it did not define.
     */
    reference(id: string): {
        title: string;
        list(project?: Partial<ProjectInfo>): Promise<ReferenceItem[]>;
        read(item: ReferenceItem, project?: Partial<ProjectInfo>): Promise<string>;
    };
    /** A command `defineSlashCommand` of `server/` named, run as the machine runs it for `/` in a chat. Throws for one it did not define. */
    slashCommand(name: string): { description: string; run(args?: string, project?: Partial<ProjectInfo>): Promise<string> };
    /**
     * A UI source `defineUiSource` named, read as the machine reads it for a block. `name` is what a block writes as
     * `source`, and `description` and `parameters` are what an agent is told. `read` hands over the arguments and the
     * project, and rejects for an answer the machine would not hand a block: one over 32 KB, or a throw. A source whose
     * description or parameters the machine does not take is not here, with the reason in `logs`. Throws for a source
     * it did not define.
     */
    /**
     * An agent `defineAgentProvider` described, as the machine takes it: the kind it goes by among the providers, its name,
     * the program Ruimte starts for a chat and the models the picker offers first. Nothing starts here. One whose
     * description the machine does not take is not here, with the reason in `logs`. Rejects for an agent it did not define.
     */
    agentProvider(id: string): Promise<{ kind: string; name: string; protocol: 'acp'; spawn: SpawnDescription; models: { id: string; name: string }[] }>;
    uiSource(id: string): {
        name: string;
        description: string;
        parameters?: object;
        read(args?: Record<string, Json>, project?: Partial<ProjectInfo>): Promise<Json>;
    };
    /**
     * A notification channel `defineNotificationChannel` named, handed a notification as the machine hands it one. What
     * you leave out is filled in: a wait in `project` for the node `node-1`. Answers whether the channel delivered; a throw
     * of the channel answers false with its reason in `logs`, as the machine writes it to the extension's log. When
     * Ruimte tells a channel is the machine's to decide, so nothing here waits. Throws for a channel it did not define.
     */
    notificationChannel(id: string): { title: string; deliver(notification?: Partial<Notification>): Promise<boolean> };
    /** What the problem sources hold now, as `problems.report` and `problems.clear` left it: per source, the files with problems. */
    problems: { source: string; files: FileProblems[] }[];
    /** The text files of the project, by path. `writeFile` changes one, or removes it with null, and tells every `files.watch` that follows it. */
    files: Record<string, string>;
    writeFile(path: string, text: string | null): void;
    /** A person choosing a field of `defineProjectSettings` in the settings of a project, the test's own unless it names another. */
    setProjectSetting(key: string, value: boolean | string, project?: { id?: string }): void;
    /** An agent's call of a tool `defineAgentTool` named, by the id it gave, answered in text. */
    tool(id: string): { run(input?: object, context?: { caller?: string }): Promise<string> };
    /** What an agent reads of a node of this type along a line. */
    nodeContext(nodeType: string, data: Json): Promise<{ text: string }[]>;
}

/**
 * Loads `server/index.ts` in this process, against the machine of a test: storage in memory, answers you script and the permissions of
 * your manifest, refused with the messages and codes Ruimte gives. Each test server loads `server/index.ts` afresh, with every file of
 * your project it imports, so no state carries over; a package from `node_modules` loads once. What it loaded speaks for it, and a
 * file your test imports itself speaks for the test server created last.
 */
export function createTestServer<Api = Record<string, (...args: never[]) => Promise<unknown>>>(options?: TestServerOptions): Promise<TestServer<Api>>;

/** A failure for an answer to throw, which `server/` reads as a Result under `code`. */
export function refusal(code: ExtensionErrorCode, message: string): Error;
