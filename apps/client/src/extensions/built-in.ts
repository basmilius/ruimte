/* The one place that names a built-in. Each is data and lazy code: what it defines loads once it is on, its surfaces when they first draw. */
import petsManifest from '@extensions/pets/manifest.json';
import umbraManifest from '@extensions/theme-umbra/manifest.json';
import umbraTheme from '@extensions/theme-umbra/themes/umbra.json';
import { ExtensionManifestSchema, ExtensionThemeSchema } from '@ruimte/contracts';
import { PawPrint } from 'lucide-react';
import { defineBuiltIn } from '@/extensions/built-ins';

defineBuiltIn({
    manifest: ExtensionManifestSchema.parse(petsManifest),
    icon: PawPrint,
    activate: () => import('@extensions/pets/client/index.ts?activate'),
    words: {
        en: () => import('@extensions/pets/locales/en.json'),
        nl: () => import('@extensions/pets/locales/nl.json')
    }
});

defineBuiltIn({
    manifest: ExtensionManifestSchema.parse(umbraManifest),
    themes: [
        {
            path: 'themes/umbra.json',
            theme: ExtensionThemeSchema.parse(umbraTheme),
            thumbnailUrl: new URL('../../../../extensions/theme-umbra/themes/umbra.svg', import.meta.url).href
        }
    ]
});
