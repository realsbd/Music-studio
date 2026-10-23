import { Matrix4, Vector3 } from 'three';

const AXES = ['x', 'y', 'z'];
const SKIN = 1e-5;
const SHELL = /^(Main_Studio|Studio_Block|RecordingBooth|Roof)(?:_\d+)?$/;

// Camera movement uses cached, expanded mesh bounds rather than raycasting
// the detailed studio on every frame. The expansion protects the near plane
// and gives even zero-thickness light panels a solid collision volume.
export function createCameraCollision({ radius = 0.20, bounds = null } = {}) {
  const obstacles = [];
  const registered = new WeakSet();
  const position = new Vector3();
  const destination = new Vector3();
  const remaining = new Vector3();
  const candidate = new Vector3();
  const best = new Vector3();
  const matrix = new Matrix4();
  const instanceMatrix = new Matrix4();

  function inside(point, box) {
    return point.x > box.min.x && point.x < box.max.x &&
      point.y > box.min.y && point.y < box.max.y &&
      point.z > box.min.z && point.z < box.max.z;
  }

  function isClear(point) {
    return (!bounds || bounds.containsPoint(point)) && !obstacles.some(box => inside(point, box));
  }

  function addBox(box) {
    if (!box.isEmpty()) {
      const expanded = box.clone().expandByScalar(radius);
      if (!bounds || expanded.intersectsBox(bounds)) obstacles.push(expanded);
    }
    return api;
  }

  // Call once after adding each static model/group to the scene. Skipping a
  // group also skips its descendants, including GLTF multi-material shells.
  // Mark visual effects with userData.cameraCollision = false to opt out.
  function addModel(root, { exclude = () => false } = {}) {
    root.updateWorldMatrix(true, true);
    function visit(node) {
      if (!node.visible || node.userData.cameraCollision === false ||
          SHELL.test(node.name) || /^smoke/i.test(node.name) || exclude(node)) return;
      if (node.isMesh && node.geometry && !registered.has(node)) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (materials.some(material => material?.visible !== false &&
            (!material?.transparent || material.opacity > 0))) {
          if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
          const localBox = node.geometry.boundingBox;
          if (localBox) {
            if (node.isInstancedMesh) {
              for (let index = 0; index < node.count; index++) {
                node.getMatrixAt(index, instanceMatrix);
                matrix.multiplyMatrices(node.matrixWorld, instanceMatrix);
                addBox(localBox.clone().applyMatrix4(matrix));
              }
            } else {
              addBox(localBox.clone().applyMatrix4(node.matrixWorld));
            }
          }
          registered.add(node);
        }
      }
      node.children.forEach(visit);
    }
    visit(root);
    return api;
  }

  // Recover safely if a model is registered around the current camera.
  // Search along all six axes through the UNION of overlapping boxes, so
  // sofa cushions cannot push the camera back and forth into one another.
  function depenetrate(point) {
    if (isClear(point)) return;
    let bestDistance = Infinity;
    for (const axis of AXES) {
      for (const sign of [-1, 1]) {
        candidate.copy(point);
        for (let step = 0; step <= obstacles.length; step++) {
          let moved = false;
          for (const box of obstacles) {
            if (!inside(candidate, box)) continue;
            candidate[axis] = sign < 0 ? box.min[axis] - SKIN : box.max[axis] + SKIN;
            moved = true;
          }
          if (!moved || (bounds && !bounds.containsPoint(candidate))) break;
        }
        const distance = candidate.distanceToSquared(point);
        if (distance < bestDistance && isClear(candidate)) {
          best.copy(candidate);
          bestDistance = distance;
        }
      }
    }
    if (bestDistance < Infinity) point.copy(best);
  }

  // Sweep the entire movement segment, not just its endpoint: a fast wheel
  // zoom or a reduced-motion fly-to cannot tunnel through a sofa or lamp.
  function firstHit(origin, delta) {
    let hit = null;
    for (const box of obstacles) {
      let enter = -Infinity;
      let leave = Infinity;
      let hitAxis = null;
      let hitSign = 0;
      for (const axis of AXES) {
        if (Math.abs(delta[axis]) < 1e-12) {
          if (origin[axis] <= box.min[axis] || origin[axis] >= box.max[axis]) {
            leave = -Infinity;
            break;
          }
          continue;
        }
        const first = (box.min[axis] - origin[axis]) / delta[axis];
        const second = (box.max[axis] - origin[axis]) / delta[axis];
        const near = Math.min(first, second);
        if (near > enter) {
          enter = near;
          hitAxis = axis;
          hitSign = delta[axis] > 0 ? -1 : 1;
        }
        leave = Math.min(leave, Math.max(first, second));
      }
      if (enter >= 0 && enter <= 1 && leave > enter && (!hit || enter < hit.time)) {
        hit = { time: enter, axis: hitAxis, sign: hitSign };
      }
    }
    return hit;
  }

  // previous must be the LAST RESOLVED camera position, including when
  // OrbitControls has already changed the desired position in an event.
  // output may alias either input. Room bounds are camera-center limits.
  function resolve(previous, desired, output = desired) {
    position.copy(previous);
    destination.copy(desired);
    if (bounds) {
      position.clamp(bounds.min, bounds.max);
      destination.clamp(bounds.min, bounds.max);
    }
    depenetrate(position);
    remaining.subVectors(destination, position);
    // Each collision removes movement along one axis, so three contacts
    // suffice. One extra pass consumes the final unobstructed slide.
    for (let pass = 0; pass < 4 && remaining.lengthSq() > 1e-16; pass++) {
      const hit = firstHit(position, remaining);
      if (!hit) {
        position.add(remaining);
        break;
      }
      position.addScaledVector(remaining, hit.time);
      position[hit.axis] += hit.sign * SKIN;
      remaining.multiplyScalar(1 - hit.time);
      remaining[hit.axis] = 0;
    }
    if (bounds) position.clamp(bounds.min, bounds.max);
    depenetrate(position);
    return output.copy(position);
  }

  const api = { addBox, addModel, resolve, isClear, get count() { return obstacles.length; } };
  return api;
}
