import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useFileLanguage } from '@/extensions/languages';
import { useContributions } from '@/state/extension-registry';
import { mount, type Mounted } from '../../testing/dom';
import { loadProduct } from '../../testing/poc';

let extension: LoadedExtension;
let page: Mounted | null = null;

function Language({ path, read }: { path: string; read?: string }) {
    return <p>{useFileLanguage(path, read) ?? 'none'}</p>;
}

beforeAll(async () => {
    extension = await loadProduct('lintel', 'Lintel');
});
afterAll(async () => {
    await page?.unmount();
    extension.disposers.forEach((dispose) => dispose());
});

describe('Lintel in the window', () => {
    test('names its config files as a language of its own, which a file the machine knows a language of keeps', async () => {
        page = mount();

        await page.render(
            <>
                <Language path="/work/a/rules.lintel" />
                <Language path="/work/a/Lintelfile" />
                <Language path="/work/a/app.ts" read="typescript" />
                <Language path="/work/a/notes.txt" />
            </>
        );

        expect(useContributions.getState().languages.map((language) => language.id)).toEqual(['dev.lintel/lintel']);
        expect(page.host.textContent).toBe('lintellinteltypescriptnone');
    });
});
