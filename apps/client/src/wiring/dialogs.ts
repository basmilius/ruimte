import { AGENT_DIALOGS } from '@/agents/dialogs';
import { LOGIN_DIALOGS, PROVIDER_COMMAND_DIALOGS } from '@/chat/dialogs';
import { LANGUAGE_DIALOGS } from '@/language/dialogs';
import { MACHINE_WINDOW_DIALOGS } from '@/machine-ui/dialogs';
import { MODELS_DIALOGS } from '@/models/dialog';
import { ONBOARDING_DIALOGS } from '@/onboarding/dialog';
import { PALETTE_DIALOGS } from '@/palette/dialogs';
import { windowDialogs, type DialogContribution } from '@/registry/dialogs';
import { RELEASE_NOTES_DIALOGS } from '@/release-notes/dialog';
import { SETTINGS_DIALOGS } from '@/settings/dialogs';
import { ToastLayer } from '@/shell/ToastLayer';
import { TUNNEL_DIALOGS } from '@/tunnels/dialog';
import { USAGE_DIALOGS } from '@/usage/dialog';

const TOAST_LAYER: DialogContribution = { id: 'toasts', surface: 'toasts', component: ToastLayer };

/* The dialogs of the window, which open over the start screen too, in the order they mount: main's, the toasts among them. */
export function installWindowDialogs(): void {
    windowDialogs.add(
        ...PALETTE_DIALOGS,
        ...SETTINGS_DIALOGS,
        ...USAGE_DIALOGS,
        ...MODELS_DIALOGS,
        TOAST_LAYER,
        ...RELEASE_NOTES_DIALOGS,
        ...MACHINE_WINDOW_DIALOGS,
        ...ONBOARDING_DIALOGS,
        ...AGENT_DIALOGS,
        ...LOGIN_DIALOGS,
        ...TUNNEL_DIALOGS,
        ...PROVIDER_COMMAND_DIALOGS,
        ...LANGUAGE_DIALOGS
    );
}
