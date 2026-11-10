import { ProjectSidebarResultSchema, type EventMap, type EventType, type RequestMap, type RequestType, type SessionStatusEvent } from '@ruimte/contracts';
import { SidebarWatch } from '../../src/project/sidebar-watch';
import type { Transport } from '../../src/transport-api/transport';
import { median } from './bench';

const projectCount = Number(process.env.BENCH_PROJECTS ?? 20);
const viewsPerProject = Number(process.env.BENCH_VIEWS ?? 100);
const updates = Number(process.env.BENCH_UPDATES ?? 200);
const runs = Number(process.env.BENCH_RUNS ?? 7);
const projects = Array.from({ length: projectCount }, (_, project) => ({
    summary: {
        projectId: `project-${project}`,
        name: `Project ${project}`,
        color: 'blue',
        folder: `/benchmark/${project}`,
        lastOpenedAt: 0,
        closedAt: null,
        available: true,
        icon: { kind: 'initial' as const, value: 'P' },
        nameSource: 'folder' as const
    },
    views: Array.from({ length: viewsPerProject }, (_, index) => ({
        id: `view-${project}-${index}`,
        name: `View ${index}`,
        kind: 'browser' as const,
        icon: null,
        provider: null,
        path: null,
        shared: false,
        nodes: [],
        self: null
    }))
}));
ProjectSidebarResultSchema.parse({ projects });
const handlers = new Map<string, (value: never) => void>();
const transport: Transport = {
    status: 'open',
    request: async <T extends RequestType>(type: T): Promise<RequestMap[T]['result']> => {
        const result =
            type === 'project.sidebar' ? { projects } : type === 'session.list' ? { sessions: [] } : type === 'chat.list' ? { chats: [] } : undefined;
        if (result === undefined) {
            throw new Error(`Unexpected request ${type}`);
        }
        return result as RequestMap[T]['result'];
    },
    on: <E extends EventType>(event: E, handler: (value: EventMap[E]) => void) => {
        handlers.set(event, handler as (value: never) => void);
        return () => {
            handlers.delete(event);
        };
    },
    subscribeStatus: () => () => undefined
};
const watcher = new SidebarWatch(transport, { polls: () => false });
for (let turn = 0; turn < 15; turn++) {
    await Promise.resolve();
}
if (watcher.getSnapshot().state !== 'ready') {
    throw new Error('Sidebar did not load');
}
let notifications = 0;
watcher.subscribe(() => notifications++);
const event = (index: number, status: 'idle' | 'running'): SessionStatusEvent => ({
    sessionId: `session-${index}`,
    agent: { kind: 'claude', agentSessionId: `agent-${index}`, transcriptPath: null, status, live: true, updatedAt: 0 }
});
const emit = (payload: SessionStatusEvent) => handlers.get('session.status')!(payload as never);
const cases = [];
try {
    for (const changed of [true, false]) {
        for (let index = 0; index < 50; index++) {
            emit(event(index, 'idle'));
        }
        notifications = 0;
        const samples = [];
        for (let run = 0; run < runs; run++) {
            const started = performance.now();
            for (let index = 0; index < updates; index++) {
                const status = changed && Math.floor((run * updates + index) / 50) % 2 === 0 ? 'running' : 'idle';
                emit(event(index % 50, status));
            }
            samples.push(performance.now() - started);
        }
        if (notifications !== (changed ? runs * updates : 0)) {
            throw new Error('Sidebar notifications lost a change or repeated unchanged data');
        }
        if (watcher.getSnapshot().projects !== projects) {
            throw new Error('A status update replaced project rows');
        }
        cases.push({ changed, notifications, samples });
    }
    notifications = 0;
    const samples = [];
    for (let run = 0; run < runs; run++) {
        const started = performance.now();
        for (let index = 0; index < updates; index++) {
            handlers.get('project.summary')!({ summary: { ...projects[0]!.summary, name: `Updated ${index % 2}` }, views: projects[0]!.views } as never);
        }
        samples.push(performance.now() - started);
    }
    if (notifications !== runs * updates || watcher.getSnapshot().projects[0]?.summary.name !== `Updated ${(updates - 1) % 2}`) {
        throw new Error('Sidebar lost a project summary change');
    }
    cases.push({ projectSummary: true, notifications, samples });
} finally {
    watcher.dispose();
}
console.log(JSON.stringify({ benchmark: 'sidebar-status-updates', projectCount, viewsPerProject, updates, runs, cases }, null, 2));
if (median(cases[0]!.samples) > Number(process.env.BENCH_MAX_STATUS_MS ?? Infinity)) {
    throw new Error('Sidebar updates exceeded their processing budget');
}
