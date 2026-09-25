export type Vec3 = { x: number; y: number; z: number };
export type Pointer = { x: number; y: number; active: number };
export type Scene = (paint: Space, time: number, pointer: Pointer) => void;

type Command = { depth: number; draw: () => void };
type Projected = Vec3 & { scale: number };

export const TAU = Math.PI * 2;
export const point = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => point(a.x + b.x, a.y + b.y, a.z + b.z);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const noise = (seed: number) => (((Math.sin(seed * 127.1 + 311.7) * 43758.5453) % 1) + 1) % 1;

export function rotate(p: Vec3, x = 0, y = 0, z = 0): Vec3 {
    const py = p.y * Math.cos(x) - p.z * Math.sin(x);
    const pz = p.y * Math.sin(x) + p.z * Math.cos(x);
    const px = p.x * Math.cos(y) + pz * Math.sin(y);
    const rz = -p.x * Math.sin(y) + pz * Math.cos(y);
    return point(px * Math.cos(z) - py * Math.sin(z), px * Math.sin(z) + py * Math.cos(z), rz);
}

export function lighting(a: Vec3, b: Vec3, c: Vec3, tint = 0): number {
    const u = point(b.x - a.x, b.y - a.y, b.z - a.z);
    const v = point(c.x - a.x, c.y - a.y, c.z - a.z);
    const normal = point(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x);
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const incidence = Math.abs((normal.x * -0.35 + normal.y * -0.65 + normal.z * -0.68) / length);
    return Math.min(0.95, -0.65 + incidence * 0.92 + tint);
}

export class Space {
    private commands: Command[] = [];
    private readonly ctx: CanvasRenderingContext2D;
    private readonly pointer: Pointer;
    private readonly blue: readonly number[];
    private readonly zoom: number;

    constructor(ctx: CanvasRenderingContext2D, pointer: Pointer, blue: readonly number[], zoom = 1) {
        this.ctx = ctx;
        this.pointer = pointer;
        this.blue = blue;
        this.zoom = zoom;
    }

    private project(p: Vec3): Projected {
        const v = rotate(p, this.pointer.y * 0.12, this.pointer.x * 0.2);
        const scale = (880 / Math.max(180, 880 + v.z * this.zoom)) * this.zoom;
        return { x: 400 + v.x * scale, y: 380 + v.y * scale, z: v.z * this.zoom, scale };
    }

    color(light = 0, opacity = 1): string {
        light = Math.max(-1, Math.min(1, light));
        const channels = this.blue.map((channel) => Math.round(light < 0 ? channel * (1 + light) : channel + (245 - channel) * light));
        return `rgba(${channels.join(',')},${opacity})`;
    }

    line(points: Vec3[], opacity = 0.5, width = 1, light = 0): void {
        if (points.length < 2) {
            return;
        }
        const projected = points.map((p) => this.project(p));
        this.commands.push({
            depth: projected.reduce((sum, p) => sum + p.z, 0) / projected.length,
            draw: () => {
                const ctx = this.ctx;
                ctx.beginPath();
                projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
                ctx.strokeStyle = this.color(light, opacity);
                ctx.lineWidth = width * projected[0]!.scale;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }
        });
    }

    face(vertices: Vec3[], tint = 0, opacity = 1, lights?: number[]): void {
        const projected = vertices.map((p) => this.project(p));
        const fill = lights ? this.smoothFill(projected, lights, opacity) : this.color(lighting(vertices[0]!, vertices[1]!, vertices[2]!, tint), opacity);
        this.commands.push({
            depth: projected.reduce((sum, p) => sum + p.z, 0) / projected.length,
            draw: () => {
                const ctx = this.ctx;
                ctx.beginPath();
                projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
                ctx.closePath();
                ctx.fillStyle = fill;
                ctx.fill();
                // A matching hairline closes subpixel seams between adjoining faces.
                ctx.strokeStyle = ctx.fillStyle;
                ctx.lineWidth = lights ? 1.2 : 0.6;
                ctx.stroke();
            }
        });
    }

    private smoothFill(vertices: Projected[], lights: number[], opacity: number): CanvasGradient | string {
        const count = vertices.length;
        const mx = vertices.reduce((sum, p) => sum + p.x, 0) / count;
        const my = vertices.reduce((sum, p) => sum + p.y, 0) / count;
        const ml = lights.reduce((sum, value) => sum + value, 0) / count;
        let xx = 0,
            yy = 0,
            xy = 0,
            xl = 0,
            yl = 0;
        for (let i = 0; i < count; i++) {
            const x = vertices[i]!.x - mx;
            const y = vertices[i]!.y - my;
            const light = lights[i]! - ml;
            xx += x * x;
            yy += y * y;
            xy += x * y;
            xl += x * light;
            yl += y * light;
        }
        // Fit a lighting gradient in screen space to keep adjoining ribbon patches smooth.
        const determinant = xx * yy - xy * xy;
        if (Math.abs(determinant) < 0.00001) {
            return this.color(ml, opacity);
        }
        const dx = (xl * yy - yl * xy) / determinant;
        const dy = (yl * xx - xl * xy) / determinant;
        const magnitude = Math.hypot(dx, dy);
        if (magnitude < 0.00001) {
            return this.color(ml, opacity);
        }
        const nx = dx / magnitude;
        const ny = dy / magnitude;
        const distances = vertices.map((p) => (p.x - mx) * nx + (p.y - my) * ny);
        const near = Math.min(...distances);
        const far = Math.max(...distances);
        const gradient = this.ctx.createLinearGradient(mx + nx * near, my + ny * near, mx + nx * far, my + ny * far);
        gradient.addColorStop(0, this.color(ml + magnitude * near, opacity));
        gradient.addColorStop(1, this.color(ml + magnitude * far, opacity));
        return gradient;
    }

    glow(position: Vec3, radius: number, opacity = 1, light = 0.6, core = true): void {
        const p = this.project(position);
        const size = radius * p.scale;
        this.commands.push({
            depth: p.z - 1,
            draw: () => {
                const ctx = this.ctx;
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
                gradient.addColorStop(0, this.color(light, opacity));
                gradient.addColorStop(0.12, this.color(light * 0.65, opacity * 0.6));
                gradient.addColorStop(0.4, this.color(0, opacity * 0.16));
                gradient.addColorStop(1, this.color(0, 0));
                ctx.fillStyle = gradient;
                ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
                if (core) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, Math.max(0.8, size * 0.055), 0, TAU);
                    ctx.fillStyle = this.color(0.92, opacity);
                    ctx.fill();
                }
            }
        });
    }

    crystal(center: Vec3, radius: number, rotation: number, stretch = 1.5, light = 0): void {
        const vertices = [
            point(0, -radius * stretch, 0),
            point(0, radius * stretch, 0),
            point(-radius, 0, 0),
            point(0, 0, radius),
            point(radius, 0, 0),
            point(0, 0, -radius)
        ].map((p) => add(rotate(p, 0.25, rotation, -0.2), center));
        for (let i = 0; i < 4; i++) {
            const a = vertices[2 + i]!;
            const b = vertices[2 + ((i + 1) % 4)]!;
            this.face([vertices[0]!, a, b], light);
            this.face([vertices[1]!, b, a], light);
        }
    }

    finish(): void {
        this.commands.sort((a, b) => b.depth - a.depth);
        for (const command of this.commands) {
            command.draw();
        }
    }
}
