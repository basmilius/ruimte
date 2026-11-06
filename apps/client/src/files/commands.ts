import { defineBehaviors } from '@/commands/behavior';
import { diffInFront, openFileAtDiffCaret } from '@/files/diff-caret';
import { currentEndpointId } from '@/state/current-endpoint';
import { useFiles } from '@/state/files';
import { shownFolderOf, useProject } from '@/state/project';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';

export const FILE_BEHAVIORS = defineBehaviors({
    'file-new': {
        run: () => useFiles.getState().requestCreate('file'),
        offered: (moment) => moment.inWorkspace && moment.folder !== null,
        afterClose: true
    },
    'folder-new': {
        run: () => useFiles.getState().requestCreate('directory'),
        offered: (moment) => moment.inWorkspace && moment.folder !== null,
        afterClose: true
    },
    reveal: {
        run: () => {
            const path = shownFolderOf(useProject.getState().current);
            if (path !== null) {
                void fireAndForget('fs.reveal', transportFor(currentEndpointId())?.request('fs.reveal', { path }));
            }
        },
        offered: (moment) => moment.folder !== null && { values: { app: fileManagerName(serverInfoOf(moment.endpointId).platform) } }
    },
    // A diff answers the key on its own editors, since a file's editor gives it to Text End.
    'open-file-at-line': { run: openFileAtDiffCaret, offered: (moment) => moment.inWorkspace && diffInFront(), afterClose: true },
    'panel-files': { run: () => useUi.getState().togglePanel('files'), offered: (moment) => moment.inWorkspace && !moment.scratch }
});
