import type { ChatItem } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import type { ProjectIndex } from '../projects/project-index.ts';
import { hasPrepareSource } from '../sessions/prepare-source.ts';
import type { PrepareTerminal, PrepareTerminalHost } from '../sessions/prepare-terminal.ts';

export interface TerminalPrepareDeps {
    prepare: PrepareTerminal;
}

export function terminalPrepareArea({ prepare }: TerminalPrepareDeps): Area {
    return {
        name: 'terminal prepare',
        handlers: (dispatcher) => {
            dispatcher.register('session.preparePreview', ({ machineId, ...source }, client) => prepare.preview(machineId, source, client));
            dispatcher.register('session.prepare', ({ machineId, token }, client) => prepare.prepare(machineId, token, client));
        }
    };
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
