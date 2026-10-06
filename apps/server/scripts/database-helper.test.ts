import { expect, test } from 'bun:test';
import { pinnedIn } from './database-helper.ts';

const LOCK = [
    '    "@adecore/database": ["@adecore/database@0.17.0", "", { "optionalDependencies": { "@adecore/database-linux-arm64": "0.17.0" } }, "sha512-main=="],',
    '',
    '    "@adecore/database-linux-arm64": ["@adecore/database-linux-arm64@0.17.0", "", { "os": "linux", "cpu": "arm64" }, "sha512-/Ia3+arm=="],'
].join('\n');

test('reads the version and integrity the lockfile pins for a platform package', () => {
    expect(pinnedIn(LOCK, '@adecore/database-linux-arm64')).toEqual({ version: '0.17.0', integrity: 'sha512-/Ia3+arm==' });
});

test('a package the lockfile does not pin has nothing to fetch', () => {
    expect(pinnedIn(LOCK, '@adecore/database-darwin-x64')).toBeNull();
});
