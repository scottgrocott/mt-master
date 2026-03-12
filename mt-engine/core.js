// core.js — Babylon.js engine + scene singleton
// Exported once, imported everywhere. Never recreated.

const canvas  = document.getElementById('renderCanvas');
export const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: false,
  stencil: true,
  antialias: true,
  adaptToDeviceRatio: true,
});

export const scene  = new BABYLON.Scene(engine);
export const camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 2, 0), scene);

// Ambient fill light (non-shadow-casting)
export const ambientLight = new BABYLON.HemisphericLight('hemi',
  new BABYLON.Vector3(0, 1, 0), scene);
ambientLight.intensity   = 0.55;
ambientLight.diffuse     = new BABYLON.Color3(0.9, 0.88, 0.82);
ambientLight.groundColor = new BABYLON.Color3(0.25, 0.22, 0.18);
ambientLight.name        = 'hemi';

// Run loop
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());

console.log('[core] BJS', BABYLON.Engine.Version, 'WebGL2:', engine.webGLVersion === 2);
