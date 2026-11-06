import { templateActions, templatePreviews } from '../actions/template-actions.ts';
import { templateToolkit } from '../tools/template-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const templateFeature = defineAgentFeature({
    name: 'template',
    toolkit: templateToolkit,
    actions: templateActions,
    previews: templatePreviews,
    host: ({ templates }) => ({ templates: templates.store })
});
