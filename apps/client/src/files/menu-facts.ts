import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { diffInFront } from '@/files/diff-caret';
import { currentEndpointId } from '@/state/current-endpoint';
import { fileManagerName, serverInfoOf } from '@/state/server';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* The view in front of the focused cell is a diff, whose file Open File at Line opens. */
        diff: boolean;
        /* The name of the app that shows a folder on this machine. */
        fileManager: string;
    }
}

export function fileFacts(_host: MenuHost): Pick<MenuFacts, 'diff' | 'fileManager'> {
    return { diff: diffInFront(), fileManager: fileManagerName(serverInfoOf(currentEndpointId()).platform) };
}
