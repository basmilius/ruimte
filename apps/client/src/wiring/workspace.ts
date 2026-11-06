import { InlineEditFeature } from '@/editor-ai/inline-edit';
import { provideInlineEdit } from '@/language/ruimte-editor-language';
import { installPanels } from '@/wiring/panels';
import { installWorkspaceCommands } from '@/wiring/workspace-commands';
import { installWorkspaceDialogs } from '@/wiring/workspace-dialogs';
import { installWorkspaceEffects } from '@/wiring/workspace-effects';

let installed = false;

/*
 * What only a workspace needs, wired when its chunk loads (`App.tsx`) and by the test harness: the
 * start screen never imports it, so it stays out of the entry chunk.
 */
export function installWorkspace(): void {
    if (installed) {
        return;
    }
    installed = true;
    provideInlineEdit((language) => new InlineEditFeature(language));
    installPanels();
    installWorkspaceEffects();
    installWorkspaceDialogs();
    installWorkspaceCommands();
}
