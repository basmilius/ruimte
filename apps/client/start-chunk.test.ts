import { describe, expect, test } from 'bun:test';
import { preloadedWorkspaceModules } from './start-chunk.ts';

const APP = '/repo/apps/client/src';
const NPM = '/repo/node_modules/.bun/@adecore+editor@1.0.0/node_modules/@adecore';
const LINKED = '/home/adecore/packages';

function chunk(modules: Record<string, number>, imports: string[] = [], isEntry = false) {
    return {
        type: 'chunk' as const,
        isEntry,
        imports,
        modules: Object.fromEntries(Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }]))
    };
}

describe('what the start screen preloads', () => {
    test('a workspace module the entry imports statically is named with its chunk', () => {
        const bundle = {
            'assets/index.js': chunk({ [`${APP}/main.tsx`]: 100 }, ['assets/menu.js'], true),
            'assets/menu.js': chunk({ [`${APP}/shell/menu/actions.ts`]: 50 }, ['assets/commands.js']),
            'assets/commands.js': chunk({ [`${APP}/shell/commands.ts`]: 80, [`${NPM}/editor/src/index.ts`]: 10 })
        };
        expect(preloadedWorkspaceModules(bundle)).toEqual([`assets/commands.js: ${APP}/shell/commands.ts`, `assets/commands.js: ${NPM}/editor/src/index.ts`]);
    });

    test('a workspace module behind a dynamic import is not preloaded', () => {
        const bundle = {
            'assets/index.js': chunk({ [`${APP}/main.tsx`]: 100 }, [], true),
            'assets/WorkspaceShell.js': chunk({ [`${APP}/shell/WorkspaceShell.tsx`]: 500, [`${LINKED}/editor-core/src/index.ts`]: 300 }),
            'assets/style.css': { type: 'asset' as const }
        };
        expect(preloadedWorkspaceModules(bundle)).toEqual([]);
    });

    test('the shared wasm module is still a workspace dependency when externalized', () => {
        const wasm = '/assets/shiki-4.5.0/wasm.mjs';
        const bundle = { 'assets/index.js': chunk({ [`${APP}/main.tsx`]: 100 }, [wasm], true) };
        expect(preloadedWorkspaceModules(bundle)).toEqual([`assets/index.js: ${wasm}`]);
    });

    test('the editor key table and view state, and what tree shaking dropped, are allowed', () => {
        const bundle = {
            'assets/index.js': chunk(
                {
                    [`${LINKED}/editor/src/keymap-table.ts`]: 40,
                    [`${NPM}/editor-react/src/view-state.ts`]: 20,
                    [`${LINKED}/drawing/src/svg.ts`]: 0
                },
                [],
                true
            )
        };
        expect(preloadedWorkspaceModules(bundle)).toEqual([]);
    });

    test('the drawing painters, the SQL console and the grammars count as the workspace', () => {
        const modules = [
            '/repo/node_modules/.bun/roughjs@4.6.6/node_modules/roughjs/bundled/rough.esm.js',
            '/repo/node_modules/.bun/@shikijs+langs@4.4.3/node_modules/@shikijs/langs/dist/php.mjs',
            `${APP}/drawing/paint.ts`,
            `${APP}/database/sql-bindings.ts`,
            `${LINKED}/diagram/src/svg.ts`,
            `${NPM}/editor-react/src/EditorView.tsx`
        ];
        const bundle = { 'assets/index.js': chunk(Object.fromEntries(modules.map((id) => [id, 1])), [], true) };
        expect(preloadedWorkspaceModules(bundle)).toHaveLength(modules.length);
    });
});
