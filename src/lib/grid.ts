import type { GridState, CellValue } from './types';

/** Create an empty grid with all cells set to 0 */
export function createEmptyGrid(numRows: number, numCols: number): GridState {
  const cells: CellValue[][] = Array.from({ length: numRows }, () =>
    Array.from({ length: numCols }, () => 0)
  );
  return { cells, numRows, numCols };
}

/**
 * Create the default starter grid — a recognizable beat pattern.
 * 16 sub-columns (pairs of 2 = 8 beats). Each pair: left = on-beat, right = "and".
 *
 * 4-row layout (top to bottom): sparkle, rhythm, groove, pulse
 *
 *   Beat:  1 . 2 . 3 . 4 . 5 . 6 . 7 . 8 .
 *   Col:   0 1 2 3 4 5 6 7 8 9 ...
 *
 *   SPARK .  .  .  .  .  .  1  .  .  .  .  1  .  .  .  .
 *   RHYTH .  .  1  .  .  .  1  .  .  .  1  .  .  .  1  .
 *   GROOV .  .  .  .  1  .  .  .  .  .  .  .  1  .  .  .
 *   PULSE 1  .  .  1  .  .  .  .  1  .  1  .  .  .  .  .
 */
export function createDefaultGrid(numRows: number, numCols: number): GridState {
  const grid = createEmptyGrid(numRows, numCols);

  if (numRows < 4 || numCols < 16) return grid;

  // Row 0 — Sparkle (cymbal + arp)
  grid.cells[0][6] = 1;
  grid.cells[0][11] = 1;  // offbeat — triggers descending arp
  // Row 1 — Rhythm (hat + stab)
  grid.cells[1][2] = 1;
  grid.cells[1][6] = 1;
  grid.cells[1][10] = 1;
  grid.cells[1][14] = 1;
  // Row 2 — Groove (snare + groove stab)
  grid.cells[2][4] = 1;
  grid.cells[2][12] = 1;
  // Row 3 — Pulse (kick + bass)
  grid.cells[3][0] = 1;
  grid.cells[3][3] = 1;
  grid.cells[3][8] = 1;
  grid.cells[3][10] = 1;

  return grid;
}

/** Get the filled cell positions from the default grid (for staggered reveal) */
export function getDefaultCells(numRows: number, numCols: number): [number, number][] {
  const grid = createDefaultGrid(numRows, numCols);
  const cells: [number, number][] = [];
  for (let r = 0; r < grid.numRows; r++) {
    for (let c = 0; c < grid.numCols; c++) {
      if (grid.cells[r][c] > 0) cells.push([r, c]);
    }
  }
  return cells;
}

/** Toggle a cell on/off */
export function toggleCell(
  grid: GridState,
  row: number,
  col: number,
): GridState {
  const newCells = grid.cells.map((r) => [...r]);
  newCells[row][col] = newCells[row][col] === 0 ? 1 : 0;
  return { ...grid, cells: newCells };
}

/** Cycle a cell to the next state (0 → 1 → 2 → ... → maxValue → 0) */
export function cycleCell(
  grid: GridState,
  row: number,
  col: number,
  maxValue: number,
): GridState {
  const newCells = grid.cells.map((r) => [...r]);
  const current = newCells[row][col];
  newCells[row][col] = current >= maxValue ? 0 : current + 1;
  return { ...grid, cells: newCells };
}

/** Set a cell to a specific value */
export function setCell(
  grid: GridState,
  row: number,
  col: number,
  value: CellValue,
): GridState {
  if (grid.cells[row][col] === value) return grid;
  const newCells = grid.cells.map((r) => [...r]);
  newCells[row][col] = value;
  return { ...grid, cells: newCells };
}

/**
 * Get the loop length. Currently fixed to the full grid width.
 * TODO: Reactive loop length (rightmost filled column, snap to power of 2)
 */
export function getLoopLength(grid: GridState): number {
  return grid.numCols;
}
