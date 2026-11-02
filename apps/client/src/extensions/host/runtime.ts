import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactDom from 'react-dom';
import * as ui from '@adecore/ui';
import { consoleFor } from '@/extensions/dev-log';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';

/*
 * What a pack reads instead of bundling: `ruimte extension pack` rewrites every import of React, the
 * components and the API to `globalThis.__ruimteExtension.for(id)`. Loaded with the first extension, so a
 * client without any carries none of this. A module of an extension is fully trusted code in this page; this is
 * not a boundary, only how it finds what it shares with Ruimte.
 */
type ClientApi = ReturnType<typeof clientApiFor>;

interface Load {
    extension: LoadedExtension;
    generation: number;
    api?: ClientApi;
}

const extensions = new Map<string, Load>();
let generations = 0;

// Bound to this load, so a module that registers after it was taken down adds nothing.
function apiOf(id: string, load: Load): ClientApi {
    load.api ??= clientApiFor(load.extension, () => extensions.get(id)?.generation === load.generation);

    return load.api;
}

/*
 * A version turned on again imports only its entry anew: a chunk the page ran before keeps the client it was handed
 * then. That client speaks for the load in place while it is of the same version, so the chunk registers and calls
 * through it; a load of another version, or none, leaves it the load it began with, which adds nothing.
 */
function clientOf(id: string, load: Load): ClientApi {
    return new Proxy(apiOf(id, load), {
        get(own, property) {
            const current = extensions.get(id);
            const api = current !== undefined && current.extension === load.extension ? apiOf(id, current) : own;

            return Reflect.get(api, property);
        }
    });
}

(globalThis as Record<string, unknown>).__ruimteExtension = {
    for(id: string) {
        const load = extensions.get(id);

        if (load === undefined) {
            throw new Error(`Extension ${id} is not loaded`);
        }

        return { react: React, jsxRuntime, reactDom, ui, client: clientOf(id, load), console: consoleFor(id, load.extension.dev === true) };
    }
};

/* Starts a load of the extension and answers whether that load is still the one in place. */
export function registerExtension(extension: LoadedExtension): () => boolean {
    const id = extension.manifest.id;
    const generation = ++generations;

    extensions.set(id, { extension, generation });

    return () => extensions.get(id)?.generation === generation;
}

export function forgetExtension(id: string): void {
    const extension = extensions.get(id)?.extension;

    // Emptied, since the same extension comes back when it is turned on again.
    for (const dispose of extension?.disposers.splice(0) ?? []) {
        dispose();
    }

    extensions.delete(id);
}
