import * as THREE from 'three';

const atmospheres = new WeakMap();

function createTwinkleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 30);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.08, 'rgba(255,255,255,0.96)');
  glow.addColorStop(0.24, 'rgba(214,202,255,0.28)');
  glow.addColorStop(0.62, 'rgba(164,132,255,0.04)');
  glow.addColorStop(1, 'rgba(139,92,246,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCeilingTwinkles(compact) {
  const columns = compact ? 14 : 19;
  const rows = compact ? 10 : 13;
  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  let seed = 0x61f3a9d;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let index = 0; index < count; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const xProgress = (column + 0.16 + random() * 0.68) / columns;
    const zProgress = (row + 0.16 + random() * 0.68) / rows;
    const x = THREE.MathUtils.lerp(-3.58, 3.58, xProgress);
    const z = THREE.MathUtils.lerp(-5.22, 2.92, zProgress);
    positions[index * 3] = x;
    // Pull the procedural points just inside the room so they do not sit
    // inside the authored ceiling mesh and disappear behind its depth buffer.
    positions[index * 3 + 1] = 2.735 - random() * 0.012;
    positions[index * 3 + 2] = z;
    phases[index] = random() * Math.PI * 2;
    speeds[index] = THREE.MathUtils.lerp(0.7, 1.65, random());
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    map: createTwinkleTexture(),
    color: 0xffffff,
    size: compact ? 0.058 : 0.064,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    alphaTest: 0.025,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'Studio_Ceiling_Twinkles';
  points.frustumCulled = false;
  points.renderOrder = 8;
  return { points, colors, phases, speeds, baseSize: material.size };
}

