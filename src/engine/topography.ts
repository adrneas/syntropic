import type { GridCoordinate, TopographySummary } from '../core/types/generation';
import type { TerrainState } from '../core/types/terrain';
import { getGridIndex, sampleElevation } from '../core/utils/terrain';

// Slope percentage at or below which a cell is considered functionally flat
// (used to classify flat cells and to discount pathfinding costs on flat terrain)
export const FLAT_SLOPE_THRESHOLD_PERCENT = 6;

// Slope percentage above which a cell is classified as a restricted zone
// (too steep for most infrastructure and human movement)
const RESTRICTED_SLOPE_THRESHOLD_PERCENT = 45;

// Maximum flow-direction index (D8 uses 8 neighbors, indexed 0–7)
const MAX_FLOW_DIRECTION_INDEX = 7;

// Number of decimal places used when rounding elevation summary values
const ELEVATION_SUMMARY_PRECISION = 2;

const NEIGHBOR_OFFSETS = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
] as const;

export interface TopographyAnalysis {
  flatCellGrid: Uint8Array;
  flowAccumulationGrid: Uint16Array;
  flowDirectionGrid: Int8Array;
  restrictionGrid: Uint8Array;
  sinkCoordinates: GridCoordinate[];
  slopeGrid: Float32Array;
  summary: TopographySummary;
}

export function analyzeTopography(terrain: TerrainState): TopographyAnalysis {
  const totalCells = terrain.gridWidth * terrain.gridHeight;
  const flatCellGrid = new Uint8Array(totalCells);
  const slopeGrid = new Float32Array(totalCells);
  const flowDirectionGrid = new Int8Array(totalCells).fill(-1);
  const restrictionGrid = new Uint8Array(totalCells);
  const sinkCoordinates: GridCoordinate[] = [];

  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  let sumElevation = 0;
  let flatCellCount = 0;
  let maxSlopePercent = 0;
  let restrictedCellCount = 0;

  for (let gridY = 0; gridY < terrain.gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth; gridX += 1) {
      const index = getGridIndex(gridX, gridY, terrain.gridWidth);
      const centerElevation = terrain.elevationGrid[index] ?? 0;

      minElevation = Math.min(minElevation, centerElevation);
      maxElevation = Math.max(maxElevation, centerElevation);
      sumElevation += centerElevation;

      let bestDrop = 0;
      let bestDirection = -1;
      let localMaxSlope = 0;

      NEIGHBOR_OFFSETS.forEach((offset, directionIndex) => {
        const neighborX = gridX + offset.x;
        const neighborY = gridY + offset.y;

        if (
          neighborX < 0 ||
          neighborX >= terrain.gridWidth ||
          neighborY < 0 ||
          neighborY >= terrain.gridHeight
        ) {
          return;
        }

        const neighborElevation = sampleElevation(
          terrain.elevationGrid,
          terrain.gridWidth,
          neighborX,
          neighborY,
        );
        const elevationDelta = neighborElevation - centerElevation;
        const distance = terrain.cellSize * (Math.abs(offset.x) + Math.abs(offset.y) === 2 ? Math.SQRT2 : 1);
        const slopePercent = Math.abs(elevationDelta / distance) * 100;

        if (slopePercent > localMaxSlope) {
          localMaxSlope = slopePercent;
        }

        if (elevationDelta < bestDrop) {
          bestDrop = elevationDelta;
          bestDirection = directionIndex;
        }
      });

      slopeGrid[index] = localMaxSlope;
      flowDirectionGrid[index] = bestDirection;
      maxSlopePercent = Math.max(maxSlopePercent, localMaxSlope);

      if (localMaxSlope <= FLAT_SLOPE_THRESHOLD_PERCENT) {
        flatCellGrid[index] = 1;
        flatCellCount += 1;
      }

      if (localMaxSlope > RESTRICTED_SLOPE_THRESHOLD_PERCENT) {
        restrictionGrid[index] = 1;
        restrictedCellCount += 1;
      }

      if (bestDirection === -1) {
        sinkCoordinates.push({ x: gridX, y: gridY });
      }
    }
  }

  const flowAccumulationGrid = computeFlowAccumulation(
    flowDirectionGrid,
    terrain.gridWidth,
    terrain.gridHeight,
  );

  return {
    flatCellGrid,
    flowAccumulationGrid,
    flowDirectionGrid,
    restrictionGrid,
    sinkCoordinates,
    slopeGrid,
    summary: {
      minElevation: roundTo(minElevation, ELEVATION_SUMMARY_PRECISION),
      maxElevation: roundTo(maxElevation, ELEVATION_SUMMARY_PRECISION),
      averageElevation: roundTo(sumElevation / totalCells, ELEVATION_SUMMARY_PRECISION),
      maxSlopePercent: roundTo(maxSlopePercent, ELEVATION_SUMMARY_PRECISION),
      flatCellCount,
      restrictedCellCount,
      sinkCount: sinkCoordinates.length,
    },
  };
}

/**
 * Compute flow accumulation from D8 flow direction grid.
 * Each cell counts how many upstream cells drain into it.
 * High accumulation values indicate drainage lines (talvegues).
 *
 * Algorithm: topological sort by computing in-degree, then BFS from
 * cells with zero in-degree (ridgelines), propagating flow downstream.
 */
function computeFlowAccumulation(
  flowDirectionGrid: Int8Array,
  gridWidth: number,
  gridHeight: number,
): Uint16Array {
  const totalCells = gridWidth * gridHeight;
  const accumulation = new Uint16Array(totalCells); // each cell starts with 1 (itself)
  const inDegree = new Uint16Array(totalCells);

  // Compute in-degree: count how many cells flow into each cell
  for (let index = 0; index < totalCells; index += 1) {
    const direction = flowDirectionGrid[index];

    if (direction < 0 || direction > MAX_FLOW_DIRECTION_INDEX) {
      continue;
    }

    const cellX = index % gridWidth;
    const cellY = Math.floor(index / gridWidth);
    const offset = NEIGHBOR_OFFSETS[direction];
    const targetX = cellX + offset.x;
    const targetY = cellY + offset.y;

    if (targetX >= 0 && targetX < gridWidth && targetY >= 0 && targetY < gridHeight) {
      inDegree[targetY * gridWidth + targetX] += 1;
    }
  }

  // Initialize: each cell contributes 1 (itself)
  accumulation.fill(1);

  // BFS from cells with zero in-degree (ridgelines/peaks)
  const queue: number[] = [];

  for (let index = 0; index < totalCells; index += 1) {
    if (inDegree[index] === 0) {
      queue.push(index);
    }
  }

  let head = 0;

  while (head < queue.length) {
    const currentIndex = queue[head];
    head += 1;

    const direction = flowDirectionGrid[currentIndex];

    if (direction < 0 || direction > MAX_FLOW_DIRECTION_INDEX) {
      continue;
    }

    const cellX = currentIndex % gridWidth;
    const cellY = Math.floor(currentIndex / gridWidth);
    const offset = NEIGHBOR_OFFSETS[direction];
    const targetX = cellX + offset.x;
    const targetY = cellY + offset.y;

    if (targetX < 0 || targetX >= gridWidth || targetY < 0 || targetY >= gridHeight) {
      continue;
    }

    const targetIndex = targetY * gridWidth + targetX;
    accumulation[targetIndex] += accumulation[currentIndex];
    inDegree[targetIndex] -= 1;

    if (inDegree[targetIndex] === 0) {
      queue.push(targetIndex);
    }
  }

  return accumulation;
}

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
