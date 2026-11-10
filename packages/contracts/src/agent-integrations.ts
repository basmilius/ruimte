import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

/*
 * What a person allowed the daemon to write into a CLI's global settings: the status hooks. `unset`
 * writes nothing yet.
 */
export const AgentIntegrationSchema = z.object({
    provider: AgentKindSchema,
    state: z.enum(['unset', 'on', 'off']),
    // False while a person has not seen the choice for a provider that was already wired up.
    reviewed: z.boolean()
});
export type AgentIntegration = z.infer<typeof AgentIntegrationSchema>;

export const AgentIntegrationsSummarySchema = z.object({
    providers: z.array(AgentIntegrationSchema),
    // True when `--no-hooks` decides: nothing is written or removed, whatever the choice says.
    fixed: z.boolean()
});
export type AgentIntegrationsSummary = z.infer<typeof AgentIntegrationsSummarySchema>;

/* A file the integration writes or would write; paths stay with the local secret. */
export const AgentIntegrationFileSchema = z.object({
    provider: AgentKindSchema,
    path: z.string(),
    // `rules` is a rules file of an earlier release for `ruimte-context`, listed while it is still there.
    kind: z.enum(['hooks', 'rules']),
    present: z.boolean(),
    ours: z.boolean()
});
export type AgentIntegrationFile = z.infer<typeof AgentIntegrationFileSchema>;

export const AgentIntegrationReportSchema = z.object({
    path: z.string(),
    // `rules` reports only the removal of such an earlier rules file.
    kind: z.enum(['hooks', 'rules']),
    outcome: z.enum(['written', 'unchanged', 'removed', 'deleted', 'none', 'kept-edited', 'missing', 'refused', 'failed']),
    message: z.string().optional()
});
export type AgentIntegrationReport = z.infer<typeof AgentIntegrationReportSchema>;

export const AgentIntegrationsResultSchema = z.object({
    summary: AgentIntegrationsSummarySchema,
    files: z.array(AgentIntegrationFileSchema)
});
export type AgentIntegrationsResult = z.infer<typeof AgentIntegrationsResultSchema>;

/* `endpoint.setAgentIntegration`: local secret only. */
export const AgentIntegrationSetPayloadSchema = z.object({
    provider: AgentKindSchema,
    on: z.boolean()
});

export const AgentIntegrationSetResultSchema = z.object({
    summary: AgentIntegrationsSummarySchema,
    report: z.array(AgentIntegrationReportSchema)
});

export const AGENT_INTEGRATIONS_REQUEST_SCHEMAS = {
    'endpoint.agentIntegrations': { payload: EmptySchema, result: AgentIntegrationsResultSchema },
    'endpoint.setAgentIntegration': { payload: AgentIntegrationSetPayloadSchema, result: AgentIntegrationSetResultSchema }
} as const;
