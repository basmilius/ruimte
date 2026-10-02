import { lazy, type ComponentProps, type ComponentType } from 'react';

type Loader = () => Promise<unknown>;

const loaders: Loader[] = [];
let register: ((load: Loader) => void) | null = null;
const openErrorListeners = new Set<(error: unknown) => void>();

/*
 * Hands every module the chat loads lazily to the app's prefetcher: the ones made so far, and each
 * one made from now on. Without it they load on their first render, as `React.lazy` does.
 */
export const setLazyPrefetch = (next: (load: Loader) => void): void => {
    register = next;
    for (const load of loaders) {
        next(load);
    }
};

/*
 * Tells `listener` when a module the chat loads for a render fails to load, the way `onLazyOpenError`
 * of `@basmilius/desktop-ui` does for the app's own. A failed prefetch never reaches it.
 */
export const onLazyOpenError = (listener: (error: unknown) => void): (() => void) => {
    openErrorListeners.add(listener);
    return () => {
        openErrorListeners.delete(listener);
    };
};

/*
 * `React.lazy` for a module that exports its component by name, `default` included. Once the module
 * is here the component is drawn straight away, since `React.lazy` suspends for a tick even on a
 * module the prefetcher already fetched.
 */
export function lazyNamed<Module extends Record<Name, ComponentType<any>>, Name extends keyof Module>(
    load: () => Promise<Module>,
    name: Name
): ComponentType<ComponentProps<Module[Name]>> {
    let loaded: ComponentType<any> | null = null;
    const open = async (): Promise<ComponentType<any>> => {
        const component = (await load())[name];
        loaded ??= component;
        return component;
    };
    loaders.push(open);
    register?.(open);
    // Only a render loads through here; a prefetch calls `open` itself, so its failures report nothing.
    const Lazy = lazy(async () => {
        try {
            return { default: await open() };
        } catch (error) {
            for (const listener of openErrorListeners) {
                listener(error);
            }
            throw error;
        }
    });
    const LazyNamed = (props: ComponentProps<Module[Name]>) => {
        const Component: ComponentType<any> = loaded ?? Lazy;
        return <Component {...props} />;
    };
    return LazyNamed;
}
