import type { TunnelOrigin } from '@ruimte/contracts';

export interface OriginDraft {
    https: boolean;
    hostHeader: string;
    noTlsVerify: boolean;
    serverName: string;
}

export function originDraftOf(origin: TunnelOrigin | undefined): OriginDraft {
    return {
        https: origin?.https === true,
        hostHeader: origin?.hostHeader ?? '',
        noTlsVerify: origin?.noTlsVerify === true,
        serverName: origin?.serverName ?? ''
    };
}

/* What the machine takes: only what differs from the defaults, and the certificate settings only with https. */
export function originOf(draft: OriginDraft): TunnelOrigin {
    const hostHeader = draft.hostHeader.trim();
    const serverName = draft.serverName.trim();

    return {
        ...(draft.https ? { https: true } : {}),
        ...(hostHeader === '' ? {} : { hostHeader }),
        ...(draft.https && draft.noTlsVerify ? { noTlsVerify: true } : {}),
        ...(draft.https && serverName !== '' ? { serverName } : {})
    };
}
