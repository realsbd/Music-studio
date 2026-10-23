import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { createCameraCollision } from '../camera-collision.js';

const v = (x, y, z) => new Vector3(x, y, z);
const box = (min, max) => new Box3(v(...min), v(...max));
const furniture = () => createCameraCollision({ radius: 0.2 })
  .addBox(box([-1, 0, -1], [1, 1, 1]));

test('fast zoom sweeps the whole sofa and leaves camera clearance', () => {
  const collision = furniture();
  const result = collision.resolve(v(0, 0.5, 5), v(0, 0.5, -5));
  assert.ok(result.z >= 1.2 && result.z < 1.201);
  assert.ok(collision.isClear(result));
});

test('oblique movement slides along furniture and permits moving away', () => {
  const collision = furniture();
  const result = collision.resolve(v(0, 0.5, 3), v(1.5, 0.5, 0));
  assert.equal(result.x, 1.5);
  assert.ok(result.z >= 1.2);
  const away = collision.resolve(result, v(2, 0.5, 4));
  assert.deepEqual(away.toArray(), [2, 0.5, 4]);
});

test('repeated contact cannot creep into a surface and tangent movement stays free', () => {
  const collision = furniture();
  let point = v(0, 0.5, 3);
  for (let frame = 0; frame < 120; frame++) {
    point = collision.resolve(point, v(0, 0.5, -2));
    assert.ok(collision.isClear(point));
    assert.ok(point.z >= 1.2);
  }
  const tangent = collision.resolve(point, v(1, 0.5, point.z));
  assert.equal(tangent.x, 1);
  const away = collision.resolve(tangent, v(1, 0.5, 3));
  assert.equal(away.z, 3);
});

test('a zero-thickness horizontal fixture blocks upward zoom', () => {
  const model = new Group();
  const light = new Mesh(new PlaneGeometry(1.3, 1.3), new MeshBasicMaterial());
  light.name = 'Light.001';
  light.rotation.x = -Math.PI / 2;
  light.position.set(-2.4, 2.57, 0.6);
  model.add(light);
  const collision = createCameraCollision({ radius: 0.2 }).addModel(model);
  const result = collision.resolve(v(-2.4, 1.5, 0.6), v(-2.4, 3, 0.6));
  assert.ok(result.y <= 2.37 && result.y > 2.369);
  assert.ok(collision.isClear(result));
});

test('overlapping cushions cannot trap an embedded camera or push it outside the room', () => {
  const bounds = box([-2, 0.45, -2], [2, 2.58, 2]);
  const collision = createCameraCollision({ radius: 0.2, bounds })
    .addBox(box([0, -1, -3], [1.3, 4, 3]))
    .addBox(box([1, -1, -3], [2.5, 4, 3]));
  const point = v(1.2, 1.5, 0);
  const result = collision.resolve(point, point.clone());
  assert.ok(collision.isClear(result));
  assert.ok(result.x <= -0.2);
  assert.ok(bounds.containsPoint(result));
});

test('multiple surfaces stop a diagonal move into a corner', () => {
  const collision = createCameraCollision({ radius: 0.2 })
    .addBox(box([0, -1, -5], [1, 3, 5]))
    .addBox(box([-5, -1, 0], [5, 3, 1]));
  const result = collision.resolve(v(-2, 1, -2), v(3, 1, 3));
  assert.ok(result.x <= -0.2 && result.z <= -0.2);
  assert.ok(collision.isClear(result));
});

test('registration caches transformed meshes once and skips shells and visual effects', () => {
  const model = new Group();
  model.position.set(5, 0, 0);
  const material = new MeshBasicMaterial();
  const sofa = new Mesh(new BoxGeometry(2, 1, 2), material);
  sofa.position.set(0, 0.5, 0);
  model.add(sofa);
  for (const name of ['Main_Studio', 'Roof', 'Studio_Block', 'RecordingBooth', 'smoke_big']) {
    const group = new Group();
    group.name = name;
    group.add(new Mesh(new BoxGeometry(20, 20, 20), material));
    model.add(group);
  }
  const effect = new Mesh(new BoxGeometry(20, 20, 20), material);
  effect.userData.cameraCollision = false;
  model.add(effect);
  const hidden = new Group();
  hidden.visible = false;
  hidden.add(new Mesh(new BoxGeometry(20, 20, 20), material));
  model.add(hidden);
  const collision = createCameraCollision().addModel(model).addModel(model);
  assert.equal(collision.count, 1);
  assert.ok(collision.isClear(v(0, 0.5, 0)));
  assert.equal(collision.isClear(v(5, 0.5, 0)), false);
});
