import { InlineEditFeature } from '@/editor-ai/inline-edit';
import { provideInlineEdit } from '@/language/ruimte-editor-language';
import { installPanels } from '@/wiring/panels';
import { installWorkspaceCommands } from '@/wiring/workspace-commands';
import { installWorkspaceDialogs } from '@/wiring/workspace-dialogs';
import { installWorkspaceEffects } from '@/wiring/workspace-effects';

let installed = false;

/*
 * What only a workspace needs and a test can have without a browser: the panels, the dialogs, the
 * commands and what runs beside a workspace. A unit test of something only a workspace has installs this
 * itself; `installWorkspace` adds what a workspace draws by kind.
 */
export function installWorkspaceRegistries(): void {
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
