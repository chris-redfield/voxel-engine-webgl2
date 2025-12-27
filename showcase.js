/**
 * Voxel Ray Traversal Engine v2.1
 * Showcase Demo
 * 
 * Phase 2: Updated for Brick Map hierarchy
 */

// ============================================================================
// Scene Generators (Updated for larger worlds)
// ============================================================================

const SceneGenerators = {
    demo(world) {
        const size = world.worldSize;
        world.clear();
        
        // Ground plane with checkerboard pattern
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const color = ((x + z) % 2 === 0) ? [58, 90, 64] : [88, 129, 87];
                world.setVoxel(x, 0, z, ...color);
            }
        }
        
        // Colored structures/columns
        const structures = [
            { x: size * 0.3, z: size * 0.3, h: size * 0.4, color: [233, 57, 70] },
            { x: size * 0.6, z: size * 0.45, h: size * 0.55, color: [69, 123, 157] },
            { x: size * 0.45, z: size * 0.75, h: size * 0.35, color: [244, 162, 97] },
            { x: size * 0.75, z: size * 0.25, h: size * 0.5, color: [42, 157, 143] },
            { x: size * 0.25, z: size * 0.7, h: size * 0.3, color: [233, 196, 106] },
        ];
        
        for (const s of structures) {
            const w = Math.max(2, Math.floor(size * 0.04));
            for (let y = 1; y <= s.h; y++) {
                for (let dx = -w; dx <= w; dx++) {
                    for (let dz = -w; dz <= w; dz++) {
                        world.setVoxel(Math.floor(s.x) + dx, y, Math.floor(s.z) + dz, ...s.color);
                    }
                }
            }
        }
        
        // Scattered random voxels
        const colors = [
            [155, 34, 38], [174, 32, 18], [187, 62, 3], 
            [202, 103, 2], [238, 155, 0]
        ];
        const scatterCount = Math.floor(size * size * 0.01);
        for (let i = 0; i < scatterCount; i++) {
            const x = Math.floor(Math.random() * size);
            const y = Math.floor(Math.random() * size * 0.1) + 1;
            const z = Math.floor(Math.random() * size);
            const color = colors[Math.floor(Math.random() * colors.length)];
            world.setVoxel(x, y, z, ...color);
        }
    },
    
    sphere(world) {
        const size = world.worldSize;
        world.clear();
        
        const cx = size / 2, cy = size / 2, cz = size / 2;
        const radius = size / 2 - 2;
        const thickness = Math.max(2, size * 0.04);
        
        // Only iterate near the sphere surface for efficiency
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                for (let z = 0; z < size; z++) {
                    const dx = x - cx, dy = y - cy, dz = z - cz;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    
                    if (dist <= radius && dist >= radius - thickness) {
                        const r = Math.floor((x / size) * 127 + 128);
                        const g = Math.floor((y / size) * 127 + 128);
                        const b = Math.floor((z / size) * 127 + 128);
                        world.setVoxel(x, y, z, r, g, b);
                    }
                }
            }
        }
    },
    
    terrain(world) {
        const size = world.worldSize;
        world.clear();
        
        const scale = 8 / size;  // Adjust scale based on world size
        
        // Generate heightmap terrain
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                // Multi-octave noise
                const noise1 = Math.sin(x * scale * 2) * Math.cos(z * scale * 2);
                const noise2 = Math.sin(x * scale * 4 + 1) * Math.cos(z * scale * 4 + 1) * 0.5;
                const noise3 = Math.sin(x * scale * 8 + 2) * Math.cos(z * scale * 8 + 2) * 0.25;
                const height = Math.floor(((noise1 + noise2 + noise3) / 1.75 * 0.5 + 0.5) * size * 0.35) + 1;
                
                for (let y = 0; y < height; y++) {
                    let color;
                    if (y === height - 1) {
                        color = [74, 124, 89]; // Grass
                    } else if (y > height - 4) {
                        color = [139, 94, 60]; // Dirt
                    } else {
                        color = [107, 107, 107]; // Stone
                    }
                    world.setVoxel(x, y, z, ...color);
                }
            }
        }
        
        // Add trees
        const numTrees = Math.floor(size * size * 0.0005);
        for (let i = 0; i < numTrees; i++) {
            const tx = Math.floor(Math.random() * (size - 6)) + 3;
            const tz = Math.floor(Math.random() * (size - 6)) + 3;
            
            // Find ground height
            let groundY = 0;
            for (let y = size - 1; y >= 0; y--) {
                const voxel = world.getVoxel(tx, y, tz);
                if (voxel && voxel.a > 0) {
                    groundY = y;
                    break;
                }
            }
            
            if (groundY < 2) continue;
            
            const treeHeight = Math.floor(Math.random() * 5) + 5;
            
            // Trunk
            for (let y = groundY + 1; y < groundY + treeHeight + 1; y++) {
                world.setVoxel(tx, y, tz, 93, 64, 55);
            }
            
            // Leaves
            const leafY = groundY + treeHeight;
            const leafRadius = Math.floor(Math.random() * 2) + 2;
            for (let dx = -leafRadius; dx <= leafRadius; dx++) {
                for (let dy = 0; dy <= leafRadius; dy++) {
                    for (let dz = -leafRadius; dz <= leafRadius; dz++) {
                        if (Math.abs(dx) + Math.abs(dz) + dy <= leafRadius + 1) {
                            world.setVoxel(tx + dx, leafY + dy, tz + dz, 46, 125, 50);
                        }
                    }
                }
            }
        }
    },
    
    city(world) {
        const size = world.worldSize;
        world.clear();
        
        // Ground (asphalt)
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                world.setVoxel(x, 0, z, 66, 66, 66);
            }
        }
        
        // Buildings on grid
        const gridSize = Math.max(8, Math.floor(size / 16));
        const buildingColors = [
            [120, 144, 156], [144, 164, 174], [176, 190, 197], 
            [96, 125, 139], [69, 90, 100]
        ];
        
        for (let gx = 1; gx < size / gridSize - 1; gx++) {
            for (let gz = 1; gz < size / gridSize - 1; gz++) {
                if (Math.random() > 0.25) {
                    const bx = gx * gridSize + Math.floor(gridSize * 0.1);
                    const bz = gz * gridSize + Math.floor(gridSize * 0.1);
                    const maxHeight = Math.floor(size * 0.6);
                    const height = Math.floor(Math.random() * maxHeight) + Math.floor(size * 0.05);
                    const width = Math.floor(Math.random() * 3) + Math.max(3, Math.floor(gridSize * 0.4));
                    
                    const color = buildingColors[Math.floor(Math.random() * buildingColors.length)];
                    
                    for (let y = 1; y <= height; y++) {
                        for (let dx = 0; dx < width; dx++) {
                            for (let dz = 0; dz < width; dz++) {
                                // Windows on every 3rd-4th floor
                                const floorInterval = Math.max(3, Math.floor(size / 64));
                                const isWindow = (y % floorInterval === 0) && ((dx + dz) % 2 === 0);
                                const voxelColor = isWindow ? [255, 245, 157] : color;
                                world.setVoxel(bx + dx, y, bz + dz, ...voxelColor);
                            }
                        }
                    }
                }
            }
        }
    }
};

