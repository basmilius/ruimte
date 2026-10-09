import i18next from 'i18next';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { RequestType } from '@ruimte/contracts';
import { ImageSaveHost } from '@/chat/ImageSaveHost';
import { imageSaveDialog, requestImageSave } from '@/chat/image-save';
import type { Transport } from '@/transport';

async function waitFor(condition: () => boolean, phase: string): Promise<void> {
    const started = performance.now();
    while (!condition()) {
        if (performance.now() - started > 5000) {
            throw new Error(`The image save dialog did not reach ${phase}: ${JSON.stringify(imageSaveDialog.getState().session?.state.getState())}`);
        }
        await new Promise(requestAnimationFrame);
    }
}

export async function probeImageSave() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const previousLanguage = i18next.language;
    const requests: Array<{ type: RequestType; payload: unknown }> = [];
    const writing = Promise.withResolvers<{ path: string; size: number; mtime: number }>();
    const target = { folder: '/project', projectName: 'Project', name: 'rabbit.png', exists: false, revision: null };
    const request = async (type: RequestType, payload: unknown): Promise<unknown> => {
        requests.push({ type, payload });
        if (type === 'chat.imageTarget') {
            const path = (payload as { path?: string }).path;
            return path?.includes('/assets/') ? { ...target, exists: true, revision: 'checked-image' } : target;
        }
        if (type === 'fs.list') {
            const { path } = payload as { path: string };
            return {
                path,
                entries:
                    path === '/project'
                        ? [{ name: 'assets', path: '/project/assets', kind: 'directory', size: null, mtime: 1, hidden: false, ignored: false }]
                        : [],
                truncated: false
            };
        }
        if (type === 'chat.saveImage') {
            return writing.promise;
        }
        throw new Error(`Unexpected request ${type}`);
    };
    const transport: Transport = { request: request as Transport['request'], status: 'open', on: () => () => {}, subscribeStatus: () => () => {} };
    try {
        await i18next.changeLanguage('en');
        flushSync(() => root.render(createElement(ImageSaveHost)));
        const result = requestImageSave(transport, 'chat-original', 'image-original');
        const folderRow = (): HTMLElement | null => {
            for (const host of document.querySelectorAll('*')) {
                const row = host.shadowRoot?.querySelector<HTMLElement>('button[data-item-path="project/assets/"], button[data-item-path="project/assets"]');
                if (row) {
                    return row;
                }
            }
            return null;
        };
        await waitFor(() => folderRow() !== null, 'folder rows');
        folderRow()!.click();
        await waitFor(() => imageSaveDialog.getState().session?.state.getState().target?.exists === true, 'collision check');
        const dialog = document.querySelector('[role="dialog"]')!;
        const button = (label: string) =>
            [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!;
        const saveDisabled = button('Save').disabled;
        const pathShown = dialog.textContent?.includes('/project/assets/rabbit.png') === true;
        dialog.querySelector('form')!.requestSubmit();
        const saveBeforeReplace = requests.filter((entry) => entry.type === 'chat.saveImage').length;
        button('Replace').click();
        await waitFor(() => imageSaveDialog.getState().session?.state.getState().pending === true, 'pending write');
        button('Cancel').click();
        const busyStaysOpen = imageSaveDialog.getState().session !== null;
        writing.resolve({ path: '/project/assets/rabbit.png', size: 68, mtime: 1 });
        const savedPath = await result;
        return { saveDisabled, pathShown, saveBeforeReplace, busyStaysOpen, savedPath, writes: requests.filter((entry) => entry.type === 'chat.saveImage') };
    } finally {
        imageSaveDialog.getState().session?.close();
        flushSync(() => root.unmount());
        container.remove();
        await i18next.changeLanguage(previousLanguage);
    }
}
