import { chatNoticeTargets, showNotices, steerNotices, withinHops, type NoticeChat, type NoticeStore } from '@adecore/agents/coordination';
import type { MessageHost } from '../tools/host.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { errorText } from '../error-text.ts';
import type { OutboxWork } from '../outbox/outbox.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { PushService } from '../push/service.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { deliverNotice, MESSAGE_WORDS } from './notices.ts';

interface AgentMessageDeps {
    notices: NoticeStore;
    sessions: Pick<SessionManager, 'get'>;
    chats: ChatManager;
    projects: Pick<ProjectStore, 'index'>;
    enqueue(projectId: string, nodeId: string, work: OutboxWork): Promise<void>;
    push(): Pick<PushService, 'notify'>;
    /* The person's "Send to a working agent right away", which holds for a message of an agent as well. */
    steerMessages?(): boolean;
}

/*
 * The turn messages that landed during a turn are owed once it ends. Only after a turn that finished:
 * a person's Stop or an error is no moment to start another on its own.
 */
export async function wakeForWaitingMessages(
    notices: Pick<NoticeStore, 'waiting'>,
    chatId: string,
    state: 'done' | 'aborted' | 'error',
    projectId: string | null,
    enqueue: (projectId: string, work: OutboxWork) => Promise<void>
): Promise<void> {
    if (state === 'done' && projectId !== null && notices.waiting(chatId).some(withinHops)) {
        await enqueue(projectId, { kind: 'deliver-message', payload: { from: chatId } });
    }
}

/* What `notify` and `alert` reach: another node's agent, and the person's devices. */
export function agentMessages(deps: AgentMessageDeps): MessageHost {
    const { notices, sessions, chats, projects } = deps;
    /* Where a message a person has not seen goes: the thread of the chat left under that node id. */
    const noticeChat: NoticeChat = {
        has: (id) => chats.hasStored(id),
        note: (id, text, message) => chats.addNote(id, 'info', text, message)
    };
    return {
        alert: (nodeId, text) => {
            const place = projects.index.locate(nodeId);
            if (!place) {
                throw new Error('The notifying session is no longer in a project');
            }
            deps.push().notify(chats.get(nodeId) ? 'chat' : 'terminal', nodeId, projects.index.titleFor(nodeId) ?? 'Agent', text, {
                projectId: place.projectId,
                viewId: place.canvasId ?? nodeId
            });
        },
        notify: async (notice) => {
            const delivery = await deliverNotice(
                notices,
                {
                    /* An exited session still lists its last screen, but nobody is reading it; its
                       message waits for the shell that takes the id over. */
                    terminal: (id) => {
                        const session = sessions.get(id);
                        return session && !session.exited ? { agent: session.agent, notice: (text: string) => session.notice(text) } : null;
                    },
                    ...chatNoticeTargets(chats)
                },
                notice
            );
            /* A chat shows it to a person the moment it lands. Never in the way of the answer to the
               sender: the message is in the queue by now, so the model hears it whatever a thread does. */
            await showNotices(notices, noticeChat, MESSAGE_WORDS, notice.targetId).catch((e) =>
                console.error(`Showing a message in chat ${notice.targetId} failed:`, errorText(e))
            );
            /* After the line in the thread, so a person sees the message itself above the turn it opens. */
            if (delivery.wake) {
                await deps.enqueue(notice.projectId, notice.targetId, { kind: 'deliver-message', payload: { from: notice.from } });
            }
            /* Not awaited: a CLI takes a steer only between tool calls, and the sender goes on meanwhile. */
            if (delivery.inTurn === true && deps.steerMessages?.() === true) {
                void steerNotices(notices, { steer: (id, steer) => chats.steerMessages(id, steer) }, MESSAGE_WORDS, notice.targetId).catch((e) =>
                    console.error(`Steering a message into chat ${notice.targetId} failed:`, errorText(e))
                );
            }
            return delivery;
        }
    };
}
