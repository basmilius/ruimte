import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startDaemon } from './wire-client';

test('native daemon restarts preserve device views and canvas presentation fields', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-device-persistence-'));
    const home = join(temporary, 'home');
    const folder = join(temporary, 'project');
    await mkdir(home);
    await mkdir(folder);
    const device = { platform: 'ios', kind: 'simulator', name: 'iPhone 18 Pro', runtime: 'iOS 27.0' } as const;
    const content = {
        name: 'Portable device',
        color: '#353e53',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'phone', kind: 'device', title: 'Phone', x: 10, y: 20, w: 360, h: 720, device },
                    { id: 'note', kind: 'note', title: 'Note', x: 500, y: 20, w: 320, h: 240, body: 'Hello' }
                ],
                texts: [{ id: 'caption', x: 8, y: 9, text: 'Styled', size: 18, font: 'mono', bold: true, italic: true }],
                edges: [{ id: 'edge', from: 'phone', to: 'note', fromSide: 'right', toSide: 'left' }],
                layouts: []
            },
            { id: 'device-view', kind: 'device', name: 'Simulator', device }
        ]
    };
    const local = {
        activeViewId: 'device-view',
        views: {
            main: { camera: null, focusedNodeId: null },
            'device-view': { camera: null, focusedNodeId: null }
        },
        panels: { panel: { open: true, kind: 'devices' } }
    };
    let projectId = '';

    try {
        for (const index of [0, 1, 2]) {
            const daemon = await startDaemon({ home });
            const client = await daemon.connect();
            try {
                const opened = await client.call('project.open', projectId ? { projectId } : { folder, name: content.name });
                projectId = opened.summary.projectId;
                if (index > 0) {
                    expect(opened.document.views).toEqual(content.views);
                    expect(opened.local).toEqual(local);
                }
                const saved = await client.call('project.save', { projectId, baseRev: opened.document.rev, content });
                expect(saved.rev).toBe(index + 1);
                await client.call('project.save-local', { projectId, local });
                expect(client.violations).toEqual([]);
            } finally {
                client.close();
                await daemon.stop();
            }
        }
        expect(await readFile(join(folder, '.ruimte/project.json'), 'utf8')).not.toContain('deviceId');
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}, 90_000);
