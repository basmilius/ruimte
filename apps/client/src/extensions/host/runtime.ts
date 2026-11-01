import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactDom from 'react-dom';
import * as ui from '@adecore/ui';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';

/*
 * What a pack reads instead of bundling: `ruimte extension pack` rewrites every import of React, the
 * components and the API to `globalThis.__ruimteExtension.for(id)`. Loaded with the first extension, so a
 * client without any carries none of this. A module of an extension is fully trusted code in this page; this is
 * not a boundary, only how it finds what it shares with Ruimte.
 */
const extensions = new Map<string, LoadedExtension>();
const apis = new Map<string, ReturnType<typeof clientApiFor>>();

(globalThis as Record<string, unknown>).__ruimteExtension = {
    for(id: string) {
        const extension = extensions.get(id);

        if (extension === undefined) {
            throw new Error(`Extension ${id} is not loaded`);
        }

        let client = apis.get(id);

        if (client === undefined) {
            client = clientApiFor(extension);
            apis.set(id, client);
        }

        return { react: React, jsxRuntime, reactDom, ui, client };
    }
};

export function registerExtension(extension: LoadedExtension): void {
    extensions.set(extension.manifest.id, extension);
    apis.delete(extension.manifest.id);
}

export function forgetExtension(id: string): void {
    const extension = extensions.get(id);

    for (const dispose of extension?.disposers ?? []) {
        dispose();
    }

    extensions.delete(id);
    apis.delete(id);
}
