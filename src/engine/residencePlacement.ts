import type {
  GridCoordinate,
  ResidencePlacement,
  SolarPlacement,
  TopographySummary,
} from '../core/types/generation';
import { getDistanceToPolygonBoundary } from '../core/utils/terrain';
import type { ProceduralEngineInput } from './types';
import {
  buildFootprintFromArea,
  calculateSolarFootprintArea,
  evaluateRectCandidate,
  fillFootprint,
  getNearestSinkDistance,
  getNorthVector,
  getOperationalRotationRadians,
  getPlacementFootprintForRotation,
  GROUND_SOLAR_OCCUPATION_VALUE,
  metersToCells,
  RESIDENCE_OCCUPATION_VALUE,
  roundTo,
  worldPointToGrid,
} from './placementUtils';
import type { RectCandidate, TerrainToleranceProfile } from './placementUtils';

// ─── Residence terrain tolerance ───
// Maximum elevation span the residence footprint can span (meters)
const RESIDENCE_MAX_ALTITUDE_VARIATION_METERS = 1.4;
// Average slope percentage limit across the residence footprint
const RESIDENCE_MAX_AVERAGE_SLOPE_PERCENT = 12;
// Maximum fraction of cells that may exceed the average slope limit
const RESIDENCE_MAX_CRITICAL_CELL_RATIO = 0.28;
// Absolute slope percentage that makes any cell immediately disqualifying
const RESIDENCE_MAX_CRITICAL_SLOPE_PERCENT = 22;

// ─── Ground-mounted solar array terrain tolerance ───
// Stricter than residence: panels require a flatter, more uniform surface
const SOLAR_GROUND_MAX_ALTITUDE_VARIATION_METERS = 0.9;
const SOLAR_GROUND_MAX_AVERAGE_SLOPE_PERCENT = 8;
const SOLAR_GROUND_MAX_CRITICAL_CELL_RATIO = 0.12;
const SOLAR_GROUND_MAX_CRITICAL_SLOPE_PERCENT = 14;

// ─── Solar sizing ───
// Fraction of the residence roof area usable for solar panels
// (accounts for obstructions, orientation losses, and structural limits)
const SOLAR_ROOF_UTILIZATION = 0.65;

// ─── Scoring weights — residence placement ───
// Penalty multiplier per unit of average slope (degrees of "roughness")
const RESIDENCE_SCORE_WEIGHT_AVG_SLOPE = 2.5;
// Penalty multiplier per unit of worst-cell slope (extreme local roughness)
const RESIDENCE_SCORE_WEIGHT_MAX_SLOPE = 1.1;
// Penalty multiplier per meter of elevation span across the footprint
const RESIDENCE_SCORE_WEIGHT_ELEVATION_SPAN = 8;
// Penalty multiplier for ratio of cells exceeding tolerance slope
const RESIDENCE_SCORE_WEIGHT_CRITICAL_RATIO = 35;
// Reward multiplier for ratio of flat cells (negative = subtracted from score)
const RESIDENCE_SCORE_WEIGHT_FLAT_RATIO = 18;

// ─── Scoring weights — ground solar placement ───
const SOLAR_SCORE_WEIGHT_MAX_SLOPE = 2.1;
const SOLAR_SCORE_WEIGHT_ELEVATION_SPAN = 10;
const SOLAR_SCORE_WEIGHT_CRITICAL_RATIO = 40;
const SOLAR_SCORE_WEIGHT_FLAT_RATIO = 24;

// ─── Residence operational penalty tuning ───
// Preferred elevation is biased slightly above terrain average (ratio of relief)
const RESIDENCE_PREFERRED_ELEVATION_ABOVE_AVERAGE_RATIO = 0.12;
// Penalty weight for deviation from preferred elevation (normalised by relief)
const RESIDENCE_ELEVATION_DEVIATION_PENALTY = 22;
// Extra penalty weight when residence sits below terrain average elevation
const RESIDENCE_BELOW_AVERAGE_ELEVATION_PENALTY = 18;
// Minimum distance (meters) from drainage sinks to avoid flood risk
const RESIDENCE_MIN_SINK_CLEARANCE_METERS = 18;
// Penalty per meter too close to a drainage sink
const RESIDENCE_SINK_PROXIMITY_PENALTY_PER_METER = 3.2;
// Multiplier on footprint extent used to derive minimum boundary clearance
const RESIDENCE_BOUNDARY_CLEARANCE_FOOTPRINT_FACTOR = 0.55;
// Absolute minimum boundary clearance regardless of footprint size (meters)
const RESIDENCE_BOUNDARY_CLEARANCE_MIN_METERS = 6;
// Absolute maximum boundary clearance cap (meters)
const RESIDENCE_BOUNDARY_CLEARANCE_MAX_METERS = 14;
// Penalty per meter of shortfall below minimum boundary clearance
const RESIDENCE_BOUNDARY_CLEARANCE_PENALTY_PER_METER = 4.5;

