import { join } from 'node:path';

/*
 * The layout of `$RUIMTE_HOME` as far as more than one module has to agree on it: the file only the
 * local account reads and the folders whose contents agents and clients are handed. Who may read which
 * folder is the daemon's policy (`apps/server/src/disk/agent-folders.ts`), not decided here.
 */

/* The secret a process on this computer proves itself with; read by the daemon, the app, the CLI and the Windows installer. */
export const LOCAL_KEY_FILE = 'local.key';

export function localKeyPath(home: string): string {
    return join(home, LOCAL_KEY_FILE);
}

export const HOME_FOLDERS = {
    /* The Chats project's folders, one per view. */
    scratch: 'scratch',
    /* The checkouts of agents started with a worktree. */
    worktrees: 'worktrees',
    checkpoints: 'checkpoints',
    /* The shots agents take of a browser, a window or a device. */
    screenshots: 'screenshots',
    /* A person's captures and recordings of a device. */
    deviceCaptures: 'device-captures',
    /* The helper of computer use: its socket, its overlay words and the shots it takes. */
    computerUse: 'computer-use',
    /* The files people attach to a chat, one folder per chat. */
    attachments: 'attachments',
    /* The threads of the chats, and beside each the folder of its visuals. */
    chats: 'chats',
    /* A node's binding to another machine. */
    remote: 'remote',
    /* The Claude Code config folder and usage of an Anthropic API key. */
    anthropicClaudeApi: 'anthropic-claude-api'
} as const;

export type HomeFolder = keyof typeof HOME_FOLDERS;

/* The shots computer use takes, under its helper's folder. */
export const COMPUTER_USE_SCREENSHOTS = 'screenshots';

export function homeFolder(home: string, folder: HomeFolder): string {
    return join(home, HOME_FOLDERS[folder]);
}

export function computerUseScreenshots(home: string): string {
    return join(homeFolder(home, 'computerUse'), COMPUTER_USE_SCREENSHOTS);
}

/* Ends the folder of a chat's visuals, which `@adecore/agents`' `VisualStore` names `<encoded chat id>.visuals`. */
export const CHAT_VISUALS_SUFFIX = '.visuals';

export function chatVisualsFolder(home: string, chatId: string): string {
    return join(homeFolder(home, 'chats'), `${encodeURIComponent(chatId)}${CHAT_VISUALS_SUFFIX}`);
}

/* The folder of one chat's attachments, named as `@adecore/agents`' `AttachmentStore.folderOf` names it. */
export function chatAttachmentsFolder(home: string, chatId: string): string {
    // `encodeURIComponent` leaves `.` and `..` as they are, and those would name the folder above.
    const segment = chatId === '.' || chatId === '..' ? chatId.replaceAll('.', '%2E') : encodeURIComponent(chatId);

    return join(homeFolder(home, 'attachments'), segment);
}
