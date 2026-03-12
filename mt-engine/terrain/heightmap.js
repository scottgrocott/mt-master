// terrain/heightmap.js — Load a PNG heightmap and extract pixel data
// Returns Float32Array of normalised heights [0..1], width, height

export async function loadHeightmap(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cvs = document.createElement('canvas');
      cvs.width  = w;
      cvs.height = h;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const raw  = ctx.getImageData(0, 0, w, h).data;
      const data = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        data[i] = raw[i * 4] / 255;   // red channel → [0..1]
      }
      console.log(`[heightmap] Loaded ${w}×${h}`);
      resolve({ data, width: w, height: h });
    };
    img.onerror = () => reject(new Error('[heightmap] Failed: ' + url));
    img.src = url;
  });
}

// Sample height at normalised (u,v) in [0,1]
export function sampleHeight(hmData, u, v) {
  const { data, width, height } = hmData;
  const px = Math.max(0, Math.min(width  - 1, Math.floor(u * (width  - 1))));
  const py = Math.max(0, Math.min(height - 1, Math.floor(v * (height - 1))));
  return data[py * width + px];
}

// World XZ → normalised height (0..1)
export function worldHeight(hmData, worldX, worldZ, worldSize) {
  const u = (worldX + worldSize / 2) / worldSize;
  const v = (worldZ + worldSize / 2) / worldSize;
  return sampleHeight(hmData, u, v);
}
