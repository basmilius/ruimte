import { translate, type Dispatcher } from '../dispatcher.ts';
import type { ChatItem } from '@ruimte/contracts';
import type { ProjectIndex } from '../projects/project-index.ts';
import { hasPrepareSource } from '../sessions/prepare-source.ts';
import type { PrepareTerminal, PrepareTerminalHost } from '../sessions/prepare-terminal.ts';

export function registerTerminalPrepareHandlers(dispatcher: Dispatcher, prepare: PrepareTerminal): void {
    dispatcher.register('session.preparePreview', ({ machineId, ...source }, client) => translate(() => prepare.preview(machineId, source, client)));
    dispatcher.register('session.prepare', ({ machineId, token }, client) => translate(() => prepare.prepare(machineId, token, client)));
}

export function projectTerminalPrepareHost(
    index: ProjectIndex,
    chats: { get(id: string): { info: { cwd: string }; thread: { get(id: string): ChatItem | undefined } } | undefined }
): Pick<PrepareTerminalHost, 'source' | 'title'> {
    return {
        source: (source) => {
            const chat = chats.get(source.chatId);
            const place = index.locate(source.chatId);
            return chat && place && hasPrepareSource(chat.thread.get(source.itemId), source) ? { cwd: chat.info.cwd, projectId: place.projectId } : null;
        },
        title: (sessionId, projectId) => {
            const target = index.agentSource(sessionId);
            return target?.kind === 'terminal' && index.locate(sessionId)?.projectId === projectId ? target.title : null;
        }
    };
}
