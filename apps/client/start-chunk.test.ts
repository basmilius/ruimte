import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preloadedWorkspaceModules } from './start-chunk.ts';
import { START_SCREEN_MODULES } from './start-screen-modules.ts';

const APP = '/repo/apps/client/src';
const NPM = '/repo/node_modules/.bun/@adecore+editor@1.0.0/node_modules/@adecore';
const LINKED = '/home/adecore/packages';
const LISTED = ['main.tsx', 'shell/menu/actions.ts', 'chat/generated-commands.ts', 'chat/worker.ts'];

function chunk(modules: Record<string, number>, imports: string[] = [], isEntry = false) {
    return {
        type: 'chunk' as const,
        isEntry,
        imports,
        modules: Object.fromEntries(Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }]))
    };
}

describe('what the start screen preloads', () => {
    test('a client module off the list, or a workspace module of a package, the entry imports statically is named with its chunk', () => {
        const bundle = {
            'assets/index.js': chunk({ [`${APP}/main.tsx`]: 100 }, ['assets/menu.js'], true),
            'assets/menu.js': chunk({ [`${APP}/shell/menu/actions.ts`]: 50 }, ['assets/commands.js']),
            'assets/commands.js': chunk({ [`${APP}/chat/ForkDialog.tsx`]: 80, [`${NPM}/editor/src/index.ts`]: 10 })
        };
        expect(preloadedWorkspaceModules(bundle, LISTED)).toEqual([
            `assets/commands.js: ${APP}/chat/ForkDialog.tsx`,
            `assets/commands.js: ${NPM}/editor/src/index.ts`
        ]);
    });

    test('a client module is judged by its path under the sources, without its query', () => {
        const bundle = {
            'assets/index.js': chunk(
                { [`${APP}/chat/generated-commands.ts`]: 40, [`${APP}/chat/worker.ts?worker`]: 10, [`${APP}/views/commands.ts`]: 60 },
                [],
                true
            )
        };
        expect(preloadedWorkspaceModules(bundle, LISTED)).toEqual([`assets/index.js: ${APP}/views/commands.ts`]);
    });

    test('a module behind a dynamic import is not preloaded', () => {
        const bundle = {
            'assets/index.js': chunk({ [`${APP}/main.tsx`]: 100 }, [], true),
            'assets/WorkspaceShell.js': chunk({ [`${APP}/shell/WorkspaceShell.tsx`]: 500, [`${LINKED}/editor-core/src/index.ts`]: 300 }),
            'assets/style.css': { type: 'asset' as const }
        };
        expect(preloadedWorkspaceModules(bundle, LISTED)).toEqual([]);
    });

    test.each(['wasm.mjs', 'langs/php.mjs', 'themes/nord.mjs'])(
        'the shared Shiki module %s is still a workspace dependency when externalized',
        (modulePath) => {
            const external = `/assets/shiki-4.5.0/${modulePath}`;
            const bundle = { 'assets/index.js': chunk({ [`${APP}/main.tsx`]: 100 }, [external], true) };
            expect(preloadedWorkspaceModules(bundle, LISTED)).toEqual([`assets/index.js: ${external}`]);
        }
    );

    test('the editor key table and view state, and what tree shaking dropped, are allowed', () => {
        const bundle = {
            'assets/index.js': chunk(
                {
                    [`${LINKED}/editor/src/keymap-table.ts`]: 40,
                    [`${NPM}/editor-react/src/view-state.ts`]: 20,
                    [`${LINKED}/drawing/src/svg.ts`]: 0,
                    [`${APP}/shell/WorkspaceShell.tsx`]: 0
                },
                [],
                true
            )
        };
        expect(preloadedWorkspaceModules(bundle, LISTED)).toEqual([]);
    });

    test('the drawing painters and the grammars of a package count as the workspace', () => {
        const modules = [
            '/repo/node_modules/.bun/roughjs@4.6.6/node_modules/roughjs/bundled/rough.esm.js',
            '/repo/node_modules/.bun/@shikijs+langs@4.4.3/node_modules/@shikijs/langs/dist/php.mjs',
            `${LINKED}/diagram/src/svg.ts`,
            `${NPM}/editor-react/src/EditorView.tsx`
        ];
        const bundle = { 'assets/index.js': chunk(Object.fromEntries(modules.map((id) => [id, 1])), [], true) };
        expect(preloadedWorkspaceModules(bundle, LISTED)).toHaveLength(modules.length);
    });

    test('the list of the start screen names only modules that exist, and none twice', () => {
        const source = fileURLToPath(new URL('./src/', import.meta.url));

        expect(START_SCREEN_MODULES.filter((path) => !existsSync(`${source}${path}`))).toEqual([]);
        expect(new Set(START_SCREEN_MODULES).size).toBe(START_SCREEN_MODULES.length);
    });
});
