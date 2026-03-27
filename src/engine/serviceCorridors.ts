import type {
  GridCoordinate,
  InfrastructurePlacement,
  LayoutGuide,
  ResidencePlacement,
  SolarPlacement,
} from '../core/types/generation';
import { getGridIndex, gridToWorld, sampleElevation, worldToGrid } from '../core/utils/terrain';
import { FLAT_SLOPE_THRESHOLD_PERCENT } from './topography';
import type { ProceduralEngineInput } from './types';
import {
  GROUND_SOLAR_OCCUPATION_VALUE,
  RESIDENCE_OCCUPATION_VALUE,
  roundTo,
  SERVICE_CORRIDOR_OCCUPATION_VALUE,
} from './placementUtils';

// ─── Pathfinding cost tuning ───
// Base movement cost for traversing a single cell (slope penalty is added on top)
const SERVICE_PATH_BASE_COST = 0.9;
// Slope is divided by this divisor to compute per-cell slope surcharge
// (higher = less sensitive to slope, lower = more slope-averse routing)
const SERVICE_PATH_SLOPE_COST_DIVISOR = 15;
// Multiplier applied to base cost for flat cells (rewards flat terrain routing)
const SERVICE_PATH_FLAT_DISCOUNT = 0.55;

// ─── Chaikin curve smoothing ───
// Fraction of each segment cut from the start of a chord (Chaikin algorithm)
const CHAIKIN_NEAR_FRACTION = 0.25;
// Fraction of each segment cut from the end of a chord (Chaikin algorithm)
const CHAIKIN_FAR_FRACTION = 0.75;
// Number of Chaikin smoothing passes applied to corridor path anchors
const CHAIKIN_SMOOTHING_PASSES = 2;

// ─── Guide resampling ───
// Preferred sample interval as a fraction of cell size when resampling guide points
const GUIDE_RESAMPLE_CELL_SIZE_FRACTION = 0.65;
// Minimum preferred point spacing (meters) regardless of cell size
const GUIDE_RESAMPLE_MIN_SPACING_METERS = 0.75;
// Maximum number of resampled points along a service corridor guide
const GUIDE_RESAMPLE_MAX_POINTS = 160;
// Minimum number of resampled points along a service corridor guide
const GUIDE_RESAMPLE_MIN_POINTS = 3;
// Duplicate-point suppression threshold (meters); closer points are merged
const GUIDE_RESAMPLE_DEDUP_THRESHOLD_METERS = 0.001;

const SERVICE_NEIGHBOR_OFFSETS = [
  { x: 0, y: -1, traversalDistance: 1 },
  { x: 1, y: 0, traversalDistance: 1 },
  { x: 0, y: 1, traversalDistance: 1 },
  { x: -1, y: 0, traversalDistance: 1 },
  { x: 1, y: -1, traversalDistance: Math.SQRT2 },
  { x: 1, y: 1, traversalDistance: Math.SQRT2 },
  { x: -1, y: 1, traversalDistance: Math.SQRT2 },
  { x: -1, y: -1, traversalDistance: Math.SQRT2 },
] as const;

interface ServiceCorridorTarget {
  id: string;
  center: GridCoordinate;
  targetOccupancyValue: number;
}

export function generateServiceCorridors({
  groundSolarPlacement,
  infrastructurePlacements,
  occupationGrid,
  polygonMask,
  residence,
  restrictionGrid,
  slopeGrid,
  terrain,
}: {
  groundSolarPlacement: SolarPlacement | null;
  infrastructurePlacements: InfrastructurePlacement[];
  occupationGrid: Int32Array;
  polygonMask: Uint8Array;
  residence: ResidencePlacement;
  restrictionGrid: Uint8Array;
  slopeGrid: Float32Array;
  terrain: ProceduralEngineInput['terrain'];
}): LayoutGuide[] {
  const corridors: LayoutGuide[] = [];
  const targets: ServiceCorridorTarget[] = [];

  if (groundSolarPlacement) {
    targets.push({
      id: 'solar-ground',
      center: groundSolarPlacement.center,
      targetOccupancyValue: GROUND_SOLAR_OCCUPATION_VALUE,
    });
  }

  infrastructurePlacements.forEach((placement, index) => {
    if (placement.status !== 'placed' || !placement.gridPosition) {
      return;
    }

    targets.push({
      id: placement.infrastructureId,
      center: placement.gridPosition,
      targetOccupancyValue: index + 1,
    });
  });

  targets.forEach((target) => {
    const path = findServicePath({
      occupancyGrid: occupationGrid,
      polygonMask,
      residenceCenter: residence.center,
      restrictionGrid,
      slopeGrid,
      target,
      terrain,
    });

    if (!path || path.length < 2) {
      return;
    }

    reserveServiceCorridor(path, occupationGrid, terrain.gridWidth);
    corridors.push(buildServiceCorridorGuide(path, target.id, terrain));
  });

  return corridors;
}

