import { translate, type Dispatcher } from '../dispatcher.ts';
import type { ChatImageFiles } from '../chat/image-files.ts';

export function registerChatImageHandlers(dispatcher: Dispatcher, images: ChatImageFiles): void {
    dispatcher.register('chat.imageTarget', (payload, client) => translate(() => images.target(payload, client.id)));
    dispatcher.register('chat.saveImage', (payload, client) => translate(() => images.save(payload, client.id)));
}
