import { templateActions, templatePreviews } from '../actions/template-actions.ts';
import type { TemplateStore } from '../templates/template-store.ts';
import { templateToolkit } from '../tools/template-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The editor templates an agent lists and adds to; absent on a host that keeps none. */
        templates?: Pick<TemplateStore, 'listForAgent' | 'addByAgent' | 'checkAgentAdd'>;
    }
}

export const templateFeature = defineAgentFeature({
    name: 'template',
    toolkit: templateToolkit,
    actions: templateActions,
    previews: templatePreviews,
    host: ({ templates }) => ({ templates: templates.store })
});
