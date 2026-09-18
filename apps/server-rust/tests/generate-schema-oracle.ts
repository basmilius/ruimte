import { REQUEST_SCHEMAS } from '../../../packages/contracts/src';

const cases: Array<{ method: string; input: unknown; ok: boolean; output?: unknown }> = [];
const add = (method: keyof typeof REQUEST_SCHEMAS, input: unknown): void => {
    const result = REQUEST_SCHEMAS[method].payload.safeParse(input);
    cases.push({ method, input, ok: result.success, ...(result.success ? { output: result.data } : {}) });
};

for (const method of Object.keys(REQUEST_SCHEMAS) as Array<keyof typeof REQUEST_SCHEMAS>) {
    for (const input of [{}, { extra: 'strip me' }, null, [], true, 0, '']) {
        add(method, input);
    }
}
for (const input of [
    { sessionId: 's', follow: true },
    { sessionId: 's', follow: false },
    { sessionId: 's', cols: 80, rows: 24 },
    { sessionId: 's', cols: null, rows: null, follow: true },
    { sessionId: 's', cols: 80, follow: true },
    { sessionId: 's', cols: 80, rows: 24, extra: true },
    { sessionId: 's', cols: 0, rows: 24 }
]) {
    add('session.attach', input);
}
for (const input of [
    { chatId: 'c', text: '' },
    { chatId: 'c', text: '   ' },
    { chatId: 'c', text: 'hello' },
    { chatId: 'c', text: 'hello', attachments: null },
    { chatId: 'c', text: 'hello', attachments: [], extra: 1 }
]) {
    add('chat.send', input);
}
for (const input of [
    { projectId: 'p', baseRev: 0, content: { name: 'P', color: '#112233', views: [] } },
    {
        projectId: 'p',
        baseRev: 0,
        content: { name: 'P', color: '#112233', views: [{ kind: 'canvas', id: 'v', name: 'V', nodes: [], texts: [], edges: [] }] }
    },
    {
        projectId: 'p',
        baseRev: 0,
        content: { name: 'P', color: '#112233', views: [{ kind: 'future-view', id: 'v', name: 'V', future: { preserved: true } }] }
    },
    {
        projectId: 'p',
        baseRev: 0,
        content: {
            name: 'P',
            color: '#112233',
            views: [{ kind: 'canvas', id: 'v', name: 'V', nodes: [{ kind: 'future-node', id: 'n', future: true }], texts: [], edges: [] }]
        }
    }
]) {
    add('project.save', input);
}
for (const name of ['a'.repeat(80), 'a'.repeat(81), 'é'.repeat(80), '🚀'.repeat(40), '🚀'.repeat(41)]) {
    add('endpoint.setIdentity', { name });
}

const device = { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' } as const;
for (const input of [
    device,
    { ...device, stream: 'http' },
    { ...device, stream: 'events', extra: true },
    { ...device, stream: 'video' }
]) {
    add('device.open', input);
}
for (const input of [
    { ...device, input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.25, edge: 'bottom', extra: true } },
    { ...device, input: { kind: 'multiPointer', phase: 'move', first: { x: 0, y: 1 }, second: { x: 1, y: 0 } } },
    { ...device, input: { kind: 'scroll', deltaX: 10, deltaY: -20, x: 0.5, y: 0.5 } },
    { ...device, input: { kind: 'pointer', phase: 'down', x: -0.1, y: 0.25 } },
    { ...device, input: { kind: 'button', button: 'unknown' } }
]) {
    add('device.input', input);
}
for (const input of [
    { ...device, action: 'setAppearance', value: 'dark', extra: true },
    { ...device, action: 'setPermission', appId: '  com.example.app  ', permission: 'camera', decision: 'grant' },
    { ...device, action: 'openUrl', url: '  https://example.test/path  ' },
    { ...device, action: 'launchApp', appId: '   ' },
    { ...device, action: 'setLocation', latitude: 91, longitude: 0 }
]) {
    add('device.action', input);
}

add('project.save', {
    projectId: 'p',
    baseRev: 0,
    content: {
        name: 'P',
        color: '#112233',
        views: [
            {
                kind: 'canvas',
                id: 'v',
                name: 'V',
                nodes: [
                    {
                        id: 'phone',
                        kind: 'device',
                        title: 'Phone',
                        x: 0,
                        y: 0,
                        w: 360,
                        h: 720,
                        device: { platform: 'ios', kind: 'simulator', name: 'iPhone', runtime: 'iOS 27.0' }
                    }
                ],
                texts: [{ id: 'text', x: 2, y: 3, text: 'hello', size: 16, font: 'mono', bold: true }],
                edges: [{ id: 'edge', from: 'phone', to: 'text', fromSide: 'right', toSide: 'left' }]
            },
            {
                id: 'phone-view',
                kind: 'device',
                name: 'Phone',
                device: { platform: 'ios', kind: 'simulator', name: 'iPhone', runtime: 'iOS 27.0' }
            }
        ]
    }
});

const output = new URL('./schema-oracle.json', import.meta.url);
const text = `${JSON.stringify(cases, null, 2)}\n`;
if (process.argv.includes('--check')) {
    const current = await Bun.file(output).text().catch(() => '');
    if (current !== text) {
        console.error('Schema oracle is out of date. Run `bun apps/server-rust/tests/generate-schema-oracle.ts`.');
        process.exit(1);
    }
} else {
    await Bun.write(output, text);
}
