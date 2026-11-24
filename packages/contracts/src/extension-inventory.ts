import { EXTENSION_API_INVENTORY } from './extension-inventory.generated.ts';

/*
 * The inventory of the extension API, read from the `.d.ts` files an author reads and from the manifest schema. The
 * contract suite names a scenario or a known gap for every row (`extensions/poc/contract/contract/inventory.ts`), which
 * `bun run check` holds. Pure, with no import that needs zod.
 */
export { EXTENSION_API_INVENTORY };
export type ExtensionApiRow = keyof typeof EXTENSION_API_INVENTORY;

/* Where the contract suite holds a row, each by the title of a scenario. */
export interface ExtensionApiCoverage {
    /* The scenario that uses it. */
    scenario: string;

    /* The scenario that asks without the permission, for a row that takes one. */
    refusal?: string;

    /* The scenario that stops it, for a row that answers a function that does. */
    cleanup?: string;
}
