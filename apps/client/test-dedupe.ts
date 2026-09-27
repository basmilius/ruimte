import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { plugin } from 'bun';

/*
 * What `resolve.dedupe` in `vite.config.ts` does for the page, for the tests: a linked checkout of
 * @basmilius/react-ui has node_modules of its own, and a second React or i18next breaks every hook
 * and every word. Bun offers no dedupe, and its resolve hook never sees a package import, so every
 * file of these packages in the checkout loads as a stand-in for the same file in the client's copy.
 * A preload of its own, listed first in `bunfig.toml`, since the words preload imports the library.
 */
const SHARED = ['react', 'react-dom', 'i18next', 'react-i18next'];

const here = new URL('.', import.meta.url).pathname;
const library = realpathSync(join(here, 'node_modules', '@basmilius', 'react-ui'));
const copies = SHARED.map((name) => ({
    theirs: `${realpathSync(join(library, 'node_modules', name))}/`,
    ours: `${realpathSync(join(here, 'node_modules', name))}/`
}));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const theirs = new RegExp(`^(${copies.map((copy) => escape(copy.theirs)).join('|')})`);

// Bun refuses `export default` beside `export *`, so the stand-in names every export of the real file.
const standIn = (path: string): string => {
    const names = Object.keys(require(path) as object).filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));
    return [`import * as real from ${JSON.stringify(path)};`, 'export default real.default;', `export const { ${names.join(', ')} } = real;`].join('\n');
};

plugin({
    name: 'dedupe-react-ui',
    setup(build) {
        build.onLoad({ filter: theirs }, (args) => {
            const copy = copies.find((candidate) => args.path.startsWith(candidate.theirs))!;
            return { contents: standIn(copy.ours + args.path.slice(copy.theirs.length)), loader: 'js' };
        });
    }
});
