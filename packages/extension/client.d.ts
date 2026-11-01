import type { ComponentType } from 'react';

/** A component is always handed over as a lazy import: `() => import('./Panel')`. */
export type LazyComponent<Props = {}> = () => Promise<{ default: ComponentType<Props> }>;
export type Surface<Props = {}> = { component: LazyComponent<Props> } | { frame: string };

export interface Handle {
    open(params?: unknown): void;
    close(): void;
    setBadge(text: string | null): void;
}

export interface NodeRef {
    id: string;
}

export interface ViewRef {
    id: string;
}

/** `icon` names a Lucide icon. Without one, a surface shows the extension's `assets/icon.svg`. */
export function definePanel(panel: { id: string; title: string; icon?: string; minWidth?: number } & Surface): Handle;
export function defineSidebarCard(card: { id: string; title: string; component: LazyComponent }): Handle;
export function defineView<Params = unknown>(view: { id: string; title: string; icon?: string } & Surface<{ params: Params }>): Handle;
export function defineNode<Data = unknown>(
    node: {
        id: string;
        title: string;
        icon?: string;
        size?: { width: number; height: number };
        initialData?: Data;
        dataVersion?: number;
        migrate?: (stored: unknown, fromVersion: number) => Data;
        plate?: string;
    } & Surface
): void;
export function defineCanvasOverlay(overlay: { id: string; component: LazyComponent }): void;
export function defineCommand(command: { id: string; title: string; run: () => void | Promise<void> }): void;
export function defineExtensionSettings(settings: { component: LazyComponent; keywords?: string[] }): void;

/** A place an action or menu shows. Yours to choose, and an action in a menu needs none of its own. */
export type ActionPlace = 'selectionBar' | 'nodeHeader' | 'nodeMenu';

export interface ActionTarget {
    /** In a bar or a command the selection, in a header that node, in a node's menu the selection if the node is in it. */
    nodes: { id: string; kind: string }[];
}

/**
 * While `run` is pending its nodes show a spinner and its button is disabled, and a throw is shown to the person.
 * Without `show` it is only in the command palette.
 */
export function defineAction(action: {
    id: string;
    title: string;
    /** A Lucide icon. */
    icon?: string;
    show?: (ActionPlace | 'commands')[];
    when?: (target: ActionTarget) => boolean;
    run: (target: ActionTarget) => void | Promise<void>;
}): void;

/** A menu of your own: a submenu in a node's menu, a dropdown in a bar or header. `items` are ids of actions. */
export function defineMenu(menu: { id: string; title: string; icon?: string; show: ActionPlace[]; items: string[] }): void;

/** Your own UI in a node's header, beside its buttons. Keep it small. */
export function defineNodeHeader(header: { id: string; when?: (node: { id: string; kind: string }) => boolean; component: LazyComponent<{ nodeId: string }> }): void;

/** For drawing your own loading state of an action. */
export function useActionRunning(actionId: string): boolean;

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
export function useStorage<Value>(key: string, initial: Value): [Value, (next: Value) => void];
export function useProject(): { id: string; name: string };
export function useActiveView(): ViewRef;
export function useSelection(): NodeRef[];
export function useCanvasNodes(): { id: string; kind: string; title: string; x: number; y: number; width: number; height: number }[];
/** Needs the permission `agents.status`. */
export function useAgents(): { id: string; title: string; status: string | undefined; needsYou: boolean }[];

/** Needs the permission `usage.read`. `used` runs from 0 to 1. */
export function useUsageLimits(): { provider: string; plan: string | null; windows: { label: string; used: number; resetsAt: number | null }[] }[];

export const host: {
    /** Marks work that is no action as busy: a spinner on `nodes` until it is done. */
    busy<Result>(work: { title: string; nodes?: NodeRef[] }, run: () => Result | Promise<Result>): Promise<Result>;
    notify(text: string, options?: { tone?: 'neutral' | 'error' }): void;
    confirm(options: { title: string; body: string }): Promise<boolean>;
    openUrl(url: string): void;
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

/** Needs the permission `agents.run`. One prompt on a CLI of the person, with the answer whole. */
export const agents: {
    run(options: { prompt: string; context?: string[]; provider?: string }): Promise<{ text: string }>;
};

/** Needs the permission `canvas.write`, except `reveal`. */
export const canvas: {
    createNote(note: { title?: string; text: string; near?: NodeRef[] }): NodeRef | null;
    link(from: NodeRef, to: NodeRef): void;
    reveal(target: NodeRef): void;
};
