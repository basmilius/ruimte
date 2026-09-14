export interface Env {
    DB: D1Database;
    // The origin the provider's callback is registered under; a request's own URL is not trusted for it.
    PUBLIC_ORIGIN: string;
    // Comma separated origins besides loopback that may call `/v1/*` from a page.
    ALLOWED_ORIGINS?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    // The private half of the statement key, pkcs8 DER in base64url.
    STATEMENT_PRIVATE_KEY?: string;
}
