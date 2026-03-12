// sky.js — procedural sky + directional sun light
import { scene } from './core.js';

export let sunLight = null;
export let skyMaterial = null;
export let skybox = null;

export function initSky() {
  // Directional sun (shadow-casting)
  sunLight = new BABYLON.DirectionalLight('sun',
    new BABYLON.Vector3(-0.5, -1.0, -0.5).normalize(), scene);
  sunLight.position  = new BABYLON.Vector3(200, 200, 200);
  sunLight.intensity = 1.2;
  sunLight.diffuse   = new BABYLON.Color3(1.0, 0.95, 0.85);
  sunLight.specular  = new BABYLON.Color3(0.3, 0.28, 0.22);
  sunLight.name      = 'sun';

  // Sky box
  skybox = BABYLON.MeshBuilder.CreateBox('skyBox', { size: 1600 }, scene);
  skybox.infiniteDistance = true;
  skybox.renderingGroupId = 0;
  skybox.isPickable = false;

  skyMaterial = new BABYLON.SkyMaterial('skyMat', scene);
  skyMaterial.backFaceCulling = false;
  skyMaterial.luminance        = 1.0;
  skyMaterial.turbidity        = 8;
  skyMaterial.rayleigh         = 2;
  skyMaterial.mieCoefficient   = 0.005;
  skyMaterial.mieDirectionalG  = 0.98;
  skyMaterial.inclination      = 0.49;  // sun angle 0=noon, 0.5=horizon
  skyMaterial.azimuth          = 0.25;

  // Sync sun direction with sky material
  skyMaterial.sunPosition = new BABYLON.Vector3(
    -sunLight.direction.x * 400,
    -sunLight.direction.y * 400,
    -sunLight.direction.z * 400
  );

  skybox.material = skyMaterial;
  console.log('[sky] Sky and sun initialised');
}

export function getSunLight() { return sunLight; }
