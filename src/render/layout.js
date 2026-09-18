/**
 * World layout is owned by the Grid's tessellation: the board is centred on x = z = 0
 * with its lowest point on y = 0 (see Grid.bounds). For cubes that is the familiar
 * x ∈ [-w/2, w/2], y ∈ [0, h], z ∈ [-d/2, d/2] with cell (x, y, z) centred at
 * (x - w/2 + 0.5, y + 0.5, z - d/2 + 0.5).
 */
export function cellCenter(grid, i, out) {
  return grid.centreOf(i, out);
}

/** World point -> cell index, or -1 if outside the play volume. */
export function worldToCell(grid, x, y, z) {
  return grid.cellAt(x, y, z);
}
