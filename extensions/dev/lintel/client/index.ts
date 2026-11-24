import { defineCommand, defineEditorDecoration, defineFileIcon, defineLanguage, files, getServer, host, onEvent } from '@ruimte/extension/client';
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
