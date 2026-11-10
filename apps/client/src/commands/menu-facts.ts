import type { MenuFacts, MenuHost } from '@/commands/menu-context';

type FactsProvider = (host: MenuHost) => Partial<MenuFacts>;

const providers: FactsProvider[] = [];

/* A feature's share of the menu's moment, read when the menu is built. */
export function registerMenuFacts(...added: readonly FactsProvider[]): void {
    providers.push(...added);
}

/* The features' facts of this moment, to lay beside the window's own. */
export function menuFactsOf(host: MenuHost): Partial<MenuFacts> {
    return Object.assign({}, ...providers.map((provider) => provider(host)));
}
