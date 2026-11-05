import { AttachmentStore, VisualStore } from '@adecore/agents/chat';

/*
 * The caller's own folders under `$RUIMTE_HOME`, its attachments and its visuals workspace, named as
 * the chat stores name them. A node id comes from a project file, so no path is built from it elsewhere.
 */
export function callerFolders(home: string, caller: string): string[] {
    const attachments = new AttachmentStore(home);

    return [attachments.folderOf(caller), new VisualStore(home, attachments).workspacePath(caller)];
}
