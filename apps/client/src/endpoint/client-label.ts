/*
 * Keep user-agent parsing shallow because this label never controls behavior. Prefer structured
 * Chromium data and call anything uncertain "Browser" rather than guessing the wrong brand.
 */

export interface ClientEnvironment {
    /* `window.ruimteDesktop?.platform`: this is the app rather than a page, and the value is Node's. */
    desktopPlatform?: string | null;
    /* `navigator.userAgentData.brands`, in the order Chromium gives them. */
    brands?: readonly { readonly brand: string }[] | null;
    /* `navigator.userAgentData.platform`, already a word a person uses ("macOS", "Windows"). */
    uaPlatform?: string | null;
    userAgent?: string | null;
    /* `navigator.platform`, the legacy one ("MacIntel", "Win32"). */
    platform?: string | null;
}

/* Node's platform names, which is what the desktop shell hands over. */
const DESKTOP_SYSTEMS: Record<string, string> = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux'
};

/* What a browser writes, in either the modern field or the old one, and what a person calls it. */
const BROWSER_SYSTEMS: [RegExp, string][] = [
    [/iphone/i, 'iOS'],
    [/ipad/i, 'iPadOS'],
    [/android/i, 'Android'],
    [/mac/i, 'macOS'],
    // The word boundary matters. Without it Node's own `darwin` reads as Windows.
    [/\bwin/i, 'Windows'],
    [/cros|chrome ?os/i, 'ChromeOS'],
    [/linux|x11/i, 'Linux']
];

/* The system in the words its own maker uses, or null when nothing here recognizes it. */
export const systemName = (raw: string | null | undefined): string | null => {
    const text = (raw ?? '').trim();
    if (text === '') {
        return null;
    }
    for (const [pattern, name] of BROWSER_SYSTEMS) {
        if (pattern.test(text)) {
            return name;
        }
    }
    return null;
};

/*
 * Chromium pads its brand list with a made-up one to keep parsers honest ("Not)A;Brand"), and every
 * Chromium browser also claims "Chromium" beside its own name. The brand worth showing is the first
 * that is neither, with "Chromium" itself as the answer when a browser claims nothing else.
 */
const GREASE = /not.?a.?brand/i;

const BRAND_NAMES: Record<string, string> = {
    'google chrome': 'Chrome',
    'microsoft edge': 'Edge',
    'opera gx': 'Opera',
    brave: 'Brave',
    vivaldi: 'Vivaldi',
    arc: 'Arc'
};

export const brandName = (brands: readonly { readonly brand: string }[] | null | undefined): string | null => {
    const named = (brands ?? []).map((entry) => entry.brand.trim()).filter((brand) => brand !== '' && !GREASE.test(brand));
    const own = named.find((brand) => brand.toLowerCase() !== 'chromium') ?? named[0];
    if (own === undefined) {
        return null;
    }
    return BRAND_NAMES[own.toLowerCase()] ?? own;
};

/*
 * The fallback for a browser without `userAgentData`, ordered so a browser that carries another's
 * token is caught before that other one. Every Chromium browser says "Chrome" and "Safari" too.
 */
const USER_AGENTS: [RegExp, string][] = [
    [/\bFirefox\//, 'Firefox'],
    [/\bEdg\//, 'Edge'],
    [/\bOPR\//, 'Opera'],
    [/\bChrome\//, 'Chrome'],
    [/\bSafari\//, 'Safari']
];

export const browserName = (userAgent: string | null | undefined): string | null => {
    const text = userAgent ?? '';
    for (const [pattern, name] of USER_AGENTS) {
        if (pattern.test(text)) {
            return name;
        }
    }
    return null;
};

/* The name in the daemon's list. A system nobody here can name is left out rather than guessed at. */
export const clientLabelFrom = (env: ClientEnvironment): string => {
    const desktop = (env.desktopPlatform ?? '').trim();
    const app = desktop !== '' ? 'Ruimte' : (brandName(env.brands) ?? browserName(env.userAgent) ?? 'Browser');
    const system =
        desktop !== ''
            ? (DESKTOP_SYSTEMS[desktop] ?? systemName(desktop))
            : (systemName(env.uaPlatform) ?? systemName(env.platform) ?? systemName(env.userAgent));
    return system === null ? app : `${app} on ${system}`;
};

/*
 * What this client is called on the page it runs in, read from the page's own navigator. Here rather
 * than beside pairing, so the account code can name a device without importing the transport.
 */
export const currentClientLabel = (): string => {
    if (typeof navigator === 'undefined') {
        return 'Ruimte';
    }
    const data = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } }).userAgentData;
    const desktopPlatform = typeof window === 'undefined' ? null : (window.ruimteDesktop?.platform ?? null);
    return clientLabelFrom({
        desktopPlatform,
        brands: data?.brands ?? null,
        uaPlatform: data?.platform ?? null,
        userAgent: navigator.userAgent,
        platform: navigator.platform
    });
};
