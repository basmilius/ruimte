import { afterEach, describe, expect, test } from 'bun:test';
import { MAX_LANGUAGE_GRAMMAR_BYTES, type ExtensionManifest } from '@ruimte/contracts';
import { CODE_PALETTES } from '@/code-themes';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';
import { fetchGrammar } from '@/extensions/languages';
import { highlightCode } from '@/surface/panels/highlight';

const GRAMMAR = JSON.stringify({
    scopeName: 'source.pack-probe',
    patterns: [
        { name: 'comment.line.number-sign.pack-probe', match: '#.*$' },
        { name: 'keyword.control.pack-probe', match: '\\brule\\b' }
    ]
});
const realFetch = globalThis.fetch;
const fetched: string[] = [];

function answer(body: string, status = 200): void {
    globalThis.fetch = (async (url: string) => {
        fetched.push(url);

        return new Response(body, { status });
    }) as unknown as typeof fetch;
}

afterEach(() => {
    globalThis.fetch = realFetch;
    fetched.length = 0;
});

describe('the grammar of a language an extension defines', () => {
    test('is read from the folder of its pack when the first file is colored, and colors it', async () => {
        const manifest: ExtensionManifest = { id: 'acme.pack', name: 'Pack', version: '0.1.0', api: 1, proposed: ['languages'] };
        const extension: LoadedExtension = { manifest, base: '/extensions/acme.pack/', disposers: [], settings: null, dev: true };

        answer(GRAMMAR);
        clientApiFor(extension).defineLanguage({ id: 'pack-probe', name: 'Probe', extensions: ['probe'], grammar: 'assets/probe.tmLanguage.json' });

        expect(fetched).toEqual([]);

        const html = (await highlightCode('rule one # why', 'pack-probe', 'ruimte-dark')).toLowerCase();

        expect(fetched).toEqual(['/extensions/acme.pack/assets/probe.tmLanguage.json']);
        expect(html).toContain(CODE_PALETTES.dark.colors.keyword);
        expect(html).toContain(CODE_PALETTES.dark.colors.comment);

        extension.disposers.forEach((dispose) => dispose());
    });

    test('is refused when it is larger than a grammar may be, no TextMate grammar or not there', async () => {
        answer(`{"scopeName":"source.big","padding":"${'x'.repeat(MAX_LANGUAGE_GRAMMAR_BYTES)}"}`);
        await expect(fetchGrammar('/big.json')).rejects.toThrow('the grammar is over 512 KB');

        answer('{"patterns":[]}');
        await expect(fetchGrammar('/none.json')).rejects.toThrow('the grammar is no TextMate grammar: it has no scopeName');

        answer('', 404);
        await expect(fetchGrammar('/gone.json')).rejects.toThrow('the grammar could not be read (404)');
    });
});
