/**
 * Voxel Ray Traversal Engine v2.0
 * WebGL2 GPU-Accelerated Voxel Renderer
 * 
 * Core engine module - handles rendering, camera, and voxel data
 */

// ============================================================================
// Shader Sources
// ============================================================================

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler3D u_voxelData;
uniform vec3 u_cameraPos;
uniform vec3 u_cameraDir;
uniform vec3 u_cameraUp;
uniform vec3 u_cameraRight;
uniform vec2 u_resolution;
uniform float u_fov;
uniform float u_worldSize;
uniform int u_maxSteps;
uniform int u_showNormals;
uniform int u_enableShadows;
uniform vec3 u_lightDir;
uniform vec3 u_skyColorTop;
uniform vec3 u_skyColorBottom;
uniform float u_fogDensity;

// Ray-box intersection
vec2 intersectAABB(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax) {
    vec3 tMin = (boxMin - rayOrigin) / rayDir;
    vec3 tMax = (boxMax - rayOrigin) / rayDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);
    return vec2(tNear, tFar);
}

// Get voxel at position
vec4 getVoxel(ivec3 pos) {
    if (pos.x < 0 || pos.y < 0 || pos.z < 0 ||
        pos.x >= int(u_worldSize) || pos.y >= int(u_worldSize) || pos.z >= int(u_worldSize)) {
        return vec4(0.0);
    }
    return texelFetch(u_voxelData, pos, 0);
}

// DDA Ray Traversal
struct HitResult {
    bool hit;
    vec3 pos;
    vec3 normal;
    vec4 color;
    float distance;
    int steps;
};

HitResult traceRay(vec3 origin, vec3 direction) {
    HitResult result;
    result.hit = false;
    result.steps = 0;
    result.normal = vec3(0.0);
    
    // Intersect with world bounds
    vec2 tBox = intersectAABB(origin, direction, vec3(0.0), vec3(u_worldSize));
    if (tBox.x > tBox.y || tBox.y < 0.0) {
        return result;
    }
    
    float tStart = max(0.0, tBox.x) + 0.001;
    vec3 startPos = origin + direction * tStart;
    
    // Current voxel coordinates
    ivec3 mapPos = ivec3(floor(startPos));
    mapPos = clamp(mapPos, ivec3(0), ivec3(int(u_worldSize) - 1));
    
    // Step direction
    ivec3 step = ivec3(sign(direction));
    
    // Delta - how far along ray to move for 1 unit in each axis
    vec3 deltaDist = abs(vec3(1.0) / direction);
    
    // Distance to next voxel boundary
    vec3 sideDist = (sign(direction) * (vec3(mapPos) - startPos) + (sign(direction) * 0.5) + 0.5) * deltaDist;
    
    // Track which axis we crossed
    int side = 0;
    
    // DDA loop
    for (int i = 0; i < 512; i++) {
        if (i >= u_maxSteps) break;
        result.steps = i + 1;
        
        // Check current voxel
        vec4 voxel = getVoxel(mapPos);
        if (voxel.a > 0.0) {
            result.hit = true;
            result.color = voxel;
            result.pos = vec3(mapPos);
            
            // Set normal based on side hit
            result.normal = vec3(0.0);
            if (side == 0) result.normal.x = -float(step.x);
            else if (side == 1) result.normal.y = -float(step.y);
            else result.normal.z = -float(step.z);
            
            // Calculate distance
            if (side == 0) result.distance = (float(mapPos.x) - origin.x + (1.0 - float(step.x)) / 2.0) / direction.x;
            else if (side == 1) result.distance = (float(mapPos.y) - origin.y + (1.0 - float(step.y)) / 2.0) / direction.y;
            else result.distance = (float(mapPos.z) - origin.z + (1.0 - float(step.z)) / 2.0) / direction.z;
            
            return result;
        }
        
        // DDA step - move to next voxel
        if (sideDist.x < sideDist.y) {
            if (sideDist.x < sideDist.z) {
                sideDist.x += deltaDist.x;
                mapPos.x += step.x;
                side = 0;
            } else {
                sideDist.z += deltaDist.z;
                mapPos.z += step.z;
                side = 2;
            }
        } else {
            if (sideDist.y < sideDist.z) {
                sideDist.y += deltaDist.y;
                mapPos.y += step.y;
                side = 1;
            } else {
                sideDist.z += deltaDist.z;
                mapPos.z += step.z;
                side = 2;
            }
        }
        
        // Check bounds
        if (mapPos.x < 0 || mapPos.x >= int(u_worldSize) ||
            mapPos.y < 0 || mapPos.y >= int(u_worldSize) ||
            mapPos.z < 0 || mapPos.z >= int(u_worldSize)) {
            break;
        }
    }
    
    return result;
}

