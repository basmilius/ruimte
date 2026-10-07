import { expect, spyOn, test } from 'bun:test';
import tailwindcss from '@tailwindcss/vite';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer, type HMRPayload } from 'vite';
import { adecoreSources } from './adecore-sources.ts';

test('Tailwind updates CSS when linked ADE CORE source classes change', async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'ruimte-tailwind-link-')));
    const client = join(temporary, 'ruimte/apps/client');
    const source = join(client, 'src');
    const directives = [...readFileSync(join(import.meta.dir, 'src/styles.css'), 'utf8').matchAll(/^@source "\.\.\/node_modules\/@adecore\/([^"/]+)\/src";/gm)];
    expect(directives.map((match) => match[1])).toEqual(['ui', 'agents-react', 'editor-react', 'database']);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(temporary, 'ruimte/package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }));
    writeFileSync(join(client, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const modules = join(client, 'node_modules');
    mkdirSync(join(modules, '@adecore'), { recursive: true });
    symlinkSync(dirname(Bun.resolveSync('tailwindcss/package.json', import.meta.dir)), join(modules, 'tailwindcss'));
    const files = directives.map((match, index) => {
        const folder = join(temporary, 'adecore/packages', match[1]!);
        mkdirSync(join(folder, 'src'), { recursive: true });
        symlinkSync(folder, join(modules, '@adecore', match[1]!));
        const file = join(folder, 'src/fixture.tsx');
        writeFileSync(file, `export const className = 'z-[${41001 + index}]'; if (import.meta.hot) import.meta.hot.accept();`);
        return file;
    });
    writeFileSync(join(source, 'styles.css'), `@import 'tailwindcss' source(none);\n${directives.map((match) => match[0]).join('\n')}\n`);
    const server = await createServer({
        root: client,
        configFile: false,
        cacheDir: join(temporary, 'cache'),
        plugins: [adecoreSources(), tailwindcss()],
        logLevel: 'silent',
        server: { port: 0, strictPort: false, fs: { allow: [temporary] } }
    });
    const send = spyOn(server.ws, 'send');
    try {
        await new Promise<void>((ready) => server.watcher.once('ready', ready));
        await server.listen();
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string') {
            throw new Error('Vite did not bind a TCP port.');
        }
        const url = `http://localhost:${address.port}/src/styles.css`;
        expect((await fetch(url)).status).toBe(200);
        for (const file of files) {
            expect((await fetch(`http://localhost:${address.port}/@fs${file}`)).status).toBe(200);
        }
        const initial = await (await fetch(`${url}?direct`)).text();
        for (const index of files.keys()) {
            expect(initial).toContain(`z-index: ${41001 + index}`);
            expect(initial).not.toContain(`z-index: ${42001 + index}`);
        }
        for (const [index, file] of files.entries()) {
            const updated = new Promise<HMRPayload>((resolveUpdate) => {
                send.mockImplementation((payload: HMRPayload | string) => {
                    if (typeof payload !== 'string' && payload.type === 'update' && payload.updates.some((update) => update.path === `/@fs${file}`)) {
                        resolveUpdate(payload);
                    }
                });
            });
            writeFileSync(file, `export const className = 'z-[${42001 + index}]'; if (import.meta.hot) import.meta.hot.accept();`);
            const message = await updated;
            expect(message.type === 'update' && message.updates.some((update) => update.type === 'css-update')).toBe(true);
            expect(await (await fetch(`${url}?direct`)).text()).toContain(`z-index: ${42001 + index}`);
        }
        const added = new Promise<void>((resolveUpdate) => {
            send.mockImplementation((payload: HMRPayload | string) => {
                if (typeof payload !== 'string' && payload.type === 'update' && payload.updates.some((update) => update.type === 'css-update')) {
                    resolveUpdate();
                }
            });
        });
        writeFileSync(join(dirname(files[0]!), 'added.tsx'), "export const className = 'z-[43001]';");
        await added;
        expect(await (await fetch(`${url}?direct`)).text()).toContain('z-index: 43001');
        const cssUpdated = new Promise<void>((resolveUpdate) => {
            send.mockImplementation((payload: HMRPayload | string) => {
                if (typeof payload !== 'string' && payload.type === 'update' && payload.updates.some((update) => update.type === 'css-update')) {
                    resolveUpdate();
                }
            });
        });
        writeFileSync(join(source, 'styles.css'), `${readFileSync(join(source, 'styles.css'), 'utf8')}\n`);
        await cssUpdated;
        const regenerated = await (await fetch(`${url}?direct`)).text();
        for (const index of files.keys()) {
            expect(regenerated).toContain(`z-index: ${42001 + index}`);
        }
    } finally {
        send.mockRestore();
        await server.close();
        rmSync(temporary, { recursive: true, force: true });
    }
}, 10000);
