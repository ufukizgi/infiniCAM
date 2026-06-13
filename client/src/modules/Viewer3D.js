import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Viewer3D — Three.js 3D viewer for STEP files.
 * Uses occt-import-js (CDN) via Web Worker to parse STEP,
 * then renders the resulting mesh with Three.js.
 */
export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.showEdges = true;
    this.isDisposed = false;
    this._worker = null;
    this._initThree();
  }

  _initThree() {
    const canvas = this.canvas;
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true, // needed for screenshot
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // Scene
    this.scene = new THREE.Scene();
    
    // SolidWorks-style Gradient Background Texture
    const canvasBg = document.createElement('canvas');
    canvasBg.width = 2;
    canvasBg.height = 512;
    const context = canvasBg.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#8ca0b3'); // Top (blue-grey)
    gradient.addColorStop(1, '#e3e7f0'); // Bottom (light-grey/white)
    context.fillStyle = gradient;
    context.fillRect(0, 0, 2, 512);
    const bgTexture = new THREE.CanvasTexture(canvasBg);
    bgTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bgTexture;

    // Lights (Neutral CAD lighting)
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(200, 400, 200);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-200, 100, -200);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, -200, 100);
    this.scene.add(rimLight);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
    this.camera.position.set(300, 200, 300);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 50000;

    // Resize
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas.parentElement);

    // Setup HUD Scene for Orientation Compass
    this.hudScene = new THREE.Scene();
    this.hudCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    // Add intersecting arrows for X, Y, Z
    const origin = new THREE.Vector3(0, 0, 0);
    const arrowX = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 15, 0xff0000, 4, 3);
    const arrowY = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, 15, 0x00ff00, 4, 3);
    const arrowZ = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, 15, 0x0088ff, 4, 3);
    this.hudScene.add(arrowX, arrowY, arrowZ);

    // Animate
    this._animate();
  }

  _animate() {
    this._rafId = requestAnimationFrame(() => this._animate());
    this.controls.update();
    
    // Copy main camera rotation and position the HUD camera
    this.hudCamera.position.copy(this.camera.position).sub(this.controls.target).normalize().multiplyScalar(50);
    this.hudCamera.quaternion.copy(this.camera.quaternion);

    const canvas = this.canvas;
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;

    this.renderer.autoClear = false;
    this.renderer.clear();

    // Render main scene
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.render(this.scene, this.camera);

    // Render HUD in bottom left corner
    const hudSize = 100;
    this.renderer.clearDepth(); // Clear depth so axes overlay on top of everything
    this.renderer.setViewport(10, 10, hudSize, hudSize);
    this.renderer.render(this.hudScene, this.hudCamera);
  }

  _onResize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /**
   * Load a STEP file from a URL using occt-import-js in a Web Worker.
   * @param {string} url - Authenticated URL to the STP file
   * @param {function} [onProgress] - Optional callback(message: string)
   */
  async loadSTP(url, onProgress) {
    return new Promise((resolve, reject) => {
      this._worker = new Worker(
        new URL('../workers/occt-worker.js', import.meta.url)
      );

      const token = localStorage.getItem('infinicam_token') || '';
      const baseUrl = import.meta.env.BASE_URL || '/';
      this._worker.postMessage({ type: 'load', url, token, baseUrl });

      this._worker.onmessage = (e) => {
        if (this.isDisposed) {
          this._worker.terminate();
          this._worker = null;
          return reject(new Error('Disposed'));
        }
        const { type, meshData, error, message } = e.data;
        if (type === 'progress' && onProgress) { onProgress(message); return; }
        if (type === 'error') { this._worker.terminate(); this._worker = null; reject(new Error(error)); return; }
        if (type === 'done')  { 
          this._worker.terminate(); 
          this._worker = null;
          this._buildMesh(meshData); 
          resolve(); 
        }
      };

      this._worker.onerror = (err) => {
        this._worker.terminate();
        this._worker = null;
        reject(new Error(err.message));
      };
    });
  }

  _buildMesh(meshData) {
    if (this._modelGroup) {
      this.scene.remove(this._modelGroup);
    }

    const group = new THREE.Group();
    this._modelGroup = group;

    const material = new THREE.MeshStandardMaterial({
      color: 0x8eabca,
      metalness: 0.65,
      roughness: 0.35,
      envMapIntensity: 0.8,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });

    for (const mesh of meshData.meshes) {
      const geo = new THREE.BufferGeometry();

      geo.setAttribute('position',
        new THREE.Float32BufferAttribute(mesh.vertices, 3));

      if (mesh.normals && mesh.normals.length > 0) {
        geo.setAttribute('normal',
          new THREE.Float32BufferAttribute(mesh.normals, 3));
      }

      if (mesh.indices && mesh.indices.length > 0) {
        geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
      }

      if (!mesh.normals || mesh.normals.length === 0) {
        geo.computeVertexNormals();
      }

      const threeMesh = new THREE.Mesh(geo, material.clone());
      
      const edgesGeo = new THREE.EdgesGeometry(geo, 15);
      const edgesMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 });
      const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat);
      edgesLine.isEdgeLine = true;
      edgesLine.visible = this.showEdges;
      threeMesh.add(edgesLine);

      group.add(threeMesh);
    }

    this.scene.add(group);

    // Center and fit camera
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    group.position.sub(center);

    const dist = maxDim * 2.0;
    this.camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    this.camera.near = maxDim * 0.001;
    this.camera.far = maxDim * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this._box = box;
    this._material = material;
  }

  resetCamera() {
    if (!this._box) return;
    const size = this._box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2.0;
    this.camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  toggleEdges() {
    this.showEdges = !this.showEdges;
    if (this._modelGroup) {
      this._modelGroup.traverse(obj => {
        if (obj.isEdgeLine) {
          obj.visible = this.showEdges;
        }
      });
    }
  }

  async captureScreenshot() {
    this.renderer.render(this.scene, this.camera);
    return new Promise(resolve => {
      this.canvas.toBlob(blob => resolve(blob), 'image/png');
    });
  }

  _createRoundedBoxGeometry(length, width, depth, radius) {
    const shape = new THREE.Shape();
    const w = length;
    const h = width;
    const x = -w / 2;
    const y = -h / 2;
    const r = Math.min(radius || 0, w / 2, h / 2);

    if (r > 0) {
      shape.moveTo(x + r, y);
      shape.lineTo(x + w - r, y);
      shape.quadraticCurveTo(x + w, y, x + w, y + r);
      shape.lineTo(x + w, y + h - r);
      shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      shape.lineTo(x + r, y + h);
      shape.quadraticCurveTo(x, y + h, x, y + h - r);
      shape.lineTo(x, y + r);
      shape.quadraticCurveTo(x, y, x + r, y);
    } else {
      shape.moveTo(x, y);
      shape.lineTo(x + w, y);
      shape.lineTo(x + w, y + h);
      shape.lineTo(x, y + h);
      shape.lineTo(x, y);
    }

    const extrudeSettings = {
      depth: depth,
      bevelEnabled: false,
      curveSegments: 16
    };

    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.translate(0, 0, -depth / 2);
    geo.rotateX(-Math.PI / 2);
    
    return geo;
  }

  highlightFeature(feat) {
    if (!this.scene || !this._modelGroup) return;
    
    // Remove old highlight
    if (this.currentHighlight) {
      this._modelGroup.remove(this.currentHighlight);
      if (this.currentHighlight.geometry) this.currentHighlight.geometry.dispose();
      if (this.currentHighlight.material) this.currentHighlight.material.dispose();
      this.currentHighlight = null;
    }
    
    const mat = new THREE.MeshBasicMaterial({ 
      color: 0xff0044, 
      transparent: true, 
      opacity: 0.6,
      depthTest: false // render on top
    });
    
    let geo;
    let mesh;
    
    if (feat.type === 'drill') {
      geo = new THREE.CylinderGeometry(feat.radius, feat.radius, feat.depth, 32);
      mesh = new THREE.Mesh(geo, mat);
      
      const v = new THREE.Vector3(feat.vector[0], feat.vector[1], feat.vector[2]).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, v);
      mesh.setRotationFromQuaternion(quaternion);
      
    } else if (feat.type === 'slot') {
      // Travel direction vector (from p1 to p2)
      const dx = feat.p2[0] - feat.p1[0];
      const dy = feat.p2[1] - feat.p1[1];
      const dz = feat.p2[2] - feat.p1[2];
      
      geo = this._createRoundedBoxGeometry(feat.length, feat.width, feat.depth, feat.radius);
      mesh = new THREE.Mesh(geo, mat);
      
      const drillAxis = new THREE.Vector3(feat.vector[0], feat.vector[1], feat.vector[2]).normalize();
      const travelAxis = new THREE.Vector3(dx, dy, dz).normalize();
      if (travelAxis.lengthSq() < 0.1) travelAxis.set(1,0,0);
      
      // Orient the box so Y aligns with drillAxis, X aligns with travelAxis
      const yAxis = drillAxis;
      const xAxis = travelAxis;
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
      
      const mat4 = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      mesh.setRotationFromMatrix(mat4);
      
    } else if (feat.type === 'pocket') {
      const drillAxis = new THREE.Vector3(feat.vector[0], feat.vector[1], feat.vector[2]).normalize();
      const travelAxis = new THREE.Vector3(1, 0, 0);
      if (Math.abs(drillAxis.dot(travelAxis)) > 0.9) travelAxis.set(0, 1, 0);
      
      const yAxis = drillAxis;
      const xAxis = travelAxis;
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
      
      if (feat.polygon_3d && feat.polygon_3d.length > 2) {
        console.log(`[Viewer3D] Rendering custom polygon for feature ${feat.id} with ${feat.polygon_3d.length} points.`);
        try {
          const shape = new THREE.Shape();
          const center = new THREE.Vector3(feat.position[0], feat.position[1], feat.position[2]);
          feat.polygon_3d.forEach((pt, idx) => {
            const v3 = new THREE.Vector3(pt[0], pt[1], pt[2]).sub(center);
            const u = v3.dot(xAxis);
            const v = -v3.dot(zAxis); // Negative because rotateX(-Math.PI/2) maps local Y to -Z
            if (idx === 0) shape.moveTo(u, v);
            else shape.lineTo(u, v);
          });
          
          geo = new THREE.ExtrudeGeometry(shape, { depth: feat.depth, bevelEnabled: false });
          geo.translate(0, 0, -feat.depth / 2);
          geo.rotateX(-Math.PI / 2);
        } catch (e) {
          console.error(`[Viewer3D] Failed to extrude polygon for feature ${feat.id}:`, e);
          geo = this._createRoundedBoxGeometry(feat.length, feat.width, feat.depth, feat.radius);
        }
      } else {
        if (feat.polygon_3d && feat.polygon_3d.length <= 2) {
          console.warn(`[Viewer3D] Feature ${feat.id} has polygon_3d but too few points: ${feat.polygon_3d.length}`);
        } else {
          console.log(`[Viewer3D] Feature ${feat.id} has no polygon_3d. Falling back to rounded box.`);
        }
        geo = this._createRoundedBoxGeometry(feat.length, feat.width, feat.depth, feat.radius);
      }
      
      mesh = new THREE.Mesh(geo, mat);
      
      const mat4 = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      mesh.setRotationFromMatrix(mat4);

    } else if (feat.type.startsWith('cut')) {
      const w = feat.width || 100;
      const l = feat.length || 100;
      const d = feat.depth || 100;
      const size = Math.sqrt(w*w + l*l + d*d) * 1.2;
      
      geo = new THREE.PlaneGeometry(size, size);
      mat.side = THREE.DoubleSide;
      mesh = new THREE.Mesh(geo, mat);
      
      const n = new THREE.Vector3(feat.vector[0], feat.vector[1], feat.vector[2]).normalize();
      
      let up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(n.y) > 0.99) {
        up.set(1, 0, 0);
      } else if (Math.abs(n.x) > 0.99) {
        up.set(0, 0, 1);
      }
      
      const localZ = n;
      const localX = new THREE.Vector3().crossVectors(up, localZ).normalize();
      const localY = new THREE.Vector3().crossVectors(localZ, localX).normalize();
      
      const mat4 = new THREE.Matrix4().makeBasis(localX, localY, localZ);
      mesh.setRotationFromMatrix(mat4);
    }
    
    if (mesh) {
      mesh.position.set(feat.position[0], feat.position[1], feat.position[2]);
      this._modelGroup.add(mesh);
      this.currentHighlight = mesh;
      
      if (this.controls) {
        // Find the world position of the feature for camera target
        const worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);
        this.controls.target.copy(worldPos);
        this.controls.update();
      }
    }
  }

  dispose() {
    this.isDisposed = true;
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    cancelAnimationFrame(this._rafId);
    this._resizeObserver.disconnect();
    this.controls.dispose();
    
    // Forcibly clear WebGL context
    const gl = this.renderer.getContext();
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    
    this.renderer.dispose();
  }
}
