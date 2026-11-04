import type { ExternalChatSessions } from '../chat/external.ts';
import type { ProjectChatSearch } from '../chat/project-search.ts';
import type { Dispatcher } from '../dispatcher.ts';

export function registerChatSearchHandlers(dispatcher: Dispatcher, search: ProjectChatSearch, external: ExternalChatSessions): void {
    dispatcher.register('chat.search', (payload, client) => search.search(payload, client.id));
    dispatcher.register('chat.searchCancel', (payload, client) => {
        search.cancel(payload.searchId, client.id);
        return {};
    });
    dispatcher.register('chat.external', (payload, client) => external.list(payload.projectId, client.id));
}
