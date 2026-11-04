import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import * as ui from '@adecore/ui';
import { addFileIcons } from '@/extensions/file-icons';
import { fileInfoOf } from '@/extensions/file-info';

const overrides = spyOn(ui, 'setFileIconOverride');

afterEach(() => overrides.mockClear());
afterAll(() => {
    overrides.mockRestore();
    ui.setFileIconOverride(null);
});

function iconOf(path: string): string | null {
    return overrides.mock.calls.at(-1)?.[0]?.(path) ?? null;
}

test("keeps another extension's icon for a file extension when one that gave it too goes", () => {
    const removeFirst = addFileIcons('/first.svg', ['csv']);
    const removeSecond = addFileIcons('/second.svg', ['CSV', 'tsv']);

    removeFirst();

    expect(iconOf('data/table.csv')).toBe('/second.svg');

    const removeThird = addFileIcons('/third.svg', ['csv']);

    removeThird();

    expect(iconOf('data/table.csv')).toBe('/second.svg');

    removeSecond();

    expect(iconOf('data/table.csv')).toBeNull();
});

test('names a file by what follows the last separator, a backslash too', () => {
    expect(fileInfoOf('C:\\work\\v1.2\\notes')).toEqual({ path: 'C:\\work\\v1.2\\notes', name: 'notes', extension: '' });
    expect(fileInfoOf('/work/a/Table.CSV')).toEqual({ path: '/work/a/Table.CSV', name: 'Table.CSV', extension: 'csv' });
});