// Shadow ray trace
float traceShadow(vec3 origin, vec3 direction) {
    vec3 startPos = origin + direction * 0.01;
    
    ivec3 mapPos = ivec3(floor(startPos));
    ivec3 step = ivec3(sign(direction));
    vec3 deltaDist = abs(vec3(1.0) / direction);
    vec3 sideDist = (sign(direction) * (vec3(mapPos) - startPos) + (sign(direction) * 0.5) + 0.5) * deltaDist;
    
    for (int i = 0; i < 128; i++) {
        if (mapPos.x < 0 || mapPos.x >= int(u_worldSize) ||
            mapPos.y < 0 || mapPos.y >= int(u_worldSize) ||
            mapPos.z < 0 || mapPos.z >= int(u_worldSize)) {
            return 1.0;
        }
        
        vec4 voxel = getVoxel(mapPos);
        if (voxel.a > 0.0) {
            return 0.3;
        }
        
        if (sideDist.x < sideDist.y) {
            if (sideDist.x < sideDist.z) {
                sideDist.x += deltaDist.x;
                mapPos.x += step.x;
            } else {
                sideDist.z += deltaDist.z;
                mapPos.z += step.z;
            }
        } else {
            if (sideDist.y < sideDist.z) {
                sideDist.y += deltaDist.y;
                mapPos.y += step.y;
            } else {
                sideDist.z += deltaDist.z;
                mapPos.z += step.z;
            }
        }
    }
    
    return 1.0;
}

