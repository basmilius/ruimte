import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { UI_NAMESPACE } from '@ruimte/ui/locales';
import uiWords from '@ruimte/ui/locales/en.json';
import { connectFormat } from './src/format/source';
import { FALLBACK_LANGUAGE } from './src/i18n/languages';

/*
 * The English words, in memory, before the first test runs. A pure function that raises a toast or
 * builds a label reads them straight off i18next, and without this it would read `undefined` and
 * every test about what a person sees would be a test about nothing. Bun loads this through the
 * `preload` in `bunfig.toml`; the app itself never imports it.
 *
 * English only, and synchronously: a test asserts on the source language, and `import.meta.glob` is
 * Vite's, so the files are read off disk here. It sits beside `src` rather than in it, because the
 * client never imports Node.
 */
const here = new URL('.', import.meta.url).pathname;
const dir = join(here, 'src', 'i18n', 'locales', FALLBACK_LANGUAGE);

const resources = Object.fromEntries(
    readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => [name.slice(0, -'.json'.length), JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>])
);

// Awaited, so the first test already has the words: nothing here waits for a network or a file.
await i18next.init({
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    resources: { [FALLBACK_LANGUAGE]: { ...resources, [UI_NAMESPACE]: uiWords } }
});

// The formatters of @ruimte/ui read the client's settings, which the tests set.
connectFormat();
