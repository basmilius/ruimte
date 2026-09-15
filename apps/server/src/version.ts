import pkg from '../package.json' with { type: 'json' };

// A release build stamps the tag's version in with `--define`; a checkout reports what package.json says.
export const VERSION: string = process.env.RUIMTE_VERSION ?? pkg.version;

/*
 * One compile of the daemon, stamped in by `scripts/compile.ts` and written beside the binary as
 * well. The desktop app compares the two to tell whether the daemon that answers is the binary in
 * its bundle, which a version cannot say for two local builds of the same version. Null in a checkout.
 */
export const BUILD: string | null = process.env.RUIMTE_BUILD || null;
