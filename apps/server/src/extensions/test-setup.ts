/*
 * What `ruimte extension test` checks of a project before it runs `bun test`: whether a test draws into a page, which
 * needs happy-dom, and whether the project's React is the one Ruimte draws extensions with.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLIENT_REACT_MAJOR } from './scaffold.ts';

const HAPPY_DOM = '@happy-dom/global-registrator';

/* The page a `*.dom.test.tsx` file draws into, registered before React loads. */
export const DOM_PRELOAD = `import { GlobalRegistrator } from '${HAPPY_DOM}';\n\nGlobalRegistrator.register();\n`;

const SKIPPED = new Set(['node_modules', 'dist', '.git']);
const DOM_TEST = /\.dom\.test\.[jt]sx?$/;

export function hasDomTests(folder: string): boolean {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.isDirectory() ? !SKIPPED.has(entry.name) && hasDomTests(join(folder, entry.name)) : DOM_TEST.test(entry.name)) {
            return true;
        }
    }

    return false;
}

/*
 * The `package.json` of a package in a `node_modules` from here up, or null. Not through a resolve, which Bun answers from
 * a cache it installs into for a project with no `node_modules`, while the run that follows does not.
 */
function installed(folder: string, name: string): string | null {
    for (let at = folder; ; at = dirname(at)) {
        const manifest = join(at, 'node_modules', name, 'package.json');

        if (existsSync(manifest)) {
            return manifest;
        }

        if (dirname(at) === at) {
            return null;
        }
    }
}

export function missingDom(folder: string): string | null {
    return installed(folder, HAPPY_DOM) === null
        ? `A *.dom.test.tsx file draws into a page, which needs ${HAPPY_DOM}. Add it with: bun add -d ${HAPPY_DOM}`
        : null;
}

/* A warning when the project tests with another major of React than Ruimte draws its extensions with. */
export function reactWarning(folder: string): string | null {
    const manifest = installed(folder, 'react');

    if (manifest === null) {
        return null;
    }

    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
    const major = Number(version.split('.')[0]);

    if (major === CLIENT_REACT_MAJOR) {
        return null;
    }

    return `This project tests with React ${version}, and Ruimte draws extensions with React ${CLIENT_REACT_MAJOR}, so what passes here can differ in Ruimte. Install react@${CLIENT_REACT_MAJOR} and react-dom@${CLIENT_REACT_MAJOR}.`;
}
