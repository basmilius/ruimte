import type { ActionHandlers, ActionName } from '@ruimte/actions';
import type { TemplateDraft } from '../templates/template-store.ts';
import { hostService, type ServerActionContext } from './context.ts';

function templatesOf(context: ServerActionContext) {
    return hostService(context, 'templates', 'no-templates', 'This machine keeps no editor templates');
}

/* The actions of this file that honor a dry run. */
export const templatePreviews: readonly ActionName[] = ['template.add'];

// A refusal of the store is a coded error, which the registry already hands on under its own code.
export const templateActions: ActionHandlers<ServerActionContext> = {
    'template.list': async ({ language }, { context }) => {
        const rows = await templatesOf(context).listForAgent(context.place.projectId);

        return { output: { templates: language ? rows.filter((row) => row.languages.includes(language)) : rows } };
    },
    'template.add': async ({ kind, key, body, languages, description, places, expression }, { actor, context, dryRun }) => {
        const shared = { key, body, languages, ...(description ? { description } : {}) };
        const draft: TemplateDraft =
            kind === 'live'
                ? { kind, template: { ...shared, ...(places ? { places } : {}) } }
                : { kind, template: { ...shared, ...(expression ? { expression } : {}) } };
        const templates = templatesOf(context);
        const { projectId } = context.place;

        if (dryRun === true) {
            await templates.checkAgentAdd(draft, projectId);

            return { output: { id: '', kind, key } };
        }

        const saved = await templates.addByAgent(draft, actor.id, projectId);

        return { output: { id: saved.template.id, kind, key } };
    }
};
