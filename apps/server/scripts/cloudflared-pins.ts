/*
 * Computes the sha256 of every `cloudflared` build the installer can download, for `src/tunnels/cloudflared-pins.ts`. Run at each
 * bump: `bun apps/server/scripts/cloudflared-pins.ts <version>`. It downloads each asset itself and hashes the bytes it got, so a pin
 * is never copied from the release page. It prints the table; a person pastes it and the version into the pins file.
 */
const ASSETS: Record<string, { name: string; archive: 'tgz' | null }> = {
    'darwin-arm64': { name: 'cloudflared-darwin-arm64.tgz', archive: 'tgz' },
    'darwin-x64': { name: 'cloudflared-darwin-amd64.tgz', archive: 'tgz' },
    'linux-x64': { name: 'cloudflared-linux-amd64', archive: null },
    'linux-arm64': { name: 'cloudflared-linux-arm64', archive: null },
    'win32-x64': { name: 'cloudflared-windows-amd64.exe', archive: null }
};

const version = process.argv[2];

if (version === undefined || !/^\d{4}\.\d+\.\d+$/.test(version)) {
    console.error('Usage: bun apps/server/scripts/cloudflared-pins.ts <version>, such as 2026.10.7');
    process.exit(1);
}

for (const [platform, asset] of Object.entries(ASSETS)) {
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${version}/${asset.name}`;
    const response = await fetch(url);

    if (!response.ok) {
        console.error(`${asset.name}: answered ${response.status}`);
        process.exit(1);
    }

    const sha256 = new Bun.CryptoHasher('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex');

    console.log(
        `    '${platform}': {\n        name: '${asset.name}',\n        sha256: '${sha256}',\n        archive: ${asset.archive === null ? 'null' : `'${asset.archive}'`}\n    },`
    );
}
