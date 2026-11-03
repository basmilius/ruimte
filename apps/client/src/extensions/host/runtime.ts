import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactDom from 'react-dom';
import * as agentsUi from '@adecore/agents-react/chat/ui';
import * as charts from '@adecore/charts';
import * as ui from '@adecore/ui';
import { consoleFor } from '@/extensions/dev-log';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';

/*
 * What a pack reads instead of bundling: `ruimte extension pack` rewrites every import of React, the
 * components and the API to `globalThis.__ruimteExtension.for(id, import.meta.url)`. Loaded with the first extension, so a
 * client without any carries none of this. A module of an extension is fully trusted code in this page; this is
 * not a boundary, only how it finds what it shares with Ruimte.
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
function loadOf(id: string, address: unknown): Load {
    const load = extensions.get(id);

    if (load === undefined) {
        throw new Error(`Extension ${id} is not loaded`);
    }

    if (load.root !== undefined && typeof address === 'string' && !decodeURIComponent(address).includes(load.root)) {
        throw new Error(`Extension ${id} was turned off or replaced`);
    }

    return load;
}

(globalThis as Record<string, unknown>).__ruimteExtension = {
    for(id: string, address?: string) {
        const load = loadOf(id, address);

        return { react: React, jsxRuntime, reactDom, ui, charts, agentsUi, client: apiOf(id, load), console: consoleFor(id, load.extension.dev === true) };
    }
};

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
