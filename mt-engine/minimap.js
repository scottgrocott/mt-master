// minimap.js — Canvas minimap (top-down player position)

let _scene    = null;
let _camera   = null;
let _ctx      = null;
let _canvas   = null;
let _tickReg  = null;
const MAP_R   = 200;  // world-space radius shown on minimap

export function initMinimap(scene, camera) {
  _scene  = scene;
  _camera = camera;
  _canvas = document.getElementById('minimap-canvas');
  if (!_canvas) return;
  _ctx = _canvas.getContext('2d');
}

export function updateMinimap(camera) {
  if (!_ctx || !camera) return;
  const w = _canvas.width;
  const h = _canvas.height;
  _ctx.clearRect(0, 0, w, h);

  // Background
  _ctx.fillStyle = 'rgba(0,10,0,0.7)';
  _ctx.fillRect(0, 0, w, h);

  // Player dot
  const cx = w / 2;
  const cy = h / 2;

  // Heading arrow
  const yaw = camera.rotation.y;
  _ctx.save();
  _ctx.translate(cx, cy);
  _ctx.rotate(yaw);
  _ctx.fillStyle = '#4aee4a';
  _ctx.beginPath();
  _ctx.moveTo(0, -7);
  _ctx.lineTo(4, 5);
  _ctx.lineTo(0, 2);
  _ctx.lineTo(-4, 5);
  _ctx.closePath();
  _ctx.fill();
  _ctx.restore();
}

export function clearMinimap() {
  if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
}
