import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanguageChoices } from './choices.ts';
import { alternativesOf } from './profiles.ts';

let path = '';
let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-choices-'));
    path = join(folder, 'nested', 'choices.json');
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

describe('language choices', () => {
    it('picks nothing until a person does, and remembers the pick in a file of the machine', async () => {
        const choices = new LanguageChoices({ path });
        await choices.load();
        expect(choices.get()).toEqual({});
        await choices.set('php');
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ picks: { php: 'php' } });
        const again = new LanguageChoices({ path });
        await again.load();
        expect(again.get()).toEqual({ php: 'php' });
    });

    it('ignores a pick the catalog does not hold for that choice, and a file it cannot read', async () => {
        await writeFile(join(folder, 'bad.json'), JSON.stringify({ picks: { php: 'typescript', css: 'php', nothing: 'php-native' } }));
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
});

describe('alternatives', () => {
    it('names the kinds that serve a language instead of one another, and only those', () => {
        expect(alternativesOf('php')).toEqual(['php-native']);
        expect(alternativesOf('php-native')).toEqual(['php']);
        expect(alternativesOf('typescript')).toEqual([]);
        expect(alternativesOf('vue')).toEqual([]);
    });
});
