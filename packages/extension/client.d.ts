import type { ComponentType } from 'react';

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

/** `icon` names a Lucide icon. Without one, a surface shows the extension's `assets/icon.svg`. */
export function definePanel<Params = void>(panel: { id: string; title: string; icon?: string; minWidth?: number } & Surface<{ params: Params | undefined }>): PanelHandle<Params>;
export function defineSidebarCard(card: { id: string; title: string; component: LazyComponent }): void;
export function defineView<Params = unknown>(view: { id: string; title: string; icon?: string } & Surface<{ params: Params }>): { open(params?: Params): void };
export function defineNode<Data = unknown>(
    node: {
        id: string;
        title: string;
        icon?: string;
        size?: { width: number; height: number };
        initialData?: Data;
        dataVersion?: number;
        migrate?: (stored: unknown, fromVersion: number) => Data;
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
export function defineOverlay<Params = void, Result = void>(overlay: {
    id: string;
    title: string;
    size?: 'sm';
    component: LazyComponent<{ params: Params; close(result?: Result): void }>;
}): { open(params: Params): Promise<Result | null>; close(): void };
/** Draws these tools' calls in a chat, by their exact name, instead of the thread's own view. */
export function defineToolResult(result: { id: string; tools: string[]; component: LazyComponent<{ call: { name: string; input: unknown; output: string | null; state: string } }> }): void;
/** After `/` in a chat. It expands into the prompt, and the person still sends it. */
/** Rows in the command palette for what a person types. It waits for a pause in the typing; a slow or failing one costs only its own rows. */
export function definePaletteSource(source: { id: string; title: string; search(query: string): Promise<{ id: string; title: string; detail?: string; run(): void }[]> }): void;
export function defineSlashCommand(command: { name: string; description: string; run(args: string): string | Promise<string> }): void;
/** Things from outside the project for `#` in a chat. Picking one puts what `read` answers in the prompt. */
export function defineReference(reference: { id: string; title: string; list(): Promise<{ id: string; name: string }[]>; read(item: { id: string; name: string }): Promise<string> }): void;
/** Opens a changed file with these extensions in your component, with Ruimte's own diff one click away. */
export function defineDiffViewer(viewer: { id: string; title: string; extensions: string[]; component: LazyComponent<{ file: FileInfo; diff: string }> }): void;
/** An icon from your pack, by its path, for files with these extensions. */
export function defineFileIcon(icon: { extensions: string[]; path: string }): void;
/** What a person can ask for by voice, through extension.voiceList and extension.voiceRun. It answers in words. */
export function defineVoiceAction(action: { id: string; description: string; parameters?: object; run(input: any): string | Promise<string> }): void;
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

/** Your own component, or `fields` that Ruimte draws. Read a field with `useSetting`. */
export function defineExtensionSettings(settings: { component: LazyComponent; keywords?: string[] } | { fields: SettingField[] }): void;
export function useSetting<Value>(key: string): Value;
export function useMachine(): { id: string };
export function useTheme(): { side: 'light' | 'dark' };
export function useChat(id: string): { id: string; status: string; provider: string } | null;

export interface AgentInfo {
    provider: string;
    account: string | null;
    status: 'idle' | 'running' | 'needsYou' | 'stopped';
    cwd: string | null;
    branch: string | null;
    worktree: string | null;
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
    toolActions: { chat: { id: string }; tool: { name: string; input: unknown; output: string | null; state: string } };
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

export interface ActionHandle {
    run(context?: Partial<BaseContext> & Record<string, unknown>): Promise<void>;
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
}): ActionHandle;
export function defineAction<Context = {}>(action: {
    id: string;
    title: string;
    icon?: string;
    shortcut?: string;
    run(context: BaseContext & Context & { slot: string; signal: AbortSignal }): void | Promise<void>;
}): ActionHandle;

export type MenuItem = ActionHandle | 'separator' | { title: string; run(): void; checked?: boolean } | { title: string; items: MenuItem[] };

/** A menu of your own: a submenu in a menu, a dropdown in a bar. */
export function defineMenu<Place extends SlotName>(menu: { id: string; title: string; icon?: string; slots: Slots<Place>; items: MenuItem[] | ((context: ContextOf<Place>) => MenuItem[]) }): void;

/** Your own React in a slot. */
export function defineWidget<Place extends SlotName>(widget: { id: string; slots: Slots<Place>; component: LazyComponent<{ context: ContextOf<Place> }> }): void;

/** Each method calls `server/` on the machine in front; `.use()` suspends until it answers. */
export type ServerClient<Server> = {
    [Method in keyof Server]: Server[Method] extends (...args: infer Args) => Promise<infer Result>
        ? ((...args: Args) => Promise<Result>) & { use(...args: Args): Result }
        : never;
};

export function useServer<Server>(): ServerClient<Server>;
/** Hears what `emit` says in `server/`. */
export function useServerEvent(name: string, listener: (payload: unknown) => void): void;
export function useNodeData<Data>(): [Data, (next: Data) => void];
/** `computer` stays on this computer. `project` and `machine` live on the machine, where `server/` reads `machine` keys too. */
export function useStorage<Value>(key: string, initial: Value, scope?: 'computer' | 'project' | 'machine'): [Value, (next: Value) => void];
export function useProject(): { id: string; name: string };
export function useActiveView(): ViewRef;
export function useViews(): { id: string; kind: string; name: string }[];
export function useSelection(): NodeInfo[];
export function useNode(id: string): NodeInfo;
export function useNodes(filter?: (node: NodeInfo) => boolean): NodeInfo[];
/** Words from `locales/<language>.json`, English as the fallback, and every number and date through `format`. */
export function useLocale(): { language: string; t(key: string, values?: Record<string, unknown>): string; format: typeof import('@adecore/ui/format') };

export interface ClientEvents {
    'node.added': { node: NodeInfo };
    'node.removed': { id: string };
    'node.changed': { node: NodeInfo };
    'selection.changed': { nodes: NodeInfo[] };
    'view.changed': { viewId: string | null };
    'project.opened': { projectId: string };
    'agent.status': { nodeId: string; status: string | undefined };
    'chat.turnFinished': { chatId: string };
}

export function useEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void): void;
export function onEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void): () => void;
/** Needs the permission `agents.status`. */
export function useAgents(): { id: string; title: string; status: string | undefined; needsYou: boolean }[];

