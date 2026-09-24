import { Suspense, lazy, useState, useSyncExternalStore, type ComponentProps, type ComponentType } from 'react';
import { prefetcher } from '@/ui/prefetch';

/*
 * A module's component, loaded once and kept. `React.lazy` suspends for a tick even on a module the
 * prefetcher already has, which shows the fallback and mounts a dialog already open; a component
 * that is here is drawn straight away instead.
 */
export class LoadedComponent<Component> {
    current: Component | null = null;
    private readonly listeners = new Set<() => void>();
    private readonly loader: () => Promise<Component>;

    constructor(loader: () => Promise<Component>) {
        this.loader = loader;
    }

    async load(): Promise<Component> {
        const component = await this.loader();
        if (this.current === null) {
            this.current = component;
            for (const listener of this.listeners) {
                listener();
            }
        }
        return component;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}

/*
 * `React.lazy` for a module that exports its component by name, `default` included. Every module
 * loaded through here, or through `lazyDialog`, is prefetched once a workspace is idle.
 */
export function lazyNamed<Module extends Record<Name, ComponentType<any>>, Name extends keyof Module>(
    load: () => Promise<Module>,
    name: Name
): ComponentType<ComponentProps<Module[Name]>> {
    const loaded = new LoadedComponent(async () => (await load())[name]);
    prefetcher.register(() => loaded.load());
    const Lazy = lazy(async () => ({ default: await loaded.load() }));
    // Once `loaded` has it, `Lazy` never committed anything, so switching over remounts nothing.
    const LazyNamed = (props: ComponentProps<Module[Name]>) => {
        const Component: ComponentType<any> = loaded.current ?? Lazy;
        return <Component {...props} />;
    };
    return LazyNamed;
}

/* Stays true after the first opening, so every close after it still has something mounted to animate. */
function useOpenedOnce(open: boolean): boolean {
    const [opened, setOpened] = useState(open);
    if (open && !opened) {
        setOpened(true);
    }
    return opened || open;
}

/*
 * A dialog that keeps its own open state. Once its module is here, prefetched or opened, it stays
 * mounted closed, so its first opening animates like every other; before that, opening loads it.
 */
export function lazyDialog<Module extends Record<Name, ComponentType>, Name extends keyof Module, State>(
    load: () => Promise<Module>,
    name: Name,
    useStore: (select: (state: State) => boolean) => boolean,
    isOpen: (state: State) => boolean
): ComponentType {
    const loaded = new LoadedComponent(async (): Promise<ComponentType> => (await load())[name]);
    prefetcher.register(() => loaded.load());
    const Dialog = lazy(async (): Promise<{ default: ComponentType }> => ({ default: await loaded.load() }));
    const subscribe = (listener: () => void) => loaded.subscribe(listener);
    const isLoaded = () => loaded.current !== null;
    const LazyDialog = () => {
        const opened = useOpenedOnce(useStore(isOpen));
        useSyncExternalStore(subscribe, isLoaded);
        const Loaded: ComponentType | null = loaded.current;
        if (Loaded) {
            return <Loaded />;
        }
        if (!opened) {
            return null;
        }
        return (
            <Suspense fallback={null}>
                <Dialog />
            </Suspense>
        );
    };
    return LazyDialog;
}
