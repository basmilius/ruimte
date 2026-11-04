import { useProviderAccountsStore, useProvidersStore } from '@adecore/agents-react/state';
import { Icon } from '@adecore/ui';
import type { ProviderAccountStatus } from '@ruimte/contracts';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCliSession } from '@/chat/cli-session';
import { CliTerminalDialog, CliTerminalFrame } from '@/chat/CliTerminalDialog';
import { loginLanded } from '@/chat/login-landing';
import { useUi, type LoginRequest } from '@/state/ui';

/* Long enough to read that it worked, short enough not to wait on it. */
const LANDED_MS = 1_200;

function closeLogin(): void {
    useUi.getState().setLogin(null);
}

/* The CLI's own login in a terminal of its own, which the onboarding and the settings both open. */
export function LoginDialog() {
    const request = useUi((s) => s.login);

    return (
        <CliTerminalDialog request={request} keyOf={(shown) => `${shown.endpointId}:${shown.accountId}`} close={closeLogin}>
            {(shown, onRetry) => <LoginTerminal request={shown} onRetry={onRetry} />}
        </CliTerminalDialog>
    );
}

function LoginTerminal({ request, onRetry }: { request: LoginRequest; onRetry(): void }) {
    const { t } = useTranslation('chat');
    const { endpointId, kind, accountId, name } = request;
    const status = useProviderAccountsStore((s) => s.byScope[endpointId]?.accounts?.statuses.find((entry) => entry.id === accountId) ?? null);
    const cli = useProvidersStore((s) => s.byScope[endpointId]?.providers.find((provider) => provider.kind === kind)?.name ?? kind);
    const silent = useProviderAccountsStore((s) => s.byScope[endpointId]?.accounts?.silentLogins?.includes(kind) === true);
    const session = useCliSession({
        endpointId,
        sessionPrefix: 'login',
        start: (link, size) => link.request('session.login', { ...size, kind, account: accountId }),
        // Watching is a courtesy: the status still arrives on the machine's own clock.
        onStarted: (link) => void link.request('accounts.watchLogin', { id: accountId }).catch(() => undefined)
    });
    const { phase, setPhase } = session;
    // The account as it read until this login started, which is what a landing has to differ from.
    const before = useRef<ProviderAccountStatus | null>(status);

    useEffect(() => {
        if (phase.kind === 'starting') {
            before.current = status;
        } else if (phase.kind === 'running' && loginLanded(before.current, status)) {
            setPhase({ kind: 'landed' });
        }
    }, [phase.kind, status, setPhase]);

    useEffect(() => {
        if (phase.kind !== 'landed') {
            return;
        }
        const timer = window.setTimeout(closeLogin, LANDED_MS);
        return () => window.clearTimeout(timer);
    }, [phase.kind]);

    return (
        <CliTerminalFrame
            session={session}
            endpointId={endpointId}
            kind={kind}
            title={t('login.title', { account: name })}
            description={t(silent ? 'login.descriptionSilent' : 'login.description', { cli })}
            failed={(reason) => t('login.failed', { reason })}
            ended={(dropped) => (dropped ? t('login.dropped') : t('login.ended'))}
            close={closeLogin}
            onRetry={onRetry}
            footer={
                phase.kind === 'landed' && (
                    <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-status-idle" role="status">
                        <Icon icon={Check} size={14} />
                        {status?.email ? t('login.landedAs', { email: status.email }) : t('login.landed')}
                    </div>
                )
            }
        />
    );
}