/** Needs the permission `usage.read`. `used` runs from 0 to 1. */
export function useUsageLimits(): { provider: string; plan: string | null; windows: { label: string; used: number; resetsAt: number | null }[] }[];

export const host: {
    /** Marks work that is no action as busy: a spinner on `nodes` until it is done, which also stops it through the signal. */
    busy<Result>(work: { title: string; nodes?: NodeRef[] }, run: (signal: AbortSignal) => Result | Promise<Result>): Promise<Result>;
    notify(text: string, options?: { tone?: 'neutral' | 'error'; action?: { title: string; run(): void } }): void;
    pickFolder(initial?: string): Promise<string | null>;
    openSettings(): void;
    confirm(options: { title: string; body: string; danger?: boolean }): Promise<boolean>;
    prompt(options: { title: string; placeholder?: string; initial?: string }): Promise<string | null>;
    pick<Item>(options: { title: string; items: readonly Item[]; label(item: Item): string }): Promise<Item | null>;
    openUrl(url: string): void;
    copy(text: string): void;
};

/** The project folder only. Needs `files.read` or `files.write`, except `open`. */
export const files: {
    readText(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    list(folder: string): Promise<{ path: string; name: string; kind: string }[]>;
    /** Calls back when the file or anything under the folder changes. Answers how to stop. */
    watch(path: string, listener: () => void): () => void;
    open(path: string): void;
};

/** Needs `git.read`. */
export const git: {
    status(repository?: string): Promise<unknown>;
    diff(options?: { repository?: string; path?: string }): Promise<unknown>;
    log(options?: { repository?: string; limit?: number }): Promise<unknown>;
};

/** `list` and `read` need `chats.read`, `send` needs `chats.send`. */
export const chats: {
    list(): Promise<unknown[]>;
    read(chatId: string): Promise<string>;
    send(chatId: string, text: string): Promise<void>;
};

type MachineAction = (input?: object) => Promise<any>;

/** `list` and `read` need `launches.read`, the rest `launches.run`. */
export const launches: Record<'list' | 'read' | 'start' | 'restart' | 'stop', MachineAction>;
/** `list` needs `routines.read`, the rest `routines.run`. */
export const routines: Record<'list' | 'run' | 'pause' | 'resume', MachineAction>;
/** `list` and `read` need `artifacts.read`, `publish` `artifacts.write`. */
export const artifacts: Record<'list' | 'read' | 'publish', MachineAction>;
/** Needs `browser.control`. */
export const browser: Record<'inspect' | 'navigate' | 'back' | 'forward' | 'reload' | 'screenshot', MachineAction>;
/** Needs `devices.control`. */
export const devices: Record<'list' | 'inspect' | 'screenshot' | 'tap' | 'launch', MachineAction>;

export const terminals: {
    /** Needs `terminals.read`. */
    read(terminal: NodeRef): Promise<string>;
    /** Needs `canvas.write`. Opens a shell and types nothing: only a person types in a terminal. */
    open(options?: { title?: string; cwd?: string; near?: NodeRef[] }): NodeRef | null;
};

/** Needs `database.read`. One SELECT or WITH statement on a read-only session, as for an agent. */
export const database: {
    connections(): Promise<{ id: string; name: string }[]>;
    query(connection: string, sql: string): Promise<{ columns: string[]; rows: unknown[][]; hasMore: boolean }>;
};

/** Needs `views.write`, except `open`. */
export const views: {
    open(view: ViewRef): void;
    createCanvas(name: string): ViewRef;
    rename(view: ViewRef, name: string): void;
};

export interface ContextSource {
    id: string;
    kind: string;
    title: string;
    text: string;
}

/** Needs the permission `context.read`. */
export const context: {
    read(of: { nodes?: NodeRef[]; view?: ViewRef }): Promise<ContextSource[]>;
};

export const agents: {
    /** Needs `agents.run`. One hidden prompt on a CLI of the person, with the answer whole. */
    run(options: { prompt: string; context?: string[]; provider?: string }): Promise<{ text: string }>;
    /** Needs `agents.run`. The same, in pieces as the CLI writes them. */
    stream(options: { prompt: string; context?: string[]; provider?: string; signal?: AbortSignal }): AsyncIterable<{ text: string }>;
    /** Needs `agents.start`. A chat a person sees and can stop, supervised at most: on the canvas in front, or a view of its own in the sidebar with none there. */
    start(options: { prompt?: string; provider?: string; title?: string; near?: NodeRef[] }): Promise<NodeRef>;
};

/** Needs `canvas.write`, except `reveal` and `select`. */
export const canvas: {
    createNote(note: { title?: string; text: string; near?: NodeRef[]; color?: string }): NodeRef | null;
    arrange(nodes: NodeRef[], layout: 'row' | 'column' | 'grid'): void;
    /** A person confirms first. Answers whether they did. */
    remove(nodes: NodeRef[]): Promise<boolean>;
    createFile(path: string, options?: { near?: NodeRef[] }): NodeRef | null;
    createBrowser(url: string, options?: { near?: NodeRef[] }): NodeRef | null;
    /** A node of this extension's own, by the id it gave `defineNode`. */
    createNode(type: string, options?: { data?: unknown; title?: string }): NodeRef | null;
    update(node: NodeRef, patch: { title?: string; x?: number; y?: number; width?: number; height?: number }): void;
    writeNote(node: NodeRef, text: string): void;
    group(nodes: NodeRef[]): NodeRef | null;
    link(from: NodeRef, to: NodeRef): void;
    unlink(from: NodeRef, to: NodeRef): void;
    select(nodes: NodeRef[]): void;
    reveal(target: NodeRef): void;
};
