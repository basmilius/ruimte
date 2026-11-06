/*
 * Where each part of Ruimte sends its crash reports. A DSN only lets a client send, so it is no secret.
 * The two workers read theirs from `wrangler.jsonc`; a test holds those rows to this table.
 */
export const TELEMETRY_DSN = {
    daemon: 'https://ace29cdab42746249e5753874d74c401@ingest.bmnw.nl/3',
    desktop: 'https://1b7ea4823fd6466f9de7f4c6bee0fc8d@ingest.bmnw.nl/4',
    station: 'https://313c4ee0419c4e3eac2e8c92be270bb2@ingest.bmnw.nl/5',
    bench: 'https://a28d4e1c79fb49cd9704267b9ac05638@ingest.bmnw.nl/10',
    pulsar: 'https://9ff9af7a3b804d228a025d52b6040176@ingest.bmnw.nl/7',
    broker: 'https://47b1dcc0fd8242359e18520245dab28e@ingest.bmnw.nl/8',
    maps: 'https://6519c142a98b418cbaa7fb0a02f18c07@ingest.bmnw.nl/9'
};

export type TelemetrySurface = keyof typeof TELEMETRY_DSN;

/* Observatory's usage ingest of the daemon's app, which takes the anonymous `UsageBatch` as it is. */
export function usageIngestUrl(dsn: string = TELEMETRY_DSN.daemon): string {
    const url = new URL(dsn);
    return `${url.origin}/api${url.pathname}/usage/?sentry_key=${url.username}`;
}

/* The release every part reports under, and the one CI creates for a tag `v<version>`. */
export function telemetryRelease(version: string): string {
    return `ruimte@${version}`;
}

/*
 * The SDK's own collection, all off: the scrubber's allow-list is what decides, and this keeps the
 * SDK from gathering what the scrubber would only drop again. Goes in `init` as `dataCollection`.
 */
export const TELEMETRY_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0
};
