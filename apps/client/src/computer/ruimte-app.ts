/* The desktop app, packaged and dev (`apps/desktop/electron-builder.yml`, `apps/desktop/scripts/mac-dev-app.ts`); the daemon holds the same pair. */
const RUIMTE_BUNDLE_IDS: ReadonlySet<string> = new Set(['app.ruimte.desktop', 'app.ruimte.desktop.dev']);

export const isRuimteApp = (bundleId: string): boolean => RUIMTE_BUNDLE_IDS.has(bundleId);
