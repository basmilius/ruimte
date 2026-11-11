import * as agentsUi from '@adecore/agents-react/chat/ui';
import * as charts from '@adecore/charts';
import * as ui from '@adecore/ui';
import * as React from 'react';
import * as reactDom from 'react-dom';
import * as jsxRuntime from 'react/jsx-runtime';
import { consoleFor } from '@/extensions/dev-log';
import { loadOf } from '@/extensions/host/loads';

export { forgetExtension, registerExtension } from '@/extensions/host/loads';

/*
 * What a pack reads instead of bundling: `ruimte extension pack` rewrites every import of React, the
 * components and the API to `globalThis.__ruimteExtension.for(id, import.meta.url)`. Loaded with the first installed
 * extension, so a client without any carries none of this. A module of an extension is fully trusted code in this page;
 * this is not a boundary, only how it finds what it shares with Ruimte. A built-in gets the same API from `built-in-api.ts`.
 */
(globalThis as Record<string, unknown>).__ruimteExtension = {
    for(id: string, address?: string) {
        const { extension, api } = loadOf(id, address);

        return { react: React, jsxRuntime, reactDom, ui, charts, agentsUi, client: api, console: consoleFor(id, extension.dev === true) };
    }
};
