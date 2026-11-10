import { AgentResumePayloadSchema, SessionStatusEventSchema } from '@adecore/agent-contracts/agent';
import { EmptySchema } from '@adecore/agent-contracts/protocol';

export * from '@adecore/agent-contracts/agent';

export const RUIMTE_AGENT_REQUEST_SCHEMAS = {
    'agent.resume': { payload: AgentResumePayloadSchema, result: EmptySchema }
} as const;

export const RUIMTE_AGENT_EVENT_SCHEMAS = {
    'session.status': SessionStatusEventSchema
} as const;
