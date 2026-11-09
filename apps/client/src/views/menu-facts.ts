import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { activeViewFacts } from '@/views/active-view';
import type { ViewOffers } from '@/views/view-offers';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        offers: ViewOffers | null;
        shared: boolean;
    }
}

export function viewFacts(_host: MenuHost): Pick<MenuFacts, 'offers' | 'shared'> {
    const facts = activeViewFacts();

    return { offers: facts?.offers ?? null, shared: facts?.shared ?? false };
}
