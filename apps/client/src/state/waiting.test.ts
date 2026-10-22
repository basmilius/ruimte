import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentRequest, ChatInfo } from '@ruimte/contracts';
import type { ChatStatuses } from '@adecore/agents-react/state';
import { endpointKey } from '@/state/keys';
import type { SessionsByKey, StatusOf } from '@/state/sessions';
import { nextWaiting, nextWaitingSince, oldestWaitingFirst, type Waiting } from './waiting';

const ENDPOINT = 'local';

function key(nodeId: string): string {
    return endpointKey(ENDPOINT, nodeId);
}

function request(createdAt: number): AgentRequest {
    return { id: `request-${createdAt}`, source: 'hook', kind: 'approval', toolName: 'Bash', title: null, text: 'bun test', createdAt };
}

function agent(status: AgentInfo['status'], updatedAt: number, requests?: AgentRequest[]): AgentInfo {
    return { kind: 'claude', agentSessionId: 'session', transcriptPath: null, status, live: true, updatedAt, ...(requests ? { requests } : {}) };
}

function chat(createdAts: number[]): ChatStatuses[string] {
    const requests = createdAts.map((createdAt) => ({ requestId: `r${createdAt}`, itemId: `i${createdAt}`, kind: 'approval', createdAt }));
    return { info: { status: 'needs-you', ...(requests.length > 0 ? { requests } : {}) } as unknown as ChatInfo };
}

describe('when a terminal started waiting', () => {
    test('is its first sighting, not the later hooks of the same prompt', () => {
        const first = nextWaitingSince({ [key('api')]: { attached: true, agent: agent('needs-you', 100) } }, new Map());
        expect(first.get(key('api'))).toBe(100);
        const later = nextWaitingSince({ [key('api')]: { attached: true, agent: agent('needs-you', 250) } }, first);
        expect(later).toBe(first);
    });

    test('is forgotten once it runs again, so the next wait is dated anew', () => {
        const waiting = nextWaitingSince({ [key('api')]: { attached: true, agent: agent('needs-you', 100) } }, new Map());
        const running = nextWaitingSince({ [key('api')]: { attached: true, agent: agent('running', 200) } }, waiting);
        expect(running.has(key('api'))).toBe(false);
        expect(nextWaitingSince({ [key('api')]: { attached: true, agent: agent('needs-you', 300) } }, running).get(key('api'))).toBe(300);
    });
});

describe('what waits on a person, oldest first', () => {
    const sessions: SessionsByKey = {
        [key('api')]: { attached: true, agent: agent('needs-you', 900) },
        [key('ios')]: { attached: true, agent: agent('needs-you', 900, [request(400), request(200)]) }
    };
    const chats: ChatStatuses = { [key('docs')]: chat([300]), [key('old')]: chat([]) };
    const nodes: StatusOf[] = [
        { id: 'old', kind: 'chat' },
        { id: 'api', kind: 'terminal' },
        { id: 'docs', kind: 'chat' },
        { id: 'ios', kind: 'terminal' }
    ];

    test('dates a request by when it came, a bare wait by its first sighting, and puts what nothing dates last', () => {
        const order = oldestWaitingFirst(nodes, sessions, chats, new Map([[key('api'), 100]]), ENDPOINT);
        expect(order).toEqual([
            { id: 'api', since: 100 },
            { id: 'ios', since: 200 },
            { id: 'docs', since: 300 },
            { id: 'old', since: Infinity }
        ]);
    });
});

describe('the next wait', () => {
    const order: Waiting[] = [
        { id: 'a', since: 100 },
        { id: 'b', since: 200 },
        { id: 'c', since: 300 }
    ];

    test('starts with the oldest and walks on, around to the start', () => {
        expect(nextWaiting(order, null)).toEqual(order[0]!);
        expect(nextWaiting(order, order[0]!)).toEqual(order[1]!);
        expect(nextWaiting(order, order[2]!)).toEqual(order[0]!);
    });

    test('goes on from where an answered one stood rather than back to the oldest', () => {
        expect(nextWaiting([order[0]!, order[2]!], order[1]!)).toEqual(order[2]!);
        expect(nextWaiting([order[0]!], order[1]!)).toEqual(order[0]!);
    });

    test('is nothing while nothing waits', () => {
        expect(nextWaiting([], order[0]!)).toBeNull();
    });
});
