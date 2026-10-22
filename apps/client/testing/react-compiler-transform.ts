import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { BunPlugin } from 'bun';
import type { Compiled } from '../react-compiler-babel';
import { CompilerCache } from '../react-compiler-cache';
import { CompilerPool } from '../react-compiler-pool';
import { COMPILER_RUNTIME, compiledByReactCompiler, MAY_HOLD_REACT, REACT_COMPILED, REACT_COMPILED_PACKAGES } from '../react-compiler';

/*
 * The React Compiler over the client and ADE CORE's React sources the way Vite hands it them
 * (`react-compiler.ts`), with the runtime behind the client's own: for the DOM run's preload and the
 * browser fixture's bundle alike. What it made is kept on disk with Vite's (`react-compiler-cache.ts`).
 */

const cache = new CompilerCache();

const compiled = new Map<string, Promise<string>>();

async function compile(path: string): Promise<string> {
    const code = await Bun.file(path).text();
    if (!compiledByReactCompiler(path) || !MAY_HOLD_REACT.test(code)) {
        return code;
    }
    const cached = await cache.read(path, code);
    if (cached !== null) {
        return cached.code ?? code;
    }
    // Loaded only once a test reaches a module the cache lacks, so a warm run skips Babel.
    const { compileWithBabel } = await import('../react-compiler-babel');
    return kept(path, code, await compileWithBabel(code, path));
}

async function kept(path: string, code: string, result: Compiled): Promise<string> {
    if (result.code !== null) {
        await cache.write(path, code, result);
    }
    return result.code ?? code;
}

export function compiledOnce(path: string): Promise<string> {
    let code = compiled.get(path);
    if (code === undefined) {
        code = compile(path);
        compiled.set(path, code);
    }
    return code;
}

/*
 * Compiles every module up front, for a run whose tests draw the window or bundle the client: the lazy
 * views would otherwise be compiled inside the first test that opens them, against its timeout. On the
 * pool's threads, which also keep Babel's stack trace rewriter away from a Vite this run loads after.
 */
export async function compileReactSourcesAhead(): Promise<void> {
    const client = join(import.meta.dir, '..');
    const roots = [join(client, 'src'), ...REACT_COMPILED_PACKAGES.map((name) => realpathSync(join(client, 'node_modules', name, 'src')))];
    const pool = new CompilerPool();
    const pending: Promise<string>[] = [];
    try {
        for (const root of roots) {
            for await (const file of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: root, absolute: true })) {
                if (compiledByReactCompiler(file) && !compiled.has(file)) {
                    const code = compileOn(pool, file);
                    compiled.set(file, code);
                    pending.push(code);
                }
            }
        }
        await Promise.all(pending);
    } finally {
        pool.close();
    }
}

async function compileOn(pool: CompilerPool, path: string): Promise<string> {
    const code = await Bun.file(path).text();
    if (!MAY_HOLD_REACT.test(code)) {
        return code;
    }
    const cached = await cache.read(path, code);
    if (cached !== null) {
        return cached.code ?? code;
    }
    const result = await pool.compile(code, path);
    return result === null ? compile(path) : kept(path, code, result);
}

const STOCK_RUNTIME = /(from\s*)(["'])react\/compiler-runtime\2/g;

/* Bun's runtime plugins leave a bare import to the package, whatever `onResolve` says, so a test points the compiled code at the client's runtime itself. */
function withClientRuntime(path: string, code: string): string {
    return path === COMPILER_RUNTIME ? code : code.replace(STOCK_RUNTIME, (_, from: string) => `${from}${JSON.stringify(COMPILER_RUNTIME)}`);
}

export const reactCompilerPlugin: BunPlugin = {
    name: 'react-compiler',
    setup(build) {
        build.onResolve({ filter: /^react\/compiler-runtime$/ }, (args) => (args.importer === COMPILER_RUNTIME ? undefined : { path: COMPILER_RUNTIME }));
        build.onLoad({ filter: new RegExp(REACT_COMPILED.map((pattern) => pattern.source).join('|')) }, async (args) => ({
            contents: withClientRuntime(args.path, await compiledOnce(args.path)),
            loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts'
        }));
    }
};
