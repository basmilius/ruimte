import type { LucideIcon } from 'lucide-react';
import { Ban, CircleAlert, Clock, Globe, Link2Off, ShieldAlert, Unplug, WifiOff } from 'lucide-react';
import type { LoadErrorKind } from '@/browser/load-error';

/* The mark of each way a page fails to load, shared by the error plate over a page and the plate of a far one. */
export const ERROR_ICON: Record<LoadErrorKind, LucideIcon> = {
    offline: WifiOff,
    dns: Globe,
    refused: Unplug,
    certificate: ShieldAlert,
    timeout: Clock,
    blocked: Ban,
    address: Link2Off,
    other: CircleAlert
};
