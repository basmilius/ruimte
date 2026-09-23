import clsx from 'clsx';

/*
 * The Android head beside the Apple mark of `SignInMark`: Lucide has no brand marks, so it is drawn
 * here in the same 24 by 24 box and in `currentColor`.
 */
export function AndroidMark({ size = 12, className }: { size?: number; className?: string }) {
    return (
        <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className={clsx('shrink-0', className)}>
            <path d="M8 11 5.8 7.2M16 11l2.2-3.8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M2 19a10 10 0 0 1 20 0zm5.5-4a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0zm9 0a1.25 1.25 0 1 0-2.5 0 1.25 1.25 0 1 0 2.5 0z"
            />
        </svg>
    );
}
