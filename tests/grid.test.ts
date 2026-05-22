import { describe, it, expect } from 'vitest';
import {
  createEmptyGrid,
  createDefaultGrid,
  cycleCell,
  toggleCell,
  setCell,
  getLoopLength,
} from '../src/lib/grid';

describe('createEmptyGrid', () => {
  it('creates a grid of the correct dimensions', () => {
    const grid = createEmptyGrid(4, 16);
    expect(grid.numRows).toBe(4);
    expect(grid.numCols).toBe(16);
    expect(grid.cells.length).toBe(4);
    expect(grid.cells[0].length).toBe(16);
  });

  it('initializes all cells to 0', () => {
    const grid = createEmptyGrid(6, 16);
    for (const row of grid.cells) {
      for (const cell of row) {
        expect(cell).toBe(0);
      }
    }
  });
});

describe('createDefaultGrid', () => {
  it('fills starter pattern for 4x16 grid', () => {
    const grid = createDefaultGrid(4, 16);
    // Sparkle (row 0) — cymbal + arp
    expect(grid.cells[0][6]).toBe(1);
    expect(grid.cells[0][11]).toBe(1);
    // Rhythm (row 1) — hats on even offbeats
    expect(grid.cells[1][2]).toBe(1);
    expect(grid.cells[1][6]).toBe(1);
    expect(grid.cells[1][10]).toBe(1);
    expect(grid.cells[1][14]).toBe(1);
    // Groove (row 2) — snare on beats 3 and 7
    expect(grid.cells[2][4]).toBe(1);
    expect(grid.cells[2][12]).toBe(1);
    // Pulse (row 3) — kick
    expect(grid.cells[3][0]).toBe(1);
    expect(grid.cells[3][3]).toBe(1);
    expect(grid.cells[3][8]).toBe(1);
    expect(grid.cells[3][10]).toBe(1);
  });

  it('returns empty grid for small dimensions', () => {
    const grid = createDefaultGrid(3, 8);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        expect(grid.cells[r][c]).toBe(0);
      }
    }
  });
});

describe('toggleCell', () => {
  it('toggles 0 to 1', () => {
    const grid = createEmptyGrid(2, 4);
    const result = toggleCell(grid, 0, 0);
    expect(result.cells[0][0]).toBe(1);
  });

  it('toggles 1 to 0', () => {
    const grid = createEmptyGrid(2, 4);
    grid.cells[0][0] = 1;
    const result = toggleCell(grid, 0, 0);
    expect(result.cells[0][0]).toBe(0);
  });

  it('does not mutate the original grid', () => {
    const grid = createEmptyGrid(2, 4);
    toggleCell(grid, 0, 0);
    expect(grid.cells[0][0]).toBe(0);
  });
});

describe('cycleCell', () => {
  it('cycles from 0 to 1', () => {
    const grid = createEmptyGrid(2, 4);
    const result = cycleCell(grid, 0, 0, 1);
    expect(result.cells[0][0]).toBe(1);
  });

  it('cycles from max back to 0', () => {
    const grid = createEmptyGrid(2, 4);
    grid.cells[0][0] = 1;
    const result = cycleCell(grid, 0, 0, 1);
    expect(result.cells[0][0]).toBe(0);
  });

  it('does not mutate the original grid', () => {
    const grid = createEmptyGrid(2, 4);
    cycleCell(grid, 0, 0, 1);
    expect(grid.cells[0][0]).toBe(0);
  });
});

describe('setCell', () => {
  it('sets a cell to a specific value', () => {
    const grid = createEmptyGrid(2, 4);
    const result = setCell(grid, 0, 0, 1);
    expect(result.cells[0][0]).toBe(1);
  });

  it('returns same grid if value unchanged', () => {
    const grid = createEmptyGrid(2, 4);
    const result = setCell(grid, 0, 0, 0);
    expect(result).toBe(grid);
  });

  it('does not mutate the original grid', () => {
    const grid = createEmptyGrid(2, 4);
    setCell(grid, 0, 0, 1);
    expect(grid.cells[0][0]).toBe(0);
  });
});

describe('getLoopLength', () => {
  it('returns full grid width (fixed at numCols)', () => {
    expect(getLoopLength(createEmptyGrid(4, 16))).toBe(16);
    expect(getLoopLength(createDefaultGrid(4, 16))).toBe(16);
    expect(getLoopLength(createEmptyGrid(4, 8))).toBe(8);
  });
});

describe('drag-to-paint behavior (setCell used for drag)', () => {
  it('painting empty cells to value 1 leaves already-1 cells unchanged', () => {
    let grid = createEmptyGrid(3, 4);
    grid = setCell(grid, 0, 0, 1);

    // Simulate drag: set all cells in row 0 to 1
    grid = setCell(grid, 0, 0, 1); // already 1, should return same ref for this cell
    grid = setCell(grid, 0, 1, 1);
    grid = setCell(grid, 0, 2, 1);

    expect(grid.cells[0][0]).toBe(1);
    expect(grid.cells[0][1]).toBe(1);
    expect(grid.cells[0][2]).toBe(1);
    expect(grid.cells[0][3]).toBe(0);
  });

  it('painting filled cells to 0 clears them', () => {
    let grid = createEmptyGrid(2, 4);
    grid = setCell(grid, 0, 0, 1);
    grid = setCell(grid, 0, 1, 1);
    grid = setCell(grid, 0, 2, 1);

    // Simulate drag-to-clear
    grid = setCell(grid, 0, 0, 0);
    grid = setCell(grid, 0, 1, 0);
    grid = setCell(grid, 0, 2, 0);

    expect(grid.cells[0][0]).toBe(0);
    expect(grid.cells[0][1]).toBe(0);
    expect(grid.cells[0][2]).toBe(0);
  });
});
