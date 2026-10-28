import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { WebviewParking } from '../src/browser/WebviewParking';
import { pageSnapshots, usePageSnapshots } from '../src/browser/page-snapshots';
import { browserRegistry, useBrowser } from '../src/browser/registry';
import type { RenderDistance } from '../src/canvas/render-distance';
import { registerCell } from '../src/shell/cell-rects';
import { defaultCanvases } from '../src/state/canvas';
import { useDocument } from '../src/state/document';
import { endpointKey } from '../src/state/keys';
import { useSettings } from '../src/state/settings';

/*
 * The production parking layer with one real <webview> on a canvas, for the Electron test of the render
 * distance. The main process drives it through `window.distanceTest`.
 */
const KEY = endpointKey('remote', 'page');
const canvas = defaultCanvases.of('main');
let firstHost: Element | null = null;
let firstClip: Element | null = null;

const fixture = {
    open(url: string) {
        useDocument.setState({ layout: { columns: [{ size: 1, cells: [{ size: 1, viewId: 'main' }] }], focus: { column: 0, cell: 0 } } } as never);
        canvas.setState({
            viewId: 'main',
            viewport: { w: 1000, h: 700 },
            nodes: { page: { id: 'page', kind: 'browser', title: 'Page', x: 20, y: 20, w: 800, h: 600 } },
            order: ['page'],
            camera: { x: 0, y: 0, zoom: 1 }
        } as never);
        const cell = document.createElement('div');
        cell.style.cssText = 'position:absolute;inset:0';
        document.body.append(cell);
        registerCell('main', cell);
        const root = document.createElement('div');
        root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
        document.body.append(root);
        browserRegistry.ensure(KEY, url);
        createRoot(root).render(createElement(WebviewParking));
    },
    state() {
        const element = browserRegistry.get(KEY);
        const host = element?.parentElement ?? null;
        firstHost ??= host;
        firstClip ??= host?.parentElement ?? null;
        let id: number | null = null;
        try {
            id = element?.getWebContentsId() ?? null;
        } catch {
            // Not attached yet.
        }
        const snapshot = usePageSnapshots.getState().byKey[KEY];
        return {
            id,
            connected: element?.isConnected === true,
            sameHost: host !== null && host === firstHost && host.parentElement === firstClip,
            visibility: host === null ? null : getComputedStyle(host).visibility,
            far: snapshot?.far === true,
            picture: snapshot?.imageUrl ?? null,
            row: useBrowser.getState().byKey[KEY] ?? null
        };
    },
    zoom(zoom: number) {
        canvas.getState().setCamera({ x: 0, y: 0, zoom });
    },
    distance(distance: RenderDistance) {
        useSettings.setState({ canvasRenderDistance: distance });
    },
    run(code: string) {
        return browserRegistry.get(KEY)!.executeJavaScript(code);
    },
    navigate(url: string) {
        browserRegistry.navigate(KEY, url);
    },
    /* What an agent's `browser shot` gets, as a byte count. */
    async shot() {
        const image = await pageSnapshots.photograph(KEY);
        return image === null ? 0 : image.byteLength;
    },
    async pictureBytes() {
        const url = usePageSnapshots.getState().byKey[KEY]?.imageUrl;
        return url ? (await (await fetch(url)).blob()).size : 0;
    }
};
Object.assign(window, { distanceTest: fixture });
export type DistanceFixture = typeof fixture;
