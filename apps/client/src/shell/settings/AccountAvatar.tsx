import { useState } from 'react';
import { User } from 'lucide-react';
import type { Account } from '@ruimte/pulsar';
import { accountName } from '@/pulsar/account-name';
import { Icon } from '@ruimte/ui/Icon';

/* GitHub serves every login's profile picture at this address; no other provider hands out a picture. */
const pictureOf = (account: Account): string | null =>
    account.provider === 'github' && account.login !== null ? `https://github.com/${encodeURIComponent(account.login)}.png?size=64` : null;

/* The round mark of a Ruimte account: its GitHub picture, else its first letter, else a person when signed out. */
export function AccountAvatar({ account }: { readonly account: Account | null }) {
    const picture = account === null ? null : pictureOf(account);
    // Offline, or a login GitHub no longer knows: the letter stands in rather than a broken image.
    const [failed, setFailed] = useState<string | null>(null);

    if (account === null) {
        return (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-hover text-text-muted">
                <Icon icon={User} size={16} />
            </span>
        );
    }
    if (picture !== null && failed !== picture) {
        return <img src={picture} alt="" className="h-8 w-8 shrink-0 rounded-full bg-surface-hover" onError={() => setFailed(picture)} />;
    }
    return (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>
            {accountName(account).slice(0, 1).toUpperCase()}
        </span>
    );
}
