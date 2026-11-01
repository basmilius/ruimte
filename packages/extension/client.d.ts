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
/** Your own UI over the app. `open` answers what `close` was given, or null when a person dismissed it. */
export function defineOverlay<Params = void, Result = void>(overlay: {
    id: string;
    title: string;
    size?: 'sm';
    component: LazyComponent<{ params: Params; close(result?: Result): void }>;
}): { open(params: Params): Promise<Result | null>; close(): void };
export function defineCommand(command: { id: string; title: string; run: () => void | Promise<void> }): void;
export function defineExtensionSettings(settings: { component: LazyComponent; keywords?: string[] }): void;

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
    composer: { chat: { id: string }; node: NodeInfo };
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
    slots: Slots<Place>;
    run(context: ContextOf<Place> & { slot: Place; signal: AbortSignal }): void | Promise<void>;
}): ActionHandle;
export function defineAction<Context = {}>(action: {
    id: string;
    title: string;
    icon?: string;
    run(context: BaseContext & Context & { slot: string; signal: AbortSignal }): void | Promise<void>;
}): ActionHandle;

export type MenuItem = ActionHandle | 'separator' | { title: string; run(): void; checked?: boolean } | { title: string; items: MenuItem[] };

/** A menu of your own: a submenu in a menu, a dropdown in a bar. */
export function defineMenu(menu: { id: string; title: string; icon?: string; slots: Partial<Slots>; items: MenuItem[] | ((context: BaseContext) => MenuItem[]) }): void;

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
    notify(text: string, options?: { tone?: 'neutral' | 'error' }): void;
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
    open(path: string): void;
};

/** Needs `git.read`. */
export const git: {
    status(repository?: string): Promise<unknown>;
    log(options?: { repository?: string; limit?: number }): Promise<unknown>;
};

/** `list` and `read` need `chats.read`, `send` needs `chats.send`. */
export const chats: {
    list(): Promise<unknown[]>;
    read(chatId: string): Promise<string>;
    send(chatId: string, text: string): Promise<void>;
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
    /** Needs `agents.start`. A chat a person sees on the canvas, follows and can stop. */
    start(options: { prompt?: string; provider?: string; title?: string; near?: NodeRef[] }): Promise<NodeRef>;
};

/** Needs `canvas.write`, except `reveal` and `select`. */
export const canvas: {
    createNote(note: { title?: string; text: string; near?: NodeRef[] }): NodeRef | null;
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
