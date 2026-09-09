import pkg from '../package.json' with { type: 'json' };

// A release build stamps the tag's version in with `--define`; a checkout reports what package.json says.
export const VERSION: string = process.env.RUIMTE_VERSION ?? pkg.version;