function findServicePath({
  occupancyGrid,
  polygonMask,
  residenceCenter,
  restrictionGrid,
  slopeGrid,
  target,
  terrain,
}: {
  occupancyGrid: Int32Array;
  polygonMask: Uint8Array;
  residenceCenter: GridCoordinate;
  restrictionGrid: Uint8Array;
  slopeGrid: Float32Array;
  target: ServiceCorridorTarget;
  terrain: ProceduralEngineInput['terrain'];
}): GridCoordinate[] | null {
  const start = residenceCenter;
  const goal = target.center;
  const totalCells = terrain.gridWidth * terrain.gridHeight;
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const gScore = new Float32Array(totalCells).fill(Number.POSITIVE_INFINITY);
  const openSet = new Set<number>();
  const startIndex = getGridIndex(start.x, start.y, terrain.gridWidth);
  const goalIndex = getGridIndex(goal.x, goal.y, terrain.gridWidth);

  gScore[startIndex] = 0;
  openSet.add(startIndex);

  while (openSet.size > 0) {
    let currentIndex = -1;
    let currentScore = Number.POSITIVE_INFINITY;

    openSet.forEach((candidateIndex) => {
      const coordinates = indexToGridCoordinate(candidateIndex, terrain.gridWidth);
      const estimate =
        gScore[candidateIndex] + euclideanGridDistance(coordinates, goal);

      if (estimate < currentScore) {
        currentScore = estimate;
        currentIndex = candidateIndex;
      }
    });

    if (currentIndex === -1) {
      break;
    }

    if (currentIndex === goalIndex) {
      return reconstructPath(cameFrom, currentIndex, terrain.gridWidth);
    }

    openSet.delete(currentIndex);
    const current = indexToGridCoordinate(currentIndex, terrain.gridWidth);

    for (let directionIndex = 0; directionIndex < SERVICE_NEIGHBOR_OFFSETS.length; directionIndex += 1) {
      const offset = SERVICE_NEIGHBOR_OFFSETS[directionIndex];
      const nextX = current.x + offset.x;
      const nextY = current.y + offset.y;

      if (
        nextX < 0 ||
        nextX >= terrain.gridWidth ||
        nextY < 0 ||
        nextY >= terrain.gridHeight
      ) {
        continue;
      }

      const nextIndex = getGridIndex(nextX, nextY, terrain.gridWidth);

      if (
        !isServiceCellWalkable({
          occupationGrid: occupancyGrid,
          polygonMask,
          restrictionGrid,
          target,
          goalIndex,
          gridIndex: nextIndex,
        })
      ) {
        continue;
      }

      if (
        Math.abs(offset.x) === 1 &&
        Math.abs(offset.y) === 1 &&
        !isDiagonalServiceStepAllowed({
          current,
          next: { x: nextX, y: nextY },
          occupancyGrid: occupancyGrid,
          polygonMask,
          restrictionGrid,
          target,
          terrain,
        })
      ) {
        continue;
      }

      const tentativeScore =
        gScore[currentIndex] +
        getServiceCellTraversalCost(nextIndex, slopeGrid) * offset.traversalDistance;

      if (tentativeScore >= gScore[nextIndex]) {
        continue;
      }

      cameFrom[nextIndex] = currentIndex;
      gScore[nextIndex] = tentativeScore;
      openSet.add(nextIndex);
    }
  }

  return null;
}

function isServiceCellWalkable({
  occupationGrid,
  polygonMask,
  restrictionGrid,
  target,
  goalIndex,
  gridIndex,
}: {
  occupationGrid: Int32Array;
  polygonMask: Uint8Array;
  restrictionGrid: Uint8Array;
  target: ServiceCorridorTarget;
  goalIndex: number;
  gridIndex: number;
}): boolean {
  if (polygonMask[gridIndex] !== 1) {
    return false;
  }

  if (gridIndex === goalIndex) {
    return true;
  }

  if (restrictionGrid[gridIndex] === 1) {
    return false;
  }

  const occupancyValue = occupationGrid[gridIndex];

  return (
    occupancyValue === 0 ||
    occupancyValue === RESIDENCE_OCCUPATION_VALUE ||
    occupancyValue === SERVICE_CORRIDOR_OCCUPATION_VALUE ||
    occupancyValue === target.targetOccupancyValue
  );
}

