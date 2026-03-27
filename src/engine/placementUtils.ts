import type { GridCoordinate } from '../core/types/generation';
import type { IInfrastructure } from '../core/types/infrastructure';
import type { TerrainGridConfig, TerrainPoint } from '../core/types/terrain';
import { getGridIndex, gridToWorld } from '../core/utils/terrain';
import { FLAT_SLOPE_THRESHOLD_PERCENT } from './topography';
import type { ProceduralEngineInput } from './types';

export const FAR_DISTANCE_METERS = 100;
export const NEAR_DISTANCE_METERS = 50;
export const MAX_SINK_COORDINATES_FOR_PLACEMENT = 256;
export const RESIDENCE_OCCUPATION_VALUE = -1;
export const GROUND_SOLAR_OCCUPATION_VALUE = -2;
export const SERVICE_CORRIDOR_OCCUPATION_VALUE = -4;

export interface EvaluateRectCandidateInput {
  originX: number;
  originY: number;
  widthCells: number;
  lengthCells: number;
  terrain: ProceduralEngineInput['terrain'];
  polygonMask: Uint8Array;
  occupationGrid: Int32Array;
  terrainTolerance: TerrainToleranceProfile;
}

export interface TerrainToleranceProfile {
  maxAverageSlopePercentage: number;
  maxCriticalSlopePercentage: number;
  maxCriticalCellRatio: number;
  maxAltitudeVariationMeters: number;
}

export interface RectCandidate {
  averageSlope: number;
  center: GridCoordinate;
  criticalCellRatio: number;
  elevation: number;
  elevationSpan: number;
  flatCellRatio: number;
  lengthCells: number;
  maxSlope: number;
  origin: GridCoordinate;
  score: number;
  widthCells: number;
  worldPoint: TerrainPoint;
}

export interface PlacementCandidate extends RectCandidate {
  rationale: string;
}

export function evaluateRectCandidate({
  originX,
  originY,
  widthCells,
  lengthCells,
  terrain,
  polygonMask,
  occupationGrid,
  terrainTolerance,
}: EvaluateRectCandidateInput): RectCandidate | null {
  let flatCellCount = 0;
  let maxSlope = 0;
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  let slopeSum = 0;
  let elevationSum = 0;
  let occupiedCells = 0;
  let criticalCellCount = 0;

  for (let offsetY = 0; offsetY < lengthCells; offsetY += 1) {
    for (let offsetX = 0; offsetX < widthCells; offsetX += 1) {
      const gridX = originX + offsetX;
      const gridY = originY + offsetY;
      const index = getGridIndex(gridX, gridY, terrain.gridWidth);

      if (polygonMask[index] !== 1 || occupationGrid[index] !== 0) {
        return null;
      }

      const elevation = terrain.elevationGrid[index] ?? 0;
      const localSlope = getLocalSlope(terrain, gridX, gridY);

      if (localSlope > terrainTolerance.maxCriticalSlopePercentage) {
        return null;
      }

      if (localSlope > terrainTolerance.maxAverageSlopePercentage) {
        criticalCellCount += 1;
      }

      if (localSlope <= FLAT_SLOPE_THRESHOLD_PERCENT) {
        flatCellCount += 1;
      }

      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
      elevationSum += elevation;
      slopeSum += localSlope;
      occupiedCells += 1;
      maxSlope = Math.max(maxSlope, localSlope);
    }
  }

  const averageSlope = slopeSum / occupiedCells;
  const elevationSpan = maxElevation - minElevation;
  const criticalCellRatio = criticalCellCount / occupiedCells;
  const flatCellRatio = flatCellCount / occupiedCells;

  if (
    averageSlope > terrainTolerance.maxAverageSlopePercentage ||
    elevationSpan > terrainTolerance.maxAltitudeVariationMeters ||
    criticalCellRatio > terrainTolerance.maxCriticalCellRatio
  ) {
    return null;
  }

  const center = {
    x: originX + Math.floor(widthCells / 2),
    y: originY + Math.floor(lengthCells / 2),
  };
  const worldPoint = gridToWorld(center.x, center.y, terrain);

  return {
    averageSlope,
    center,
    criticalCellRatio,
    elevation: elevationSum / occupiedCells,
    elevationSpan,
    flatCellRatio,
    lengthCells,
    maxSlope,
    origin: { x: originX, y: originY },
    score: Number.POSITIVE_INFINITY,
    widthCells,
    worldPoint,
  };
}

export function fillFootprint(
  occupationGrid: Int32Array,
  gridWidth: number,
  originX: number,
  originY: number,
  widthCells: number,
  lengthCells: number,
  value: number,
): void {
  for (let offsetY = 0; offsetY < lengthCells; offsetY += 1) {
    for (let offsetX = 0; offsetX < widthCells; offsetX += 1) {
      occupationGrid[getGridIndex(originX + offsetX, originY + offsetY, gridWidth)] = value;
    }
  }
}

export function getLocalSlope(terrain: ProceduralEngineInput['terrain'], gridX: number, gridY: number): number {
  const centerElevation = terrain.elevationGrid[getGridIndex(gridX, gridY, terrain.gridWidth)] ?? 0;
  let localSlope = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const neighborX = gridX + offsetX;
      const neighborY = gridY + offsetY;

      if (
        neighborX < 0 ||
        neighborX >= terrain.gridWidth ||
        neighborY < 0 ||
        neighborY >= terrain.gridHeight
      ) {
        continue;
      }

      const neighborElevation = terrain.elevationGrid[getGridIndex(neighborX, neighborY, terrain.gridWidth)] ?? 0;
      const distance = terrain.cellSize * (Math.abs(offsetX) + Math.abs(offsetY) === 2 ? Math.SQRT2 : 1);
      const slope = Math.abs((neighborElevation - centerElevation) / distance) * 100;

      if (slope > localSlope) {
        localSlope = slope;
      }
    }
  }

  return localSlope;
}

