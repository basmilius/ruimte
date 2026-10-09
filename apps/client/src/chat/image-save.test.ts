import { expect, test } from 'bun:test';
import type { ChatImageTargetResult, RequestType } from '@ruimte/contracts';
import type { Transport } from '@/transport';
import { ImageSaveSession, validImageFileName } from './image-save';

const ROOT: ChatImageTargetResult = { folder: '/project', projectName: 'Project', name: 'rabbit.png', exists: false, revision: null };

function connection(request: (type: RequestType, payload: unknown) => Promise<unknown>): Transport {
    return { request: request as Transport['request'], status: 'open', on: () => () => {}, subscribeStatus: () => () => {} };
}

test('only a checked name saves and repeated clicks send one write with the captured source', async () => {
    const writing = Promise.withResolvers<unknown>();
    const requests: unknown[] = [];
    const completed: Array<string | null> = [];
    const session = new ImageSaveSession(
        connection(async (type, payload) => {
            requests.push({ type, payload });
            return type === 'chat.imageTarget' ? ROOT : writing.promise;
        }),
        { chatId: 'chat', attachmentId: 'image' },
        ROOT,
        (path) => completed.push(path)
    );
    await session.save(false);
    expect(requests).toEqual([]);
    await session.check();
    const saved = session.save(false);
    await session.save(false);
    session.close();
    session.name('other.png');
    expect(session.state.getState()).toMatchObject({ pending: true, name: 'rabbit.png', closed: false });
    expect(requests).toEqual([
        { type: 'chat.imageTarget', payload: { chatId: 'chat', attachmentId: 'image', path: '/project/rabbit.png' } },
        { type: 'chat.saveImage', payload: { chatId: 'chat', attachmentId: 'image', path: '/project/rabbit.png' } }
    ]);
    writing.resolve({ path: '/project/rabbit.png', size: 68, mtime: 1 });
    await saved;
    expect(completed).toEqual(['/project/rabbit.png']);
});

test('an existing destination writes only after an explicit Replace with its revision', async () => {
    const requests: unknown[] = [];
    const session = new ImageSaveSession(
        connection(async (type, payload) => {
            requests.push({ type, payload });
            return type === 'chat.imageTarget' ? { ...ROOT, exists: true, revision: 'checked-version' } : { path: '/project/rabbit.png', size: 68, mtime: 1 };
        }),
        { chatId: 'chat', attachmentId: 'image' },
        ROOT,
        () => {}
    );
    await session.check();
    await session.save(false);
    expect(requests).toHaveLength(1);
    await session.save(true);
    expect(requests[1]).toEqual({
        type: 'chat.saveImage',
        payload: { chatId: 'chat', attachmentId: 'image', path: '/project/rabbit.png', replace: 'checked-version' }
    });
});

test('a late check for an older name cannot approve the current destination or a cancelled dialog', async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    const completed: Array<string | null> = [];
    let checks = 0;
    const session = new ImageSaveSession(
        connection(async () => (++checks === 1 ? first.promise : second.promise)),
        { chatId: 'chat', attachmentId: 'image' },
        ROOT,
        (path) => completed.push(path)
    );
    const original = session.check();
    session.name('other.png');
    first.resolve(ROOT);
    await original;
    expect(session.state.getState().checkedPath).toBeNull();
    session.close();
    second.resolve(ROOT);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.state.getState().checkedPath).toBeNull();
    expect(completed).toEqual([null]);
});

test('a write refused because another file appeared refreshes the collision in the same dialog', async () => {
    let checks = 0;
    const completed: Array<string | null> = [];
    const session = new ImageSaveSession(
        connection(async (type) => {
            if (type === 'chat.saveImage') {
                throw new Error('A file appeared');
            }
            return ++checks === 1 ? ROOT : { ...ROOT, exists: true, revision: 'new-file' };
        }),
        { chatId: 'chat', attachmentId: 'image' },
        ROOT,
        (path) => completed.push(path)
    );
    await session.check();
    await session.save(false);
    expect(session.state.getState()).toMatchObject({ pending: false, closed: false, error: 'A file appeared', target: { exists: true, revision: 'new-file' } });
    expect(completed).toEqual([]);
});

test('the name input cannot select a parent or another directory', () => {
    for (const name of ['', ' ', '.', '..', '../image.png', 'assets/image.png', 'assets\\image.png', 'image\0.png']) {
        expect(validImageFileName(name)).toBe(false);
    }
    expect(validImageFileName('rabbit.png')).toBe(true);
});
