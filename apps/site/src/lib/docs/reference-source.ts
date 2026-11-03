import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDeclarations, type ReferenceModule } from './reference.ts';

export const REFERENCE_MODULES = ['client', 'server', 'ui', 'charts', 'agents-ui', 'testing'] as const;

const TYPES_FOLDER = join(import.meta.dir, '../../../../../packages/extension');

/* Read only by the script and the test: the site itself draws the committed JSON. */
export function referenceModules(): ReferenceModule[] {
    return REFERENCE_MODULES.map((module) => ({
        module,
        entries: parseDeclarations(readFileSync(join(TYPES_FOLDER, `${module}.d.ts`), 'utf8'))
    }));
}
