export interface Env {
    DB: D1Database;
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
    // Where a person approves a machine's code, when it is not the web client in production.
    DEVICE_LINK_PAGE_URL?: string;
    // The key of the free Data API of Artificial Analysis. Never logged, never sent anywhere else.
    ARTIFICIAL_ANALYSIS_API_KEY?: string;
}
