import { CodedError } from '@adecore/agents';
import type { Area, EventSource } from '../area.ts';
import type { ConsentBook } from '../tunnels/consent-book.ts';
import type { CredentialStore } from '../tunnels/credential-store.ts';
import type { ExternalListener } from '../tunnels/external-listener.ts';
import type { TunnelProposals } from '../tunnels/tunnel-proposals.ts';
import type { TunnelService } from '../tunnels/tunnel-service.ts';

interface TunnelsDeps {
    service: TunnelService;
    proposals: Pick<TunnelProposals, 'list' | 'confirm' | 'decline'>;
    credentials: CredentialStore;
    consent: ConsentBook;
    listener: Pick<ExternalListener, 'stop'>;
    /* What every client hears: the tunnel state or the consent waiting for a person moved. */
    changes: EventSource;
    changed(): void;
}

/*
 * Tunnels, the credentials of external MCP clients and the consent of one that waits. Any client reads the state of the
 * tunnels and an agent's cards, and declines a card; everything else is the local secret's, so a client the machine let
 * in changes no tunnel and makes no credential.
 * None of these is on a peer's list. Stopping the area ends cloudflared first and the listener of the external clients after,
 * both in `end`: cloudflared may take its full wait behind a slow Cloudflare call, which must not push the chats, tasks
 * and terminals of `drain` past the shutdown deadline.
 */
export function tunnelsArea(deps: TunnelsDeps): Area {
    const { service, proposals, credentials, consent, listener, changes, changed } = deps;

    return {
        name: 'tunnel',
        sources: [changes],
        stop: [
            { phase: 'end', label: 'Stopping tunnels', run: () => service.stop() },
            { phase: 'end', label: 'Stopping the external MCP listener', run: () => listener.stop() }
        ],
        handlers: (dispatcher) => {
            dispatcher.register('tunnel.state', () => service.state());
            dispatcher.register('tunnel.discover', async () => ({ ports: await service.discover() }), { owner: true });
            dispatcher.register('tunnel.install', () => service.install(), { owner: true });
            dispatcher.register('tunnel.setToken', ({ token }) => service.setToken(token), { owner: true });
            dispatcher.register('tunnel.clearToken', () => service.clearToken(), { owner: true });
            dispatcher.register('tunnel.setup', ({ account }) => service.setup(account), { owner: true });
            dispatcher.register('tunnel.list', async ({ account }) => ({ tunnels: await service.existing(account) }), { owner: true });
            dispatcher.register('tunnel.link', ({ account, tunnel }) => service.link(account, tunnel), { owner: true });
            dispatcher.register('tunnel.unlink', () => service.unlink(), { owner: true });
            dispatcher.register('tunnel.add', (payload) => service.add(payload), { owner: true });
            dispatcher.register('tunnel.update', ({ id, ...change }) => service.update(id, change), { owner: true });
            dispatcher.register('tunnel.remove', ({ id }) => service.remove(id), { owner: true });
            dispatcher.register('tunnel.retry', () => service.retry(), { owner: true });
            dispatcher.register('tunnel.setMcp', ({ enabled }) => service.setMcp(enabled), { owner: true });

            // A card is answered where it shows, as a question of a chat is; a yes makes the change above, so it is the local secret's like that change.
            dispatcher.register('tunnel.proposals', () => ({ proposals: proposals.list() }));
            dispatcher.register('tunnel.proposalConfirm', async ({ proposalId }) => ({ accepted: await proposals.confirm(proposalId) }), { owner: true });
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
                        throw new CodedError('unknown-credential', 'That credential is gone');
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
                        throw new CodedError('unknown-consent', 'That request was already answered or timed out');
                    }

                    return { credential: null };
                },
                { owner: true }
            );
        }
    };
}
