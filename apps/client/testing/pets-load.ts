import type { ExtensionManifest } from '@ruimte/contracts';
import petsManifest from '../../../extensions/pets/manifest.json';
import { loadOf, registerExtension } from '../src/extensions/host/loads';

/*
 * A load of the pets built-in, for a test of its modules on their own: they reach the extension API as they import, and
 * a load the client starts as it boots may not be in yet. The client's own load, once it comes, takes its place.
 */
try {
    loadOf(petsManifest.id);
} catch {
    registerExtension({ manifest: petsManifest as ExtensionManifest, base: '', disposers: [], settings: null, builtIn: true });
}
