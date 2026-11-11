import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_API, builtInModule } from './built-ins';

const PETS = fileURLToPath(new URL('../../extensions/pets/client/', import.meta.url)).replaceAll('\\', '/');
const EXTENSION_UI = fileURLToPath(new URL('./src/extensions/host/extension-ui.ts', import.meta.url)).replaceAll('\\', '/');
const POC = fileURLToPath(new URL('../../extensions/poc/surfaces/client/index.ts', import.meta.url)).replaceAll('\\', '/');

describe('a built-in as the client builds it', () => {
    test('binds its imports of the API to the API of its own id, and the rest to what the client supplies', () => {
        const code = 'import { useNodes } from \'@ruimte/extension/client\';\nimport { Tooltip } from "@ruimte/extension/ui";\n';

        expect(builtInModule(`${PETS}PetFigure.tsx`, code)).toBe(
            `import { useNodes } from '${BUILT_IN_API}?extension=ruimte.pets&lang.ts';\nimport { Tooltip } from "${EXTENSION_UI}";\n`
        );
    });

    test('leaves a file outside a built-in alone', () => {
        expect(builtInModule(POC, "import { defineCommand } from '@ruimte/extension/client';")).toBeNull();
    });

    test('makes its entry a function a load calls, with its imports above it', () => {
        const code = "import { defineCommand } from '@ruimte/extension/client';\n\ndefineCommand({ id: 'a', title: 'A', run: () => {} });\n";
        const module = builtInModule(`${PETS}index.ts?activate`, code) ?? '';

        expect(module.indexOf('import { defineCommand }')).toBeLessThan(module.indexOf('export default function activate(): void {'));
        expect(module).toContain("defineCommand({ id: 'a', title: 'A', run: () => {} });\n\n}");
    });

    test('refuses an entry that exports something, which no load could reach', () => {
        expect(() => builtInModule(`${PETS}index.ts?activate`, 'export const a = 1;')).toThrow("a built-in's entry exports nothing");
    });

    test('gives the API module the id of the built-in that imports it', () => {
        expect(builtInModule(`${BUILT_IN_API}?extension=ruimte.pets`, 'const EXTENSION_ID: string = builtInExtensionId();')).toBe(
            'const EXTENSION_ID: string = "ruimte.pets";'
        );
    });
});
