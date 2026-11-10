import { Avatar, Icon } from '@adecore/ui';
import type { Account } from '@ruimte/pulsar';
import { User } from 'lucide-react';
import { accountName } from '@/pulsar/account-name';

/* GitHub serves every login's profile picture at this address; no other provider hands out a picture. */
function pictureOf(account: Account): string | undefined {
    return account.provider === 'github' && account.login !== null ? `https://github.com/${encodeURIComponent(account.login)}.png?size=64` : undefined;
}

export function AccountAvatar({ account }: { readonly account: Account | null }) {
    if (account === null) {
        return (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-text/14 text-text-muted">
                <Icon icon={User} size={16} />
            </span>
        );
    }

    return <Avatar name={accountName(account)} src={pictureOf(account)} aria-hidden />;
}
