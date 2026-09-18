import * as THREE from 'three';
import { cellCenter } from './layout.js';
import { cellGeometry } from './shapes.js';

/** Minecraft-style selection outline around the aimed block, shaped like the board's cells. */
export class Highlighter {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 5;
    this.innerMat = new THREE.LineBasicMaterial({ color: 0x000000 });
    this.outerMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
    });
    scene.add(this.group);
    this.cell = -1;
  }

  /** Rebuilds the outline for a tessellation's cell shape. */
  setShape(tess) {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry.dispose();
    }
    const outline = (factor, mat) => {
      const solid = cellGeometry(tess, factor);
      const edges = new THREE.EdgesGeometry(solid, 10);
      solid.dispose();
      return new THREE.LineSegments(edges, mat);
    };
    this.group.add(outline(1.03, this.innerMat), outline(1.07, this.outerMat));
  }

  set(grid, cell) {
    if (cell < 0 || !grid) {
      this.hide();
      return;
    }
    this.cell = cell;
    cellCenter(grid, cell, this.group.position);
    this.group.visible = true;
  }

  hide() {
    this.cell = -1;
    this.group.visible = false;
  }
}