function getServiceCellTraversalCost(gridIndex: number, slopeGrid: Float32Array): number {
  const slope = slopeGrid[gridIndex] ?? 0;
  const baseCost = SERVICE_PATH_BASE_COST + slope / SERVICE_PATH_SLOPE_COST_DIVISOR;

  return slope <= FLAT_SLOPE_THRESHOLD_PERCENT ? baseCost * SERVICE_PATH_FLAT_DISCOUNT : baseCost;
}

function isDiagonalServiceStepAllowed({
  current,
  next,
  occupancyGrid,
  polygonMask,
  restrictionGrid,
  target,
  terrain,
}: {
  current: GridCoordinate;
  next: GridCoordinate;
  occupancyGrid: Int32Array;
  polygonMask: Uint8Array;
  restrictionGrid: Uint8Array;
  target: ServiceCorridorTarget;
  terrain: ProceduralEngineInput['terrain'];
}): boolean {
  const horizontalIndex = getGridIndex(next.x, current.y, terrain.gridWidth);
  const verticalIndex = getGridIndex(current.x, next.y, terrain.gridWidth);
  const goalIndex = getGridIndex(target.center.x, target.center.y, terrain.gridWidth);

  return (
    isServiceCellWalkable({
      occupationGrid: occupancyGrid,
      polygonMask,
      restrictionGrid,
      target,
      goalIndex,
      gridIndex: horizontalIndex,
    }) &&
    isServiceCellWalkable({
      occupationGrid: occupancyGrid,
      polygonMask,
      restrictionGrid,
      target,
      goalIndex,
      gridIndex: verticalIndex,
    })
  );
}

function reserveServiceCorridor(
  path: GridCoordinate[],
  occupationGrid: Int32Array,
  gridWidth: number,
): void {
  for (let index = 0; index < path.length; index += 1) {
    const cellIndex = getGridIndex(path[index].x, path[index].y, gridWidth);

    if (occupationGrid[cellIndex] === 0) {
      occupationGrid[cellIndex] = SERVICE_CORRIDOR_OCCUPATION_VALUE;
    }
  }
}

function buildServiceCorridorGuide(
  path: GridCoordinate[],
  id: string,
  terrain: ProceduralEngineInput['terrain'],
): LayoutGuide {
  const rawPoints = path.map((coordinate) => {
    const worldPoint = gridToWorld(coordinate.x, coordinate.y, terrain);
    const elevation = terrain.elevationGrid[getGridIndex(coordinate.x, coordinate.y, terrain.gridWidth)] ?? 0;

    return {
      x: worldPoint.x,
      y: worldPoint.y,
      z: elevation,
    };
  });
  const points = buildCurvedServiceGuidePoints(rawPoints, terrain);

  return {
    averageElevation: roundTo(
      points.reduce((sum, point) => sum + point.z, 0) / points.length,
      2,
    ),
    id: `service-corridor-${id}`,
    length: roundTo(calculateGuideLength(points), 2),
    points,
    type: 'SERVICE_CORRIDOR',
  };
}

function reconstructPath(
  cameFrom: Int32Array,
  currentIndex: number,
  gridWidth: number,
): GridCoordinate[] {
  const path: GridCoordinate[] = [];
  let cursor = currentIndex;

  while (cursor !== -1) {
    path.push(indexToGridCoordinate(cursor, gridWidth));
    cursor = cameFrom[cursor] ?? -1;
  }

  return path.reverse();
}

function indexToGridCoordinate(index: number, gridWidth: number): GridCoordinate {
  return {
    x: index % gridWidth,
    y: Math.floor(index / gridWidth),
  };
}

function euclideanGridDistance(left: GridCoordinate, right: GridCoordinate): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function calculateGuideLength(points: LayoutGuide['points']): number {
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }

  return length;
}

function simplifyGuidePoints(points: LayoutGuide['points']): LayoutGuide['points'] {
  if (points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const delta1X = Math.sign(current.x - previous.x);
    const delta1Y = Math.sign(current.y - previous.y);
    const delta2X = Math.sign(next.x - current.x);
    const delta2Y = Math.sign(next.y - current.y);

    if (delta1X !== delta2X || delta1Y !== delta2Y) {
      simplified.push(current);
    }
  }

  simplified.push(points[points.length - 1]);

  return simplified;
}

