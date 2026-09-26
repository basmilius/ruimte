import { useState } from 'react';
import { Globe } from 'lucide-react';
import { useBrowserRow } from '@/browser/registry';
import { Icon } from '@ruimte/ui/Icon';

/* The page's own favicon where there is one, otherwise the globe. A URL that fails to load stays
   failed, so the row never flashes a broken image. */
export function Favicon({ id, size = 16 }: { id: string; size?: number }) {
    const url = useBrowserRow(id, (row) => row?.favicon ?? null);
    const [failed, setFailed] = useState<string | null>(null);

    if (!url || url === failed) {
        return <Icon icon={Globe} size={size} />;
    }
    return <img src={url} alt="" width={size} height={size} className="shrink-0" onError={() => setFailed(url)} />;
}
