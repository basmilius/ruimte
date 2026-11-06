import type { Area } from '../area.ts';
import type { ExternalChatSessions } from '../chat/external.ts';
import type { ProjectChatSearch } from '../chat/project-search.ts';

export interface ChatSearchDeps {
    search: ProjectChatSearch;
    external: ExternalChatSessions;
}

export function chatSearchArea({ search, external }: ChatSearchDeps): Area {
    return {
        name: 'chat search',
        handlers: (dispatcher) => {
            dispatcher.register('chat.search', (payload, client) => search.search(payload, client.id));
            dispatcher.register('chat.searchCancel', (payload, client) => {
                search.cancel(payload.searchId, client.id);
                return {};
            });
            dispatcher.register('chat.external', (payload, client) => external.list(payload.projectId, client.id));
        }
    };
}
