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
const extensions = new Map<string, { extension: LoadedExtension; generation: number }>();
const apis = new Map<string, ReturnType<typeof clientApiFor>>();
let generations = 0;

(globalThis as Record<string, unknown>).__ruimteExtension = {
    for(id: string) {
        const loaded = extensions.get(id);

        if (loaded === undefined) {
            throw new Error(`Extension ${id} is not loaded`);
        }

        const { extension, generation } = loaded;
        let client = apis.get(id);

        if (client === undefined) {
            // Bound to this load, so a module that registers after it was taken down adds nothing.
            client = clientApiFor(extension, () => extensions.get(id)?.generation === generation);
            apis.set(id, client);
        }

        return { react: React, jsxRuntime, reactDom, ui, client, console: consoleFor(id, extension.dev === true) };
    }
};

/* Starts a load of the extension and answers whether that load is still the one in place. */
export function registerExtension(extension: LoadedExtension): () => boolean {
    const id = extension.manifest.id;
    const generation = ++generations;

    extensions.set(id, { extension, generation });
    apis.delete(id);

    return () => extensions.get(id)?.generation === generation;
}

export function forgetExtension(id: string): void {
    const extension = extensions.get(id)?.extension;

    // Emptied, since the same extension comes back when it is turned on again.
    for (const dispose of extension?.disposers.splice(0) ?? []) {
        dispose();
    }

    extensions.delete(id);
    apis.delete(id);
}
