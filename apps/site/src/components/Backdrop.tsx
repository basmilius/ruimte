export function Backdrop() {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute top-20 -right-[25%] h-[1200px] w-[1400px] bg-[radial-gradient(ellipse,color-mix(in_srgb,var(--accent)_15%,transparent),transparent_65%)]" />
            <div className="absolute inset-x-0 top-0 h-[1300px] opacity-40 [background-image:radial-gradient(color-mix(in_srgb,var(--accent)_50%,transparent)_0.7px,transparent_0.7px)] [background-size:38px_38px] [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
        </div>
    );
}
