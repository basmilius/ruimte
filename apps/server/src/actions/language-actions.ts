import type { ActionHandlers } from '@ruimte/actions';
import type { LanguageAgentHost } from '../canvas/host.ts';
import { checkInsideFile } from '../canvas/project-paths.ts';
import { hostService, type ServerActionContext } from './context.ts';

function languageOf(context: ServerActionContext): LanguageAgentHost {
    return hostService(context, 'language', 'no-language-servers', 'This machine runs no language servers');
}

/* The file the call names, held to the project folder and its worktrees the way every tool's path is. */
function fileOf(context: ServerActionContext, path: string): Promise<string> {
    return checkInsideFile(context.place.folder, path, context.host.checkouts.paths);
}

export const languageActions: ActionHandlers<ServerActionContext> = {
    'language.diagnostics': async ({ path }, { actor, context }) => ({
        output: await languageOf(context).diagnostics(context.place, actor.id, await fileOf(context, path))
    }),
    'language.hover': async ({ path, line, column }, { actor, context }) => ({
        output: await languageOf(context).hover(context.place, actor.id, await fileOf(context, path), { line, column })
    }),
    'language.definition': async ({ path, line, column }, { actor, context }) => ({
        output: await languageOf(context).definition(context.place, actor.id, await fileOf(context, path), { line, column })
    }),
    'language.references': async ({ path, line, column }, { actor, context }) => ({
        output: await languageOf(context).references(context.place, actor.id, await fileOf(context, path), { line, column })
    }),
    'language.symbols': async ({ path }, { actor, context }) => ({
        output: await languageOf(context).symbols(context.place, actor.id, await fileOf(context, path))
    }),
    'language.problems': async ({ path }, { actor, context }) => ({
        output: await languageOf(context).problems(context.place, actor.id, path === null ? null : await fileOf(context, path))
    }),
    'language.supertypes': async ({ path, line, column }, { actor, context }) => ({
        output: await languageOf(context).supertypes(context.place, actor.id, await fileOf(context, path), { line, column })
    }),
    'language.subtypes': async ({ path, line, column }, { actor, context }) => ({
        output: await languageOf(context).subtypes(context.place, actor.id, await fileOf(context, path), { line, column })
    }),
    'language.sql': async ({ path }, { context }) => ({
        output: await languageOf(context).sqlFile(context.place, await fileOf(context, path))
    })
};