// ============================================================================
// Input Handler
// ============================================================================

class InputHandler {
    constructor(canvas) {
        this.canvas = canvas;
        this.keys = {};
        this.isLocked = false;
        this.mouseDelta = { x: 0, y: 0 };
        this.wheelDelta = 0;
        
        this._setupEventListeners();
    }
    
    _setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Escape' && this.isLocked) {
                document.exitPointerLock();
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
        
        this.canvas.addEventListener('click', () => {
            if (!this.isLocked) {
                this.canvas.requestPointerLock();
            }
        });
        
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.canvas;
            this._onPointerLockChange(this.isLocked);
        });
        
        document.addEventListener('mousemove', (e) => {
            if (this.isLocked) {
                this.mouseDelta.x += e.movementX;
                this.mouseDelta.y += e.movementY;
            }
        });
        
        this.canvas.addEventListener('wheel', (e) => {
            this.wheelDelta += e.deltaY;
        });
    }
    
    _onPointerLockChange(locked) {}
    
    getMouseDelta() {
        const delta = { x: this.mouseDelta.x, y: this.mouseDelta.y };
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
        return delta;
    }
    
    getWheelDelta() {
        const delta = this.wheelDelta;
        this.wheelDelta = 0;
        return delta;
    }
    
    isKeyPressed(code) {
        return !!this.keys[code];
    }
}

