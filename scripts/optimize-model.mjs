import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { compressTexture, dedup, listTextureSlots, meshopt, prune, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

// Run locally after exporting a new model. Vercel only needs the optimized
// assets, so builds never need the 90 MB source or an expensive conversion.
const source = fileURLToPath(new URL('../Music_studio.glb', import.meta.url));
const output = fileURLToPath(new URL('../assets/music-studio.glb', import.meta.url));
const metadata = fileURLToPath(new URL('../assets/studio.json', import.meta.url));
await mkdir(new URL('../assets/', import.meta.url), { recursive: true });

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

console.log('Reading the source studio…');
const document = await io.read(source);
const root = document.getRoot();
const countTriangles = () => root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives()
  .filter(primitive => primitive.getMode() === 4)
  .reduce((count, primitive) => count + (primitive.getIndices()?.getCount()
    ?? primitive.getAttribute('POSITION').getCount()) / 3, 0), 0);
const originalTriangles = countTriangles();

// The old smoke cards intersect the desk, floor and ceiling. Their two large
// PNGs are no longer needed by the procedural effect.
const smokeEmitters = ['weed_Lit', 'weed_Lit.001'].map(name => {
  const node = root.listNodes().find(candidate => candidate.getName() === name);
  if (!node) throw new Error(`Smoke source "${name}" is missing in the model.`);
  const { min, max } = getBounds(node);
  return {
    name,
    position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2 + 0.008, max[2] - 0.005],
  };
});
for (const node of root.listNodes()) {
  if (/^smoke/i.test(node.getName())) node.dispose();
}
// Keep the currently selected procedural ceiling and diffuser treatments.
// These authored nodes belong to visual changes 1 and 4, which remain active.
const retainedRuntimeTreatments = /^(pCube14[6-9]|pCube15[01])$/;
for (const node of root.listNodes()) {
  if (retainedRuntimeTreatments.test(node.getName())) node.dispose();
}
// Decode Draco once during authoring; the deployed model uses an embedded
// Meshopt decoder and requires no external CDN, worker script or WASM fetch.
for (const extension of root.listExtensionsUsed()) {
  if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
}

console.log('Removing unused resources while preserving authored geometry…');
await document.transform(
  prune({ keepLeaves: true }),
  dedup(),
  weld(),
);
const foregroundMeshes = new Set(root.listNodes()
  .filter(node => /^Chair_/.test(node.getName()))
  .map(node => node.getMesh()));
const detailedNormalMaps = new Set();
for (const mesh of root.listMeshes()) {
  const foreground = foregroundMeshes.has(mesh);
  for (const primitive of mesh.listPrimitives()) {
    if (foreground) detailedNormalMaps.add(primitive.getMaterial()?.getNormalTexture());
  }
}

console.log('Compressing textures…');
// Keep extra resolution for the gallery and screens. Data maps use smaller,
// near-lossless images without lossy chroma subsampling. Process each texture
// once, never upscale it, and retain alpha. Bounded batches limit RAM usage.
const detailed = /frame|frammmm|mac_screen|studio_5|chatgpt|label/i;
const textures = root.listTextures();
for (let i = 0; i < textures.length; i += 4) {
  await Promise.all(textures.slice(i, i + 4).map(async texture => {
    const dataMap = listTextureSlots(texture).every(slot => !/baseColor|emissive|diffuse|specularColor|sheenColor/i.test(slot));
    const detail = detailed.test(texture.getName());
    const detailedNormal = detailedNormalMaps.has(texture);
    const limit = detailedNormal ? 1024 : dataMap ? 512 : detail ? 1536 : 1024;
    const [width, height] = texture.getSize();
    const scale = Math.min(1, limit / Math.max(width, height));
    await compressTexture(texture, {
      encoder: sharp,
      targetFormat: 'webp',
      resize: [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))],
      nearLossless: dataMap && !detailedNormal,
      lossless: detailedNormal,
      quality: dataMap ? 50 : detail ? 84 : 78,
      effort: 75,
    });
  }));
}
document.createExtension(EXTTextureWebP).setRequired(true);
await document.transform(
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  prune({ keepLeaves: true }),
);

await io.write(output, document);
const originalBytes = (await stat(source)).size;
const byteLength = (await stat(output)).size;
const triangles = countTriangles();
await writeFile(metadata, JSON.stringify({ byteLength, originalBytes, triangles, originalTriangles, smokeEmitters }, null, 2) + '\n');
console.log(`Model: ${(originalBytes / 1e6).toFixed(2)} MB → ${(byteLength / 1e6).toFixed(2)} MB (${(100 * (1 - byteLength / originalBytes)).toFixed(1)}% smaller)`);
console.log(`Triangles: ${originalTriangles.toLocaleString()} → ${triangles.toLocaleString()}`);
