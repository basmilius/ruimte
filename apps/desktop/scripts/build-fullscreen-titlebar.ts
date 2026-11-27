import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFullScreenTitlebar } from '@adecore/shell';

// The module only changes how a fullscreen macOS window shows its traffic lights.
if (process.platform !== 'darwin') {
    process.exit(0);
}

buildFullScreenTitlebar({ outfile: join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'native', 'fullscreen-titlebar.node') });