// ============================================================================
// Stats Tracker
// ============================================================================

class StatsTracker {
    constructor() {
        this.fps = 0;
        this.frameTime = 0;
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
    }
    
    update() {
        this.frameCount++;
        const now = performance.now();
        
        if (now - this.lastFpsTime >= 1000) {
            this.fps = this.frameCount;
            this.frameTime = 1000 / Math.max(1, this.fps);
            this.frameCount = 0;
            this.lastFpsTime = now;
        }
    }
}

// ============================================================================
// Showcase Application
// ============================================================================

class ShowcaseApp {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.engine = new VoxelEngine(this.canvas);
        this.input = new InputHandler(this.canvas);
        this.stats = new StatsTracker();
        
        // Settings
        this.resolutionScale = 1.0;
        this.coarseSize = 64;  // 64³ coarse grid × 8³ bricks = 512³ world
        this.currentScene = 'demo';
        
        // Setup
        this._setupInputCallbacks();
        this._setupUI();
        this._initWorld();
        
        // Handle resize
        window.addEventListener('resize', () => this._handleResize());
        this._handleResize();
    }
    
    _setupInputCallbacks() {
        this.input._onPointerLockChange = (locked) => {
            const overlay = document.getElementById('overlay');
            const crosshair = document.querySelector('.crosshair');
            const container = this.canvas.parentElement;
            
            if (overlay) overlay.classList.toggle('hidden', locked);
            if (crosshair) crosshair.classList.toggle('visible', locked);
            if (container) container.classList.toggle('locked', locked);
        };
    }
    
    _setupUI() {
        // Resolution scale
        const resolutionSlider = document.getElementById('resolution');
        if (resolutionSlider) {
            resolutionSlider.addEventListener('input', (e) => {
                this.resolutionScale = parseFloat(e.target.value);
                document.getElementById('resolution-val').textContent = this.resolutionScale + 'x';
                this._handleResize();
            });
        }
        
        // World size (coarse grid size)
        const worldSizeSelect = document.getElementById('world-size');
        if (worldSizeSelect) {
            worldSizeSelect.addEventListener('change', (e) => {
                this.coarseSize = parseInt(e.target.value);
                this._initWorld();
            });
        }
        
        // Max steps
        const maxStepsSlider = document.getElementById('max-steps');
        if (maxStepsSlider) {
            maxStepsSlider.addEventListener('input', (e) => {
                this.engine.settings.maxSteps = parseInt(e.target.value);
                document.getElementById('max-steps-val').textContent = e.target.value;
            });
        }
        
        // FOV
        const fovSlider = document.getElementById('fov');
        if (fovSlider) {
            fovSlider.addEventListener('input', (e) => {
                this.engine.camera.fov = parseInt(e.target.value);
                document.getElementById('fov-val').textContent = e.target.value + '°';
            });
        }
        
        // Scene select
        const sceneSelect = document.getElementById('scene');
        if (sceneSelect) {
            sceneSelect.addEventListener('change', (e) => {
                this.currentScene = e.target.value;
                this._loadScene(this.currentScene);
            });
        }
        
        // Show normals
        const showNormalsCheckbox = document.getElementById('show-normals');
        if (showNormalsCheckbox) {
            showNormalsCheckbox.addEventListener('change', (e) => {
                this.engine.settings.showNormals = e.target.checked;
            });
        }
        
        // Enable shadows
        const enableShadowsCheckbox = document.getElementById('enable-shadows');
        if (enableShadowsCheckbox) {
            enableShadowsCheckbox.addEventListener('change', (e) => {
                this.engine.settings.enableShadows = e.target.checked;
            });
        }
    }
    
    _initWorld() {
        console.log(`Creating world: ${this.coarseSize}³ coarse grid (${this.coarseSize * 8}³ voxels)`);
        this.engine.createWorld(this.coarseSize, 8);
        this._loadScene(this.currentScene);
    }
    
    _loadScene(sceneName) {
        console.log(`Loading scene: ${sceneName}`);
        const startTime = performance.now();
        
        const generator = SceneGenerators[sceneName];
        if (generator) {
            generator(this.engine.world);
            this.engine.uploadWorld();
            
            // Reset camera position
            const size = this.engine.world.worldSize;
            this.engine.camera.setPosition(size / 2, size * 0.6, -size * 0.2);
            this.engine.camera.yaw = 0;
            this.engine.camera.pitch = -0.3;
            this.engine.camera.moveSpeed = size * 0.5;  // Scale speed with world size
        }
        
        const elapsed = performance.now() - startTime;
        console.log(`Scene loaded in ${elapsed.toFixed(0)}ms - ${this.engine.getVoxelCount().toLocaleString()} voxels in ${this.engine.getBrickCount()} bricks`);
    }
    
    _handleResize() {
        const container = this.canvas.parentElement;
        const width = Math.floor(container.clientWidth * this.resolutionScale);
        const height = Math.floor(container.clientHeight * this.resolutionScale);
        this.engine.resize(width, height);
    }
    
    _updateCamera(deltaTime) {
        const camera = this.engine.camera;
        const input = this.input;
        const speed = camera.moveSpeed * deltaTime;
        
        if (input.isKeyPressed('KeyW')) camera.moveForward(speed);
        if (input.isKeyPressed('KeyS')) camera.moveForward(-speed);
        if (input.isKeyPressed('KeyA')) camera.moveRight(-speed);
        if (input.isKeyPressed('KeyD')) camera.moveRight(speed);
        if (input.isKeyPressed('KeyQ')) camera.moveUp(-speed);
        if (input.isKeyPressed('KeyE')) camera.moveUp(speed);
        
        // Shift for faster movement
        if (input.isKeyPressed('ShiftLeft')) {
            camera.moveSpeed = this.engine.world.worldSize;
        } else {
            camera.moveSpeed = this.engine.world.worldSize * 0.5;
        }
        
        const mouseDelta = input.getMouseDelta();
        camera.rotate(mouseDelta.x * camera.lookSpeed, mouseDelta.y * camera.lookSpeed);
        
        const wheelDelta = input.getWheelDelta();
        if (wheelDelta !== 0) {
            camera.fov = Math.max(30, Math.min(120, camera.fov + wheelDelta * 0.05));
            const fovSlider = document.getElementById('fov');
            const fovVal = document.getElementById('fov-val');
            if (fovSlider) fovSlider.value = camera.fov;
            if (fovVal) fovVal.textContent = Math.round(camera.fov) + '°';
        }
    }
    
    _updateStats() {
        this.stats.update();
        
        const camera = this.engine.camera;
        const dir = camera.getDirection();
        const res = this.engine.getResolution();
        const mem = this.engine.getMemoryUsage();
        
        const elements = {
            'fps': this.stats.fps,
            'frame-time': this.stats.frameTime.toFixed(1) + ' ms',
            'resolution-display': `${res.width} x ${res.height}`,
            'voxel-count': this.engine.getVoxelCount().toLocaleString(),
            'brick-count': this.engine.getBrickCount().toLocaleString(),
            'world-size-display': `${this.engine.getWorldSize()}³`,
            'memory-usage': mem.totalMB.toFixed(2) + ' MB',
            'cam-pos': `(${camera.position[0].toFixed(0)}, ${camera.position[1].toFixed(0)}, ${camera.position[2].toFixed(0)})`,
            'cam-dir': `(${dir[0].toFixed(2)}, ${dir[1].toFixed(2)}, ${dir[2].toFixed(2)})`
        };
        
        for (const [id, value] of Object.entries(elements)) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }
    }
    
    run() {
        let lastTime = performance.now();
        
        const gameLoop = () => {
            const now = performance.now();
            const deltaTime = (now - lastTime) / 1000;
            lastTime = now;
            
            this._updateCamera(deltaTime);
            this.engine.render();
            this._updateStats();
            
            requestAnimationFrame(gameLoop);
        };
        
        gameLoop();
    }
}

// ============================================================================
// Export
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShowcaseApp, SceneGenerators, InputHandler, StatsTracker };
}
