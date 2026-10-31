import { afterEach } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import { CHARTS_NAMESPACE, CHARTS_RESOURCES } from '@adecore/charts';
import { UI_NAMESPACE, UI_RESOURCES } from '@adecore/ui';
import { AGENTS_LOCALES } from '@adecore/agents-react/locales';
import editorWords from '@adecore/editor-react/locales/en.json' with { type: 'json' };
import { connectFormat } from './src/format/source';
import { FALLBACK_LANGUAGE } from './src/i18n/languages';
import { defaultCanvases, focusedCanvas } from './src/state/canvas';
import { useDocument } from './src/state/document';
import { useEndpoints } from './src/state/endpoints';
import { useToasts } from './src/state/toasts';

/*
 * The English words, in memory, before the first test runs, so a pure function that builds a label
 * reads real words off i18next. Bun loads this through the `preload` in `bunfig.toml`.
 *
 * Off disk, since `import.meta.glob` is Vite's. It sits beside `src` rather than in it, because the
 * client never imports Node.
 */
const folder = fileURLToPath(new URL(`./src/i18n/locales/${FALLBACK_LANGUAGE}/`, import.meta.url));

const resources = Object.fromEntries(
    readdirSync(folder)
        .filter((name) => name.endsWith('.json'))
        .map((name) => [name.slice(0, -'.json'.length), JSON.parse(readFileSync(join(folder, name), 'utf8')) as Record<string, unknown>])
);

const agentsWords = await AGENTS_LOCALES[FALLBACK_LANGUAGE]!();

// Awaited, so the first test already has the words.
await i18next.init({
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    resources: {
        [FALLBACK_LANGUAGE]: { ...resources, ...agentsWords, [UI_NAMESPACE]: UI_RESOURCES.en, [CHARTS_NAMESPACE]: CHARTS_RESOURCES.en, editor: editorWords }
    }
});

// The formatters of @adecore/ui read the client's settings, which the tests set.
connectFormat();

/*
 * Files share a worker under `--no-isolate`, and a preload's `afterAll` only runs when the worker ends,
 * so the stores nearly every client test writes go back to their first state after each test.
 */
const focusedCanvasStore = focusedCanvas();
const sharedStores: { getState(): object; setState(state: object, replace: true): void }[] = [useDocument, useEndpoints, useToasts, focusedCanvasStore];
const firstStates = sharedStores.map((store) => store.getState());

afterEach(() => {
    defaultCanvases.focus(null);
    defaultCanvases.keep([]);
    sharedStores.forEach((store, index) => store.setState(firstStates[index]!, true));
});
