import { useProvidersStore } from '@adecore/agents-react/state';
import { useTranslation } from 'react-i18next';
import { useCliSession } from '@/chat/cli-session';
import { CliTerminalDialog, CliTerminalFrame } from '@/chat/CliTerminalDialog';
import type { ProviderCommandRequest } from '@/chat/dialog-state';
import { providerCommandDialog } from '@/chat/dialog-state';

function closeCommand(): void {
    providerCommandDialog.set(null);
}

/*
 * A provider's install or sign-in command in a shell of its own, over the settings that asked for it, so it
 * needs no project. The command is typed and never sent: nothing starts a command a person did not run.
 */
export function ProviderCommandDialog() {
    const request = providerCommandDialog.useRequest((request) => request);

    return (
        <CliTerminalDialog request={request} keyOf={(shown) => `${shown.endpointId}:${shown.command}`} close={closeCommand}>
            {(shown, onRetry) => <CommandTerminal request={shown} onRetry={onRetry} />}
        </CliTerminalDialog>
    );
}

function CommandTerminal({ request, onRetry }: { request: ProviderCommandRequest; onRetry(): void }) {
    const { t } = useTranslation('chat');
    const { endpointId, kind, command } = request;
    const cli = useProvidersStore((s) => s.byScope[endpointId]?.providers.find((provider) => provider.kind === kind)?.name ?? kind);
    const session = useCliSession({
        endpointId,
        sessionPrefix: 'provider',
        // Ends with this window as well, which may go without the dialog closing.
        start: (link, size) => link.request('session.create', { ...size, endsWithClient: true }),
        typed: command
    });

    return (
        <CliTerminalFrame
            session={session}
            endpointId={endpointId}
            kind={kind}
            title={cli}
            description={t('providerCommand.description')}
            failed={(reason) => t('providerCommand.failed', { reason })}
            ended={(dropped) => (dropped ? t('providerCommand.dropped') : t('providerCommand.ended'))}
            close={closeCommand}
            onRetry={onRetry}
        />
    );
}
