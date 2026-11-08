import { expect, test } from 'bun:test';
import { RefusedBatch } from './refused-batch';

test('tells the window once per page and step how many requests were refused, with the latest address', () => {
    const reports: Array<[number, string, number]> = [];
    const fires: Array<() => void> = [];
    const batch = new RefusedBatch(
        (guest, url, count) => reports.push([guest, url, count]),
        (_ms, fire) => void fires.push(fire)
    );

    batch.add(1, 'https://cdn.example/a.js');
    batch.add(1, 'https://cdn.example/b.js');
    batch.add(2, 'https://fonts.example/f.woff');

    expect(reports).toEqual([]);
    expect(fires).toHaveLength(2);

    fires.splice(0).forEach((fire) => fire());

    expect(reports).toEqual([
        [1, 'https://cdn.example/b.js', 2],
        [2, 'https://fonts.example/f.woff', 1]
    ]);

    batch.add(1, 'https://cdn.example/c.js');
    fires.splice(0).forEach((fire) => fire());

    expect(reports.at(-1)).toEqual([1, 'https://cdn.example/c.js', 1]);
});