function createFixtureCover(model, starMaterial) {
  const fixture = model.getObjectByName('Light');
  const ceiling = model.getObjectByName('Roof') ?? model.getObjectByName('roof');
  let starMesh = null;
  ceiling?.traverse(node => {
    if (!starMesh && node.isMesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.includes(starMaterial)) starMesh = node;
    }
  });
  if (!fixture || !starMesh || !starMaterial) return null;
  const box = new THREE.Box3().setFromObject(fixture);
  if (box.isEmpty()) return null;

  const position = starMesh.geometry.attributes.position;
  const uv = starMesh.geometry.attributes.uv;
  const sample = {
    minX: { value: Infinity }, maxX: { value: -Infinity },
    minZ: { value: Infinity }, maxZ: { value: -Infinity },
  };
  starMesh.updateMatrixWorld(true);
  for (let index = 0; index < position.count; index++) {
    const world = new THREE.Vector3(
      position.getX(index), position.getY(index), position.getZ(index),
    ).applyMatrix4(starMesh.matrixWorld);
    const point = { x: world.x, z: world.z, u: uv.getX(index), v: uv.getY(index) };
    if (world.x < sample.minX.value) sample.minX = { value: world.x, point };
    if (world.x > sample.maxX.value) sample.maxX = { value: world.x, point };
    if (world.z < sample.minZ.value) sample.minZ = { value: world.z, point };
    if (world.z > sample.maxZ.value) sample.maxZ = { value: world.z, point };
  }

  const minX = box.min.x - 0.018;
  const maxX = box.max.x + 0.018;
  const minZ = box.min.z - 0.018;
  const maxZ = box.max.z + 0.018;
  const y = box.min.y - 0.006;
  const corners = [
    [minX, y, minZ], [maxX, y, minZ],
    [maxX, y, maxZ], [minX, y, maxZ],
  ];
  const positions = new Float32Array(corners.flatMap(([x, worldY, z]) => {
    const local = model.worldToLocal(new THREE.Vector3(x, worldY, z));
    return local.toArray();
  }));
  const uvs = new Float32Array(corners.flatMap(([x, , z]) => [
    THREE.MathUtils.mapLinear(
      z, sample.minZ.value, sample.maxZ.value,
      sample.minZ.point.u, sample.maxZ.point.u,
    ),
    THREE.MathUtils.mapLinear(
      x, sample.minX.value, sample.maxX.value,
      sample.minX.point.v, sample.maxX.point.v,
    ),
  ]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const cover = new THREE.Mesh(geometry, starMaterial);
  cover.name = 'Studio_Ceiling_Fixture_Cover';
  model.add(cover);
  return cover;
}

function createPerimeterBars(model, starMaterials) {
  const dimensions = {
    coverDepth: 0.58,
    spillDepth: 0.48,
    glowDepth: 0.24,
    coreDepth: 0.072,
  };
  const ceiling = model.getObjectByName('Roof') ?? model.getObjectByName('roof');
  let starMesh = null;
  ceiling?.traverse(node => {
    if (!starMesh && node.isMesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(material => starMaterials.includes(material))) starMesh = node;
    }
  });
  if (!starMesh) return { group: null, cores: [], glows: [], spills: [], dimensions };

  const box = new THREE.Box3().setFromObject(starMesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const group = new THREE.Group();
  group.name = 'Studio_Perimeter_Lighting';
  const cores = [];
  const glows = [];
  const spills = [];

  // Mask the authored emitter, then rebuild it as a layered recessed strip:
  // a crisp core, a visible blue-white halo and a broad low-energy ceiling spill.
  const addStrip = (width, edgeZ, inward) => {
    const cover = new THREE.Mesh(
      new THREE.PlaneGeometry(width, dimensions.coverDepth),
      new THREE.MeshBasicMaterial({ color: 0x020204, side: THREE.DoubleSide, toneMapped: false }),
    );
    cover.rotation.x = Math.PI / 2;
    cover.position.set(center.x, box.min.y - 0.004, edgeZ + inward * dimensions.coverDepth / 2);
    group.add(cover);

    const spillMaterial = new THREE.MeshBasicMaterial({
      color: 0xa9d8ff,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(width, dimensions.spillDepth), spillMaterial);
    spill.rotation.x = Math.PI / 2;
    spill.position.set(center.x, box.min.y - 0.005, edgeZ + inward * dimensions.spillDepth / 2);
    spill.renderOrder = 1;
    group.add(spill);
    spills.push(spillMaterial);

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xa9d8ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(width, dimensions.glowDepth), glowMaterial);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(center.x, box.min.y - 0.006, edgeZ + inward * dimensions.glowDepth / 2);
    glow.renderOrder = 2;
    group.add(glow);
    glows.push(glowMaterial);

    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xc9e8ff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const core = new THREE.Mesh(new THREE.PlaneGeometry(width, dimensions.coreDepth), coreMaterial);
    core.rotation.x = Math.PI / 2;
    core.position.set(center.x, box.min.y - 0.008, edgeZ + inward * dimensions.coreDepth / 2);
    core.renderOrder = 3;
    group.add(core);
    cores.push(coreMaterial);
  };

  addStrip(size.x, box.min.z, 1);
  addStrip(size.x, box.max.z, -1);

  const addSideStrip = (edgeX, inward) => {
    const side = new THREE.Group();
    const coverMaterial = new THREE.MeshBasicMaterial({ color: 0x020204, side: THREE.DoubleSide, toneMapped: false });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(dimensions.coverDepth, size.z), coverMaterial);
    cover.rotation.x = Math.PI / 2;
    cover.position.set(edgeX + inward * dimensions.coverDepth / 2, box.min.y - 0.004, center.z);
    side.add(cover);

    const spillMaterial = new THREE.MeshBasicMaterial({
      color: 0xa9d8ff,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(dimensions.spillDepth, size.z), spillMaterial);
    spill.rotation.x = Math.PI / 2;
    spill.position.set(edgeX + inward * dimensions.spillDepth / 2, box.min.y - 0.005, center.z);
    spill.renderOrder = 1;
    side.add(spill);
    spills.push(spillMaterial);

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xa9d8ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(dimensions.glowDepth, size.z), glowMaterial);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(edgeX + inward * dimensions.glowDepth / 2, box.min.y - 0.006, center.z);
    glow.renderOrder = 2;
    side.add(glow);
    glows.push(glowMaterial);

    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xc9e8ff, side: THREE.DoubleSide, toneMapped: false });
    const core = new THREE.Mesh(new THREE.PlaneGeometry(dimensions.coreDepth, size.z), coreMaterial);
    core.rotation.x = Math.PI / 2;
    core.position.set(edgeX + inward * dimensions.coreDepth / 2, box.min.y - 0.008, center.z);
    core.renderOrder = 3;
    side.add(core);
    cores.push(coreMaterial);
    group.add(side);
  };
  addSideStrip(box.min.x, 1);
  addSideStrip(box.max.x, -1);
  model.add(group);
  return { group, cores, glows, spills, dimensions };
}

// Keep the authored room finishes intact while separating the star field from
// the exposed perimeter light material so they can animate independently.
function finishSurfaces(model) {
  const starMaterials = [];
  const perimeterMaterials = [];
  const ceiling = model.getObjectByName('Roof') ?? model.getObjectByName('roof');
  ceiling?.traverse(node => {
    if (!node.isMesh) return;
    const finish = material => {
      const copy = material.clone();
      if (material.name === 'roof_light') {
        // The authored emitter is a broad ceiling band. Keep it as a dark
        // recess and let the procedural edge below provide the visible light.
        copy.color.set(0x020204);
        copy.emissive.set(0x000000);
        copy.emissiveIntensity = 0;
        copy.roughness = 0.7;
        copy.metalness = 0.05;
        perimeterMaterials.push(copy);
        return copy;
      }
      copy.color.set(0x050507);
      copy.roughness = 0.98;
      copy.envMapIntensity = 0.06;
      starMaterials.push(copy);
      return copy;
    };
    node.material = Array.isArray(node.material) ? node.material.map(finish) : finish(node.material);
  });
  return { starMaterials, perimeterMaterials };
}

const AUTHORED_DIFFUSER_NAMES = [
  'pCube146', 'pCube147', 'pCube148', 'pCube149', 'pCube150', 'pCube151',
];

function findAuthoredDiffusers(model) {
  return AUTHORED_DIFFUSER_NAMES.map(name => model.getObjectByName(name)).filter(Boolean);
}

