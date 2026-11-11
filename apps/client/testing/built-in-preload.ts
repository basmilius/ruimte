import { BUILT_IN_API, BUILT_IN_FOLDERS, builtInModule } from '../built-ins';

/*
 * A built-in's files as the client's build hands them over (`built-ins.ts`), for the unit run. Before every preload
 * that imports a built-in. The DOM run's React Compiler preload goes first and binds them itself, since the first
 * plugin that loads a module is the one Bun keeps.
 */
const escaped = (path: string): string => path.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
const extensions = escaped(new URL('../../../extensions/', import.meta.url).pathname);
const files = new RegExp(`^(?:${escaped(BUILT_IN_API)}|${extensions}(?:${BUILT_IN_FOLDERS.map(escaped).join('|')})/.*\\.tsx?)(?:$|\\?)`);

Bun.plugin({
    name: 'ruimte-built-ins',
    setup(build) {
        build.onLoad({ filter: files }, async (args) => {
            const [path = args.path] = args.path.split('?');
            const code = await Bun.file(path).text();

            return { contents: builtInModule(args.path, code) ?? code, loader: path.endsWith('.tsx') ? 'tsx' : 'ts' };
        });
    }
});
