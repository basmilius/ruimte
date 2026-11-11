import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';

/*
 * Every extension the page runs, by id, with the API bound to that load. An installed extension reaches it through
 * `runtime.ts`, a built-in through `built-in-api.ts`; both go through the same load, permissions and lifecycle.
 */
type ClientApi = ReturnType<typeof clientApiFor>;

interface Load {
    extension: LoadedExtension;
    generation: number;
    // Where every module of this load is asked for, ending in a slash; none for a load imported from where it lies.
    root?: string;
    api?: ClientApi;
}

const extensions = new Map<string, Load>();
let generations = 0;

// Bound to this load for good, so what a module of it calls after it was taken down or replaced does nothing.
function apiOf(id: string, load: Load): ClientApi {
    load.api ??= clientApiFor(load.extension, () => extensions.get(id)?.generation === load.generation);

    return load.api;
}

/*
 * A pack hands in the address of the module that asks. A chunk of a load taken down or replaced that runs only now,
 * such as a lazy one, gets nothing: it belongs to a load that is gone, never to the one in place.
 */
export function loadOf(id: string, address?: unknown): { extension: LoadedExtension; api: ClientApi } {
    const load = extensions.get(id);

    if (load === undefined) {
        throw new Error(`Extension ${id} is not loaded`);
    }

    if (load.root !== undefined && typeof address === 'string' && !decodeURIComponent(address).includes(load.root)) {
        throw new Error(`Extension ${id} was turned off or replaced`);
    }

    return { extension: load.extension, api: apiOf(id, load) };
}

/* Starts a load of the extension under `root` and answers whether that load is still the one in place. */
export function registerExtension(extension: LoadedExtension, root?: string): () => boolean {
    const id = extension.manifest.id;
    const generation = ++generations;

    extensions.set(id, { extension, generation, ...(root === undefined ? {} : { root }) });

    return () => extensions.get(id)?.generation === generation;
}

export function forgetExtension(id: string): void {
    const extension = extensions.get(id)?.extension;

    for (const dispose of extension?.disposers.splice(0) ?? []) {
        dispose();
    }

    extensions.delete(id);
}
