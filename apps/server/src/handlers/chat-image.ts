import type { ChatImageFiles } from '../chat/image-files.ts';
import type { Dispatcher } from '../dispatcher.ts';

export function registerChatImageHandlers(dispatcher: Dispatcher, images: ChatImageFiles): void {
    dispatcher.register('chat.imageTarget', (payload, client) => images.target(payload, client.id));
    dispatcher.register('chat.saveImage', (payload, client) => images.save(payload, client.id));
}
