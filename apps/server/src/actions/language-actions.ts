import type { ActionHandlers } from '@ruimte/actions';
import { checkInsideFile } from '../canvas/project-paths.ts';
import { VerbRefusal, type LanguageAgentHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

function languageOf(context: ServerActionContext): LanguageAgentHost {
    if (!context.host.language) {
        throw new VerbRefusal('no-language-servers', 'This machine runs no language servers');
    }
    return context.host.language;
}

/* The file the call names, held to the project folder and its worktrees the way every verb's path is. */
function fileOf(context: ServerActionContext, path: string): Promise<string> {
    return checkInsideFile(context.place.folder, path, context.host.worktreePaths);
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
    'language.sql': async ({ path }, { context }) => ({
        output: await languageOf(context).sqlFile(context.place, await fileOf(context, path))
    })
};
