import type { TerrainGridConfig, TerrainPoint } from '../types/terrain';

export const DEFAULT_TERRAIN_GRID_WIDTH = 257;
export const DEFAULT_TERRAIN_GRID_HEIGHT = 257;
export const DEFAULT_TERRAIN_CELL_SIZE = 1;

// Minimum and maximum grid side length (cells). Must be power-of-2 + 1 for
// clean subdivision and marching-squares compatibility.
const MIN_GRID_SIDE = 65;   // 64m minimum world span at cellSize=1
const MAX_GRID_SIDE = 513;  // 512m maximum world span at cellSize=1
// Buffer around polygon bounding box (meters)
const GRID_PADDING_METERS = 10;

/**
 * Compute grid dimensions that tightly fit a polygon's bounding box.
 * Keeps cellSize=1m when possible, increasing it for very large properties.
 * Grid sides are always power-of-2 + 1 (65, 129, 257, 513).
 */
export function computeAdaptiveGrid(polygon: TerrainPoint[]): {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
} {
  if (polygon.length < 3) {
    return {
      gridWidth: DEFAULT_TERRAIN_GRID_WIDTH,
      gridHeight: DEFAULT_TERRAIN_GRID_HEIGHT,
      cellSize: DEFAULT_TERRAIN_CELL_SIZE,
    };
  }

  const bounds = getPolygonBounds(polygon)!;
  const spanX = bounds.maxX - bounds.minX + GRID_PADDING_METERS * 2;
  const spanY = bounds.maxY - bounds.minY + GRID_PADDING_METERS * 2;
  const maxSpan = Math.max(spanX, spanY);

  // Choose cellSize: 1m up to 512m span, 2m up to 1024m, etc.
  let cellSize = 1;
  while ((maxSpan / cellSize) > MAX_GRID_SIDE - 1) {
    cellSize *= 2;
  }

  // Pick the smallest power-of-2+1 grid that covers each axis
  const neededW = Math.ceil(spanX / cellSize) + 1;
  const neededH = Math.ceil(spanY / cellSize) + 1;

  return {
    gridWidth: nearestGridSide(neededW),
    gridHeight: nearestGridSide(neededH),
    cellSize,
  };
}

/** Round up to the nearest power-of-2 + 1 within [MIN_GRID_SIDE, MAX_GRID_SIDE]. */
function nearestGridSide(needed: number): number {
  const sides = [MIN_GRID_SIDE, 129, 257, MAX_GRID_SIDE];
  for (const side of sides) {
    if (side >= needed) {
      return side;
    }
  }
  return MAX_GRID_SIDE;
}

export interface PolygonBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createFlatElevationGrid(
  gridWidth = DEFAULT_TERRAIN_GRID_WIDTH,
  gridHeight = DEFAULT_TERRAIN_GRID_HEIGHT,
  initialHeight = 0,
): Float32Array {
  return new Float32Array(gridWidth * gridHeight).fill(initialHeight);
}

export function getGridIndex(x: number, y: number, gridWidth: number): number {
  return y * gridWidth + x;
}

export function getTerrainWorldSize(config: TerrainGridConfig): { width: number; height: number } {
  return {
    width: (config.gridWidth - 1) * config.cellSize,
    height: (config.gridHeight - 1) * config.cellSize,
  };
}

export function worldToGrid(
  worldX: number,
  worldY: number,
  config: TerrainGridConfig,
): GridPosition {
  const { width, height } = getTerrainWorldSize(config);
  const gridX = clamp(Math.round((worldX + width / 2) / config.cellSize), 0, config.gridWidth - 1);
  const gridY = clamp(Math.round((worldY + height / 2) / config.cellSize), 0, config.gridHeight - 1);

  return { x: gridX, y: gridY };
}

export function gridToWorld(
  gridX: number,
  gridY: number,
  config: TerrainGridConfig,
): TerrainPoint {
  const { width, height } = getTerrainWorldSize(config);

  return {
    x: gridX * config.cellSize - width / 2,
    y: gridY * config.cellSize - height / 2,
  };
}

