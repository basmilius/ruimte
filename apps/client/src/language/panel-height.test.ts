import { describe, expect, test } from 'bun:test';
import { memoryStorage } from '../../testing/memory-storage';
import { FakeLanguageTransport } from './fake-daemon';
import { readPanelHeight, writePanelHeight } from './panel-height';
import { ProjectLanguage } from './ruimte-project-language';

describe('the height of the peek and call hierarchy panel', () => {
    test('is nothing until a person has dragged it', () => {
        expect(readPanelHeight(memoryStorage())).toBeUndefined();
    });

    test('comes back as written, in whole pixels', () => {
        const storage = memoryStorage();
        writePanelHeight(240.4, storage);
        expect(readPanelHeight(storage)).toBe(240);
    });

    test('ignores a value that is no height', () => {
        const storage = memoryStorage();
        storage.setItem('ruimte.language.panel-height', 'tall');
        expect(readPanelHeight(storage)).toBeUndefined();
        storage.setItem('ruimte.language.panel-height', '-3');
        expect(readPanelHeight(storage)).toBeUndefined();
    });

    test('survives a refusing storage', () => {
        const refusing = {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => {
                throw new Error('denied');
            }
        };
        expect(readPanelHeight(refusing)).toBeUndefined();
        expect(() => writePanelHeight(200, refusing)).not.toThrow();
    });

    test('reaches the project language from a resize and into the next one', () => {
        const storage = memoryStorage();
        const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
        try {
            const first = new ProjectLanguage(new FakeLanguageTransport(), 'p1', '/work/app');
            first.resizePanelBody(260);
            const second = new ProjectLanguage(new FakeLanguageTransport(), 'p1', '/work/app');
            expect(second.panelBodyHeight).toBe(260);
        } finally {
            if (original === undefined) {
                Reflect.deleteProperty(globalThis, 'localStorage');
            } else {
                Object.defineProperty(globalThis, 'localStorage', original);
            }
        }
    });
});
