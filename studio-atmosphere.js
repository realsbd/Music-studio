import * as THREE from 'three';

const atmospheres = new WeakMap();

// Keep the authored room finishes intact except for the selected star ceiling.
function finishSurfaces(model) {
  const ceiling = model.getObjectByName('Roof') ?? model.getObjectByName('roof');
  ceiling?.traverse(node => {
    if (!node.isMesh) return;
    const finish = material => {
      if (material.name === 'roof_light') return material;
      const copy = material.clone();
      copy.color.set(0x050507);
      copy.roughness = 0.98;
      copy.envMapIntensity = 0.06;
      return copy;
    };
    node.material = Array.isArray(node.material) ? node.material.map(finish) : finish(node.material);
  });

}

function addDiffuser(model) {
  const existing = model.getObjectByName('Studio_Acoustic_Diffuser');
  if (existing) return existing;

  // A shallow skyline diffuser above the sofa, facing into the room (-Z).
  // Quadratic residues give each block a different projection from the wall.
  const diffuser = new THREE.Group();
  diffuser.name = 'Studio_Acoustic_Diffuser';
  diffuser.position.set(0, 1.98, 3.30);
  const width = 2.06;
  const height = 0.98;
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.055),
    new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.95 }),
  );
  backing.name = 'Diffuser_Backing';
  diffuser.add(backing);

  const columns = 14;
  const rows = 7;
  const pitch = 0.136;
  const blocks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.8, metalness: 0.05 }),
    columns * rows,
  );
  blocks.name = 'Diffuser_Blocks';
  const transform = new THREE.Object3D();
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const residue = (column * column + row * row) % 7;
      const depth = 0.045 + residue * 0.032;
      transform.position.set(
        (column - (columns - 1) / 2) * pitch,
        (row - (rows - 1) / 2) * pitch,
        -0.0275 - depth / 2,
      );
      transform.scale.set(pitch - 0.009, pitch - 0.009, depth);
      transform.updateMatrix();
      blocks.setMatrixAt(row * columns + column, transform.matrix);
    }
  }
  blocks.instanceMatrix.needsUpdate = true;
  diffuser.add(blocks);
  model.add(diffuser);
  model.updateMatrixWorld(true);
  return diffuser;
}

export function createStudioAtmosphere(model, { lights, ambientLight }) {
  if (atmospheres.has(model)) return atmospheres.get(model);
  finishSurfaces(model);
  const diffuser = addDiffuser(model);

  // Reuse the four main-room fixtures and their lights. Each cloned emitting
  // surface follows its own light without recoloring other shared materials.
  const panels = lights.map(light => {
    const node = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(light.name));
    const materials = [];
    node?.traverse(child => {
      if (!child.isMesh) return;
      const clone = material => {
        const copy = material.clone();
        copy.color.set(0x111114);
        materials.push(copy);
        return copy;
      };
      child.material = Array.isArray(child.material) ? child.material.map(clone) : clone(child.material);
    });
    return materials;
  });

  let elapsed = 0;
  const atmosphere = {
    diffuser, lights, panels, ambientLight,
    get elapsed() { return elapsed; },
    update(dt, reducedMotion = false) {
      if (!reducedMotion) elapsed += dt;
      // One full color cycle per 100 seconds; a gentle 12-second breath.
      const hue = (0.61 + elapsed / 100) % 1;
      lights.forEach((light, index) => {
        const phase = index * Math.PI / 2;
        const glow = 0.5 + 0.5 * Math.sin(elapsed * Math.PI / 6 + phase);
        light.color.setHSL((hue + index * 0.055) % 1, 0.68, 0.62);
        light.intensity = 5.5 + glow * 2;
        panels[index].forEach(material => {
          material.emissive.copy(light.color);
          material.emissiveIntensity = 1.25 + glow * 0.65;
        });
      });
      ambientLight.color.setHSL(hue, 0.28, 0.78);
      ambientLight.intensity = 0.23 + Math.sin(elapsed * Math.PI / 6) * 0.025;
    },
  };
  atmosphere.update(0);
  atmospheres.set(model, atmosphere);
  return atmosphere;
}
