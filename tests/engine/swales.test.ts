import { describe, expect, it } from 'vitest';
import type { ProductiveArea } from '../../src/core/types/generation';
import type { TerrainState } from '../../src/core/types/terrain';
import {
  buildPolygonMask,
  calculatePolygonArea,
  getGridIndex,
  gridToWorld,
  pointInPolygon,
} from '../../src/core/utils/terrain';
import { generatePlantingLayout } from '../../src/engine/plantingLayout';
import { generateProductiveAreas } from '../../src/engine/productiveAreas';
import { generateSwales, SWALE_OCCUPATION_VALUE } from '../../src/engine/swales';
import { analyzeTopography } from '../../src/engine/topography';

describe('generateSwales', () => {
  it('creates contour swales inside slope productive areas and reserves their cells', () => {
    const terrain = createTerrain((world) => world.y * 0.31 + Math.sin(world.x / 7) * 0.6 + 5);
    const polygonMask = buildPolygonMask(terrain.polygon, terrain);
    const topography = analyzeTopography(terrain);
    const occupationGrid = new Int32Array(terrain.gridWidth * terrain.gridHeight);
    const layout = generatePlantingLayout(terrain, polygonMask, topography.slopeGrid, occupationGrid);
    const productiveAreas = generateProductiveAreas({
      guides: [...layout.keylines, ...layout.plantingRows],
      occupationGrid,
      polygonMask,
      rowSpacingMeters: layout.rowSpacingMeters,
      slopeGrid: topography.slopeGrid,
      terrain,
    });
    const slopeAreas = productiveAreas.areas.filter((area) => area.type === 'SLOPE_PRODUCTIVE');
    const swales = generateSwales({
      guides: [...layout.keylines, ...layout.plantingRows],
      occupationGrid,
      productiveAreas: productiveAreas.areas,
      rowSpacingMeters: layout.rowSpacingMeters,
      terrain,
    });

    expect(slopeAreas.length).toBeGreaterThan(0);
    expect(swales.length).toBeGreaterThan(0);
    expect(swales.every((guide) => guide.type === 'SWALE')).toBe(true);
    expect(
      swales.every((guide) =>
        guide.points.some((point) => slopeAreas.some((area) => isPointInsideArea(point, area))),
      ),
    ).toBe(true);
    expect(Array.from(occupationGrid).some((value) => value === SWALE_OCCUPATION_VALUE)).toBe(true);
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

function isPointInsideArea(
  point: { x: number; y: number },
  area: ProductiveArea,
): boolean {
  if (!pointInPolygon(point, area.polygon.map(({ x, y }) => ({ x, y })))) {
    return false;
  }

  return !(area.holes ?? []).some((hole) =>
    pointInPolygon(point, hole.map(({ x, y }) => ({ x, y }))),
  );
}