function buildCurvedServiceGuidePoints(
  rawPoints: LayoutGuide['points'],
  terrain: ProceduralEngineInput['terrain'],
): LayoutGuide['points'] {
  const anchors = simplifyGuidePoints(rawPoints);

  if (anchors.length <= 2) {
    return resampleGuidePoints(anchors, terrain);
  }

  let smoothed = anchors.map((point) => ({ ...point }));

  for (let iteration = 0; iteration < CHAIKIN_SMOOTHING_PASSES; iteration += 1) {
    smoothed = chaikinSmoothGuidePoints(smoothed);
  }

  return resampleGuidePoints(smoothed, terrain);
}

function chaikinSmoothGuidePoints(points: LayoutGuide['points']): LayoutGuide['points'] {
  if (points.length <= 2) {
    return points.map((point) => ({ ...point }));
  }

  const smoothed: LayoutGuide['points'] = [points[0]];

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    smoothed.push(interpolateGuidePoint(current, next, CHAIKIN_NEAR_FRACTION));
    smoothed.push(interpolateGuidePoint(current, next, CHAIKIN_FAR_FRACTION));
  }

  smoothed.push(points[points.length - 1]);

  return smoothed;
}

function resampleGuidePoints(
  points: LayoutGuide['points'],
  terrain: ProceduralEngineInput['terrain'],
): LayoutGuide['points'] {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    return [sampleGuidePointOnTerrain(points[0], terrain)];
  }

  const totalLength = calculateGuideLength(points);

  if (totalLength <= Number.EPSILON) {
    return [sampleGuidePointOnTerrain(points[0], terrain), sampleGuidePointOnTerrain(points[points.length - 1], terrain)];
  }

  const preferredSpacing = Math.max(terrain.cellSize * GUIDE_RESAMPLE_CELL_SIZE_FRACTION, GUIDE_RESAMPLE_MIN_SPACING_METERS);
  const sampleCount = Math.min(GUIDE_RESAMPLE_MAX_POINTS, Math.max(GUIDE_RESAMPLE_MIN_POINTS, Math.ceil(totalLength / preferredSpacing) + 1));
  const resampled: LayoutGuide['points'] = [];

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const distance = (totalLength * sampleIndex) / (sampleCount - 1);
    const point = samplePointAlongPolyline(points, distance);

    if (!point) {
      continue;
    }

    const terrainPoint = sampleGuidePointOnTerrain(point, terrain);
    const previous = resampled[resampled.length - 1];

    if (
      previous &&
      Math.abs(previous.x - terrainPoint.x) < GUIDE_RESAMPLE_DEDUP_THRESHOLD_METERS &&
      Math.abs(previous.y - terrainPoint.y) < GUIDE_RESAMPLE_DEDUP_THRESHOLD_METERS
    ) {
      continue;
    }

    resampled.push(terrainPoint);
  }

  const startPoint = sampleGuidePointOnTerrain(points[0], terrain);
  const endPoint = sampleGuidePointOnTerrain(points[points.length - 1], terrain);

  if (resampled.length === 0) {
    return [startPoint, endPoint];
  }

  resampled[0] = startPoint;
  resampled[resampled.length - 1] = endPoint;

  return resampled;
}

function samplePointAlongPolyline(
  points: LayoutGuide['points'],
  distance: number,
): LayoutGuide['points'][number] | null {
  if (points.length === 0) {
    return null;
  }

  if (distance <= 0) {
    return points[0];
  }

  let traversed = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);

    if (segmentLength <= Number.EPSILON) {
      continue;
    }

    if (traversed + segmentLength >= distance) {
      const factor = (distance - traversed) / segmentLength;
      return interpolateGuidePoint(previous, current, factor);
    }

    traversed += segmentLength;
  }

  return points[points.length - 1];
}

function interpolateGuidePoint(
  start: LayoutGuide['points'][number],
  end: LayoutGuide['points'][number],
  factor: number,
): LayoutGuide['points'][number] {
  return {
    x: start.x + (end.x - start.x) * factor,
    y: start.y + (end.y - start.y) * factor,
    z: start.z + (end.z - start.z) * factor,
  };
}

function sampleGuidePointOnTerrain(
  point: Pick<LayoutGuide['points'][number], 'x' | 'y'>,
  terrain: ProceduralEngineInput['terrain'],
): LayoutGuide['points'][number] {
  const gridPoint = worldToGrid(point.x, point.y, terrain);
  const elevation = sampleElevation(terrain.elevationGrid, terrain.gridWidth, gridPoint.x, gridPoint.y);

  return {
    x: roundTo(point.x, 3),
    y: roundTo(point.y, 3),
    z: roundTo(elevation, 2),
  };
}
