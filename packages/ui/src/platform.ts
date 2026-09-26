/* True on macOS and iOS, where a shortcut is written with ⌘ instead of Ctrl. The keyboard in question is the one in front of this page. */
export const isApplePlatform = (): boolean => {
    if (typeof navigator === 'undefined') {
        return false;
    }
    const hints = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    return applePlatformFrom(hints?.platform || navigator.platform);
};

export const applePlatformFrom = (platform: string | undefined): boolean => /mac|iphone|ipad/i.test(platform ?? '');
