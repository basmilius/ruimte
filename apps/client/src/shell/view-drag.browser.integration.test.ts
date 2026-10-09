import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('embedded visuals let file and view drags reach their cell, then become interactive again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-frame-drag-'));
    const entry = join(directory, 'entry.ts');
    await writeFile(entry, `import { watchDrags } from ${JSON.stringify(join(import.meta.dir, 'view-drag.ts'))}; window.stopWatching = watchDrags();`);
    const build = await Bun.build({ entrypoints: [entry], target: 'browser', conditions: ['source'] });
    expect(build.success).toBe(true);
    const script = await build.outputs[0]!.text();
    // The pointer rule needs no Tailwind utilities or imported fonts in this fixture.
    const styles = (await readFile(join(import.meta.dir, '../styles.css'), 'utf8')).replace(/^@import .*$/gm, '');
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            if (new URL(request.url).pathname === '/entry.js') {
                return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
            }
            return new Response(
                `<!doctype html><style>${styles}</style>
                <style>body{margin:0}#cell{position:absolute;left:100px;top:100px;width:400px;height:300px}iframe{display:block;width:100%;height:100%;border:0}</style>
                <div id="cell"><iframe sandbox="allow-scripts" srcdoc="<button>Interactive visual</button>"></iframe></div>
                <script>
                    window.over = 0;
                    window.dropped = 0;
                    const cell = document.getElementById('cell');
                    cell.addEventListener('dragover', event => {event.preventDefault(); event.dataTransfer.dropEffect = 'move'; window.over++;});
                    cell.addEventListener('drop', event => {event.preventDefault(); window.dropped++;});
                </script><script type="module" src="/entry.js"></script>`,
                { headers: { 'Content-Type': 'text/html' } }
            );
        }
    });
    const view = new Bun.WebView({ backend: { type: 'chrome', url: false }, headless: true, dataStore: { directory: join(directory, 'profile') } });
    try {
        await view.navigate(`http://127.0.0.1:${server.port}`);
        await view.resize(800, 600);
        expect(await view.evaluate<string>('typeof window.stopWatching')).toBe('function');
        expect(await view.evaluate<string>('document.elementFromPoint(300, 250).tagName')).toBe('IFRAME');
        for (const mimeType of ['application/x-ruimte-paths', 'application/x-ruimte-view']) {
            const data = { items: [{ mimeType, data: '/repo/readme.md' }], dragOperationsMask: 16 };
            await view.cdp('Input.dispatchDragEvent', { type: 'dragEnter', x: 20, y: 20, data });
            expect(await view.evaluate<boolean>('document.body.hasAttribute("data-dragging")')).toBe(true);
            expect(await view.evaluate<string>('document.elementFromPoint(300, 250).id')).toBe('cell');
            // Let the compositor update iframe hit testing before sending native input.
            await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            await view.evaluate('(() => {window.over = 0; window.dropped = 0;})()');
            // The first move enters the cell; the second emits dragover.
            await view.cdp('Input.dispatchDragEvent', { type: 'dragOver', x: 300, y: 250, data });
            await view.cdp('Input.dispatchDragEvent', { type: 'dragOver', x: 300, y: 250, data });
            expect(await view.evaluate<number>('window.over')).toBeGreaterThan(0);
            await view.cdp('Input.dispatchDragEvent', { type: 'drop', x: 300, y: 250, data });
            expect(await view.evaluate<number>('window.dropped')).toBe(1);
            expect(await view.evaluate<boolean>('document.body.hasAttribute("data-dragging")')).toBe(false);
            expect(await view.evaluate<string>('document.elementFromPoint(300, 250).tagName')).toBe('IFRAME');
        }
        for (const finish of ['document.dispatchEvent(new DragEvent("dragend", {bubbles: true}))', 'window.stopWatching()']) {
            await view.evaluate('document.dispatchEvent(new DragEvent("dragstart", {bubbles: true}))');
            expect(await view.evaluate<string>('document.elementFromPoint(300, 250).id')).toBe('cell');
            await view.evaluate(finish);
            expect(await view.evaluate<string>('document.elementFromPoint(300, 250).tagName')).toBe('IFRAME');
        }
    } finally {
        view.close();
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
    }
});
