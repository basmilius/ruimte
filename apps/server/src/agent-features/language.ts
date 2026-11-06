import { languageActions } from '../actions/language-actions.ts';
import { AgentLanguage, type LanguageAgentHost } from '../language/agent-language.ts';
import { languageToolkit } from '../tools/language-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The project's running language servers as an agent may ask them; absent on a host without them. */
        language?: LanguageAgentHost;
    }
}

export const languageFeature = defineAgentFeature({
    name: 'language',
    toolkit: languageToolkit,
    actions: languageActions,
    host: ({ databases, later }) => ({
        language: new AgentLanguage({
            host: {
                forAgent: (projectId, request, work) => later.language().host.forAgent(projectId, request, work),
                programOf: (kind) => later.language().host.programOf(kind),
                cachedWorkspaceProblems: (projectId) => later.language().host.cachedWorkspaceProblems(projectId)
            },
            sql: databases.sqlAnalysis
        })
    })
});
