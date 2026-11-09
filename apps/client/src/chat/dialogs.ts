import { lazyDialog } from '@adecore/ui';
import { loginDialog, providerCommandDialog } from '@/chat/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

const LoginDialog = lazyDialog(
    () => import('@/chat/LoginDialog'),
    'LoginDialog',
    loginDialog.store,
    (state) => state.request !== null
);
const ProviderCommandDialog = lazyDialog(
    () => import('@/chat/ProviderCommandDialog'),
    'ProviderCommandDialog',
    providerCommandDialog.store,
    (state) => state.request !== null
);

/* Two lists, since the window mounts the consent dialog between them. */
export const LOGIN_DIALOGS: readonly DialogContribution[] = [{ id: 'login', surface: 'login', component: LoginDialog }];

export const PROVIDER_COMMAND_DIALOGS: readonly DialogContribution[] = [
    { id: 'provider-command', surface: 'providerCommand', component: ProviderCommandDialog }
];
