import { TOLERANT_WIRE_FEATURE, type EndpointInfoPayload } from '@ruimte/contracts';
import { IS_STATION } from '@/station';

interface IdentityEnvironment {
    station: boolean;
    /* `window.ruimteDesktop?.platform`, Node's name for the system. */
    desktopPlatform: string | null;
    /* `navigator.userAgentData.platform` and `.mobile`, where Chromium gives them. */
    uaPlatform: string | null;
    uaMobile: boolean | null;
    userAgent: string;
    /* iPadOS Safari says Macintosh; only its touch points tell it from a Mac. */
    maxTouchPoints: number;
    /* The release this build is, empty in dev. */
    version: string;
}

const DESKTOP_SYSTEMS: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' };

const BROWSER_SYSTEMS: [RegExp, string][] = [
    [/iphone|ipod/i, 'ios'],
    [/ipad/i, 'ipados'],
    [/android/i, 'android'],
    [/mac/i, 'macos'],
    [/\bwin/i, 'windows'],
    [/cros|chrome ?os/i, 'chromeos'],
    [/linux|x11/i, 'linux']
];

function browserSystem(env: IdentityEnvironment): string | undefined {
    for (const text of [env.uaPlatform ?? '', env.userAgent]) {
        const found = BROWSER_SYSTEMS.find(([pattern]) => pattern.test(text))?.[1];

        if (found === 'macos' && env.maxTouchPoints > 1) {
            return 'ipados';
        }

        if (found !== undefined) {
            return found;
        }
    }

    return undefined;
}

function browserDevice(os: string | undefined, env: IdentityEnvironment): string {
    if (os === 'ios') {
        return 'phone';
    }

    if (os === 'ipados') {
        return 'tablet';
    }

    if (os === 'android') {
        return env.uaMobile === true || /\bMobile\b/.test(env.userAgent) ? 'phone' : 'tablet';
    }

    return env.uaMobile === true ? 'phone' : 'desktop';
}

/* Only the phones and tablets write a true system version; the desktop browsers freeze theirs. */
function browserSystemVersion(os: string | undefined, userAgent: string): string | undefined {
    const match =
        os === 'ios' || os === 'ipados' ? /\bOS (\d+)[_.](\d+)/.exec(userAgent) : os === 'android' ? /\bAndroid (\d+(?:\.\d+)?)/.exec(userAgent) : null;

    if (match === null) {
        return undefined;
    }

    return match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
}

/*
 * What this app tells a machine of itself in `endpoint.info`: `client` is the kind its anonymous usage
 * counts (`browser` counts nothing), the rest is for its list of connected clients. A best guess from the
 * user agent outside the desktop app, and only ever shown; what is unknown is left out.
 */
// Every build reads replies and events with `readFromMachine` (`link-transport.ts`).
const CLIENT_FEATURES = [TOLERANT_WIRE_FEATURE];

export function clientIdentityFrom(env: IdentityEnvironment): EndpointInfoPayload {
    const version = env.version === '' ? {} : { clientVersion: env.version };

    if (env.desktopPlatform !== null) {
        const os = DESKTOP_SYSTEMS[env.desktopPlatform];

        return { client: 'desktop', ...version, ...(os === undefined ? {} : { clientOs: os }), clientDevice: 'desktop', clientFeatures: CLIENT_FEATURES };
    }

    const os = browserSystem(env);
    const osVersion = browserSystemVersion(os, env.userAgent);

    return {
        client: env.station ? 'station' : 'browser',
        ...version,
        ...(os === undefined ? {} : { clientOs: os }),
        ...(osVersion === undefined ? {} : { clientOsVersion: osVersion }),
        clientDevice: browserDevice(os, env),
        clientFeatures: CLIENT_FEATURES
    };
}

export function clientIdentity(): EndpointInfoPayload {
    const data = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;

    return clientIdentityFrom({
        station: IS_STATION,
        desktopPlatform: typeof window === 'undefined' ? null : (window.ruimteDesktop?.platform ?? null),
        uaPlatform: data?.platform ?? null,
        uaMobile: data?.mobile ?? null,
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        version: import.meta.env.RUIMTE_CLIENT_VERSION ?? ''
    });
}
