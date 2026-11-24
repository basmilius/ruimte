import { defineCommand, defineFileIcon, defineLanguage, getServer, host } from '@ruimte/extension/client';
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
