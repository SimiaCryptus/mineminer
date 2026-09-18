import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

/**
 * Geometry of one cell of a tessellation, scaled by `factor` around the cell centre.
 * Flat-shaded and textured so every shape reads like a block of stone.
 */
export function cellGeometry(tess, factor = 1) {
  const s = tess.shape;
  if (s.type === 'box') return new THREE.BoxGeometry(factor, factor, factor);
  if (s.type === 'prism') {
    const g = new THREE.CylinderGeometry(
      s.radius * factor,
      s.radius * factor,
      s.height * factor,
      s.sides,
      1
    ).toNonIndexed();
    g.computeVertexNormals(); // flat faces, not a smooth-shaded tube
    // One texture tile per side face instead of a single tile stretched around the prism.
    const uv = g.attributes.uv;
    const nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++)
      if (Math.abs(nrm.getY(i)) < 0.5) uv.setX(i, uv.getX(i) * s.sides);
    return g;
  }
  const pts = s.vertices.map(([x, y, z]) => new THREE.Vector3(x * factor, y * factor, z * factor));
  const g = new ConvexGeometry(pts);
  boxProjectUvs(g);
  return g;
}

/** ConvexGeometry has no UVs: project each face along its dominant normal axis. */
function boxProjectUvs(g) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u;
    let v;
    if (nx >= ny && nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u + 0.5;
    uv[i * 2 + 1] = v + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
