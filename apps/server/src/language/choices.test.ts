import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LanguageChoices } from './choices.ts';
import { alternativesOf, kindForLanguage } from './profiles.ts';
import { makeAlternatives } from './test-fakes.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

let path = '';
let folder = '';

const newHome = tempHomes('ruimte-choices-');

beforeEach(async () => {
    folder = await newHome();
    path = join(folder, 'nested', 'choices.json');
});

describe('language choices', () => {
    let restore = (): void => undefined;

    beforeEach(() => {
        restore = makeAlternatives();
    });

    afterEach(() => {
        restore();
    });

    it('picks nothing until a person does, and remembers the pick in a file of the machine', async () => {
        const choices = new LanguageChoices({ path });
        await choices.load();
        expect(choices.get()).toEqual({});
        await choices.set('yaml');
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ picks: { css: 'yaml' } });
        const again = new LanguageChoices({ path });
        await again.load();
        expect(again.get()).toEqual({ css: 'yaml' });
    });

    it('ignores a pick the catalog does not hold for that choice, and a file it cannot read', async () => {
        await writeFile(join(folder, 'bad.json'), JSON.stringify({ picks: { css: 'typescript', html: 'css', nothing: 'yaml' } }));
        const wrong = new LanguageChoices({ path: join(folder, 'bad.json') });
        await wrong.load();
        expect(wrong.get()).toEqual({});
        await writeFile(join(folder, 'broken.json'), '{');
        const broken = new LanguageChoices({ path: join(folder, 'broken.json') });
        await broken.load();
        expect(broken.get()).toEqual({});
    });

    it('does nothing for a kind that has no alternative', async () => {
        const choices = new LanguageChoices({ path });
        await choices.set('typescript');
        expect(choices.get()).toEqual({});
    });

    it('names the kinds that serve a language instead of one another, and only those', () => {
        expect(alternativesOf('css')).toEqual(['yaml']);
        expect(alternativesOf('yaml')).toEqual(['css']);
        expect(alternativesOf('typescript')).toEqual([]);
    });

    it('serves a language with the pick, else the first of the catalog', () => {
        expect(kindForLanguage('css')).toBe('css');
        expect(kindForLanguage('css', { css: 'yaml' })).toBe('yaml');
        expect(kindForLanguage('css', { css: 'css' })).toBe('css');
    });
});

describe('a pick an older Ruimte stored', () => {
    it('ignores Intelephense and the PHP server of Ruimte alike, so PHP goes to the one server there is', async () => {
        await writeFile(join(folder, 'intelephense.json'), JSON.stringify({ picks: { php: 'php' } }));
        const intelephense = new LanguageChoices({ path: join(folder, 'intelephense.json') });
        await intelephense.load();
        expect(intelephense.get()).toEqual({});
        expect(kindForLanguage('php', intelephense.get())).toBe('php-native');
        await writeFile(join(folder, 'native.json'), JSON.stringify({ picks: { php: 'php-native' } }));
        const native = new LanguageChoices({ path: join(folder, 'native.json') });
        await native.load();
        expect(native.get()).toEqual({});
    });
});
