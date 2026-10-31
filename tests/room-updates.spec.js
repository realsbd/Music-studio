import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Read the authored finishes so runtime styling cannot silently replace the
// studio's original wall and floor materials.
const modelBytes = await readFile(new URL('../assets/music-studio.glb', import.meta.url));
const gltf = JSON.parse(modelBytes.subarray(20, 20 + modelBytes.readUInt32LE(12)).toString());
const originalFloor = gltf.materials.find(material => material.name === 'Ground_mtl');
const originalWall = gltf.materials.find(material => material.name === 'wall');

const ready = async page => {
  await page.goto('/');
  await page.bringToFront();
  await page.waitForFunction(() => window.__studio?.loaded, null, { timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Enter Studio' })).toBeVisible();
  await page.getByRole('button', { name: 'Enter Studio' }).click();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await page.waitForFunction(() => window.__studio.isSettled());
};

test('wheel zoom stops before the sofa and ceiling fixture', async ({ page }) => {
  await ready(page);
  await page.mouse.move(640, 400);

  const views = [
    { name: 'Sofa', position: [-0.4, 1, 0.8], target: [-0.4, 1, 2.7], minimumDistance: 0.45 },
    // Aim beyond the light plane so OrbitControls' minimum distance alone
    // would still allow the camera to intersect the ceiling fixture.
    { name: 'Light', position: [2.36, 1.7, -2.2], target: [2.36, 2.71, -3.398], minimumDistance: 0.39 },
  ];

  for (const view of views) {
    await test.step(view.name, async () => {
      const start = await page.evaluate(({ position, target }) => {
        __studio.setView(position, target);
        return __studio.camera.position.distanceTo(__studio.controls.target);
      }, view);
      const samples = [];
      for (let step = 0; step < 34; step++) {
        await page.mouse.wheel(0, -500);
        samples.push(await page.evaluate(name => new Promise(resolve => {
          requestAnimationFrame(() => {
            const { model, camera, controls, collision } = __studio;
            const object = model.getObjectByName(name);
            let surfaceDistance = Infinity;
            // Independently measure distance from the real object geometry,
            // in addition to checking the collision system's padded volumes.
            object.traverse(mesh => {
              if (!mesh.isMesh) return;
              if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
              const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
              surfaceDistance = Math.min(surfaceDistance, box.distanceToPoint(camera.position));
            });
            resolve({
              clear: collision.isClear(camera.position),
              surfaceDistance,
              near: camera.near,
              distance: camera.position.distanceTo(controls.target),
              position: camera.position.toArray(),
            });
          });
        }), view.name));
      }

      expect(samples.every(sample => sample.clear), `${view.name}: camera entered a padded solid`).toBe(true);
      expect(Math.min(...samples.map(sample => sample.surfaceDistance))).toBeGreaterThan(samples[0].near);
      expect(samples.at(-1).distance).toBeLessThan(start - 0.1);
      // Continued wheel input must stop at the obstacle rather than crossing
      // it and emerging clear on its far side.
      expect(samples.at(-1).distance).toBeGreaterThan(view.minimumDistance);
      const lastPositions = samples.slice(-5).map(sample => sample.position);
      const last = lastPositions.at(-1);
      for (const position of lastPositions) {
        expect(Math.hypot(...position.map((value, axis) => value - last[axis]))).toBeLessThan(0.015);
      }
    });
  }
});

test('walking stops at the sofa and preserves the view while returning from a hotspot', async ({ page }) => {
  await ready(page);
  const captureMovement = (frames, duration = 0) => page.evaluate(({ frames, duration }) => new Promise(resolve => {
    const started = performance.now();
    const samples = [];
    const next = () => {
      const { camera, controls, collision } = __studio;
      samples.push({
        position: camera.position.toArray(),
        view: controls.target.clone().sub(camera.position).toArray(),
        clear: collision.isClear(camera.position),
      });
      if (samples.length >= frames && performance.now() - started >= duration) resolve(samples);
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), { frames, duration });
  const vectorDistance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

  await test.step('holding W stops both camera and pivot at the sofa', async () => {
    const start = await page.evaluate(() => {
      __studio.setView([-0.4, 1, 0.8], [-0.4, 1, 2.7]);
      return {
        position: __studio.camera.position.toArray(),
        view: __studio.controls.target.clone().sub(__studio.camera.position).toArray(),
        near: __studio.camera.near,
      };
    });
    await page.keyboard.down('w');
    let samples;
    try {
      // The time floor also reaches the obstacle on displays faster than 60 Hz.
      samples = await captureMovement(45, 750);
    } finally {
      await page.keyboard.up('w');
    }
    const last = samples.at(-1);
    expect(samples.every(sample => sample.clear)).toBe(true);
    expect(last.position[2]).toBeGreaterThan(start.position[2] + 0.1);
    expect(last.position[2]).toBeLessThan(1.406 - start.near);
    for (const sample of samples) expect(vectorDistance(sample.view, start.view)).toBeLessThan(0.01);
    for (const sample of samples.slice(-8)) expect(vectorDistance(sample.position, last.position)).toBeLessThan(0.001);
  });

  await test.step('a movement key held during reduced-motion Back does not shift the pivot', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => __studio.clickHotspot('phone'));
    await expect(page.locator('#overlay.active h2')).toHaveText('Contact');
    const expected = await page.evaluate(() => ({
      view: __studio.ROOM.defaultLook.clone().sub(__studio.ROOM.defaultCam).toArray(),
      position: __studio.ROOM.defaultCam.toArray(),
    }));
    await page.keyboard.down('w');
    let samples;
    try {
      await page.keyboard.press('Escape');
      await expect(page.locator('#overlay')).not.toHaveClass('active');
      await page.waitForFunction(() => __studio.isSettled());
      samples = await captureMovement(8);
    } finally {
      await page.keyboard.up('w');
    }
    expect(samples.every(sample => sample.clear)).toBe(true);
    for (const sample of samples) expect(vectorDistance(sample.view, expected.view)).toBeLessThan(0.01);
    expect(samples.at(-1).position[2]).toBeLessThan(expected.position[2] - 0.01);
  });
});

test('room finishes preserve the authored walls, stars, floor and existing light fixtures', async ({ page }) => {
  await ready(page);
  const room = await page.evaluate(() => {
    const { model, scene, atmosphere } = __studio;
    const materials = object => {
      const result = [];
      object.traverse(node => {
        if (node.material) result.push(...(Array.isArray(node.material) ? node.material : [node.material]));
      });
      return result;
    };
    const describe = material => ({
      name: material.name,
      color: material.color.toArray(),
      emissive: material.emissive?.toArray(),
      emissiveMap: material.emissiveMap?.name,
      emissiveIntensity: material.emissiveIntensity,
      map: Boolean(material.map),
      repeat: material.map?.repeat.toArray(),
      roughness: material.roughness,
      metalness: material.metalness,
    });
    const shell = materials(model.getObjectByName('Main_Studio'));
    const booth = materials(model.getObjectByName('RecordingBooth'));
    const roof = materials(model.getObjectByName('Roof') ?? model.getObjectByName('roof'));
    const authoredDiffuserNames = ['pCube146', 'pCube147', 'pCube148', 'pCube149', 'pCube150', 'pCube151'];
    const authoredDiffusers = authoredDiffuserNames.map(name => model.getObjectByName(name));
    const authoredDiffuserMaterials = authoredDiffusers.map(object => materials(object).map(material => material.name));
    const proceduralDiffusers = [];
    let pointLights = 0;
    scene.traverse(node => {
      if (node.isPointLight) pointLights++;
      if (node.name === 'Studio_Acoustic_Diffuser') proceduralDiffusers.push(node);
    });
    return {
      roof: roof.map(describe),
      wall: [...shell, ...booth].filter(material => material.name === 'wall').map(describe),
      floor: shell.filter(material => material.name === 'Ground_mtl').map(describe),
      authoredDiffuserNames: authoredDiffusers.map(object => object?.name),
      authoredDiffuserMaterials,
      proceduralDiffuserCount: proceduralDiffusers.length,
      pointLights,
      rgbLights: atmosphere.lights.length,
      rgbPanels: atmosphere.panels.flat().length,
      uniquePanelMaterials: new Set(atmosphere.panels.flat()).size,
      panelColors: atmosphere.panels.flat().map(material => material.color.toArray()),
      perimeter: atmosphere.perimeterMaterials.map(describe),
      perimeterGlowOpacities: atmosphere.perimeterBars.glows.map(material => material.opacity),
      perimeterSpillOpacities: atmosphere.perimeterBars.spills.map(material => material.opacity),
      perimeterDimensions: atmosphere.perimeterBars.dimensions,
      lightIntensities: atmosphere.lights.map(light => light.intensity),
      perimeterBarCount: atmosphere.perimeterBars.cores.length,
      fixtureCoverInScene: scene.getObjectById(atmosphere.fixtureCover.id) === atmosphere.fixtureCover,
      twinkleCount: atmosphere.twinkles.geometry.attributes.position.count,
      twinklesInScene: scene.getObjectById(atmosphere.twinkles.id) === atmosphere.twinkles,
      lightsInScene: atmosphere.lights.every(light => scene.getObjectById(light.id) === light),
    };
  });

  expect(room.roof.length).toBeGreaterThan(0);
  const ceilingMaterials = room.roof.filter(material => material.name !== 'roof_light');
  expect(ceilingMaterials.length).toBeGreaterThan(0);
  for (const material of ceilingMaterials) {
    expect(Math.max(...material.color)).toBeLessThan(0.02);
    expect(material.emissiveMap).toBe('Roof_texture');
  }
  expect(Math.max(...room.perimeter.map(material => material.emissiveIntensity))).toBe(0);
  expect(room.wall.length).toBeGreaterThan(0);
  for (const wall of room.wall) {
    expect(wall.color).toEqual(originalWall.pbrMetallicRoughness.baseColorFactor?.slice(0, 3) ?? [1, 1, 1]);
    expect(wall.roughness).toBeCloseTo(originalWall.pbrMetallicRoughness.roughnessFactor ?? 1, 6);
    expect(wall.metalness).toBe(originalWall.pbrMetallicRoughness.metallicFactor ?? 1);
  }
  expect(room.floor).toHaveLength(1);
  expect(room.floor[0].color).toEqual(originalFloor.pbrMetallicRoughness.baseColorFactor?.slice(0, 3) ?? [1, 1, 1]);
  expect(room.floor[0].roughness).toBeCloseTo(originalFloor.pbrMetallicRoughness.roughnessFactor, 6);
  expect(room.floor[0].metalness).toBe(originalFloor.pbrMetallicRoughness.metallicFactor);
  expect(room.floor[0].map).toBe(true);
  expect(room.floor[0].repeat).toEqual([12, 6]);

  expect(room.authoredDiffuserNames).toEqual([
    'pCube146', 'pCube147', 'pCube148', 'pCube149', 'pCube150', 'pCube151',
  ]);
  expect(room.authoredDiffuserMaterials.slice(0, 4)).toEqual([
    ['Diffuser_Mat'], ['Diffuser_Mat'], ['Diffuser_Mat'], ['Diffuser_Mat'],
  ]);
  expect(room.authoredDiffuserMaterials.slice(4)).toEqual([
    ['Diffuser_fabric'], ['Diffuser_fabric'],
  ]);
  expect(room.proceduralDiffuserCount).toBe(0);
  // Four recolored room lights, one booth light, desk and camera fill.
  expect(room.pointLights).toBe(7);
  expect(room.rgbLights).toBe(4);
  expect(room.rgbPanels).toBeGreaterThan(0);
  expect(room.uniquePanelMaterials).toBe(room.rgbPanels);
  for (const color of room.panelColors) expect(Math.max(...color)).toBeLessThan(0.02);
  expect(room.perimeter.length).toBeGreaterThan(0);
  expect(Math.max(...room.perimeter[0].color)).toBeLessThan(0.02);
  expect(Math.max(...room.perimeter[0].emissive)).toBe(0);
  expect(Math.min(...room.perimeterGlowOpacities)).toBeGreaterThanOrEqual(0.14);
  expect(Math.max(...room.perimeterGlowOpacities)).toBeLessThanOrEqual(0.22);
  expect(Math.min(...room.perimeterSpillOpacities)).toBeGreaterThanOrEqual(0.03);
  expect(Math.max(...room.perimeterSpillOpacities)).toBeLessThanOrEqual(0.07);
  expect(room.perimeterDimensions.coreDepth).toBeCloseTo(0.072, 3);
  expect(room.perimeterDimensions.glowDepth).toBeCloseTo(0.24, 3);
  expect(room.perimeterDimensions.spillDepth).toBeCloseTo(0.48, 3);
  expect(Math.max(...room.lightIntensities)).toBeLessThanOrEqual(4.05);
  expect(room.perimeterBarCount).toBe(4);
  expect(room.fixtureCoverInScene).toBe(true);
  expect(room.twinkleCount).toBeGreaterThanOrEqual(130);
  expect(room.twinklesInScene).toBe(true);
  expect(room.lightsInScene).toBe(true);
});

test('ambient blue lighting glows slowly, freezes for reduced motion and resumes', async ({ page }) => {
  await ready(page);
  const sampleFrames = () => page.evaluate(() => new Promise(resolve => {
    const frames = [];
    const next = () => {
      const { lights, panels, ambientLight } = __studio.atmosphere;
      frames.push([
        ...lights.flatMap(light => [...light.color.toArray(), light.intensity]),
        ...panels.flat().flatMap(material => [...material.emissive.toArray(), material.emissiveIntensity]),
        ...ambientLight.color.toArray(), ambientLight.intensity,
      ]);
      if (frames.length === 16) resolve(frames);
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }));

  const moving = await sampleFrames();
  expect(moving.at(-1)).not.toEqual(moving[0]);
  for (let frame = 1; frame < moving.length; frame++) {
    for (let channel = 0; channel < moving[frame].length; channel++) {
      const previous = moving[frame - 1][channel];
      const normalizedChange = Math.abs(moving[frame][channel] - previous) / Math.max(1, Math.abs(previous));
      expect(normalizedChange).toBeLessThan(0.025);
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await sampleFrames();
  expect(still.every(frame => JSON.stringify(frame) === JSON.stringify(still[0]))).toBe(true);
  expect(still[0].some(value => value > 0)).toBe(true);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const resumed = await sampleFrames();
  expect(resumed.at(-1)).not.toEqual(resumed[0]);

  const perimeterSequence = await page.evaluate(() => {
    const atmosphere = __studio.atmosphere;
    const advanceTo = target => {
      const delta = (target - atmosphere.elapsed % 24 + 24) % 24;
      atmosphere.update(delta, false);
      return atmosphere.perimeterBars.cores[0].color.toArray();
    };
    return { coolA: advanceTo(9), coolB: advanceTo(20) };
  });
  expect(perimeterSequence.coolA[2]).toBeGreaterThan(perimeterSequence.coolA[0] + 0.1);
  expect(perimeterSequence.coolB[2]).toBeGreaterThan(perimeterSequence.coolB[0] + 0.1);
  expect(perimeterSequence.coolB).not.toEqual(perimeterSequence.coolA);

  const twinkleFrames = await page.evaluate(() => new Promise(resolve => {
    const frames = [];
    const next = () => {
      frames.push(Array.from(__studio.atmosphere.twinkles.geometry.attributes.color.array.slice(0, 24)));
      if (frames.length === 12) resolve(frames);
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }));
  expect(twinkleFrames.at(-1)).not.toEqual(twinkleFrames[0]);
});
