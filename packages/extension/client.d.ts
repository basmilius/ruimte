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

export function definePanel(panel: { id: string; title: string; icon: string; minWidth?: number } & Surface): Handle;
export function defineSidebarCard(card: { id: string; title: string; component: LazyComponent }): Handle;
export function defineView<Params = unknown>(view: { id: string; title: string; icon?: string } & Surface<{ params: Params }>): Handle;
export function defineNode<Data = unknown>(
    node: {
        id: string;
        title: string;
        icon: string;
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

export interface Action<Target> {
    id: string;
    title: string;
    icon?: string;
    when?: (target: Target) => boolean;
    run: (target: Target) => void | Promise<void>;
}

export function defineCanvasAction(action: Action<{ selection: NodeRef[] }>): void;
export function defineNodeMenuItem(action: Action<{ node: NodeRef }>): void;

/** Each method calls `server/` on the machine in front; `.use()` suspends until it answers. */
export type ServerClient<Server> = {
    [Method in keyof Server]: Server[Method] extends (...args: infer Args) => Promise<infer Result>
        ? ((...args: Args) => Promise<Result>) & { use(...args: Args): Result }
        : never;
};

export function useServer<Server>(): ServerClient<Server>;
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