// ─── Ground solar placement penalty tuning ───
// Penalty weight for solar array sitting below preferred elevation
const SOLAR_ELEVATION_PENALTY_WEIGHT = 20;
// Penalty per meter when solar is closer to residence than preferred minimum
const SOLAR_DISTANCE_BELOW_MIN_PENALTY = 2.4;
// Penalty per meter when solar is farther from residence than preferred maximum
const SOLAR_DISTANCE_ABOVE_MAX_PENALTY = 1.8;
// Penalty weight for deviation from the midpoint of preferred distance range
const SOLAR_DISTANCE_MIDPOINT_PENALTY = 0.12;
// Buffer appended to calculated offset to define preferred proximity to residence (meters)
const SOLAR_OFFSET_EXTENSION_METERS = 4;
// Maximum preferred distance from residence (relative to offset, meters)
const SOLAR_PREFERRED_DISTANCE_MAX_EXTENSION_METERS = 18;
// Minimum preferred distance from residence (floor, meters)
const SOLAR_PREFERRED_DISTANCE_MIN_FLOOR_METERS = 8;
// Minimum distance from drainage sinks (meters)
const SOLAR_MIN_SINK_CLEARANCE_METERS = 20;
// Penalty per meter too close to a drainage sink
const SOLAR_SINK_PROXIMITY_PENALTY_PER_METER = 2.8;
// Minimum clearance from terrain boundary polygon (meters)
const SOLAR_BOUNDARY_CLEARANCE_MIN_METERS = 5;
// Penalty per meter too close to boundary
const SOLAR_BOUNDARY_CLEARANCE_PENALTY_PER_METER = 4;
// Penalty for solar array facing away from equator (negative north alignment)
const SOLAR_NORTH_MISALIGNMENT_PENALTY = 28;
// Reward for solar array facing equator (positive north alignment)
const SOLAR_NORTH_ALIGNMENT_REWARD = 8;

const RESIDENCE_TERRAIN_TOLERANCE: TerrainToleranceProfile = {
  maxAltitudeVariationMeters: RESIDENCE_MAX_ALTITUDE_VARIATION_METERS,
  maxAverageSlopePercentage: RESIDENCE_MAX_AVERAGE_SLOPE_PERCENT,
  maxCriticalCellRatio: RESIDENCE_MAX_CRITICAL_CELL_RATIO,
  maxCriticalSlopePercentage: RESIDENCE_MAX_CRITICAL_SLOPE_PERCENT,
};
const GROUND_SOLAR_TERRAIN_TOLERANCE: TerrainToleranceProfile = {
  maxAltitudeVariationMeters: SOLAR_GROUND_MAX_ALTITUDE_VARIATION_METERS,
  maxAverageSlopePercentage: SOLAR_GROUND_MAX_AVERAGE_SLOPE_PERCENT,
  maxCriticalCellRatio: SOLAR_GROUND_MAX_CRITICAL_CELL_RATIO,
  maxCriticalSlopePercentage: SOLAR_GROUND_MAX_CRITICAL_SLOPE_PERCENT,
};

