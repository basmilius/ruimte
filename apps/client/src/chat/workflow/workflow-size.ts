import { z } from 'zod';
import type { CardSize } from '@/routines/output-size';
import { storedJson } from '@/state/stored-json';

/* Room for an agent's header and a few rows of its conversation. */
export const AGENT_MIN: CardSize = { w: 320, h: 240 };

const CardSizeSchema = z.object({ w: z.number().min(AGENT_MIN.w), h: z.number().min(AGENT_MIN.h) });

/* The size a person gave the conversation of a workflow's agent beside a chat node: this client's, per view and node, never in the project. */
export function storedAgentSize(viewId: string, nodeId: string) {
    return storedJson<CardSize>(`ruimte.chatWorkflowAgent.${viewId}.${nodeId}`, CardSizeSchema);
}
