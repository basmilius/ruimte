import type { ChatInfo, GitIdentity, ProjectCanvasView, ProjectSummary } from '@ruimte/contracts';

export function projectSummary(projectId: string, name: string, folder: string): ProjectSummary {
    return {
        projectId,
        name,
        color: '#000',
        folder,
        lastOpenedAt: 0,
        closedAt: null,
        available: true,
        icon: { kind: 'initial', value: name[0]! },
        nameSource: 'chosen'
    };
}

export function gitIdentity(path: string, rootCommits: string[], branch = 'main'): GitIdentity {
    return { path, rootCommits, branch, heads: [] };
}

/* An idle Claude chat that has run one turn in `/work/atlas`. */
export function idleChatInfo(chatId: string): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd: '/work/atlas',
        agentSessionId: 'session-1',
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 1, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: []
    } as unknown as ChatInfo;
}

export function emptyCanvas(id = 'main', name = 'Main'): ProjectCanvasView {
    return { kind: 'canvas', id, name, nodes: [], texts: [], edges: [], layouts: [] };
}
