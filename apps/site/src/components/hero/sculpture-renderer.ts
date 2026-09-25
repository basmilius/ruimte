import type { Pointer } from './space.ts';
import { surfaceNormal, type Sculpture } from './sculptures.ts';

const VERTEX = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_material;
uniform vec2 u_pointer;
uniform float u_size;
varying vec3 v_normal;
varying vec3 v_view;
varying vec2 v_material;

vec3 turn(vec3 p) {
    float x = u_pointer.y * 0.12;
    float y = u_pointer.x * 0.2;
    p.yz = mat2(cos(x), sin(x), -sin(x), cos(x)) * p.yz;
    p.xz = mat2(cos(y), -sin(y), sin(y), cos(y)) * p.xz;
    return p;
}

void main() {
    vec3 p = turn(a_position);
    float depth = 880.0 + p.z;
    gl_Position = vec4(p.x * 2.2, -p.y * 2.2 + depth * 0.05, 1.0083682 * depth - 20.083682, depth);
    gl_PointSize = max(1.0, a_material.y * u_size / 800.0 * 880.0 / depth);
    v_normal = turn(a_normal);
    v_view = normalize(vec3(-p.xy, -depth));
    v_material = a_material;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_blue;
uniform float u_opacity;
uniform int u_kind;
varying vec3 v_normal;
varying vec3 v_view;
varying vec2 v_material;

void main() {
    if (u_kind == 2) {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        if (radius > 1.0) discard;
        float core = pow(1.0 - radius, 28.0);
        float halo = pow(1.0 - radius, 4.0);
        vec3 color = mix(u_blue, vec3(0.95, 0.97, 1.0), min(1.0, core * 3.0));
        gl_FragColor = vec4(color, (halo * 0.5 + core) * v_material.x * u_opacity);
        return;
    }
    if (u_kind == 1) {
        gl_FragColor = vec4(mix(u_blue, vec3(0.8, 0.88, 1.0), 0.3), 0.19 * u_opacity);
        return;
    }
    vec3 normal = normalize(v_normal);
    vec3 view = normalize(v_view);
    float side = dot(normal, view);
    normal *= side < 0.0 ? -1.0 : 1.0;
    vec3 key = normalize(vec3(-0.5, -0.75, -1.0));
    vec3 fill = normalize(vec3(0.8, 0.3, -0.35));
    vec3 halfway = normalize(key + view);
    float diffuse = max(0.0, dot(normal, key));
    float reflection = max(0.0, dot(normal, halfway));
    float specular = pow(reflection, 48.0) * 0.8 + pow(reflection, 9.0) * 0.09;
    float rim = pow(1.0 - max(0.0, dot(normal, view)), 3.0);
    float pearl = min(1.0, v_material.x + (1.0 - smoothstep(-0.18, 0.18, side)) * 0.2);
    vec3 blue = pow(u_blue, vec3(2.2));
    vec3 base = mix(blue, vec3(0.52, 0.64, 0.83), pearl);
    float ambient = 0.1 + (0.5 - normal.y * 0.5) * 0.12;
    vec3 color = base * (ambient + diffuse * 0.78 + max(0.0, dot(normal, fill)) * 0.18);
    color += mix(base, vec3(1.0), 0.82) * specular;
    color += vec3(0.12, 0.22, 0.5) * rim * 0.28;
    color = pow(color / (color + vec3(0.8)), vec3(1.0 / 2.2));
    gl_FragColor = vec4(color, u_opacity);
}`;

export function createSculptureRenderer(canvas: HTMLCanvasElement, blue: readonly number[]) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    if (!gl) {
        return null;
    }
    function shader(type: number, source: string): WebGLShader {
        const shader = gl!.createShader(type)!;
        gl!.shaderSource(shader, source);
        gl!.compileShader(shader);
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
            const message = gl!.getShaderInfoLog(shader);
            gl!.deleteShader(shader);
            throw new Error(`Sculpture shader: ${message}`);
        }
        return shader;
    }
    const vertex = shader(gl.VERTEX_SHADER, VERTEX);
    const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        throw new Error('Could not link sculpture shaders');
    }
    gl.useProgram(program);
    const vertexBuffer = gl.createBuffer()!;
    const indexBuffer = gl.createBuffer()!;
    const detailBuffer = gl.createBuffer()!;
    const position = gl.getAttribLocation(program, 'a_position');
    const normal = gl.getAttribLocation(program, 'a_normal');
    const material = gl.getAttribLocation(program, 'a_material');
    const pointerLocation = gl.getUniformLocation(program, 'u_pointer');
    const sizeLocation = gl.getUniformLocation(program, 'u_size');
    const opacityLocation = gl.getUniformLocation(program, 'u_opacity');
    const kindLocation = gl.getUniformLocation(program, 'u_kind');
    gl.uniform3f(gl.getUniformLocation(program, 'u_blue'), blue[0]! / 255, blue[1]! / 255, blue[2]! / 255);
    let vertices = new Float32Array(0);
    let indexCount = 0;

    function bind(buffer: WebGLBuffer) {
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
        gl!.enableVertexAttribArray(position);
        gl!.enableVertexAttribArray(normal);
        gl!.enableVertexAttribArray(material);
        gl!.vertexAttribPointer(position, 3, gl!.FLOAT, false, 32, 0);
        gl!.vertexAttribPointer(normal, 3, gl!.FLOAT, false, 32, 12);
        gl!.vertexAttribPointer(material, 2, gl!.FLOAT, false, 32, 24);
    }

    function initialize(sculpture: Sculpture) {
        const count = sculpture.surfaces.reduce((sum, surface) => sum + (surface.length + 1) * (surface.width + 1), 0);
        vertices = new Float32Array(count * 8);
        const indices: number[] = [];
        let offset = 0;
        for (const surface of sculpture.surfaces) {
            for (let u = 0; u < surface.length; u++) {
                for (let v = 0; v < surface.width; v++) {
                    const a = offset + u * (surface.width + 1) + v;
                    const b = a + surface.width + 1;
                    indices.push(a, b, b + 1, a, b + 1, a + 1);
                }
            }
            offset += (surface.length + 1) * (surface.width + 1);
        }
        indexCount = indices.length;
        gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl!.STATIC_DRAW);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, vertexBuffer);
        gl!.bufferData(gl!.ARRAY_BUFFER, vertices.byteLength, gl!.DYNAMIC_DRAW);
    }

    return {
        render(sculpture: Sculpture, pointer: Pointer, opacity: number) {
            if (!vertices.length) {
                initialize(sculpture);
            }
            let offset = 0;
            for (const surface of sculpture.surfaces) {
                for (let segment = 0; segment <= surface.length; segment++) {
                    for (let band = 0; band <= surface.width; band++) {
                        const u = segment / surface.length;
                        const v = (band / surface.width) * 2 - 1;
                        const p = surface.at(u, v);
                        const n = surfaceNormal(surface.at, u, v);
                        vertices.set([p.x, p.y, p.z, n.x, n.y, n.z, surface.pearl, 0], offset);
                        offset += 8;
                    }
                }
            }
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.uniform2f(pointerLocation, pointer.x, pointer.y);
            gl.uniform1f(sizeLocation, canvas.width);
            gl.uniform1f(opacityLocation, opacity);
            gl.uniform1i(kindLocation, 0);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            bind(vertexBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);

            const details: number[] = [];
            for (const thread of sculpture.threads) {
                for (let i = 1; i < thread.length; i++) {
                    for (const p of [thread[i - 1]!, thread[i]!]) {
                        details.push(p.x, p.y, p.z, 0, 0, 0, 0.3, 0);
                    }
                }
            }
            const lineCount = details.length / 8;
            for (const spark of sculpture.sparks) {
                details.push(spark.at.x, spark.at.y, spark.at.z, 0, 0, 0, spark.strength, spark.size);
            }
            bind(detailBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(details), gl.DYNAMIC_DRAW);
            gl.depthMask(false);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.uniform1i(kindLocation, 1);
            gl.drawArrays(gl.LINES, 0, lineCount);
            gl.uniform1i(kindLocation, 2);
            gl.drawArrays(gl.POINTS, lineCount, sculpture.sparks.length);
            gl.depthMask(true);
        },
        dispose(releaseContext: boolean) {
            gl.deleteBuffer(vertexBuffer);
            gl.deleteBuffer(indexBuffer);
            gl.deleteBuffer(detailBuffer);
            gl.deleteProgram(program);
            if (releaseContext) {
                gl.getExtension('WEBGL_lose_context')?.loseContext();
            }
        }
    };
}