export function normalizeSinkCoordinatesForPlacement(
  sinkCoordinates: GridCoordinate[],
  terrain: Pick<TerrainGridConfig, 'gridHeight' | 'gridWidth'>,
): GridCoordinate[] {
  if (sinkCoordinates.length <= MAX_SINK_COORDINATES_FOR_PLACEMENT) {
    return sinkCoordinates;
  }

  const bucketStride = Math.max(
    1,
    Math.ceil(
      Math.sqrt(
        (terrain.gridWidth * terrain.gridHeight) / MAX_SINK_COORDINATES_FOR_PLACEMENT,
      ),
    ),
  );
  const sampled: GridCoordinate[] = [];
  const seenBuckets = new Set<string>();

  for (let index = 0; index < sinkCoordinates.length; index += 1) {
    const sink = sinkCoordinates[index];
    const bucketKey = `${Math.floor(sink.x / bucketStride)}:${Math.floor(sink.y / bucketStride)}`;

    if (seenBuckets.has(bucketKey)) {
      continue;
    }

    seenBuckets.add(bucketKey);
    sampled.push(sink);

    if (sampled.length >= MAX_SINK_COORDINATES_FOR_PLACEMENT) {
      break;
    }
  }

  return sampled.length > 0 ? sampled : [sinkCoordinates[0]];
}

export function getNearestSinkDistance(
  center: GridCoordinate,
  sinkCoordinates: GridCoordinate[],
  cellSize: number,
): number {
  if (sinkCoordinates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let nearestDistanceSquared = Number.POSITIVE_INFINITY;

  for (let index = 0; index < sinkCoordinates.length; index += 1) {
    const sink = sinkCoordinates[index];
    const deltaX = center.x - sink.x;
    const deltaY = center.y - sink.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;

    if (distanceSquared >= nearestDistanceSquared) {
      continue;
    }

    nearestDistanceSquared = distanceSquared;

    if (nearestDistanceSquared === 0) {
      return 0;
    }
  }

  return Math.sqrt(nearestDistanceSquared) * cellSize;
}

export function buildFootprintFromArea(area: number, minSideMeters: number): { width: number; length: number } {
  const width = Math.max(minSideMeters, Math.ceil(Math.sqrt(area * 1.2)));
  const length = Math.max(minSideMeters, Math.ceil(area / width));

  return { width, length };
}

export function getPlacementFootprintForRotation(
  footprint: { width: number; length: number },
  rotationRadians: number,
): { width: number; length: number } {
  const quarterTurns = Math.round(normalizeRadians(rotationRadians) / (Math.PI / 2)) % 4;

  return quarterTurns % 2 === 1
    ? { width: footprint.length, length: footprint.width }
    : footprint;
}

export function metersToCells(meters: number, cellSize: number): number {
  return Math.max(1, Math.ceil(meters / cellSize));
}

export function worldPointToGrid(point: TerrainPoint, terrain: TerrainGridConfig): GridCoordinate {
  const halfWidth = ((terrain.gridWidth - 1) * terrain.cellSize) / 2;
  const halfHeight = ((terrain.gridHeight - 1) * terrain.cellSize) / 2;

  return {
    x: Math.max(0, Math.min(terrain.gridWidth - 1, Math.round((point.x + halfWidth) / terrain.cellSize))),
    y: Math.max(0, Math.min(terrain.gridHeight - 1, Math.round((point.y + halfHeight) / terrain.cellSize))),
  };
}

export function getNorthVector(angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;

  return {
    x: Math.sin(radians),
    y: -Math.cos(radians),
  };
}

export function getOperationalRotationRadians(northAngle: number): number {
  const eastWestDegrees = northAngle + 90;
  const quarterTurns = Math.round(eastWestDegrees / 90);

  return normalizeRadians(quarterTurns * (Math.PI / 2));
}

export function normalizeRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = value % fullTurn;

  return normalized < 0 ? normalized + fullTurn : normalized;
}

export function toTerrainToleranceProfile(
  placementRules: IInfrastructure['placementRules'],
): TerrainToleranceProfile {
  return {
    maxAltitudeVariationMeters: placementRules.maxAltitudeVariationMeters,
    maxAverageSlopePercentage: placementRules.maxSlopePercentage,
    maxCriticalCellRatio: placementRules.maxCriticalCellRatio,
    maxCriticalSlopePercentage: placementRules.maxCriticalSlopePercentage,
  };
}

export function calculateSolarFootprintArea(monthlyConsumptionKwh: number): number {
  if (monthlyConsumptionKwh <= 0) {
    return 0;
  }

  return Math.ceil(monthlyConsumptionKwh / 40) * 2;
}

export function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}

export function hashSeed(input: ProceduralEngineInput): number {
  const rawSeed = JSON.stringify({
    polygon: input.terrain.polygon,
    area: input.terrain.area,
    northAngle: input.terrain.northAngle,
    residenceArea: input.residence.area,
    calculatedSolarNeed: input.residence.calculatedSolarNeed,
    climate: input.climate,
    infrastructure: input.preferences.infrastructure,
  });

  let hash = 2166136261;

  for (let index = 0; index < rawSeed.length; index += 1) {
    hash ^= rawSeed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
