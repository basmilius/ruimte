import { mock } from 'bun:test';
import * as ui from '@adecore/ui';
import type { ExtensionManifest } from '@ruimte/contracts';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';

/*
 * Loads a POC's `client/index.ts` the way a pack does, with the imports a pack rewrites answered by the
 * real API. A module evaluates once, and a lazy surface imports the API later, so a test file holds one POC.
 */
export async function loadPoc(name: string): Promise<LoadedExtension> {
    const manifest: ExtensionManifest = { id: `poc.${name}`, name: `POC ${name}`, version: '0.1.0', api: 1, permissions: {} };
    const extension: LoadedExtension = { manifest, base: '/', disposers: [], settings: null };
    const client = clientApiFor(extension);

    await mock.module('@ruimte/extension/client', () => client);
    await mock.module('@ruimte/extension/ui', () => ui);
    await import(`../../../extensions/poc-${name}/client/index.ts`);

    return extension;
}
