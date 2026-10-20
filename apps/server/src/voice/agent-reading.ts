import type { AgentStatus } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { VoiceAgentPlace } from './project-reading.ts';

export type VoiceAgentStatus = AgentStatus | 'unknown';

export interface VoiceAgentReading {
    status: VoiceAgentStatus;
    working: boolean | null;
    updatedAt: number | null;
}

/*
 * What an agent does as the machine knows it. A chat nobody opened since a restart is idle on its record;
 * a terminal is an agent only while its hooks speak, and one the machine runs no session for is unknown.
 * Null for a plain shell, which is no agent at all.
 */
export async function agentReading(
    host: Pick<CanvasHost, 'chatThreads' | 'terminals'>,
    agent: Pick<VoiceAgentPlace, 'id' | 'kind'>
): Promise<VoiceAgentReading | null> {
    if (agent.kind === 'chat') {
        const info = (await host.chatThreads?.info?.(agent.id)) ?? null;
        return info === null
            ? { status: 'unknown', working: null, updatedAt: null }
            : { status: info.status, working: info.activeTurnId !== null, updatedAt: null };
    }
    const session = host.terminals?.agentOf(agent.id);
    if (session === null) {
        return null;
    }
    if (session === undefined) {
        return { status: 'unknown', working: null, updatedAt: null };
    }
    const status: VoiceAgentStatus = session.live ? session.status : session.status === 'exited' ? 'exited' : 'unknown';
    return { status, working: status === 'unknown' ? null : status === 'running', updatedAt: session.updatedAt };
}
