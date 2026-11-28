import { expect, test } from 'bun:test';
import { ExtensionUiSources, type UiSourceHost } from './ui-sources.ts';

const PROJECT = { id: 'project', name: 'Shop', folder: '/work/shop' };
const ISSUES = { extension: 'acme.tracker', id: 'issues', described: { description: 'Open issues', parameters: { type: 'object' } } };

function hostOf(lists: (() => Promise<(typeof ISSUES)[]>)[], reads: string[] = []): UiSourceHost {
    return {
        list: () => (lists.shift() ?? (async () => []))(),
        read: async (extension, source, args, project) => {
            reads.push(`${extension} ${source} ${JSON.stringify(args)} ${project.folder}`);

            return ['row'];
        }
    };
}

test('names a source by its extension, and keeps what the last ask found for a prompt that cannot wait', async () => {
    const sources = new ExtensionUiSources(hostOf([async () => [ISSUES]]), async () => PROJECT);

    expect(sources.listed()).toEqual([]);
    expect(await sources.refresh(true)).toEqual([{ name: 'acme.tracker/issues', description: 'Open issues', parameters: { type: 'object' } }]);
    expect(sources.listed()).toHaveLength(1);
});

test('keeps what it knew when the extensions cannot be asked, and takes the newest answer when two asks cross', async () => {
    const slow = Promise.withResolvers<(typeof ISSUES)[]>();
    const failing = async (): Promise<never> => {
        throw new Error('The store would not read');
    };
    const sources = new ExtensionUiSources(hostOf([async () => [ISSUES], failing, () => slow.promise, async () => []]), async () => PROJECT);

    await sources.refresh(true);
    expect(await sources.refresh(true)).toHaveLength(1);

    const older = sources.refresh(true);

    expect(await sources.refresh(false)).toEqual([]);
    slow.resolve([ISSUES]);
    expect(await older).toEqual([]);
});

test('asks once more for a source nobody listed yet, and reads only one an extension supplies in a project it knows', async () => {
    const reads: string[] = [];
    const sources = new ExtensionUiSources(hostOf([async () => [ISSUES]], reads), async (projectId) => (projectId === 'project' ? PROJECT : null));

    await expect(sources.read('acme.tracker/issues', {}, 'project')).rejects.toThrow('No extension supplies acme.tracker/issues here');
    expect(await sources.supplies('acme.tracker/issues')).toBe(true);
    expect(await sources.read('acme.tracker/issues', { state: 'open' }, 'project')).toEqual(['row']);
    expect(reads).toEqual(['acme.tracker issues {"state":"open"} /work/shop']);
    await expect(sources.read('acme.tracker/issues', {}, 'elsewhere')).rejects.toThrow('No extension supplies acme.tracker/issues here');
    // Asked again for a name nobody knows, the extensions list nothing by now, so nothing is supplied.
    expect(await sources.supplies('acme.tracker/gone')).toBe(false);
});
