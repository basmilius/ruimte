import { configureChat } from '@/chat/host';
import { folderWatches } from '@/controllers/fs-watch';
import { startFileReadPreparation } from '@/project/file-read-preparation';
import { defaultDocumentStore } from '@/state/document';
import { useFiles } from '@/state/files';
import { defaultProjectStore } from '@/state/project';

let configured = false;

/*
 * What the chat and the file reads are configured with, once for the process. Apart from the hooks because
 * the chat host loads the diff worker, which only a bundler (the app, the DOM run) can resolve.
 */
export function configureClient(): void {
    if (configured) {
        return;
    }
    configured = true;
    configureChat();
    startFileReadPreparation(defaultProjectStore, defaultDocumentStore, folderWatches, useFiles);
}
