import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { CloudflareError } from '../tunnels/cloudflare-api.ts';
import type { ConsentBook } from '../tunnels/consent-book.ts';
import type { CredentialStore } from '../tunnels/credential-store.ts';
import { TunnelConfigError } from '../tunnels/tunnel-config.ts';
import type { TunnelProposals } from '../tunnels/tunnel-proposals.ts';
import type { TunnelService } from '../tunnels/tunnel-service.ts';

export interface TunnelHandlerDeps {
    service: TunnelService;
    proposals: Pick<TunnelProposals, 'list' | 'confirm' | 'decline'>;
    credentials: CredentialStore;
    consent: ConsentBook;
    /* Tells every client the credentials or the clients moved. */
    changed(): void;
}

/* A refusal of the tunnels, or a failure Cloudflare gave, as a request error with the code and sentence the screen shows. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (e) {
        if (e instanceof TunnelConfigError || e instanceof CloudflareError) {
            throw new RequestError(e.code, e.message);
        }

        throw e;
    }
}

/*
 * Tunnels, the credentials of external MCP clients and the consent of one that waits. Any client reads the state of the
 * tunnels and an agent's cards, and declines a card; everything else is the local secret's, so a client the machine let
 * in changes no tunnel and makes no credential.
 * None of these is on a peer's list.
 */
export function registerTunnelHandlers(dispatcher: Dispatcher, deps: TunnelHandlerDeps): void {
    const { service, proposals, credentials, consent, changed } = deps;

    dispatcher.register('tunnel.state', () => service.state());
    dispatcher.register('tunnel.discover', async () => ({ ports: await service.discover() }), { owner: true });
    dispatcher.register('tunnel.install', () => service.install(), { owner: true });
    dispatcher.register('tunnel.setToken', ({ token }) => refusing(() => service.setToken(token)), { owner: true });
    dispatcher.register('tunnel.clearToken', () => service.clearToken(), { owner: true });
    dispatcher.register('tunnel.setup', ({ account }) => refusing(() => service.setup(account)), { owner: true });
    dispatcher.register('tunnel.list', async ({ account }) => ({ tunnels: await refusing(() => service.existing(account)) }), { owner: true });
    dispatcher.register('tunnel.link', ({ account, tunnel }) => refusing(() => service.link(account, tunnel)), { owner: true });
    dispatcher.register('tunnel.unlink', () => refusing(() => service.unlink()), { owner: true });
    dispatcher.register('tunnel.add', (payload) => refusing(() => service.add(payload)), { owner: true });
    dispatcher.register('tunnel.update', ({ id, ...change }) => refusing(() => service.update(id, change)), { owner: true });
    dispatcher.register('tunnel.remove', ({ id }) => refusing(() => service.remove(id)), { owner: true });
    dispatcher.register('tunnel.retry', () => service.retry(), { owner: true });
    dispatcher.register('tunnel.setMcp', ({ enabled }) => service.setMcp(enabled), { owner: true });

    // A card is answered where it shows, as a question of a chat is; a yes makes the change above, so it is the local secret's like that change.
    dispatcher.register('tunnel.proposals', () => ({ proposals: proposals.list() }));
    dispatcher.register('tunnel.proposalConfirm', async ({ proposalId }) => ({ accepted: await refusing(() => proposals.confirm(proposalId)) }), {
        owner: true
    });
    dispatcher.register('tunnel.proposalDecline', ({ proposalId }) => ({ accepted: proposals.decline(proposalId) }));

    dispatcher.register('credential.list', () => ({ credentials: credentials.list() }), { owner: true });
    dispatcher.register(
        'credential.create',
        async ({ label, grant, bearerOnHostname, expiresAt }) => {
            const created = await credentials.createBearer({ label, grant, bearerOnHostname, expiresAt });

            changed();

            return created;
        },
        { owner: true }
    );
    dispatcher.register(
        'credential.update',
        async ({ id, ...change }) => {
            const credential = await credentials.update(id, change);

            if (credential === null) {
                throw new RequestError('unknown-credential', 'That credential is gone');
            }

            changed();

            return { credential };
        },
        { owner: true }
    );
    dispatcher.register(
        'credential.revoke',
        async ({ id }) => {
            await credentials.revoke(id);
            changed();

            return {};
        },
        { owner: true }
    );

    dispatcher.register('consent.list', () => ({ requests: consent.list() }), { owner: true });
    dispatcher.register(
        'consent.answer',
        ({ id, approve, grant, expiresAt }) => {
            if (!consent.answer(id, approve, grant, expiresAt)) {
                throw new RequestError('unknown-consent', 'That request was already answered or timed out');
            }

            return { credential: null };
        },
        { owner: true }
    );
}
