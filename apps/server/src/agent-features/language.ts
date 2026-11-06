import { languageActions } from '../actions/language-actions.ts';
import { AgentLanguage } from '../language/agent-language.ts';
import { languageToolkit } from '../tools/language-tools.ts';
import { defineAgentFeature } from './feature.ts';

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
