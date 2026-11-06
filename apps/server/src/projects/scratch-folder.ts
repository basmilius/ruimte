import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { homeFolder } from '@ruimte/service/home';

export function scratchFolderOf(home: string): string {
    return homeFolder(resolve(home), 'scratch');
}

export function newChatId(): string {
    return `chat-${randomBytes(6).toString('hex')}`;
}
