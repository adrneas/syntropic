import { describe, expect, it } from 'vitest';
import type { TerrainState } from '../../src/core/types/terrain';
import {
  buildPolygonMask,
  calculatePolygonArea,
  getGridIndex,
  gridToWorld,
} from '../../src/core/utils/terrain';
import { generatePlantingLayout } from '../../src/engine/plantingLayout';
import { generateProductiveAreas } from '../../src/engine/productiveAreas';
import { analyzeTopography } from '../../src/engine/topography';

describe('generateProductiveAreas', () => {
  it('creates crest areas over high plateaus instead of leaving the top unresolved', () => {
    const terrain = createTerrain((world) => {
      if (world.y <= 2) {
        return (world.y + 24) * 0.34;
      }

      return 8.84;
    });
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);
    const productiveAreas = generateProductiveAreas({
      guides: [...layout.keylines, ...layout.plantingRows],
      occupationGrid: new Int32Array(terrain.gridWidth * terrain.gridHeight),
      polygonMask,
      rowSpacingMeters: layout.rowSpacingMeters,
      slopeGrid: topography.slopeGrid,
      terrain,
    });
    const crestAreas = productiveAreas.areas.filter((area) => area.type === 'TOPO_CREST');
    const highestCrestElevation = Math.max(...crestAreas.map((area) => area.averageElevation));

    expect(crestAreas.length).toBeGreaterThan(0);
    expect(highestCrestElevation).toBeGreaterThan(topography.summary.maxElevation - 1);
  });

  it('fills flat productive aprons around constructions without leaving residual dead space', () => {
    const terrain = createTerrain(() => 0);
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);
    const occupationGrid = new Int32Array(terrain.gridWidth * terrain.gridHeight);

    fillOccupationRectangle(occupationGrid, terrain.gridWidth, 27, 27, 10, 10, -1);

    const productiveAreas = generateProductiveAreas({
      guides: [...layout.keylines, ...layout.plantingRows],
      occupationGrid,
      polygonMask,
      rowSpacingMeters: layout.rowSpacingMeters,
      slopeGrid: topography.slopeGrid,
      terrain,
    });
    const flatAreas = productiveAreas.areas.filter((area) => area.type === 'FLAT_PRODUCTIVE');
    const totalFlatCoverage = flatAreas.reduce((sum, area) => sum + area.areaSquareMeters, 0);

    expect(flatAreas.length).toBeGreaterThan(0);
    expect(totalFlatCoverage).toBeGreaterThan(180);
    expect(productiveAreas.deadSpaceSquareMeters).toBeLessThanOrEqual(0.01);
  });

  it('creates productive polygons with terrain-following boundaries', () => {
    const terrain = createTerrain(
      (world) => world.y * 0.18 + Math.sin(world.x / 5) * 1.2 + Math.cos(world.y / 9) * 0.6,
    );
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);
    const productiveAreas = generateProductiveAreas({
      guides: [...layout.keylines, ...layout.plantingRows],
      occupationGrid: new Int32Array(terrain.gridWidth * terrain.gridHeight),
      polygonMask,
      rowSpacingMeters: layout.rowSpacingMeters,
      slopeGrid: topography.slopeGrid,
      terrain,
    });
    const areaWithRelief = productiveAreas.areas.find((area) => area.polygon.length >= 6);

    expect(areaWithRelief).toBeDefined();
    expect(
      areaWithRelief!.polygon.some((point, index, polygon) => {
        const nextPoint = polygon[(index + 1) % polygon.length];
        return Math.abs(point.z - nextPoint.z) > 0.15;
      }),
    ).toBe(true);
  });

  it('classifies inclined terrain as cultivable slope areas instead of leaving it empty', () => {
    const terrain = createTerrain((world) => world.y * 0.34 + world.x * 0.02 + 4);
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid);
    const productiveAreas = generateProductiveAreas({
      guides: [...layout.keylines, ...layout.plantingRows],
      occupationGrid: new Int32Array(terrain.gridWidth * terrain.gridHeight),
      polygonMask,
      rowSpacingMeters: layout.rowSpacingMeters,
      slopeGrid: topography.slopeGrid,
      terrain,
    });
    const slopeAreas = productiveAreas.areas.filter((area) => area.type === 'SLOPE_PRODUCTIVE');

    expect(slopeAreas.length).toBeGreaterThan(0);
    expect(slopeAreas.some((area) => area.averageSlopePercent >= 18)).toBe(true);
    expect(productiveAreas.deadSpaceSquareMeters).toBeLessThan(25);
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
