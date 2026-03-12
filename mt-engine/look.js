// look.js — FPS mouse look + pointer lock + touch look
let _camera  = null;
let _scene   = null;
let _yaw     = 0;
let _pitch   = 0;
const MAX_PITCH = Math.PI / 2.1;

export function initLook(camera, scene) {
  _camera = camera;
  _scene  = scene;

  camera.minZ        = 0.1;
  camera.maxZ        = 1400;
  camera.fov         = 1.1;
  camera.inertia     = 0;
  camera.angularSensibilityX = 0;
  camera.angularSensibilityY = 0;
  camera.inputs.clear();

  const canvas = scene.getEngine().getRenderingCanvas();

  // Re-lock on canvas click (useful if lock is lost mid-game)
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      canvas.focus();
      document.addEventListener('mousemove', _onMouseMove);
    } else {
      document.removeEventListener('mousemove', _onMouseMove);
    }
  });
}

function _onMouseMove(e) {
  const sens = 0.0018;
  _yaw   += e.movementX * sens;
  _pitch += e.movementY * sens;
  _pitch  = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, _pitch));
  _applyRotation();
}

function _applyRotation() {
  if (!_camera) return;
  _camera.rotation.y = _yaw;
  _camera.rotation.x = _pitch;
}

export function setLookCamera(camera) { _camera = camera; }
export function getLookYaw() { return _yaw; }

// Touch look (called from touchControls)
export function applyLookDelta(dx, dy) {
  const sens = 0.003;
  _yaw   += dx * sens;
  _pitch -= dy * sens;
  _pitch  = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, _pitch));
  _applyRotation();
}
