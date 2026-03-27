import { describe, expect, it } from 'vitest';
import type { TerrainState } from '../../src/core/types/terrain';
import {
  buildPolygonMask,
  calculatePolygonArea,
  getGridIndex,
  gridToWorld,
  worldToGrid,
} from '../../src/core/utils/terrain';
import { generatePlantingLayout } from '../../src/engine/plantingLayout';
import { analyzeTopography } from '../../src/engine/topography';

describe('generatePlantingLayout', () => {
  it('extends planting rows into the upper plateau instead of stopping below the crest', () => {
    const terrain = createTerrain((world) => {
      if (world.y <= 2) {
        return (world.y + 24) * 0.34;
      }

      return 8.84;
    });
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);
    const rowCenters = layout.plantingRows.map(getGuideCenterY);
    const highestGuideElevation = Math.max(...layout.plantingRows.map((guide) => guide.averageElevation));

    expect(layout.plantingRows.length).toBeGreaterThan(4);
    expect(Math.max(...rowCenters)).toBeGreaterThan(12);
    expect(highestGuideElevation).toBeGreaterThan(topography.summary.maxElevation - 1.2);
  });

  it('spreads productive rows across flat terrain sectors instead of concentrating coverage in one band', () => {
    const terrain = createTerrain((world) => world.y * 0.05 + world.x * 0.008 + 3.2);
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);
    const coveredSectors = new Set(
      layout.plantingRows.map((guide) => getVerticalSector(getGuideCenterY(guide), -24, 24, 5)),
    );

    expect(layout.plantingRows.length).toBeGreaterThan(6);
    expect(coveredSectors.size).toBeGreaterThanOrEqual(4);
  });

  it('clips planting rows around occupied construction footprints', () => {
    const terrain = createTerrain((world) => world.y * 0.24 + 8);
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const occupationGrid = new Int32Array(terrain.gridWidth * terrain.gridHeight);

    fillOccupationRectangle(occupationGrid, terrain.gridWidth, 26, 22, 12, 20, -1);

    const layout = generatePlantingLayout(
      terrain,
      polygonMask,
      topography.slopeGrid,
      occupationGrid,
    );

    expect(layout.plantingRows.length).toBeGreaterThan(4);
    expect(
      layout.plantingRows.some((guide) =>
        guideIntersectsOccupiedCells(guide.points, occupationGrid, terrain),
      ),
    ).toBe(false);
  });

  it('does not generate interrows even when there is open space between rows', () => {
    const terrain = createTerrain(() => 0);
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);

    expect(layout.interRows).toEqual([]);
  });

  it('keeps interrows disabled on wavy terrain', () => {
    const terrain = createTerrain(
      (world) => world.y * 0.35 + Math.sin(world.x / 4) * 2.5 + Math.cos(world.y / 9) * 0.8,
    );
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);

    expect(layout.interRows).toEqual([]);
  });
});

function createTerrain(elevationAt: (world: { x: number; y: number }) => number): TerrainState {
  const polygon = [
    { x: -24, y: -24 },
    { x: 24, y: -24 },
    { x: 24, y: 24 },
    { x: -24, y: 24 },
  ];
  const gridWidth = 64;
  const gridHeight = 64;
  const cellSize = 1;
  const elevationGrid = new Float32Array(gridWidth * gridHeight);

  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const world = gridToWorld(gridX, gridY, { cellSize, gridHeight, gridWidth });
      elevationGrid[getGridIndex(gridX, gridY, gridWidth)] = elevationAt(world);
    }
  }

  return {
    area: calculatePolygonArea(polygon),
    cellSize,
    elevationGrid,
    gridHeight,
    gridWidth,
    northAngle: 0,
    polygon,
  };
}

function getGuideCenterY(guide: { points: Array<{ y: number }> }): number {
  return guide.points.reduce((sum, point) => sum + point.y, 0) / guide.points.length;
}

function getVerticalSector(value: number, min: number, max: number, sectorCount: number): number {
  const normalized = Math.min(Math.max((value - min) / (max - min), 0), 0.9999);

  return Math.floor(normalized * sectorCount);
}

function fillOccupationRectangle(
  occupationGrid: Int32Array,
  gridWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  value: number,
): void {
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      const gridX = originX + offsetX;
      const gridY = originY + offsetY;
      occupationGrid[getGridIndex(gridX, gridY, gridWidth)] = value;
    }
  }
}

function guideIntersectsOccupiedCells(
  points: Array<{ x: number; y: number }>,
  occupationGrid: Int32Array,
  terrain: TerrainState,
): boolean {
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 0.35));

    for (let step = 0; step <= steps; step += 1) {
      const factor = step / steps;
      const sample = {
        x: start.x + (end.x - start.x) * factor,
        y: start.y + (end.y - start.y) * factor,
      };
      const grid = worldToGrid(sample.x, sample.y, terrain);
      const occupationValue =
        occupationGrid[getGridIndex(grid.x, grid.y, terrain.gridWidth)] ?? 0;

      if (occupationValue !== 0 && occupationValue !== -4) {
        return true;
      }
    }
  }

  return false;
}
