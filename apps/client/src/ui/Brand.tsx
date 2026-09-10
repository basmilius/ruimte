import clsx from 'clsx';

// The two shapes of `assets/logo.svg` at the repository root, in paint order: the front shape
// first, the back shape over its lower left, and that overlap is what gives the mark its notch.
const FRONT_PATH =
    'M310.675 440.051C296.039 444.972 281.933 450.859 267.47 456.245C249.541 462.876 231.527 469.224 213.435 475.287C204.206 478.471 195.541 482.771 186.093 485.253C175.098 488.291 164.153 481.772 158.814 470.962C151.669 456.494 159.931 440.029 163.748 425.911C166.626 415.268 169.719 404.835 172.695 394.288L193.118 324.212C200.3 298.698 207.283 273.114 214.065 247.465C219.469 227.395 230.961 203.775 248.387 194.375C260.298 187.948 275.477 182.462 288.109 177.858L344.383 157.43C351.068 154.937 357.793 151.75 364.515 149.144C377.409 144.264 390.348 139.533 403.331 134.95C418.558 129.405 442.31 116.319 453.522 138.276C456.748 144.592 456.556 157.597 454.481 164.501C446.295 191.738 439.342 219.499 431.432 246.843C428.262 257.742 424.148 268.094 421.072 279.072C415.383 300.702 409.282 321.857 402.775 343.433C393.244 375.041 389.08 403.98 359.958 421.381C345.093 430.264 324.861 432.27 310.675 440.051Z';
const BACK_PATH =
    'M210.675 340.051C196.039 344.972 181.933 350.859 167.47 356.245C149.541 362.876 131.527 369.224 113.435 375.287C104.206 378.471 95.5412 382.771 86.0925 385.253C75.0978 388.291 64.1531 381.772 58.8144 370.962C51.6694 356.494 59.9308 340.029 63.7482 325.911C66.6258 315.268 69.719 304.835 72.6954 294.288L93.1175 224.212C100.3 198.698 107.283 173.114 114.065 147.465C119.469 127.395 130.961 103.775 148.387 94.3748C160.298 87.9485 175.477 82.4619 188.109 77.8575L244.383 57.43C251.068 54.9368 257.793 51.75 264.515 49.1442C277.409 44.2644 290.348 39.5327 303.331 34.9501C318.558 29.4047 342.31 16.3194 353.522 38.276C356.748 44.5919 356.556 57.5971 354.481 64.5007C346.295 91.7375 339.342 119.499 331.432 146.843C328.262 157.742 324.148 168.094 321.072 179.072C315.383 200.702 309.282 221.857 302.775 243.433C293.244 275.041 289.08 303.98 259.958 321.381C245.093 330.264 224.861 332.27 210.675 340.051Z';

interface BrandSymbolProps {
    size?: number;
    className?: string;
}

/* The symbol on its own, sized in pixels. It is decorative wherever it appears: the word next to
   it, or the label of the pane it sits in, is what a screen reader reads. */
export function BrandSymbol({ size = 20, className }: BrandSymbolProps) {
    return (
        <svg viewBox="0 0 512 512" width={size} height={size} className={clsx('shrink-0', className)} aria-hidden>
            <path d={FRONT_PATH} className="fill-brand-front" />
            <path d={BACK_PATH} className="fill-brand-back" />
        </svg>
    );
}

interface BrandProps {
    size?: number;
    className?: string;
}

/* Symbol plus wordmark. The word is Geist at 600, the only place in the client that leaves the
   interface font. */
export function Brand({ size = 20, className }: BrandProps) {
    return (
        <span className={clsx('inline-flex items-center gap-2', className)}>
            <BrandSymbol size={size} />
            <span className="font-brand text-sm font-semibold text-text">Ruimte</span>
        </span>
    );
}
