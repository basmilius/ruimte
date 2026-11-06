import { tmpdir } from 'node:os';
import { relative, sep } from 'node:path';
import { isWithin } from '@adecore/utils/path';
import { chatAttachmentsFolder, chatVisualsFolder, CHAT_VISUALS_SUFFIX, computerUseScreenshots, homeFolder } from '@ruimte/service/home';

/*
 * The folders outside a project that an agent may hand a tool or a device a file from, or read one back
 * from, and the ones a client may read under `$RUIMTE_HOME`. Each caller composes its own list from
 * these pieces, so a folder added here is added for exactly the callers that name it:
 *
 *   a device takes a file from the project, the chat's folders and the temporary folders
 *   (`DeviceDriver.pathFolders`);
 *   a tool reads from the project, its worktrees, the chat's folders and the temporary folders, and takes a
 *   picture it hands back from the shot folders too (`AgentFiles`);
 *   a person saves a picture from the project or the shot folders (`Artifacts.checkImage`);
 *   a client reads the open folders of the home and no more of it (`MachineHome`).
 */

/* The pictures the machine took for an agent or a person: its shots, those of computer use and a person's captures of a device. */
export function shotFolders(home: string): string[] {
    return [homeFolder(home, 'screenshots'), computerUseScreenshots(home), homeFolder(home, 'deviceCaptures')];
}

/* What one chat owns under the home: the files attached to it and its visuals. */
export function chatFolders(home: string, chatId: string): string[] {
    return [chatAttachmentsFolder(home, chatId), chatVisualsFolder(home, chatId)];
}

/* The system's temporary folders; `/tmp` beside `tmpdir()` since the second may be a per-user folder on macOS. */
export function tempFolders(): string[] {
    return [...new Set([tmpdir(), '/tmp'])];
}

/* Whether a path lies in a chat's visuals, the one kind of folder under `chats` a client may read. */
export function isChatVisualsPath(home: string, path: string): boolean {
    const chats = homeFolder(home, 'chats');
    if (!isWithin(chats, path)) {
        return false;
    }
    return relative(chats, path).split(sep)[0]!.endsWith(CHAT_VISUALS_SUFFIX);
}

/*
 * What under the home holds a person's own work or a picture made for them: the Chats project, the
 * agents' worktrees, the shot folders and the files people attach. Beside the visuals of a chat, which
 * `isChatVisualsPath` judges, these are all a client may read; the rest is the machine's own state.
 */
export function openHomeFolders(home: string): string[] {
    return [homeFolder(home, 'scratch'), homeFolder(home, 'worktrees'), homeFolder(home, 'attachments'), ...shotFolders(home)];
}
