import type { Plugin, TransformResult } from 'vite';
import { CompilerCache } from './react-compiler-cache.ts';
import { CompilerPool } from './react-compiler-pool.ts';
import { MAY_HOLD_REACT } from './react-compiler.ts';

/*
 * The React Compiler for `bun dev` and `vite build`. Babel runs on Vite's own thread at about ten
 * milliseconds a module, which took a first start from seconds to most of a minute. Here it runs on a few
 * worker threads (`react-compiler-babel.ts`), and what it made is kept (`react-compiler-cache.ts`), so a
 * later start or build compiles only what changed. The plugin itself only takes a module the pool cannot.
 */

type TransformHandler = (this: unknown, code: string, id: string, options?: unknown) => Promise<TransformResult | null | undefined | void>;

export async function compiledThroughCache(compiler: Promise<object>): Promise<Plugin> {
    // The Babel plugin is typed against Rolldown's plugin, which Vite's extends.
    const plugin = (await compiler) as Plugin;
    const transform = plugin.transform as { handler: TransformHandler };
    const compileHere = transform.handler;
    const cache = new CompilerCache();
    const pool = new CompilerPool();

    plugin.configureServer = (server) => {
        server.httpServer?.once('close', () => pool.close());
    };
    plugin.closeBundle = () => {
        pool.close();
    };

    transform.handler = async function (code, id, options) {
        const cached = await cache.read(id, code);
        if (cached?.code) {
            return { code: cached.code, map: cached.map as TransformResult['map'] };
        }
        // The filter the preset hands the plugin, which the plugin's own hook filter does not cover.
        if (!MAY_HOLD_REACT.test(code)) {
            return null;
        }
        const compiled = await pool.compile(code, id);
        if (compiled === null) {
            return compileHere.call(this, code, id, options);
        }
        if (compiled.code === null) {
            return null;
        }
        void cache.write(id, code, compiled);
        return { code: compiled.code, map: compiled.map as TransformResult['map'] };
    };

    return plugin;
}
