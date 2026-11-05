import { Color, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, type PerspectiveCamera } from 'three';

// The minor lines carry half of this, the lines every ten cells all of it; like a border, an alpha over the ground.
const LIGHT_OPACITY = 0.24;
const DARK_OPACITY = 0.2;

/*
 * A ground plane without an edge: a quad over the whole view that casts a ray per pixel onto the
 * plane at `groundHeight`, so the grid reaches the horizon and fades out before it gets there.
 * It draws onto the transparent canvas, over whatever surface sits behind it.
 */
export class ModelGrid extends Mesh<PlaneGeometry, ShaderMaterial> {
    constructor() {
        super(
            new PlaneGeometry(2, 2),
            new ShaderMaterial({
                transparent: true,
                depthWrite: false,
                toneMapped: false,
                uniforms: {
                    inverseProjection: { value: new Matrix4() },
                    cameraWorld: { value: new Matrix4() },
                    groundHeight: { value: 0 },
                    cellSize: { value: 0.1 },
                    fadeDistance: { value: 100 },
                    lineColor: { value: new Color(0x000000) },
                    opacity: { value: LIGHT_OPACITY }
                },
                vertexShader: `
                    uniform mat4 inverseProjection;
                    uniform mat4 cameraWorld;
                    varying vec3 rayNear;
                    varying vec3 rayFar;
                    vec3 unproject(vec2 xy, float z) {
                        vec4 point = cameraWorld * inverseProjection * vec4(xy, z, 1.0);
                        return point.xyz / point.w;
                    }
                    void main() {
                        rayNear = unproject(position.xy, -1.0);
                        rayFar = unproject(position.xy, 1.0);
                        gl_Position = vec4(position.xy, 0.0, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float groundHeight;
                    uniform float cellSize;
                    uniform float fadeDistance;
                    uniform vec3 lineColor;
                    uniform float opacity;
                    uniform mat4 projectionMatrix;
                    varying vec3 rayNear;
                    varying vec3 rayFar;
                    float lines(vec2 point, float spacing) {
                        vec2 cell = point / spacing;
                        vec2 width = max(fwidth(cell), vec2(0.000001));
                        vec2 line = abs(fract(cell - 0.5) - 0.5) / width;
                        float coverage = 1.0 - min(min(line.x, line.y), 1.0);
                        // Lines closer together than a pixel would shimmer, so they fade out first.
                        return coverage * (1.0 - smoothstep(0.5, 1.5, max(width.x, width.y)));
                    }
                    void main() {
                        vec3 ray = rayFar - rayNear;
                        if (abs(ray.y) < 0.000001) {
                            discard;
                        }
                        float t = (groundHeight - rayNear.y) / ray.y;
                        if (t < 0.0 || t > 1.0) {
                            discard;
                        }
                        vec3 hit = rayNear + t * ray;
                        vec4 clip = projectionMatrix * viewMatrix * vec4(hit, 1.0);
                        // The model hides the grid behind it, though the quad itself sits on the near plane.
                        gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
                        float distanceToCamera = distance(hit, cameraPosition);
                        float fog = exp(-pow(distanceToCamera / (fadeDistance * 0.35), 2.0));
                        float fade = fog * (1.0 - smoothstep(fadeDistance * 0.7, fadeDistance, distanceToCamera));
                        float alpha = max(lines(hit.xz, cellSize) * 0.5, lines(hit.xz, cellSize * 10.0)) * opacity * fade;
                        gl_FragColor = vec4(lineColor, alpha);
                        #include <colorspace_fragment>
                    }
                `
            })
        );
        this.frustumCulled = false;
    }

    /* Lays the grid under the model, `cellSize` apart. */
    fit(groundHeight: number, cellSize: number): void {
        this.material.uniforms.groundHeight.value = groundHeight;
        this.material.uniforms.cellSize.value = cellSize;
    }

    /* Before every frame, so the rays follow the camera; `distance` is the camera's to what it orbits. */
    follow(camera: PerspectiveCamera, distance: number): void {
        camera.updateMatrixWorld();
        const uniforms = this.material.uniforms;
        uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
        uniforms.cameraWorld.value.copy(camera.matrixWorld);
        uniforms.fadeDistance.value = Math.min(camera.far * 0.8, Math.max(distance * 12, uniforms.cellSize.value * 20));
    }

    setDark(dark: boolean): void {
        this.material.uniforms.lineColor.value.set(dark ? 0xffffff : 0x000000);
        this.material.uniforms.opacity.value = dark ? DARK_OPACITY : LIGHT_OPACITY;
    }

    override dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
        super.dispose();
    }
}
