import type { UsageDeps } from './usage.ts';

export interface Env {
    DB: D1Database;
    // The per-minute limit per address in front of the usage relay.
    USAGE_LIMIT?: UsageDeps['burst'];
    // Where every accepted batch goes on to (`usageRelay`), and the upload token of Ruimte's product there. Never logged.
    OBSERVATORY_USAGE_URL?: string;
    OBSERVATORY_UPLOAD_TOKEN?: string;
    // Observatory's envelope ingest of the address book's app, for the check-ins of the nightly cleanup.
    OBSERVATORY_CHECK_IN_URL?: string;
    // The address book's app in Observatory, for its errors and log lines (`src/telemetry.ts`), and the release the deploy names.
    OBSERVATORY_DSN?: string;
    OBSERVATORY_RELEASE?: string;
    APNS_SANDBOX_KEY?: string;
    APNS_SANDBOX_KEY_ID?: string;
    APNS_PRODUCTION_KEY?: string;
    APNS_PRODUCTION_KEY_ID?: string;
    APNS_TEAM_ID?: string;
    APNS_TOPIC?: string;
    // The origin the provider's callback is registered under; a request's own URL is not trusted for it.
    PUBLIC_ORIGIN: string;
    // Comma separated origins besides loopback that may call `/v1/*` from a page.
    ALLOWED_ORIGINS?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    // Sign in with Apple: the team, the key id and the .p8 contents of the key, and the Services ID.
    APPLE_TEAM_ID?: string;
    APPLE_KEY_ID?: string;
    APPLE_PRIVATE_KEY?: string;
    APPLE_CLIENT_ID?: string;
    // The file Apple may ask to be served at `/.well-known/apple-developer-domain-association.txt`.
    APPLE_DOMAIN_ASSOCIATION?: string;
    // The private half of the statement key, pkcs8 DER in base64url.
    STATEMENT_PRIVATE_KEY?: string;
    // Signs the tickets the maps service accepts; the same secret is set on that service, which checks them. Never logged.
    MAP_TICKET_SECRET?: string;
    // Where a person approves a machine's code, when it is not the web client in production.
    DEVICE_LINK_PAGE_URL?: string;
    // The key of the free Data API of Artificial Analysis. Never logged, never sent anywhere else.
    ARTIFICIAL_ANALYSIS_API_KEY?: string;
    // Only a digest is deployed; the short-lived bearer stays in the deployment process.
    BENCHMARK_REFRESH_TOKEN_HASH?: string;
    BENCHMARK_REFRESH_TOKEN_EXPIRES_AT?: string;
}
