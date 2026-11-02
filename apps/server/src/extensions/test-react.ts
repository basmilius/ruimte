/*
 * The project's own React, for the hooks and the page of a test host. Loaded only when a test draws, so a project of
 * `server/` alone needs none, and resolved from the project, so it is the copy the extension's code imports too.
 */
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface ReactModule {
    createElement(type: unknown, props?: object | null, ...children: unknown[]): unknown;
    createContext<Value>(initial: Value): { Provider: unknown };
    useContext<Value>(context: { Provider: unknown }): Value;
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useSyncExternalStore<Value>(subscribe: (listener: () => void) => () => void, snapshot: () => Value): Value;
    use<Value>(promise: Promise<Value>): Value;
    Suspense: unknown;
    Component: new (props: object) => { props: object; state: unknown };
    act(callback: () => Promise<void>): Promise<void>;
    version: string;
}

export interface ReactDomClient {
    createRoot(container: Element, options?: { onCaughtError?: (error: unknown) => void }): { render(element: unknown): void; unmount(): void };
}

let nodeContext: { Provider: unknown } | null = null;

/* A module the project depends on, resolved from the folder the test runs in. */
export function fromProject<Module>(name: string): Module {
    try {
        return createRequire(join(process.cwd(), 'package.json'))(name) as Module;
    } catch {
        throw new Error(
            `This test needs ${name}, which this project does not have: bun add -d ${name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]}`
        );
    }
}

/*
 * A module of `@adecore/ui`, which `@ruimte/extension` depends on: from beside that package, since an isolated install
 * keeps it out of the project's own `node_modules`, or from the project.
 */
function besideExtension<Module>(name: string): Module {
    const extension = join(process.cwd(), 'node_modules', '@ruimte', 'extension', 'package.json');

    try {
        return createRequire(realpathSync(extension))(name) as Module;
    } catch {
        return fromProject<Module>(name);
    }
}

export function formatModule<Module>(): Module {
    return besideExtension<Module>('@adecore/ui/format');
}

/* `@ruimte/extension/ui`, which Ruimte answers with the components of `@adecore/ui`. */
export function uiModule(): Record<string, unknown> {
    return besideExtension<Record<string, unknown>>('@adecore/ui');
}

export function react(): ReactModule {
    return fromProject<ReactModule>('react');
}

/* The node a surface draws, for `useNodeData`. */
export function nodeContextOf(module: ReactModule): { Provider: unknown } {
    nodeContext ??= module.createContext<string | null>(null);

    return nodeContext;
}
