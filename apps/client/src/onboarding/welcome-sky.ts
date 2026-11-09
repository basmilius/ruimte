export const WELCOME_SKY = {
    glows: [380, 200],
    rings: [150, 190],
    orbits: [
        { size: 300, alpha: 0.1 },
        { size: 460, alpha: 0.07, spin: 140 },
        { size: 680, alpha: 0.05 }
    ],
    stars: { density: 0.9, seed: 202 }
} as const;
