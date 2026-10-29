import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { compileReactSourcesAhead } from './react-compiler-transform';

/*
 * The page for `*.dom.test.tsx`, which run through `bun run test:dom` (`dom.bunfig.toml`) and never in the
 * unit run. It goes before every other preload: React DOM and Base UI read `document` once, as they load.
 */
GlobalRegistrator.register({ url: 'http://localhost/', width: 1280, height: 800 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// What Vite turns a `?worker` import into; a test never starts the worker, so one that is sent work never answers.
const SILENT_WORKER = 'export default class { postMessage() {} addEventListener() {} removeEventListener() {} terminate() {} }';

Bun.plugin({
    name: 'vite-worker',
    setup(build) {
        build.onResolve({ filter: /\?worker$/ }, (args) => ({ path: args.path, namespace: 'vite-worker' }));
        build.onLoad({ filter: /.*/, namespace: 'vite-worker' }, () => ({ contents: SILENT_WORKER, loader: 'js' }));
    }
});

// A test that draws the window would otherwise compile the views it opens lazily within its own timeout.
await compileReactSourcesAhead();