void main() {
    // Calculate ray direction for this pixel
    float aspectRatio = u_resolution.x / u_resolution.y;
    float fovRad = u_fov * 3.14159265 / 180.0;
    float halfHeight = tan(fovRad / 2.0);
    float halfWidth = aspectRatio * halfHeight;
    
    vec2 ndc = v_uv * 2.0 - 1.0;
    vec3 rayDir = normalize(u_cameraDir + u_cameraRight * ndc.x * halfWidth + u_cameraUp * ndc.y * halfHeight);
    
    // Trace primary ray
    HitResult hit = traceRay(u_cameraPos, rayDir);
    
    vec3 color;
    
    if (hit.hit) {
        if (u_showNormals == 1) {
            // Visualize normals
            color = hit.normal * 0.5 + 0.5;
        } else {
            // Basic shading
            vec3 baseColor = hit.color.rgb;
            
            // Diffuse lighting
            float diffuse = max(0.3, dot(hit.normal, u_lightDir));
            
            // Shadow
            float shadow = 1.0;
            if (u_enableShadows == 1) {
                vec3 shadowOrigin = hit.pos + hit.normal * 0.5 + vec3(0.5);
                shadow = traceShadow(shadowOrigin, u_lightDir);
            }
            
            // Distance fog
            float fog = clamp(hit.distance * u_fogDensity / u_worldSize, 0.0, 1.0);
            vec3 fogColor = mix(u_skyColorTop, u_skyColorBottom, 0.5);
            
            color = baseColor * diffuse * shadow;
            color = mix(color, fogColor, fog * 0.8);
        }
    } else {
        // Sky gradient
        color = mix(u_skyColorTop, u_skyColorBottom, v_uv.y);
    }
    
    fragColor = vec4(color, 1.0);
}
`;

// ============================================================================
// Camera Class
// ============================================================================

class Camera {
    constructor() {
        this.position = [0, 0, 0];
        this.yaw = 0;
        this.pitch = 0;
        this.fov = 70;
        this.moveSpeed = 30;
        this.lookSpeed = 0.002;
    }
    
    setPosition(x, y, z) {
        this.position = [x, y, z];
    }
    
    getDirection() {
        return [
            Math.cos(this.pitch) * Math.sin(this.yaw),
            Math.sin(this.pitch),
            Math.cos(this.pitch) * Math.cos(this.yaw)
        ];
    }
    
    getRight() {
        return [
            Math.cos(this.yaw),
            0,
            -Math.sin(this.yaw)
        ];
    }
    
    getUp() {
        const dir = this.getDirection();
        const right = this.getRight();
        return [
            dir[1] * right[2] - dir[2] * right[1],
            dir[2] * right[0] - dir[0] * right[2],
            dir[0] * right[1] - dir[1] * right[0]
        ];
    }
    
    moveForward(amount) {
        const dir = this.getDirection();
        this.position[0] += dir[0] * amount;
        this.position[1] += dir[1] * amount;
        this.position[2] += dir[2] * amount;
    }
    
    moveRight(amount) {
        const right = this.getRight();
        this.position[0] += right[0] * amount;
        this.position[2] += right[2] * amount;
    }
    
    moveUp(amount) {
        this.position[1] += amount;
    }
    
    rotate(deltaYaw, deltaPitch) {
        this.yaw += deltaYaw;
        this.pitch -= deltaPitch;
        this.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, this.pitch));
    }
}

// ============================================================================
// Voxel World Class
// ============================================================================

class VoxelWorld {
    constructor(size) {
        this.size = size;
        this.data = new Uint8Array(size * size * size * 4);
        this.voxelCount = 0;
    }
    
    clear() {
        this.data.fill(0);
        this.voxelCount = 0;
    }
    
    setVoxel(x, y, z, r, g, b, a = 255) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size || z < 0 || z >= this.size) {
            return false;
        }
        const idx = (x + y * this.size + z * this.size * this.size) * 4;
        this.data[idx] = r;
        this.data[idx + 1] = g;
        this.data[idx + 2] = b;
        this.data[idx + 3] = a;
        return true;
    }
    
    getVoxel(x, y, z) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size || z < 0 || z >= this.size) {
            return null;
        }
        const idx = (x + y * this.size + z * this.size * this.size) * 4;
        return {
            r: this.data[idx],
            g: this.data[idx + 1],
            b: this.data[idx + 2],
            a: this.data[idx + 3]
        };
    }
    
    removeVoxel(x, y, z) {
        return this.setVoxel(x, y, z, 0, 0, 0, 0);
    }
    
    countVoxels() {
        this.voxelCount = 0;
        for (let i = 3; i < this.data.length; i += 4) {
            if (this.data[i] > 0) this.voxelCount++;
        }
        return this.voxelCount;
    }
    
    resize(newSize) {
        this.size = newSize;
        this.data = new Uint8Array(newSize * newSize * newSize * 4);
        this.voxelCount = 0;
    }
}

// ============================================================================
// Main Engine Class
// ============================================================================

class VoxelEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2');
        
        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }
        
        // Settings
        this.settings = {
            maxSteps: 256,
            showNormals: false,
            enableShadows: true,
            fogDensity: 1.5,
            skyColorTop: [0.1, 0.1, 0.44],
            skyColorBottom: [0.53, 0.81, 0.92],
            lightDirection: this._normalize([0.5, 0.8, 0.3])
        };
        
        // Components
        this.camera = new Camera();
        this.world = null;
        
        // WebGL resources
        this.program = null;
        this.vao = null;
        this.voxelTexture = null;
        this.locations = {};
        
        // Initialize
        this._initWebGL();
    }
    
    _normalize(v) {
        const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
        return [v[0]/len, v[1]/len, v[2]/len];
    }
    
    _createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compile error: ' + error);
        }
        return shader;
    }
    
    _createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;
        const vertexShader = this._createShader(gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this._createShader(gl.FRAGMENT_SHADER, fragmentSource);
        
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = gl.getProgramInfoLog(program);
            throw new Error('Program link error: ' + error);
        }
        return program;
    }
    
    _initWebGL() {
        const gl = this.gl;
        
        // Compile shaders
        this.program = this._createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
        
        // Get uniform/attribute locations
        this.locations = {
            a_position: gl.getAttribLocation(this.program, 'a_position'),
            u_voxelData: gl.getUniformLocation(this.program, 'u_voxelData'),
            u_cameraPos: gl.getUniformLocation(this.program, 'u_cameraPos'),
            u_cameraDir: gl.getUniformLocation(this.program, 'u_cameraDir'),
            u_cameraUp: gl.getUniformLocation(this.program, 'u_cameraUp'),
            u_cameraRight: gl.getUniformLocation(this.program, 'u_cameraRight'),
            u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            u_fov: gl.getUniformLocation(this.program, 'u_fov'),
            u_worldSize: gl.getUniformLocation(this.program, 'u_worldSize'),
            u_maxSteps: gl.getUniformLocation(this.program, 'u_maxSteps'),
            u_showNormals: gl.getUniformLocation(this.program, 'u_showNormals'),
            u_enableShadows: gl.getUniformLocation(this.program, 'u_enableShadows'),
            u_lightDir: gl.getUniformLocation(this.program, 'u_lightDir'),
            u_skyColorTop: gl.getUniformLocation(this.program, 'u_skyColorTop'),
            u_skyColorBottom: gl.getUniformLocation(this.program, 'u_skyColorBottom'),
            u_fogDensity: gl.getUniformLocation(this.program, 'u_fogDensity'),
        };
        
        // Create fullscreen quad
        const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
        
        // Create VAO
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.enableVertexAttribArray(this.locations.a_position);
        gl.vertexAttribPointer(this.locations.a_position, 2, gl.FLOAT, false, 0, 0);
    }
    
    createWorld(size) {
        this.world = new VoxelWorld(size);
        this._createVoxelTexture();
        return this.world;
    }
    
    _createVoxelTexture() {
        const gl = this.gl;
        
        if (this.voxelTexture) {
            gl.deleteTexture(this.voxelTexture);
        }
        
        this.voxelTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, this.voxelTexture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        
        const size = this.world.size;
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.world.data);
    }
    
    uploadWorld() {
        if (!this.world) return;
        
        const gl = this.gl;
        const size = this.world.size;
        
        gl.bindTexture(gl.TEXTURE_3D, this.voxelTexture);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, size, size, size, gl.RGBA, gl.UNSIGNED_BYTE, this.world.data);
        
        this.world.countVoxels();
    }
    
    setWorldSize(size) {
        if (this.world) {
            this.world.resize(size);
        } else {
            this.createWorld(size);
        }
        this._createVoxelTexture();
    }
    
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }
    
    render() {
        if (!this.world) return;
        
        const gl = this.gl;
        const camera = this.camera;
        
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        
        // Bind voxel texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, this.voxelTexture);
        gl.uniform1i(this.locations.u_voxelData, 0);
        
        // Camera uniforms
        gl.uniform3fv(this.locations.u_cameraPos, camera.position);
        gl.uniform3fv(this.locations.u_cameraDir, camera.getDirection());
        gl.uniform3fv(this.locations.u_cameraUp, camera.getUp());
        gl.uniform3fv(this.locations.u_cameraRight, camera.getRight());
        gl.uniform1f(this.locations.u_fov, camera.fov);
        
        // Resolution
        gl.uniform2f(this.locations.u_resolution, this.canvas.width, this.canvas.height);
        
        // World
        gl.uniform1f(this.locations.u_worldSize, this.world.size);
        
        // Settings
        gl.uniform1i(this.locations.u_maxSteps, this.settings.maxSteps);
        gl.uniform1i(this.locations.u_showNormals, this.settings.showNormals ? 1 : 0);
        gl.uniform1i(this.locations.u_enableShadows, this.settings.enableShadows ? 1 : 0);
        gl.uniform3fv(this.locations.u_lightDir, this.settings.lightDirection);
        gl.uniform3fv(this.locations.u_skyColorTop, this.settings.skyColorTop);
        gl.uniform3fv(this.locations.u_skyColorBottom, this.settings.skyColorBottom);
        gl.uniform1f(this.locations.u_fogDensity, this.settings.fogDensity);
        
        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    // Utility methods
    getResolution() {
        return { width: this.canvas.width, height: this.canvas.height };
    }
    
    getVoxelCount() {
        return this.world ? this.world.voxelCount : 0;
    }
    
    getWorldSize() {
        return this.world ? this.world.size : 0;
    }
}

// ============================================================================
// Export for module usage
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoxelEngine, VoxelWorld, Camera };
}
