/** The white app icon, as the client's `BrandSymbol` draws it: the one of three sizes that is sharp. */
export function AppIcon({ size, className = '' }: { readonly size: number; readonly className?: string }) {
    return (
        <img
            src="/app-icon-128.png"
            srcSet="/app-icon-64.png 64w, /app-icon-128.png 128w, /app-icon-256.png 256w"
            sizes={`${size}px`}
            width={size}
            height={size}
            alt=""
            draggable={false}
            className={`shrink-0 ${className}`}
        />
    );
}
