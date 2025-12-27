/**
 * Voxel Ray Traversal Engine v2.1
 * WebGL2 GPU-Accelerated Voxel Renderer
 * 
 * Phase 2: Brick Map Hierarchy
 * - 2-level structure: Coarse Grid → 8³ Bricks
 * - Sparse storage: only occupied regions use memory
 * - O(1) empty space skipping at coarse level
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
precision highp usampler3D;

in vec2 v_uv;
out vec4 fragColor;

// Brick map textures
uniform usampler3D u_coarseGrid;    // Coarse grid: stores brick indices (0 = empty)
uniform sampler3D u_brickAtlas;      // Brick atlas: packed 8³ bricks

// Brick map parameters
uniform vec3 u_coarseGridSize;       // Size of coarse grid (e.g., 64³)
uniform vec3 u_atlasSize;            // Size of brick atlas in bricks (e.g., 32x32x32 bricks)
uniform int u_brickSize;             // Size of each brick (8)

// Camera & rendering
uniform vec3 u_cameraPos;
uniform vec3 u_cameraDir;
uniform vec3 u_cameraUp;
uniform vec3 u_cameraRight;
uniform vec2 u_resolution;
uniform float u_fov;
uniform int u_maxSteps;
uniform int u_showNormals;
uniform int u_enableShadows;
uniform vec3 u_lightDir;
uniform vec3 u_skyColorTop;
uniform vec3 u_skyColorBottom;
uniform float u_fogDensity;

// Constants
const int BRICK_SIZE = 8;

// Get world size in voxels
vec3 getWorldSize() {
    return u_coarseGridSize * float(BRICK_SIZE);
}

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

// Get brick index from coarse grid (0 = empty, >0 = brick index)
uint getBrickIndex(ivec3 coarsePos) {
    if (coarsePos.x < 0 || coarsePos.y < 0 || coarsePos.z < 0 ||
        coarsePos.x >= int(u_coarseGridSize.x) || 
        coarsePos.y >= int(u_coarseGridSize.y) || 
        coarsePos.z >= int(u_coarseGridSize.z)) {
        return 0u;
    }
    return texelFetch(u_coarseGrid, coarsePos, 0).r;
}

// Convert brick index to atlas position
ivec3 brickIndexToAtlasPos(uint brickIndex) {
    int idx = int(brickIndex) - 1; // brick indices are 1-based (0 = empty)
    int atlasWidth = int(u_atlasSize.x);
    int atlasHeight = int(u_atlasSize.y);
    int x = idx % atlasWidth;
    int y = (idx / atlasWidth) % atlasHeight;
    int z = idx / (atlasWidth * atlasHeight);
    return ivec3(x, y, z);
}

// Get voxel from brick atlas
vec4 getVoxelFromBrick(uint brickIndex, ivec3 localPos) {
    if (brickIndex == 0u) return vec4(0.0);
    
    ivec3 atlasPos = brickIndexToAtlasPos(brickIndex);
    ivec3 texelPos = atlasPos * BRICK_SIZE + localPos;
    return texelFetch(u_brickAtlas, texelPos, 0);
}

// Hit result structure
struct HitResult {
    bool hit;
    vec3 pos;
    vec3 normal;
    vec4 color;
    float distance;
    int steps;
};

// DDA through a single brick
bool traceBrick(uint brickIndex, vec3 rayOrigin, vec3 rayDir, 
                ivec3 coarsePos, inout HitResult result) {
    
    // Brick bounds in world space
    vec3 brickMin = vec3(coarsePos * BRICK_SIZE);
    vec3 brickMax = brickMin + float(BRICK_SIZE);
    
    // Find entry point into brick
    vec2 tBox = intersectAABB(rayOrigin, rayDir, brickMin, brickMax);
    if (tBox.x > tBox.y || tBox.y < 0.0) return false;
    
    float tStart = max(0.0, tBox.x) + 0.001;
    vec3 startPos = rayOrigin + rayDir * tStart;
    
    // Local position within brick
    vec3 localStart = startPos - brickMin;
    ivec3 mapPos = ivec3(floor(localStart));
    mapPos = clamp(mapPos, ivec3(0), ivec3(BRICK_SIZE - 1));
    
    // DDA setup
    ivec3 step = ivec3(sign(rayDir));
    vec3 deltaDist = abs(vec3(1.0) / rayDir);
    vec3 sideDist = (sign(rayDir) * (vec3(mapPos) - localStart) + (sign(rayDir) * 0.5) + 0.5) * deltaDist;
    
    int side = 0;
    
    // DDA through brick
    for (int i = 0; i < BRICK_SIZE * 3; i++) {
        // Check voxel
        vec4 voxel = getVoxelFromBrick(brickIndex, mapPos);
        if (voxel.a > 0.0) {
            result.hit = true;
            result.color = voxel;
            result.pos = brickMin + vec3(mapPos);
            
            // Normal based on side
            result.normal = vec3(0.0);
            if (side == 0) result.normal.x = -float(step.x);
            else if (side == 1) result.normal.y = -float(step.y);
            else result.normal.z = -float(step.z);
            
            // Distance calculation
            vec3 worldPos = brickMin + vec3(mapPos);
            if (side == 0) result.distance = (worldPos.x - rayOrigin.x + (1.0 - float(step.x)) / 2.0) / rayDir.x;
            else if (side == 1) result.distance = (worldPos.y - rayOrigin.y + (1.0 - float(step.y)) / 2.0) / rayDir.y;
            else result.distance = (worldPos.z - rayOrigin.z + (1.0 - float(step.z)) / 2.0) / rayDir.z;
            
            return true;
        }
        
        // DDA step
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
        
        // Exit brick bounds
        if (mapPos.x < 0 || mapPos.x >= BRICK_SIZE ||
            mapPos.y < 0 || mapPos.y >= BRICK_SIZE ||
            mapPos.z < 0 || mapPos.z >= BRICK_SIZE) {
            break;
        }
    }
    
    return false;
}

// Main ray trace - 2-level DDA
HitResult traceRay(vec3 origin, vec3 direction) {
    HitResult result;
    result.hit = false;
    result.steps = 0;
    result.normal = vec3(0.0);
    
    vec3 worldSize = getWorldSize();
    
    // Intersect with world bounds
    vec2 tBox = intersectAABB(origin, direction, vec3(0.0), worldSize);
    if (tBox.x > tBox.y || tBox.y < 0.0) {
        return result;
    }
    
    float tStart = max(0.0, tBox.x) + 0.001;
    vec3 startPos = origin + direction * tStart;
    
    // Coarse grid position
    vec3 coarseStart = startPos / float(BRICK_SIZE);
    ivec3 coarsePos = ivec3(floor(coarseStart));
    coarsePos = clamp(coarsePos, ivec3(0), ivec3(u_coarseGridSize) - 1);
    
    // DDA setup for coarse grid
    ivec3 step = ivec3(sign(direction));
    vec3 deltaDist = abs(vec3(float(BRICK_SIZE)) / direction);
    vec3 sideDist = (sign(direction) * (vec3(coarsePos) - coarseStart) + (sign(direction) * 0.5) + 0.5) * deltaDist;
    
    // Coarse grid DDA
    for (int i = 0; i < 512; i++) {
        if (i >= u_maxSteps) break;
        result.steps = i + 1;
        
        // Check if brick exists at this coarse position
        uint brickIndex = getBrickIndex(coarsePos);
        
        if (brickIndex > 0u) {
            // Trace through the brick
            if (traceBrick(brickIndex, origin, direction, coarsePos, result)) {
                return result;
            }
        }
        
        // DDA step to next coarse cell
        if (sideDist.x < sideDist.y) {
            if (sideDist.x < sideDist.z) {
                sideDist.x += deltaDist.x;
                coarsePos.x += step.x;
            } else {
                sideDist.z += deltaDist.z;
                coarsePos.z += step.z;
            }
        } else {
            if (sideDist.y < sideDist.z) {
                sideDist.y += deltaDist.y;
                coarsePos.y += step.y;
            } else {
                sideDist.z += deltaDist.z;
                coarsePos.z += step.z;
            }
        }
        
        // Check bounds
        if (coarsePos.x < 0 || coarsePos.x >= int(u_coarseGridSize.x) ||
            coarsePos.y < 0 || coarsePos.y >= int(u_coarseGridSize.y) ||
            coarsePos.z < 0 || coarsePos.z >= int(u_coarseGridSize.z)) {
            break;
        }
    }
    
    return result;
}

// Shadow ray (simplified - just check for any hit)
float traceShadow(vec3 origin, vec3 direction) {
    vec3 worldSize = getWorldSize();
    vec3 startPos = origin + direction * 0.5;
    
    vec3 coarseStart = startPos / float(BRICK_SIZE);
    ivec3 coarsePos = ivec3(floor(coarseStart));
    
    ivec3 step = ivec3(sign(direction));
    vec3 deltaDist = abs(vec3(float(BRICK_SIZE)) / direction);
    vec3 sideDist = (sign(direction) * (vec3(coarsePos) - coarseStart) + (sign(direction) * 0.5) + 0.5) * deltaDist;
    
    HitResult tempResult;
    tempResult.hit = false;
    
    for (int i = 0; i < 64; i++) {
        if (coarsePos.x < 0 || coarsePos.x >= int(u_coarseGridSize.x) ||
            coarsePos.y < 0 || coarsePos.y >= int(u_coarseGridSize.y) ||
            coarsePos.z < 0 || coarsePos.z >= int(u_coarseGridSize.z)) {
            return 1.0;
        }
        
        uint brickIndex = getBrickIndex(coarsePos);
        if (brickIndex > 0u) {
            if (traceBrick(brickIndex, origin, direction, coarsePos, tempResult)) {
                return 0.3;
            }
        }
        
        if (sideDist.x < sideDist.y) {
            if (sideDist.x < sideDist.z) {
                sideDist.x += deltaDist.x;
                coarsePos.x += step.x;
            } else {
                sideDist.z += deltaDist.z;
                coarsePos.z += step.z;
            }
        } else {
            if (sideDist.y < sideDist.z) {
                sideDist.y += deltaDist.y;
                coarsePos.y += step.y;
            } else {
                sideDist.z += deltaDist.z;
                coarsePos.z += step.z;
            }
        }
    }
    
    return 1.0;
}

void main() {
    // Calculate ray direction
    float aspectRatio = u_resolution.x / u_resolution.y;
    float fovRad = u_fov * 3.14159265 / 180.0;
    float halfHeight = tan(fovRad / 2.0);
    float halfWidth = aspectRatio * halfHeight;
    
    vec2 ndc = v_uv * 2.0 - 1.0;
    vec3 rayDir = normalize(u_cameraDir + u_cameraRight * ndc.x * halfWidth + u_cameraUp * ndc.y * halfHeight);
    
    // Trace primary ray
    HitResult hit = traceRay(u_cameraPos, rayDir);
    
    vec3 color;
    vec3 worldSize = getWorldSize();
    
    if (hit.hit) {
        if (u_showNormals == 1) {
            color = hit.normal * 0.5 + 0.5;
        } else {
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
            float fog = clamp(hit.distance * u_fogDensity / worldSize.x, 0.0, 1.0);
            vec3 fogColor = mix(u_skyColorTop, u_skyColorBottom, 0.5);
            
            color = baseColor * diffuse * shadow;
            color = mix(color, fogColor, fog * 0.8);
        }
    } else {
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
        return [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
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
// Brick Map World Class
// ============================================================================

class BrickMapWorld {
    constructor(coarseSize, brickSize = 8) {
        this.coarseSize = coarseSize;  // e.g., 64 for 64³ coarse grid
        this.brickSize = brickSize;     // 8 for 8³ bricks
        this.worldSize = coarseSize * brickSize;  // Effective voxel resolution
        
        // Coarse grid: stores brick indices (0 = empty, 1+ = brick index)
        this.coarseGrid = new Uint32Array(coarseSize * coarseSize * coarseSize);
        
        // Brick storage
        this.bricks = new Map();  // Map<brickIndex, Uint8Array>
        this.nextBrickIndex = 1;
        
        // Atlas configuration
        this.atlasSize = 64;  // 64³ bricks = up to 262,144 bricks
        this.brickAtlasData = null;
        
        // Stats
        this.voxelCount = 0;
        this.brickCount = 0;
    }
    
    _getCoarseIndex(cx, cy, cz) {
        if (cx < 0 || cx >= this.coarseSize || 
            cy < 0 || cy >= this.coarseSize || 
            cz < 0 || cz >= this.coarseSize) {
            return -1;
        }
        return cx + cy * this.coarseSize + cz * this.coarseSize * this.coarseSize;
    }
    
    _worldToCoarse(x, y, z) {
        return [
            Math.floor(x / this.brickSize),
            Math.floor(y / this.brickSize),
            Math.floor(z / this.brickSize)
        ];
    }
    
    _worldToLocal(x, y, z) {
        return [
            x % this.brickSize,
            y % this.brickSize,
            z % this.brickSize
        ];
    }
    
    _getBrickLocalIndex(lx, ly, lz) {
        return (lx + ly * this.brickSize + lz * this.brickSize * this.brickSize) * 4;
    }
    
    _getOrCreateBrick(cx, cy, cz) {
        const coarseIdx = this._getCoarseIndex(cx, cy, cz);
        if (coarseIdx < 0) return null;
        
        let brickIndex = this.coarseGrid[coarseIdx];
        
        if (brickIndex === 0) {
            // Create new brick
            brickIndex = this.nextBrickIndex++;
            this.coarseGrid[coarseIdx] = brickIndex;
            
            // Allocate brick data (8³ × 4 bytes RGBA)
            const brickData = new Uint8Array(this.brickSize * this.brickSize * this.brickSize * 4);
            this.bricks.set(brickIndex, brickData);
            this.brickCount++;
        }
        
        return this.bricks.get(brickIndex);
    }
    
    setVoxel(x, y, z, r, g, b, a = 255) {
        if (x < 0 || x >= this.worldSize || 
            y < 0 || y >= this.worldSize || 
            z < 0 || z >= this.worldSize) {
            return false;
        }
        
        const [cx, cy, cz] = this._worldToCoarse(x, y, z);
        const [lx, ly, lz] = this._worldToLocal(x, y, z);
        
        const brick = this._getOrCreateBrick(cx, cy, cz);
        if (!brick) return false;
        
        const idx = this._getBrickLocalIndex(lx, ly, lz);
        brick[idx] = r;
        brick[idx + 1] = g;
        brick[idx + 2] = b;
        brick[idx + 3] = a;
        
        return true;
    }
    
    getVoxel(x, y, z) {
        if (x < 0 || x >= this.worldSize || 
            y < 0 || y >= this.worldSize || 
            z < 0 || z >= this.worldSize) {
            return null;
        }
        
        const [cx, cy, cz] = this._worldToCoarse(x, y, z);
        const coarseIdx = this._getCoarseIndex(cx, cy, cz);
        if (coarseIdx < 0) return null;
        
        const brickIndex = this.coarseGrid[coarseIdx];
        if (brickIndex === 0) return { r: 0, g: 0, b: 0, a: 0 };
        
        const brick = this.bricks.get(brickIndex);
        if (!brick) return null;
        
        const [lx, ly, lz] = this._worldToLocal(x, y, z);
        const idx = this._getBrickLocalIndex(lx, ly, lz);
        
        return {
            r: brick[idx],
            g: brick[idx + 1],
            b: brick[idx + 2],
            a: brick[idx + 3]
        };
    }
    
    clear() {
        this.coarseGrid.fill(0);
        this.bricks.clear();
        this.nextBrickIndex = 1;
        this.voxelCount = 0;
        this.brickCount = 0;
    }
    
    countVoxels() {
        this.voxelCount = 0;
        for (const brick of this.bricks.values()) {
            for (let i = 3; i < brick.length; i += 4) {
                if (brick[i] > 0) this.voxelCount++;
            }
        }
        return this.voxelCount;
    }
    
    // Build atlas texture data for GPU
    buildAtlas() {
        const atlasVoxelSize = this.atlasSize * this.brickSize;
        this.brickAtlasData = new Uint8Array(atlasVoxelSize * atlasVoxelSize * atlasVoxelSize * 4);
        
        for (const [brickIndex, brickData] of this.bricks) {
            const idx = brickIndex - 1;  // Convert to 0-based
            const ax = idx % this.atlasSize;
            const ay = Math.floor(idx / this.atlasSize) % this.atlasSize;
            const az = Math.floor(idx / (this.atlasSize * this.atlasSize));
            
            // Copy brick data to atlas
            for (let lz = 0; lz < this.brickSize; lz++) {
                for (let ly = 0; ly < this.brickSize; ly++) {
                    for (let lx = 0; lx < this.brickSize; lx++) {
                        const srcIdx = (lx + ly * this.brickSize + lz * this.brickSize * this.brickSize) * 4;
                        
                        const atlasX = ax * this.brickSize + lx;
                        const atlasY = ay * this.brickSize + ly;
                        const atlasZ = az * this.brickSize + lz;
                        const dstIdx = (atlasX + atlasY * atlasVoxelSize + atlasZ * atlasVoxelSize * atlasVoxelSize) * 4;
                        
                        this.brickAtlasData[dstIdx] = brickData[srcIdx];
                        this.brickAtlasData[dstIdx + 1] = brickData[srcIdx + 1];
                        this.brickAtlasData[dstIdx + 2] = brickData[srcIdx + 2];
                        this.brickAtlasData[dstIdx + 3] = brickData[srcIdx + 3];
                    }
                }
            }
        }
        
        return this.brickAtlasData;
    }
    
    getMemoryUsage() {
        const coarseBytes = this.coarseGrid.byteLength;
        const brickBytes = this.brickCount * this.brickSize * this.brickSize * this.brickSize * 4;
        return {
            coarseGrid: coarseBytes,
            bricks: brickBytes,
            total: coarseBytes + brickBytes,
            totalMB: (coarseBytes + brickBytes) / (1024 * 1024)
        };
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
        this.coarseGridTexture = null;
        this.brickAtlasTexture = null;
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
            u_coarseGrid: gl.getUniformLocation(this.program, 'u_coarseGrid'),
            u_brickAtlas: gl.getUniformLocation(this.program, 'u_brickAtlas'),
            u_coarseGridSize: gl.getUniformLocation(this.program, 'u_coarseGridSize'),
            u_atlasSize: gl.getUniformLocation(this.program, 'u_atlasSize'),
            u_brickSize: gl.getUniformLocation(this.program, 'u_brickSize'),
            u_cameraPos: gl.getUniformLocation(this.program, 'u_cameraPos'),
            u_cameraDir: gl.getUniformLocation(this.program, 'u_cameraDir'),
            u_cameraUp: gl.getUniformLocation(this.program, 'u_cameraUp'),
            u_cameraRight: gl.getUniformLocation(this.program, 'u_cameraRight'),
            u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            u_fov: gl.getUniformLocation(this.program, 'u_fov'),
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
    
    createWorld(coarseSize, brickSize = 8) {
        this.world = new BrickMapWorld(coarseSize, brickSize);
        this._createTextures();
        return this.world;
    }
    
    _createTextures() {
        const gl = this.gl;
        
        // Cleanup old textures
        if (this.coarseGridTexture) gl.deleteTexture(this.coarseGridTexture);
        if (this.brickAtlasTexture) gl.deleteTexture(this.brickAtlasTexture);
        
        // Create coarse grid texture (R32UI - unsigned int)
        this.coarseGridTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, this.coarseGridTexture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        
        const coarseSize = this.world.coarseSize;
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32UI, coarseSize, coarseSize, coarseSize, 
                      0, gl.RED_INTEGER, gl.UNSIGNED_INT, this.world.coarseGrid);
        
        // Create brick atlas texture (RGBA8)
        this.brickAtlasTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, this.brickAtlasTexture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        
        // Initialize empty atlas
        const atlasVoxelSize = this.world.atlasSize * this.world.brickSize;
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, atlasVoxelSize, atlasVoxelSize, atlasVoxelSize,
                      0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    
    uploadWorld() {
        if (!this.world) return;
        
        const gl = this.gl;
        
        // Upload coarse grid
        gl.bindTexture(gl.TEXTURE_3D, this.coarseGridTexture);
        const coarseSize = this.world.coarseSize;
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, coarseSize, coarseSize, coarseSize,
                         gl.RED_INTEGER, gl.UNSIGNED_INT, this.world.coarseGrid);
        
        // Build and upload brick atlas
        this.world.buildAtlas();
        gl.bindTexture(gl.TEXTURE_3D, this.brickAtlasTexture);
        const atlasVoxelSize = this.world.atlasSize * this.world.brickSize;
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, atlasVoxelSize, atlasVoxelSize, atlasVoxelSize,
                         gl.RGBA, gl.UNSIGNED_BYTE, this.world.brickAtlasData);
        
        this.world.countVoxels();
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
        
        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, this.coarseGridTexture);
        gl.uniform1i(this.locations.u_coarseGrid, 0);
        
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, this.brickAtlasTexture);
        gl.uniform1i(this.locations.u_brickAtlas, 1);
        
        // Brick map parameters
        const cs = this.world.coarseSize;
        gl.uniform3f(this.locations.u_coarseGridSize, cs, cs, cs);
        const as = this.world.atlasSize;
        gl.uniform3f(this.locations.u_atlasSize, as, as, as);
        gl.uniform1i(this.locations.u_brickSize, this.world.brickSize);
        
        // Camera uniforms
        gl.uniform3fv(this.locations.u_cameraPos, camera.position);
        gl.uniform3fv(this.locations.u_cameraDir, camera.getDirection());
        gl.uniform3fv(this.locations.u_cameraUp, camera.getUp());
        gl.uniform3fv(this.locations.u_cameraRight, camera.getRight());
        gl.uniform1f(this.locations.u_fov, camera.fov);
        
        // Resolution
        gl.uniform2f(this.locations.u_resolution, this.canvas.width, this.canvas.height);
        
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
    
    getBrickCount() {
        return this.world ? this.world.brickCount : 0;
    }
    
    getWorldSize() {
        return this.world ? this.world.worldSize : 0;
    }
    
    getCoarseSize() {
        return this.world ? this.world.coarseSize : 0;
    }
    
    getMemoryUsage() {
        return this.world ? this.world.getMemoryUsage() : { total: 0, totalMB: 0 };
    }
}

// ============================================================================
// Export
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoxelEngine, BrickMapWorld, Camera };
}
