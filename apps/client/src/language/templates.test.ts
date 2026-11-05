import { beforeEach, describe, expect, test } from 'bun:test';
import { TemplateRegistry } from '@adecore/editor-react';
import type { PersonalTemplates, ProjectTemplates } from '@ruimte/contracts';
import { useToasts } from '@/state/toasts';
import { TransportError } from '@/transport-api/transport';
import { FakeLanguageTransport } from './fake-daemon';
import { TemplatesTracker } from './templates';

const PERSONAL: PersonalTemplates = {
    revision: 3,
    live: [{ id: 'mine', key: 'hi', body: 'hello($0);', languages: ['typescript'] }],
    postfix: [],
    disabled: [],
    settings: {}
};

const PROJECT: ProjectTemplates = { revision: 7, live: [], postfix: [] };

function machine(): FakeLanguageTransport {
    const transport = new FakeLanguageTransport();
    transport.connection = { ...transport.connection, features: ['template.list'] };
    transport.answers.set('template.list', () => ({ personal: PERSONAL, project: PROJECT }));

    return transport;
}

async function loaded(transport: FakeLanguageTransport): Promise<TemplatesTracker> {
    const tracker = new TemplatesTracker(transport, 'p1', new TemplateRegistry());
    await tracker.refresh();

    return tracker;
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('the writes of the templates tracker', () => {
    test('save names the revision of its scope and puts the answer in the snapshot', async () => {
        const transport = machine();
        transport.answers.set('template.save', () => ({
            revision: 8,
            kind: 'live',
            template: { id: 'new', key: 'ok', body: 'ok($0);', languages: ['php'] }
        }));
        const tracker = await loaded(transport);

        expect(await tracker.save('project', { kind: 'live', template: { key: 'ok', body: 'ok($0);', languages: ['php'] } })).toBe(true);

        expect(transport.callsOf('template.save').map((call) => call.payload)).toEqual([
            { scope: 'project', projectId: 'p1', revision: 7, kind: 'live', template: { key: 'ok', body: 'ok($0);', languages: ['php'] } }
        ]);
        expect(tracker.getSnapshot()?.project).toMatchObject({ revision: 8, live: [{ id: 'new', key: 'ok' }] });
        expect(tracker.getSnapshot()?.personal.revision).toBe(3);
    });

    test('save of a template that has an id replaces it', async () => {
        const transport = machine();
        transport.answers.set('template.save', () => ({
            revision: 4,
            kind: 'live',
            template: { id: 'mine', key: 'hey', body: 'hello($0);', languages: ['typescript'] }
        }));
        const tracker = await loaded(transport);

        await tracker.save('personal', { kind: 'live', template: { id: 'mine', key: 'hey', body: 'hello($0);', languages: ['typescript'] } });

        expect(tracker.getSnapshot()?.personal.live).toEqual([{ id: 'mine', key: 'hey', body: 'hello($0);', languages: ['typescript'] }]);
        expect(transport.callsOf('template.save')[0]!.payload).not.toHaveProperty('projectId');
    });

    test('remove drops the template and keeps the revision of the reply', async () => {
        const transport = machine();
        transport.answers.set('template.remove', () => ({ revision: 4 }));
        const tracker = await loaded(transport);

        await tracker.remove('personal', 'live', 'mine');

        expect(transport.callsOf('template.remove').map((call) => call.payload)).toEqual([{ scope: 'personal', revision: 3, kind: 'live', id: 'mine' }]);
        expect(tracker.getSnapshot()?.personal).toMatchObject({ revision: 4, live: [] });
    });

    test('configure sends only what it names and takes the answer for the disabled list and the switches', async () => {
        const transport = machine();
        transport.answers.set('template.configure', () => ({ revision: 4, disabled: ['builtin.javascript.log'], settings: { postfix: false } }));
        const tracker = await loaded(transport);

        await tracker.configure({ disabled: ['builtin.javascript.log'] });

        expect(transport.callsOf('template.configure').map((call) => call.payload)).toEqual([{ revision: 3, disabled: ['builtin.javascript.log'] }]);
        expect(tracker.getSnapshot()?.personal).toMatchObject({ revision: 4, disabled: ['builtin.javascript.log'], settings: { postfix: false } });
    });

    test('a rev-conflict reads the list again, says so once and reports that nothing was saved', async () => {
        const transport = machine();
        transport.answers.set('template.remove', () => {
            throw new TransportError('rev-conflict', 'The templates are at revision 9');
        });
        const tracker = await loaded(transport);
        transport.answers.set('template.list', () => ({ personal: { ...PERSONAL, revision: 9, live: [] }, project: PROJECT }));

        expect(await tracker.remove('personal', 'live', 'mine')).toBe(false);

        expect(tracker.getSnapshot()?.personal).toMatchObject({ revision: 9, live: [] });
        expect(useToasts.getState().toasts.map((toast) => toast.title)).toEqual(['Templates changed elsewhere']);
    });

    test('another failure is thrown and leaves the snapshot alone', async () => {
        const transport = machine();
        transport.answers.set('template.remove', () => {
            throw new TransportError('template-not-found', 'There is no live template mine');
        });
        const tracker = await loaded(transport);

        await expect(tracker.remove('personal', 'live', 'mine')).rejects.toThrow('There is no live template mine');

        expect(tracker.getSnapshot()?.personal).toEqual(PERSONAL);
        expect(useToasts.getState().toasts).toEqual([]);
    });

    test('a write to a project the machine could not read is refused before it is sent', async () => {
        const transport = machine();
        transport.answers.set('template.list', () => ({ personal: PERSONAL, project: null, projectTooNew: true }));
        const tracker = await loaded(transport);

        expect(tracker.projectWritable).toBe(false);
        await expect(tracker.remove('project', 'live', 'x')).rejects.toThrow('project templates are not loaded');
        expect(transport.callsOf('template.remove')).toEqual([]);
    });
});
