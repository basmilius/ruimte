import { describe, expect, test } from 'bun:test';
import { LoadedComponent } from './lazy';

describe('LoadedComponent', () => {
    test('keeps what the first load gave and tells its listeners once', async () => {
        const first = () => null;
        const second = () => null;
        let calls = 0;
        const loaded = new LoadedComponent(async () => (calls++ === 0 ? first : second));
        let told = 0;
        const off = loaded.subscribe(() => {
            told += 1;
        });

        expect(loaded.current).toBeNull();
        await loaded.load();
        await loaded.load();

        expect(loaded.current).toBe(first);
        expect(told).toBe(1);
        off();
    });

    test('a failed load leaves nothing kept, so the next one tries again', async () => {
        const component = () => null;
        let attempt = 0;
        const loaded = new LoadedComponent(async () => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error('chunk gone');
            }
            return component;
        });

        await expect(loaded.load()).rejects.toThrow('chunk gone');
        expect(loaded.current).toBeNull();
        await loaded.load();
        expect(loaded.current).toBe(component);
    });
});
