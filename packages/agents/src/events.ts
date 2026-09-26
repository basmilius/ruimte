import type { AGENT_EVENT_SCHEMAS, AgentEventType } from '@ruimte/agent-contracts';
import type { z } from 'zod';

export type AgentEventMap = { [E in AgentEventType]: z.infer<(typeof AGENT_EVENT_SCHEMAS)[E]> };

/* One event a chat host sends a client, before it is framed. */
export type AgentEvent = { [E in AgentEventType]: { event: E; payload: AgentEventMap[E] } }[AgentEventType];

export type AgentSink = (event: AgentEvent) => void;
