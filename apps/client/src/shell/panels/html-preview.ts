const PREVIEW_POLICY = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'none'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
].join('; ');

const policyTag = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_POLICY}">`;

/* The policy has to precede page content: a resource encountered before a CSP meta tag may already be on its way. */
export const htmlPreviewDocument = (html: string): string => {
    if (/<head(?:\s|>)/i.test(html)) {
        return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${policyTag}`);
    }
    if (/<html(?:\s|>)/i.test(html)) {
        return html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${policyTag}</head>`);
    }
    if (/<body(?:\s|>)/i.test(html)) {
        return html.replace(/<body(?:\s[^>]*)?>/i, (body) => `<head>${policyTag}</head>${body}`);
    }
    return `<!doctype html><html><head>${policyTag}</head><body>${html}</body></html>`;
};
