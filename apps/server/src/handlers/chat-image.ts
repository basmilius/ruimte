import type { Area } from '../area.ts';
import type { ChatImageFiles } from '../chat/image-files.ts';

export interface ChatImageDeps {
    images: ChatImageFiles;
}

export function chatImageArea({ images }: ChatImageDeps): Area {
    return {
        name: 'chat image',
        handlers: (dispatcher) => {
            dispatcher.register('chat.imageTarget', (payload, client) => images.target(payload, client.id));
            dispatcher.register('chat.saveImage', (payload, client) => images.save(payload, client.id));
        }
    };
}
