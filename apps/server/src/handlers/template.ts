import type { Area } from '../area.ts';
import type { TemplateStore } from '../templates/template-store.ts';

interface TemplateDeps {
    store: TemplateStore;
}

/* Any client of the owner edits a person's templates, since a template runs nothing. None of these is on a peer's list. */
export function templateArea({ store }: TemplateDeps): Area {
    return {
        name: 'template',
        sources: [store],
        handlers: (dispatcher) => {
            dispatcher.register('template.list', ({ projectId }, client) => store.list(client.id, projectId));

            dispatcher.register('template.save', (payload, client) => store.save(client.id, payload));

            dispatcher.register('template.remove', (payload, client) => store.remove(client.id, payload));

            dispatcher.register('template.configure', (payload) => store.configure(payload));
        },
        stop: [{ phase: 'end', label: 'Closing templates', run: () => store.closeAll() }]
    };
}
