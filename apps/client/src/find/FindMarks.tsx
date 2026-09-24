/* Where the matches are along a scroller, as short marks beside its scrollbar. It lies over the scroller's own box. */
export function FindMarks({ marks, current }: { marks: readonly number[]; current: number | null }) {
    if (marks.length === 0) {
        return null;
    }
    return (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-2">
            {marks.map((top) => (
                <span key={top} className="absolute right-0.5 h-0.5 w-1.5 rounded-full bg-find-current opacity-50" style={{ top }} />
            ))}
            {current !== null && <span className="absolute right-0.5 h-0.5 w-1.5 rounded-full bg-find-current" style={{ top: current }} />}
        </div>
    );
}
