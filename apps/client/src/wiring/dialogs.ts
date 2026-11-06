import { AGENT_DIALOGS } from '@/agents/dialogs';
import { CHAT_WINDOW_DIALOGS } from '@/chat/dialogs';
import { LANGUAGE_DIALOGS } from '@/language/dialogs';
import { MACHINE_WINDOW_DIALOGS } from '@/machine-ui/dialogs';
import { MODELS_DIALOGS } from '@/models/dialog';
import { ONBOARDING_DIALOGS } from '@/onboarding/dialog';
import { PALETTE_DIALOGS } from '@/palette/dialogs';
import { windowDialogs } from '@/registry/dialogs';
import { RELEASE_NOTES_DIALOGS } from '@/release-notes/dialog';
import { SETTINGS_DIALOGS } from '@/settings/dialogs';
import { USAGE_DIALOGS } from '@/usage/dialog';

/* The dialogs of the window, which open over the start screen too, in the order they mount. */
export function installWindowDialogs(): void {
    windowDialogs.add(
        ...PALETTE_DIALOGS,
        ...SETTINGS_DIALOGS,
        ...USAGE_DIALOGS,
        ...MODELS_DIALOGS,
        ...RELEASE_NOTES_DIALOGS,
        ...MACHINE_WINDOW_DIALOGS,
        ...ONBOARDING_DIALOGS,
        ...AGENT_DIALOGS,
        ...CHAT_WINDOW_DIALOGS,
        ...LANGUAGE_DIALOGS
    );
}
