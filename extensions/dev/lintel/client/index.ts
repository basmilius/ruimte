import { defineAction, defineCommand, defineEditorDecoration, defineFileIcon, defineLanguage, files, getServer, host, onEvent } from '@ruimte/extension/client';
import type { LintelServer } from '../server/index';

// The file a project turns Lintel's rules on and off in. `server/` names the same id for the server it adds.
defineLanguage({
    id: 'lintel',
    name: 'Lintel',
    extensions: ['lintel'],
    filenames: ['Lintelfile'],
    grammar: 'assets/lintel.tmLanguage.json'
});

defineFileIcon({ extensions: ['lintel'], path: 'assets/lintel-file.svg' });

const KINDS = { error: 'error', warning: 'warning', information: 'info', hint: 'muted' } as const;

// The lines its rules find something on, in the margin of the file a person has open. `server/` holds the rules.
const marks = defineEditorDecoration({
    id: 'problems',
    provide: async (file) => {
        const found = await getServer<LintelServer>().marks(file.path);

        return found.ok ? found.value.map(({ line, severity }) => ({ line, kind: KINDS[severity] })) : [];
    }
});

let unfollow = (): void => undefined;

/* A save changes what the rules find, so the margin asks again when a file of the project in front changes. */
function follow(): void {
    unfollow();

    const watching = files.watch('.', () => marks.refresh());

    unfollow = watching.ok ? watching.value : () => undefined;
}

follow();
onEvent('project.opened', follow);

// Where a person works on a file: its toolbar, its status bar and the menus of the editor and of the file's row.
defineAction({
    id: 'check-file',
    title: 'Lintel: check this file',
    icon: 'list-checks',
    slots: { editorToolbar: true, editorMenu: true, fileMenu: true, editorStatusBar: ({ file }) => ({ title: `Lintel: ${file.extension || 'file'}` }) },
    run: async ({ file }) => {
        const found = await getServer<LintelServer>().marks(file.path);

        if (!found.ok) {
            throw new Error(found.error.message);
        }

        marks.refresh();
        host.notify(found.value.length === 0 ? `Lintel found nothing in ${file.name}` : `Lintel found ${found.value.length} in ${file.name}`);
    }
});

defineCommand({
    id: 'config-server',
    title: 'Lintel: add a language server for its config files',
    run: async () => {
        const added = await getServer<LintelServer>().addConfigServer();

        if (!added.ok) {
            throw new Error(added.error.message);
        }

        host.notify(added.value ?? 'Look in Settings, Language servers');
    }
});
