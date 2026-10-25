import { z } from 'zod';

const Id = z.string().min(1).max(256);
export const AgentBridgeSchema = z.object({
    id: z.uuid(),
    projectId: Id,
    nodeId: Id,
    machineId: Id,
    remoteNodeId: Id,
    label: z.string().min(1).max(240)
});
export type AgentBridge = z.infer<typeof AgentBridgeSchema>;
export const BridgeListPayloadSchema = z.object({ nodeId: Id });
export const BridgeListResultSchema = z.object({ bridges: z.array(AgentBridgeSchema).max(32) });
export const BridgeRemovePayloadSchema = z.object({ id: z.uuid() });
export const BridgeCandidatesPayloadSchema = z.object({ projectId: Id });
export const BridgeCandidatesResultSchema = z.object({
    agents: z.array(z.object({ nodeId: Id, title: z.string(), canvas: z.string() }))
});
export const PeerMessagePayloadSchema = z.object({
    bridgeId: z.uuid(),
    fromNodeId: Id,
    text: z.string().trim().min(1).max(500),
    fromMessage: z.boolean()
});
export type PeerMessagePayload = z.infer<typeof PeerMessagePayloadSchema>;
export const PeerMessageResultSchema = z.object({ at: z.enum(['now', 'waiting']), detail: z.string().max(2000) });
