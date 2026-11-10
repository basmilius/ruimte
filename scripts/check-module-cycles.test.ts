import { describe, expect, test } from 'bun:test';
import { describeCycles, moduleCycles, moduleEdges, workspaceFrom, type Workspace } from './check-module-cycles.ts';

const WORKSPACES: Workspace[] = [
    { directory: '', name: 'root' },
    { directory: 'apps/client', name: '@example/client' },
    { directory: 'packages/contracts', name: '@example/contracts' }
];

function cyclesIn(files: Record<string, string>) {
    return moduleCycles(moduleEdges(new Map(Object.entries(files)), WORKSPACES));
}

describe('moduleCycles', () => {
    test('finds no cycle when imports run one way', () => {
        const cycles = cyclesIn({
            'apps/client/src/chat/view.tsx': "import { store } from '@/state/store';\nimport { Message } from '@example/contracts/chat';",
            'apps/client/src/state/store.ts': "import type { Message } from '@example/contracts';\nexport const store = {};",
            'packages/contracts/src/index.ts': "export * from './chat';",
            'packages/contracts/src/chat.ts': 'export const Message = {};'
        });

        expect(cycles).toEqual([]);
    });

    test('names the modules of a cycle and one import per hop, type-only imports included', () => {
        const cycles = cyclesIn({
            'apps/client/src/chat/view.tsx': "\nimport { store } from '@/state/store';",
            'apps/client/src/state/store.ts': "import type { View } from '../chat/view';\nexport const store = {};"
        });

        expect(cycles).toEqual([
            {
                modules: ['apps/client/src/chat', 'apps/client/src/state'],
                hops: [
                    {
                        from: 'apps/client/src/chat',
                        to: 'apps/client/src/state',
                        site: { file: 'apps/client/src/chat/view.tsx', line: 2, specifier: '@/state/store' }
                    },
                    {
                        from: 'apps/client/src/state',
                        to: 'apps/client/src/chat',
                        site: { file: 'apps/client/src/state/store.ts', line: 1, specifier: '../chat/view' }
                    }
                ]
            }
        ]);
        expect(describeCycles(cycles)).toContain("apps/client/src/chat/view.tsx:2 imports '@/state/store'");
    });

    test('follows a workspace package and a dynamic import across workspaces', () => {
        const cycles = cyclesIn({
            'apps/client/src/chat/view.tsx': "const contracts = await import('@example/contracts');",
            'packages/contracts/src/index.ts': "export { view } from '../../../apps/client/src/chat/view';"
        });

        expect(cycles.map((cycle) => cycle.modules)).toEqual([['apps/client/src/chat', 'packages/contracts/src/index']]);
    });

    test('follows the source condition of a package export into another folder', () => {
        const contracts = workspaceFrom(
            'packages/contracts/package.json',
            JSON.stringify({
                name: '@example/contracts',
                exports: {
                    './prompts': { types: './dist/chat/prompts/index.d.ts', source: './src/chat/prompts/index.ts' },
                    './words/*': { source: './src/words/*.ts' }
                }
            })
        );
        const sources = new Map(
            Object.entries({
                'apps/client/src/chat/view.tsx': "import { prompts } from '@example/contracts/prompts';\nimport en from '@example/contracts/words/en';",
                'packages/contracts/src/chat/prompts/index.ts': 'export const prompts = [];',
                'packages/contracts/src/words/en.ts': 'export default {};'
            })
        );
        const edges = moduleEdges(sources, [WORKSPACES[0], WORKSPACES[1], ...(contracts ? [contracts] : [])]);

        expect([...(edges.get('apps/client/src/chat')?.keys() ?? [])]).toEqual(['packages/contracts/src/chat', 'packages/contracts/src/words']);
    });

    test('leaves out tests and testing helpers', () => {
        const cycles = cyclesIn({
            'apps/client/src/chat/view.tsx': "import { store } from '@/state/store';",
            'apps/client/src/state/store.ts': 'export const store = {};',
            'apps/client/src/state/store.test.ts': "import { view } from '@/chat/view';",
            'apps/client/src/state/testing/fake.ts': "import { view } from '@/chat/view';"
        });

        expect(cycles).toEqual([]);
    });
});
