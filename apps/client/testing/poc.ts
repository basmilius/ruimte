import { mock } from 'bun:test';
import type { ExtensionManifest } from '@ruimte/contracts';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';
import * as ui from '@/extensions/host/extension-ui';

/*
 * Loads a development extension's `client/index.ts` the way a pack does, with the imports a pack rewrites answered by
 * the real API. A module evaluates once, and a lazy surface imports the API later, so a test file holds one extension.
 */
async function loadDevelopment(folder: string, id: string, name: string): Promise<LoadedExtension> {
    const manifest: ExtensionManifest = { id, name, version: '0.1.0', api: 1, permissions: {} };
    const extension: LoadedExtension = { manifest, base: '/', disposers: [], settings: null };
    const client = clientApiFor(extension);

    await mock.module('@ruimte/extension/client', () => client);
    await mock.module('@ruimte/extension/ui', () => ui);
    await import(`../../../extensions/${folder}/client/index.ts`);

    return extension;
}

/* One of `extensions/poc`, with no permission until a test gives it one. */
export function loadPoc(name: string): Promise<LoadedExtension> {
    return loadDevelopment(`poc/${name}`, `poc.${name}`, `POC ${name}`);
}

/* One of the products in `extensions/dev`, under the name a person reads, with no permission until a test gives it one. */
export function loadProduct(name: string, title: string): Promise<LoadedExtension> {
    return loadDevelopment(`dev/${name}`, `dev.${name}`, title);
}
