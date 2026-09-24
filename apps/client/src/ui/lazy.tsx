import { Suspense, lazy, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { prefetcher } from '@/ui/prefetch';

/*
 * `React.lazy` for a module that exports its component by name, `default` included. Every module
 * loaded through here, or through `lazyDialog`, is prefetched once a workspace is idle.
 */
export function lazyNamed<Module extends Record<Name, ComponentType<any>>, Name extends keyof Module>(
    load: () => Promise<Module>,
    name: Name
): LazyExoticComponent<Module[Name]> {
    prefetcher.register(load);
    return lazy(async () => ({ default: (await load())[name] }));
}

/* Stays true after the first opening, so every close after it still has something mounted to animate. */
function useOpenedOnce(open: boolean): boolean {
    const [opened, setOpened] = useState(open);
    if (open && !opened) {
        setOpened(true);
    }
    return opened || open;
}

/* A dialog that keeps its own open state, loaded the first time that state opens it. */
export function lazyDialog<Module extends Record<Name, ComponentType>, Name extends keyof Module, State>(
    load: () => Promise<Module>,
    name: Name,
    useStore: (select: (state: State) => boolean) => boolean,
    isOpen: (state: State) => boolean
): ComponentType {
    prefetcher.register(load);
    const Dialog = lazy(async (): Promise<{ default: ComponentType }> => ({ default: (await load())[name] }));
    const LazyDialog = () => {
        const opened = useOpenedOnce(useStore(isOpen));
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
