import { describe, it, expect } from 'vitest';
import {
  createEmptyGrid,
  createDefaultGrid,
  getDefaultCells,
  toggleCell,
  setCell,
} from './grid';

describe('createEmptyGrid', () => {
  it('creates grid with all cells set to 0', () => {
    const grid = createEmptyGrid(4, 16);
    expect(grid.numRows).toBe(4);
    expect(grid.numCols).toBe(16);
    for (const row of grid.cells) {
      expect(row.every((c) => c === 0)).toBe(true);
    }
  });
});

describe('createDefaultGrid', () => {
  it('has active cells', () => {
    const grid = createDefaultGrid(4, 16);
    const filled = grid.cells.flat().filter((c) => c > 0);
    expect(filled.length).toBeGreaterThan(0);
  });

  it('returns empty for undersized grids', () => {
    const grid = createDefaultGrid(2, 8);
    const filled = grid.cells.flat().filter((c) => c > 0);
    expect(filled).toHaveLength(0);
  });
});

describe('getDefaultCells', () => {
  it('returns positions matching the default grid', () => {
    const cells = getDefaultCells(4, 16);
    const grid = createDefaultGrid(4, 16);

    expect(cells.length).toBeGreaterThan(0);

    // Every returned position should be active in the default grid
    for (const [r, c] of cells) {
      expect(grid.cells[r][c]).toBeGreaterThan(0);
    }

    // Count should match total active cells
    const totalActive = grid.cells.flat().filter((v) => v > 0).length;
    expect(cells).toHaveLength(totalActive);
  });

  it('returns empty for undersized grids', () => {
    expect(getDefaultCells(2, 8)).toHaveLength(0);
  });
});

describe('toggleCell', () => {
  it('toggles 0 to 1', () => {
    const grid = createEmptyGrid(4, 16);
    const next = toggleCell(grid, 1, 3);
    expect(next.cells[1][3]).toBe(1);
  });

  it('toggles 1 to 0', () => {
    const grid = createDefaultGrid(4, 16);
    // Find a cell that's active
    const cells = getDefaultCells(4, 16);
    const [r, c] = cells[0];
    const next = toggleCell(grid, r, c);
    expect(next.cells[r][c]).toBe(0);
  });

  it('does not mutate original grid', () => {
    const grid = createEmptyGrid(4, 16);
    toggleCell(grid, 0, 0);
    expect(grid.cells[0][0]).toBe(0);
  });
});

describe('setCell', () => {
  it('sets cell to specified value', () => {
    const grid = createEmptyGrid(4, 16);
    const next = setCell(grid, 2, 5, 1);
    expect(next.cells[2][5]).toBe(1);
  });

  it('returns same reference if value unchanged', () => {
    const grid = createEmptyGrid(4, 16);
    const same = setCell(grid, 0, 0, 0);
    expect(same).toBe(grid);
  });
});
