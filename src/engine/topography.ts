import type { GridCoordinate, TopographySummary } from '../core/types/generation';
import type { TerrainState } from '../core/types/terrain';
import { getGridIndex, sampleElevation } from '../core/utils/terrain';

export const FLAT_SLOPE_THRESHOLD_PERCENT = 6;

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

      if (localMaxSlope > 45) {
        restrictionGrid[index] = 1;
        restrictedCellCount += 1;
      }

      if (bestDirection === -1) {
        sinkCoordinates.push({ x: gridX, y: gridY });
      }
    }
  }

  return {
    flatCellGrid,
    flowDirectionGrid,
    restrictionGrid,
    sinkCoordinates,
    slopeGrid,
    summary: {
      minElevation: roundTo(minElevation),
      maxElevation: roundTo(maxElevation),
      averageElevation: roundTo(sumElevation / totalCells),
      maxSlopePercent: roundTo(maxSlopePercent),
      flatCellCount,
      restrictedCellCount,
      sinkCount: sinkCoordinates.length,
    },
  };
}

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