export function createStudioAtmosphere(model, { lights, ambientLight, compact = false }) {
  if (atmospheres.has(model)) return atmospheres.get(model);
  const { starMaterials, perimeterMaterials } = finishSurfaces(model);
  const diffusers = findAuthoredDiffusers(model);
  const diffuser = diffusers[0] ?? null;
  const twinkles = createCeilingTwinkles(compact);
  model.add(twinkles.points);
  const fixtureCover = createFixtureCover(model, starMaterials[0]);
  const perimeterBars = createPerimeterBars(model, starMaterials);

  // Reuse the four main-room fixtures and their lights. Each cloned emitting
  // surface follows its own light without recoloring other shared materials.
  // The surface stays near-black so the old bright white square disappears;
  // the point light above it retains the authored ambient halo.
  const panels = lights.map(light => {
    const node = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(light.name));
    const materials = [];
    node?.traverse(child => {
      if (!child.isMesh) return;
      const clone = material => {
        const copy = material.clone();
        copy.color.set(0x020204);
        copy.emissive.set(0x000000);
        copy.emissiveIntensity = 0.08;
        copy.roughness = 0.92;
        copy.metalness = 0.05;
        materials.push(copy);
        return copy;
      };
      child.material = Array.isArray(child.material) ? child.material.map(clone) : clone(child.material);
    });
    return materials;
  });

  let elapsed = 0;
  const iceBlue = new THREE.Color(0xb9ddff);
  const coreWhite = new THREE.Color(0xe7f5ff);
  const ambientBlue = new THREE.Color(0x79aeea);
  const accent = new THREE.Color();
  const perimeterColor = new THREE.Color();
  const perimeterCoreColor = new THREE.Color();
  const ambientColor = new THREE.Color();
  const lightColors = lights.map(() => new THREE.Color());
  const lightAccents = lights.map(() => new THREE.Color());
  const atmosphere = {
    diffuser, diffusers, lights, panels, ambientLight,
    starMaterials, perimeterMaterials, perimeterBars, fixtureCover,
    twinkles: twinkles.points,
    get elapsed() { return elapsed; },
    update(dt, reducedMotion = false) {
      if (!reducedMotion) elapsed += dt;
      const hueDrift = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * Math.PI / 12);
      const hue = 0.575 + hueDrift * 0.035;
      accent.setHSL(hue, 0.72, 0.6);
      const perimeterBreath = 0.5 + 0.5 * Math.sin(elapsed * Math.PI / 5);
      perimeterColor.copy(iceBlue).lerp(accent, 0.34 + perimeterBreath * 0.2);
      perimeterCoreColor.copy(coreWhite).lerp(perimeterColor, 0.28);

      lights.forEach((light, index) => {
        const phase = index * Math.PI / 2;
        const glow = 0.5 + 0.5 * Math.sin(elapsed * Math.PI / 6 + phase);
        lightAccents[index].setHSL((hue + index * 0.012) % 1, 0.66, 0.62);
        lightColors[index].copy(iceBlue).lerp(lightAccents[index], 0.24 + glow * 0.14);
        light.color.copy(lightColors[index]);
        light.intensity = 3.45 + glow * 0.55;
        panels[index].forEach(material => {
          material.emissive.copy(light.color);
          material.emissiveIntensity = 0.035 + glow * 0.025;
        });
      });

      perimeterMaterials.forEach(material => {
        material.emissive.set(0x000000);
        material.emissiveIntensity = 0;
      });
      perimeterBars.cores.forEach(material => material.color.copy(perimeterCoreColor));
      perimeterBars.glows.forEach(material => {
        material.color.copy(perimeterColor);
        material.opacity = 0.15 + perimeterBreath * 0.06;
      });
      perimeterBars.spills.forEach(material => {
        material.color.copy(perimeterColor);
        material.opacity = 0.035 + perimeterBreath * 0.03;
      });

      ambientColor.copy(ambientBlue).lerp(accent, 0.14 + perimeterBreath * 0.06);
      ambientLight.color.copy(ambientColor);
      ambientLight.intensity = 0.21 + Math.sin(elapsed * Math.PI / 6) * 0.01;

      const twinkleTime = elapsed;
      for (let index = 0; index < twinkles.phases.length; index++) {
        const wave = 0.5 + 0.5 * Math.sin(twinkleTime * twinkles.speeds[index] + twinkles.phases[index]);
        const shimmer = 0.08 + Math.pow(wave, 7) * 0.94;
        const offset = index * 3;
        twinkles.colors[offset] = shimmer * 0.66;
        twinkles.colors[offset + 1] = shimmer * (0.82 + wave * 0.14);
        twinkles.colors[offset + 2] = shimmer;
      }
      twinkles.points.material.size = twinkles.baseSize * (
        reducedMotion ? 1 : 0.92 + 0.12 * Math.sin(twinkleTime * 1.7)
      );
      twinkles.points.geometry.attributes.color.needsUpdate = true;
    },
  };
  atmosphere.update(0);
  atmospheres.set(model, atmosphere);
  return atmosphere;
}