export function sampleElevation(
  elevationGrid: Float32Array,
  gridWidth: number,
  gridX: number,
  gridY: number,
): number {
  return elevationGrid[getGridIndex(gridX, gridY, gridWidth)] ?? 0;
}

export function calculatePolygonArea(polygon: TerrainPoint[]): number {
  if (polygon.length < 3) {
    return 0;
  }

  let area = 0;
  let previousIndex = polygon.length - 1;

  for (let index = 0; index < polygon.length; index += 1) {
    area += (polygon[previousIndex].x + polygon[index].x) * (polygon[previousIndex].y - polygon[index].y);
    previousIndex = index;
  }

  return Math.round(Math.abs(area / 2));
}

export function calculatePolygonCentroid(polygon: TerrainPoint[]): TerrainPoint | null {
  if (polygon.length === 0) {
    return null;
  }

  const area = signedPolygonArea(polygon);

  if (Math.abs(area) < Number.EPSILON) {
    const average = polygon.reduce(
      (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
      { x: 0, y: 0 },
    );

    return {
      x: average.x / polygon.length,
      y: average.y / polygon.length,
    };
  }

  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    const cross = polygon[index].x * polygon[nextIndex].y - polygon[nextIndex].x * polygon[index].y;
    centroidX += (polygon[index].x + polygon[nextIndex].x) * cross;
    centroidY += (polygon[index].y + polygon[nextIndex].y) * cross;
  }

  return {
    x: centroidX / (6 * area),
    y: centroidY / (6 * area),
  };
}

export function getPolygonBounds(polygon: TerrainPoint[]): PolygonBounds | null {
  if (polygon.length === 0) {
    return null;
  }

  return polygon.reduce<PolygonBounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

export function pointInPolygon(point: TerrainPoint, polygon: TerrainPoint[]): boolean {
  if (polygon.length < 3) {
    return false;
  }

  let inside = false;

  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const currentPoint = polygon[current];
    const previousPoint = polygon[previous];

    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          ((previousPoint.y - currentPoint.y) || Number.EPSILON) +
          currentPoint.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function isPointWithinBufferedPolygon(
  point: TerrainPoint,
  polygon: TerrainPoint[],
  bufferDistance: number,
): boolean {
  if (pointInPolygon(point, polygon)) {
    return true;
  }

  if (polygon.length < 2 || bufferDistance <= 0) {
    return false;
  }

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;

    if (distanceToSegment(point, polygon[index], polygon[nextIndex]) <= bufferDistance) {
      return true;
    }
  }

  return false;
}

export function getDistanceToPolygonBoundary(point: TerrainPoint, polygon: TerrainPoint[]): number {
  if (polygon.length < 2) {
    return 0;
  }

  let minimumDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    minimumDistance = Math.min(
      minimumDistance,
      distanceToSegment(point, polygon[index], polygon[nextIndex]),
    );
  }

  return minimumDistance;
}

export function buildPolygonMask(polygon: TerrainPoint[], config: TerrainGridConfig): Uint8Array {
  const mask = new Uint8Array(config.gridWidth * config.gridHeight);

  if (polygon.length < 3) {
    return mask;
  }

  for (let gridY = 0; gridY < config.gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < config.gridWidth; gridX += 1) {
      const worldPoint = gridToWorld(gridX, gridY, config);
      mask[getGridIndex(gridX, gridY, config.gridWidth)] = pointInPolygon(worldPoint, polygon) ? 1 : 0;
    }
  }

  return mask;
}

interface GridPosition {
  x: number;
  y: number;
}

function signedPolygonArea(polygon: TerrainPoint[]): number {
  let area = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    area += polygon[index].x * polygon[nextIndex].y - polygon[nextIndex].x * polygon[index].y;
  }

  return area / 2;
}

function distanceToSegment(point: TerrainPoint, start: TerrainPoint, end: TerrainPoint): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (segmentLengthSquared <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / segmentLengthSquared,
    0,
    1,
  );
  const closestX = start.x + projection * deltaX;
  const closestY = start.y + projection * deltaY;

  return Math.hypot(point.x - closestX, point.y - closestY);
}
