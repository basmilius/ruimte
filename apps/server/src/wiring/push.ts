import { join } from 'node:path';
import type { AuthStore } from '../auth/auth-store.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { errorText } from '../error-text.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { LimitContext } from '../push/limit-alert.ts';
import { pushNodeTitle } from '../push/node-title.ts';
import { PushService } from '../push/service.ts';
import type { SnoozeStore } from '../push/snoozes.ts';
import type { AgentsBundle } from './agents.ts';
import type { UsageBundle } from './usage.ts';

/* The notifications and live activities that tell a person's phone an agent needs them. */
export function wirePush(
    home: string,
    auth: AuthStore,
    identity: EndpointIdentity,
    agents: AgentsBundle,
    projects: ProjectStore,
    snoozes: SnoozeStore,
    usage: UsageBundle
): PushService {
    const { sessions, chats } = agents;
    const limitContext = (chatId: string): LimitContext | null => {
        const info = chats.get(chatId)?.info;

        if (!info) {
            return null;
        }

        const account = info.account ?? info.provider;
        const plan = usage.limits.snapshot().providers.find((entry) => (entry.account?.id ?? entry.kind) === account);

        return {
            providerName: chats.accountLabel(info.provider, undefined),
            accountLabel: chats.accountLabel(info.provider, info.account),
            windows: plan?.windows ?? [],
            // The same switches `limitResume` reads, so the push stays ordinary exactly while a resume is owed.
            resumes: identity.resumeAtReset && info.resumeAtReset !== false && info.limit?.resetsAt !== undefined
        };
    };

    return new PushService({
        auth,
        attentionPath: join(home, 'push-attention.json'),
        identity,
        titleFor: (nodeId) =>
            pushNodeTitle(
                {
                    titleFor: (id) => projects.index.titleFor(id),
                    shows: (id) => projects.index.shows(id),
                    openedBy: (id) => projects.hiddenAgents.get(id)?.openedBy
                },
                nodeId
            ),
        projectOf: (nodeId) => projects.index.locate(nodeId)?.projectId ?? null,
        shows: (nodeId) => projects.index.shows(nodeId),
        targetOf: (nodeId) => (chats.get(nodeId) ? 'chat' : 'terminal'),
        machineName: () => identity.label,
        activityNodes: () => [
            ...sessions.list().flatMap((session) =>
                !session.exited && session.agent
                    ? [
                          {
                              nodeId: session.sessionId,
                              target: 'terminal' as const,
                              title: session.agent.suggestedTitle ?? 'Terminal agent',
                              status: session.agent.status
                          }
                      ]
                    : []
            ),
            ...chats.list().map((chat) => ({ nodeId: chat.chatId, target: 'chat' as const, title: chat.suggestedTitle ?? 'AI chat', status: chat.status }))
        ],
        onError: (error) => console.error('Push delivery failed:', errorText(error)),
        snoozes,
        limitContext
    });
}
