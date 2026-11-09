/* The permissions the token needs, as Cloudflare's token page takes them in its address. */
const PERMISSIONS = [
    { key: 'zone', type: 'read' },
    { key: 'dns', type: 'edit' },
    { key: 'argotunnel', type: 'edit' }
];

/* Opens Cloudflare's page to make an API token with Zone read, DNS edit and Cloudflare Tunnel edit already ticked. */
export const CLOUDFLARE_TOKEN_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(PERMISSIONS))}&name=Ruimte&accountId=*&zoneId=all`;