export function placeResidence(
  input: ProceduralEngineInput,
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  centroid: { x: number; y: number },
  topographySummary: TopographySummary,
  sinkCoordinates: GridCoordinate[],
): ResidencePlacement {
  const footprint = buildFootprintFromArea(input.residence.area, 6); // aspect ratio hint: 1:6
  const rotationRadians = getOperationalRotationRadians(input.terrain.northAngle);
  const placementFootprint = getPlacementFootprintForRotation(footprint, rotationRadians);
  const widthCells = metersToCells(placementFootprint.width, input.terrain.cellSize);
  const lengthCells = metersToCells(placementFootprint.length, input.terrain.cellSize);
  const centroidGrid = worldPointToGrid(centroid, input.terrain);
  let bestCandidate: RectCandidate | null = null;

  for (let originY = 0; originY <= input.terrain.gridHeight - lengthCells; originY += 1) {
    for (let originX = 0; originX <= input.terrain.gridWidth - widthCells; originX += 1) {
      const candidate = evaluateRectCandidate({
        lengthCells,
        occupationGrid,
        originX,
        originY,
        polygonMask,
        terrain: input.terrain,
        terrainTolerance: RESIDENCE_TERRAIN_TOLERANCE,
        widthCells,
      });

      if (!candidate) {
        continue;
      }

      const distanceToCentroid =
        Math.hypot(candidate.center.x - centroidGrid.x, candidate.center.y - centroidGrid.y) *
        input.terrain.cellSize;
      const nearestSinkDistance = getNearestSinkDistance(
        candidate.center,
        sinkCoordinates,
        input.terrain.cellSize,
      );
      const boundaryClearance = getDistanceToPolygonBoundary(candidate.worldPoint, input.terrain.polygon);
      const operationalPenalty = getResidenceOperationalPenalty(
        candidate,
        distanceToCentroid,
        nearestSinkDistance,
        boundaryClearance,
        topographySummary,
        placementFootprint,
      );
      const score =
        operationalPenalty +
        candidate.averageSlope * RESIDENCE_SCORE_WEIGHT_AVG_SLOPE +
        candidate.maxSlope * RESIDENCE_SCORE_WEIGHT_MAX_SLOPE +
        candidate.elevationSpan * RESIDENCE_SCORE_WEIGHT_ELEVATION_SPAN +
        candidate.criticalCellRatio * RESIDENCE_SCORE_WEIGHT_CRITICAL_RATIO -
        candidate.flatCellRatio * RESIDENCE_SCORE_WEIGHT_FLAT_RATIO;

      if (!bestCandidate || score < bestCandidate.score) {
        bestCandidate = { ...candidate, score };
      }
    }
  }

  if (!bestCandidate) {
    throw new Error('Nao foi possivel encaixar a residencia em uma area valida do terreno.');
  }

  fillFootprint(
    occupationGrid,
    input.terrain.gridWidth,
    bestCandidate.origin.x,
    bestCandidate.origin.y,
    bestCandidate.widthCells,
    bestCandidate.lengthCells,
    RESIDENCE_OCCUPATION_VALUE,
  );

  const requiredSolarArea = calculateSolarFootprintArea(input.residence.calculatedSolarNeed);
  const roofSolarCapacityArea = roundTo(input.residence.area * SOLAR_ROOF_UTILIZATION, 1);
  const roofSolarAreaUsed = Math.min(requiredSolarArea, roofSolarCapacityArea);

  return {
    center: bestCandidate.center,
    elevation: bestCandidate.elevation,
    footprint,
    origin: bestCandidate.origin,
    requiredSolarArea,
    rotationRadians,
    roofSolarAreaUsed,
    roofSolarCapacityArea,
    worldPosition: {
      x: bestCandidate.worldPoint.x,
      y: bestCandidate.worldPoint.y,
      z: bestCandidate.elevation,
    },
  };
}

