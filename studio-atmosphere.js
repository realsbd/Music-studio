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

const AUTHORED_DIFFUSER_NAMES = [
  'pCube146', 'pCube147', 'pCube148', 'pCube149', 'pCube150', 'pCube151',
];

function findAuthoredDiffusers(model) {
  return AUTHORED_DIFFUSER_NAMES.map(name => model.getObjectByName(name)).filter(Boolean);
}

export function createStudioAtmosphere(model, { lights, ambientLight }) {
  if (atmospheres.has(model)) return atmospheres.get(model);
  finishSurfaces(model);
  const diffusers = findAuthoredDiffusers(model);
  const diffuser = diffusers[0] ?? null;

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
    diffuser, diffusers, lights, panels, ambientLight,
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
