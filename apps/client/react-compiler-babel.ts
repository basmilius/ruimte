import { fileURLToPath } from 'node:url';
import { transformAsync } from '@babel/core';
import { REACT_COMPILER_OPTIONS } from './react-compiler.ts';

/*
 * The React Compiler over one module, with what the build's plugin hands Babel (`@rolldown/plugin-babel`
 * with `reactCompilerPreset`), for the compiler pool's threads and the tests alike, so what one of them
 * keeps in the cache (`react-compiler-cache.ts`) is what the other would have made.
 */

export interface Compiled {
    /* Null when Babel had nothing to say about the module. */
    code: string | null;
    /* A Babel source map. */
    map: object | null;
}

const compiler = fileURLToPath(import.meta.resolve('babel-plugin-react-compiler'));

export async function compileWithBabel(code: string, id: string): Promise<Compiled> {
    const typed = /\.tsx(?:$|\?)/.test(id) ? ['typescript', 'jsx'] : /\.ts(?:$|\?)/.test(id) ? ['typescript'] : /\.jsx(?:$|\?)/.test(id) ? ['jsx'] : [];
    const result = await transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { sourceType: 'module', allowAwaitOutsideFunction: true, plugins: typed as ['typescript'] },
        plugins: [[compiler, REACT_COMPILER_OPTIONS]]
    });
    return { code: result?.code ?? null, map: (result?.map as object | null | undefined) ?? null };
}