export function placeGroundSolarArray(
  input: ProceduralEngineInput,
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  residence: ResidencePlacement,
  topographySummary: TopographySummary,
  sinkCoordinates: GridCoordinate[],
): SolarPlacement | null {
  const requiredGroundArea = roundTo(
    Math.max(0, residence.requiredSolarArea - residence.roofSolarAreaUsed),
    1,
  );

  if (requiredGroundArea <= 0) {
    return null;
  }

  const footprint = buildFootprintFromArea(requiredGroundArea, 2); // aspect ratio hint: 1:2 (wider arrays)
  const rotationRadians = getOperationalRotationRadians(input.terrain.northAngle);
  const placementFootprint = getPlacementFootprintForRotation(footprint, rotationRadians);
  const widthCells = metersToCells(placementFootprint.width, input.terrain.cellSize);
  const lengthCells = metersToCells(placementFootprint.length, input.terrain.cellSize);
  const northVector = getNorthVector(input.terrain.northAngle);
  const offsetDistance =
    Math.ceil((residence.footprint.width + residence.footprint.length + footprint.width + footprint.length) / 4) +
    SOLAR_OFFSET_EXTENSION_METERS;
  const preferredDistanceMin = Math.max(SOLAR_PREFERRED_DISTANCE_MIN_FLOOR_METERS, offsetDistance - SOLAR_OFFSET_EXTENSION_METERS);
  const preferredDistanceMax = offsetDistance + SOLAR_PREFERRED_DISTANCE_MAX_EXTENSION_METERS;
  const preferredCenter = {
    x: residence.center.x + northVector.x * offsetDistance,
    y: residence.center.y + northVector.y * offsetDistance,
  };
  let bestCandidate: RectCandidate | null = null;

  for (let originY = 0; originY <= input.terrain.gridHeight - lengthCells; originY += 1) {
    for (let originX = 0; originX <= input.terrain.gridWidth - widthCells; originX += 1) {
      const candidate = evaluateRectCandidate({
        lengthCells,
        occupationGrid,
        originX,
        originY,
        polygonMask,
        terrain: input.terrain,
        terrainTolerance: GROUND_SOLAR_TERRAIN_TOLERANCE,
        widthCells,
      });

      if (!candidate) {
        continue;
      }

      const directionX = candidate.center.x - residence.center.x;
      const directionY = candidate.center.y - residence.center.y;
      const directionLength = Math.hypot(directionX, directionY) || 1;
      const northAlignment =
        (directionX / directionLength) * northVector.x + (directionY / directionLength) * northVector.y;
      const distanceToPreferred =
        Math.hypot(candidate.center.x - preferredCenter.x, candidate.center.y - preferredCenter.y) *
        input.terrain.cellSize;
      const distanceToResidence =
        Math.hypot(candidate.center.x - residence.center.x, candidate.center.y - residence.center.y) *
        input.terrain.cellSize;
      const nearestSinkDistance = getNearestSinkDistance(
        candidate.center,
        sinkCoordinates,
        input.terrain.cellSize,
      );
      const boundaryClearance = getDistanceToPolygonBoundary(candidate.worldPoint, input.terrain.polygon);
      const solarPenalty = getGroundSolarPlacementPenalty({
        boundaryClearance,
        candidate,
        distanceToResidence,
        nearestSinkDistance,
        northAlignment,
        preferredDistanceMax,
        preferredDistanceMin,
        residence,
        topographySummary,
      });
      const score =
        distanceToPreferred +
        solarPenalty +
        candidate.maxSlope * SOLAR_SCORE_WEIGHT_MAX_SLOPE +
        candidate.elevationSpan * SOLAR_SCORE_WEIGHT_ELEVATION_SPAN +
        candidate.criticalCellRatio * SOLAR_SCORE_WEIGHT_CRITICAL_RATIO -
        candidate.flatCellRatio * SOLAR_SCORE_WEIGHT_FLAT_RATIO;

      if (!bestCandidate || score < bestCandidate.score) {
        bestCandidate = { ...candidate, score };
      }
    }
  }

  if (!bestCandidate) {
    return null;
  }

  fillFootprint(
    occupationGrid,
    input.terrain.gridWidth,
    bestCandidate.origin.x,
    bestCandidate.origin.y,
    bestCandidate.widthCells,
    bestCandidate.lengthCells,
    GROUND_SOLAR_OCCUPATION_VALUE,
  );

  return {
    center: bestCandidate.center,
    elevation: bestCandidate.elevation,
    footprint,
    mounting: 'ground',
    origin: bestCandidate.origin,
    providedArea: requiredGroundArea,
    rotationRadians,
    worldPosition: {
      x: bestCandidate.worldPoint.x,
      y: bestCandidate.worldPoint.y,
      z: bestCandidate.elevation,
    },
  };
}

