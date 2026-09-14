/* The failure classes worth their own sentence. Anything Chromium reports outside them is `other`,
   which says what happened without inventing a reason for it. */
export type LoadErrorKind = 'offline' | 'dns' | 'refused' | 'certificate' | 'timeout' | 'blocked' | 'address' | 'other';

export interface LoadError {
    kind: LoadErrorKind;
    /* The heading of the plate: what happened, in the app's words. */
    title: string;
    /* What to check, where there is anything to check. */
    hint: string | null;
    /* Chromium's own name for the failure, kept because it is the part worth searching for. */
    symbol: string;
    /* False where running this exact navigation again cannot end any differently. */
    retryable: boolean;
}

interface Copy {
    title: string;
    hint: string | null;
    retryable: boolean;
}

const COPY: Record<LoadErrorKind, Copy> = {
    offline: {
        title: 'No internet connection',
        hint: 'Check the network connection.',
        retryable: true
    },
    dns: {
        title: 'That address has no server',
        hint: 'Check the spelling, or whether the address exists on this network.',
        retryable: true
    },
    refused: {
        title: 'The server refused the connection',
        hint: 'Nothing is listening on that address. Check that the server is running.',
        retryable: true
    },
    certificate: {
        title: 'The connection is not secure',
        hint: 'The certificate is not valid, so the page was not loaded.',
        retryable: true
    },
    timeout: {
        title: 'The server took too long',
        hint: 'It may be busy, or unreachable from here.',
        retryable: true
    },
    blocked: {
        title: 'The page was blocked',
        hint: 'A policy, an extension or the page itself stopped the request.',
        retryable: true
    },
    address: {
        title: 'That address cannot be opened',
        hint: 'Check the scheme and the spelling.',
        retryable: false
    },
    other: {
        title: 'The page did not load',
        hint: null,
        retryable: true
    }
};

/* The codes worth naming, from Chromium's `net_error_list.h`. */
const KIND_BY_CODE = new Map<number, LoadErrorKind>([
    [-21, 'offline'], // NETWORK_CHANGED
    [-106, 'offline'], // INTERNET_DISCONNECTED
    [-105, 'dns'], // NAME_NOT_RESOLVED
    [-137, 'dns'], // NAME_RESOLUTION_FAILED
    [-102, 'refused'], // CONNECTION_REFUSED
    [-107, 'certificate'], // SSL_PROTOCOL_ERROR
    [-501, 'certificate'], // INSECURE_RESPONSE
    [-7, 'timeout'], // TIMED_OUT
    [-118, 'timeout'], // CONNECTION_TIMED_OUT
    [-20, 'blocked'], // BLOCKED_BY_CLIENT
    [-22, 'blocked'], // BLOCKED_BY_ADMINISTRATOR
    [-27, 'blocked'], // BLOCKED_BY_RESPONSE
    [-30, 'blocked'], // BLOCKED_BY_CSP
    [-300, 'address'], // INVALID_URL
    [-301, 'address'], // DISALLOWED_URL_SCHEME
    [-302, 'address'] // UNKNOWN_URL_SCHEME
]);

// Everything between these two is a certificate that did not check out, whatever is wrong with it.
const CERT_BEGIN = -299;
const CERT_END = -200;

/* Chromium's symbol for the code, which is what its description already is on a webview. Anything
   else (an empty description, a sentence from another layer) degrades to the number. */
const symbolOf = (code: number, description: string): string => {
    const trimmed = description.trim().replace(/^net::/, '');
    return /^[A-Z][A-Z0-9_]+$/.test(trimmed) ? trimmed : `net error ${code}`;
};

const kindOf = (code: number, symbol: string): LoadErrorKind => {
    if ((code >= CERT_BEGIN && code <= CERT_END) || symbol.startsWith('ERR_CERT')) {
        return 'certificate';
    }
    return KIND_BY_CODE.get(code) ?? 'other';
};

/*
 * What to say about a load that failed. Pure on purpose: the wording of every failure lives in one
 * place, so the node and the browser view read the same, and an unknown code falls back to the
 * generic sentence plus Chromium's symbol instead of a guess.
 */
export const classifyLoadError = (code: number, description: string): LoadError => {
    const symbol = symbolOf(code, description);
    const kind = kindOf(code, symbol);
    return { kind, symbol, ...COPY[kind] };
};
