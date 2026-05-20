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
    this.wireframe = false;
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
    this.renderer.shadowMap.enabled = true;
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
    dirLight.castShadow = true;
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

    // Animate
    this._animate();
  }

  _animate() {
    this._rafId = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
      const worker = new Worker(
        new URL('../workers/occt-worker.js', import.meta.url)
      );

      const token = localStorage.getItem('infinicam_token') || '';
      worker.postMessage({ type: 'load', url, token });

      worker.onmessage = (e) => {
        const { type, meshData, error, message } = e.data;
        if (type === 'progress' && onProgress) { onProgress(message); return; }
        if (type === 'error') { worker.terminate(); reject(new Error(error)); return; }
        if (type === 'done')  { worker.terminate(); this._buildMesh(meshData); resolve(); }
      };

      worker.onerror = (err) => {
        worker.terminate();
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
      threeMesh.castShadow = true;
      threeMesh.receiveShadow = true;
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

  toggleWireframe() {
    this.wireframe = !this.wireframe;
    if (this._modelGroup) {
      this._modelGroup.traverse(obj => {
        if (obj.isMesh) obj.material.wireframe = this.wireframe;
      });
    }
  }

  async captureScreenshot() {
    this.renderer.render(this.scene, this.camera);
    return new Promise(resolve => {
      this.canvas.toBlob(blob => resolve(blob), 'image/png');
    });
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
      
      geo = new THREE.BoxGeometry(feat.length, feat.depth, feat.width);
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
      
    } else if (feat.type.startsWith('cut')) {
      const size = Math.sqrt(feat.area || 400) * 1.5;
      geo = new THREE.PlaneGeometry(size, size);
      mat.side = THREE.DoubleSide;
      mesh = new THREE.Mesh(geo, mat);
      
      const n = new THREE.Vector3(feat.vector[0], feat.vector[1], feat.vector[2]).normalize();
      const z = new THREE.Vector3(0, 0, 1);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(z, n);
      mesh.setRotationFromQuaternion(quaternion);
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
    cancelAnimationFrame(this._rafId);
    this._resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
