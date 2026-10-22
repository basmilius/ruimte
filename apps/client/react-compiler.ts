import { fileURLToPath } from 'node:url';
import type { PluginOptions } from 'babel-plugin-react-compiler';

/*
 * Which modules the React Compiler takes, for the Vite build and the tests alike: the client's own
 * source and the TypeScript of ADE CORE's React packages, which the `source` condition hands the app
 * in place of the `dist` they compile the same way.
 */

export const REACT_COMPILER_OPTIONS = {
    target: '19',
    // A function the compiler cannot prove safe stays as written instead of failing the build.
    panicThreshold: 'none',
    // The compiler's own default leaves out everything under `node_modules`, where the packages sit when they come from npm.
    sources: (filename: string) => compiledByReactCompiler(filename)
} satisfies Partial<PluginOptions>;

/* The modules Vite hands the compiler (`reactCompilerPreset`): one that names no component or hook has nothing for it. */
export const MAY_HOLD_REACT = /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/;

/* What the compiled code imports in place of `react/compiler-runtime`. */
export const COMPILER_RUNTIME = fileURLToPath(new URL('./src/compiler-runtime.ts', import.meta.url));

/* From npm, Vite would pre-bundle these, which runs no plugin over them; served as modules they compile the way a linked checkout does. */
export const REACT_COMPILED_PACKAGES = ['@adecore/ui', '@adecore/terminal', '@adecore/agents-react', '@adecore/editor-react'];

/* A linked checkout (`adecore/packages/ui/src`) or an install (`node_modules/@adecore/ui/src`). */
const ADECORE_SOURCES = /[\\/](?:adecore[\\/]packages|node_modules[\\/]@adecore)[\\/](?:ui|terminal|agents-react|editor-react)[\\/]src[\\/].*\.tsx?(?:$|\?)/;

const CLIENT_SOURCES = new RegExp(`^${escaped(fileURLToPath(new URL('./src/', import.meta.url)))}.*\\.tsx?(?:$|\\?)`);

export const REACT_COMPILED = [CLIENT_SOURCES, ADECORE_SOURCES];

export const REACT_COMPILER_LEFT_OUT = [/\.test\.tsx?(?:$|\?)/, /[\\/]src[\\/]worker[\\/]/];

function escaped(path: string): string {
    return path.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

export function compiledByReactCompiler(path: string): boolean {
    return REACT_COMPILED.some((pattern) => pattern.test(path)) && !REACT_COMPILER_LEFT_OUT.some((pattern) => pattern.test(path));
}
