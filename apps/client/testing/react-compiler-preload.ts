import { reactCompilerPlugin } from './react-compiler-transform';

/*
 * A DOM test runs the client and ADE CORE's React sources the way the app ships them: through the
 * React Compiler (`react-compiler.ts`), with the runtime behind the client's own. It goes before every
 * preload that loads a component. The unit run leaves it out (`bunfig.toml`).
 */

Bun.plugin(reactCompilerPlugin);