function getResidenceOperationalPenalty(
  candidate: RectCandidate,
  distanceToCentroid: number,
  nearestSinkDistance: number,
  boundaryClearance: number,
  topographySummary: TopographySummary,
  footprint: { width: number; length: number },
): number {
  const elevationRange = Math.max(
    0.1,
    topographySummary.maxElevation - topographySummary.minElevation,
  );
  const preferredElevation = Math.min(
    topographySummary.maxElevation,
    Math.max(
      topographySummary.averageElevation,
      topographySummary.averageElevation + elevationRange * RESIDENCE_PREFERRED_ELEVATION_ABOVE_AVERAGE_RATIO,
    ),
  );
  const elevationPenalty =
    (Math.abs(candidate.elevation - preferredElevation) / elevationRange) * RESIDENCE_ELEVATION_DEVIATION_PENALTY +
    (candidate.elevation < topographySummary.averageElevation
      ? ((topographySummary.averageElevation - candidate.elevation) / elevationRange) * RESIDENCE_BELOW_AVERAGE_ELEVATION_PENALTY
      : 0);
  const sinkPenalty =
    nearestSinkDistance < RESIDENCE_MIN_SINK_CLEARANCE_METERS
      ? (RESIDENCE_MIN_SINK_CLEARANCE_METERS - nearestSinkDistance) * RESIDENCE_SINK_PROXIMITY_PENALTY_PER_METER
      : 0;
  const minimumBoundaryClearance = Math.max(
    RESIDENCE_BOUNDARY_CLEARANCE_MIN_METERS,
    Math.min(
      RESIDENCE_BOUNDARY_CLEARANCE_MAX_METERS,
      Math.max(footprint.width, footprint.length) * RESIDENCE_BOUNDARY_CLEARANCE_FOOTPRINT_FACTOR,
    ),
  );
  const boundaryPenalty =
    boundaryClearance < minimumBoundaryClearance
      ? (minimumBoundaryClearance - boundaryClearance) * RESIDENCE_BOUNDARY_CLEARANCE_PENALTY_PER_METER
      : 0;

  return distanceToCentroid + elevationPenalty + sinkPenalty + boundaryPenalty;
}

function getGroundSolarPlacementPenalty({
  boundaryClearance,
  candidate,
  distanceToResidence,
  nearestSinkDistance,
  northAlignment,
  preferredDistanceMax,
  preferredDistanceMin,
  residence,
  topographySummary,
}: {
  boundaryClearance: number;
  candidate: RectCandidate;
  distanceToResidence: number;
  nearestSinkDistance: number;
  northAlignment: number;
  preferredDistanceMax: number;
  preferredDistanceMin: number;
  residence: ResidencePlacement;
  topographySummary: TopographySummary;
}): number {
  const elevationRange = Math.max(
    0.1,
    topographySummary.maxElevation - topographySummary.minElevation,
  );
  const preferredElevation = Math.max(topographySummary.averageElevation, residence.elevation);
  const elevationPenalty =
    candidate.elevation < preferredElevation
      ? ((preferredElevation - candidate.elevation) / elevationRange) * SOLAR_ELEVATION_PENALTY_WEIGHT
      : 0;
  const distancePenalty =
    distanceToResidence < preferredDistanceMin
      ? (preferredDistanceMin - distanceToResidence) * SOLAR_DISTANCE_BELOW_MIN_PENALTY
      : distanceToResidence > preferredDistanceMax
        ? (distanceToResidence - preferredDistanceMax) * SOLAR_DISTANCE_ABOVE_MAX_PENALTY
        : Math.abs(distanceToResidence - (preferredDistanceMin + preferredDistanceMax) / 2) * SOLAR_DISTANCE_MIDPOINT_PENALTY;
  const sinkPenalty =
    nearestSinkDistance < SOLAR_MIN_SINK_CLEARANCE_METERS
      ? (SOLAR_MIN_SINK_CLEARANCE_METERS - nearestSinkDistance) * SOLAR_SINK_PROXIMITY_PENALTY_PER_METER
      : 0;
  const boundaryPenalty =
    boundaryClearance < SOLAR_BOUNDARY_CLEARANCE_MIN_METERS
      ? (SOLAR_BOUNDARY_CLEARANCE_MIN_METERS - boundaryClearance) * SOLAR_BOUNDARY_CLEARANCE_PENALTY_PER_METER
      : 0;
  const northPenalty =
    northAlignment < 0
      ? Math.abs(northAlignment) * SOLAR_NORTH_MISALIGNMENT_PENALTY
      : -northAlignment * SOLAR_NORTH_ALIGNMENT_REWARD;

  return elevationPenalty + distancePenalty + sinkPenalty + boundaryPenalty + northPenalty;
}
