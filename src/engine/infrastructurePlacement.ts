import type {
  GridCoordinate,
  InfrastructurePlacement,
  TopographySummary,
} from '../core/types/generation';

// ─── Dependency proximity bonus ───
// Maximum score bonus for being adjacent to a preferred-near infrastructure element
const DEPENDENCY_PROXIMITY_MAX_BONUS = 20;
// Distance (meters) beyond which the proximity bonus falls to zero
const DEPENDENCY_PROXIMITY_FALLOFF_METERS = 60;

// ─── Topography preference penalty weights ───
// Weight applied when normalising elevation deviation for LOWEST/HIGHEST preference
const TOPO_ELEVATION_WEIGHT_LOWEST_HIGHEST = 25;
// Weight applied when normalising elevation deviation for MID preference
const TOPO_ELEVATION_WEIGHT_MID = 30;

// ─── Placement scoring weights ───
// Penalty multiplier per unit of max slope across the footprint
const INFRA_SCORE_WEIGHT_MAX_SLOPE = 1.2;
// Penalty multiplier per meter of elevation span across the footprint
const INFRA_SCORE_WEIGHT_ELEVATION_SPAN = 8;
// Penalty multiplier for ratio of cells exceeding tolerance slope
const INFRA_SCORE_WEIGHT_CRITICAL_RATIO = 40;
// Reward multiplier for flat-cell ratio for STABLE topography preference
const INFRA_SCORE_FLAT_RATIO_STABLE = 24;
// Reward multiplier for flat-cell ratio for other topography preferences
const INFRA_SCORE_FLAT_RATIO_DEFAULT = 14;
// Multiplier on nearest-sink distance for keyline infrastructure penalty
const INFRA_HYDROLOGY_SINK_WEIGHT = 1.8;

// ─── Distance penalties (for infrastructure without explicit preferred range) ───
// Penalty multiplier per meter below preferred minimum distance
const INFRA_DISTANCE_BELOW_MIN_PENALTY = 2.2;
// Penalty multiplier per meter above preferred maximum distance
const INFRA_DISTANCE_ABOVE_MAX_PENALTY = 1.8;
// Penalty weight for deviation from midpoint of preferred distance range
const INFRA_DISTANCE_MIDPOINT_PENALTY = 0.15;
// Ideal distance from residence used when NEAR constraint has no explicit range (meters)
const INFRA_NEAR_IDEAL_DISTANCE_METERS = 20;
// Ideal distance from residence used when FAR constraint has no explicit range (meters)
const INFRA_FAR_IDEAL_DISTANCE_METERS = 120;
// Penalty multiplier per meter of distance when using FAR ideal distance
const INFRA_FAR_IDEAL_PENALTY_FACTOR = 0.4;
// Penalty multiplier per meter when FLEXIBLE (no proximity rule) is in effect
const INFRA_FLEXIBLE_DISTANCE_PENALTY_FACTOR = 0.05;

// ─── Describe-placement thresholds ───
// Elevation-span threshold above which foundation levelling is mentioned (meters)
const INFRA_RATIONALE_FOUNDATION_THRESHOLD_METERS = 0.2;
// Flat-cell ratio considered "predominantly flat"
const INFRA_RATIONALE_FLAT_THRESHOLD_HIGH = 0.7;
// Flat-cell ratio considered "partially flat"
const INFRA_RATIONALE_FLAT_THRESHOLD_LOW = 0.4;
import type { IInfrastructure } from '../core/types/infrastructure';
import { gridToWorld } from '../core/utils/terrain';
import type { ProceduralEngineInput } from './types';
import {
  evaluateRectCandidate,
  FAR_DISTANCE_METERS,
  fillFootprint,
  getNearestSinkDistance,
  metersToCells,
  NEAR_DISTANCE_METERS,
  roundTo,
  toTerrainToleranceProfile,
} from './placementUtils';
import type { PlacementCandidate } from './placementUtils';

export function placeInfrastructure(
  input: ProceduralEngineInput,
  infrastructureCatalog: IInfrastructure[],
  sinkCoordinates: GridCoordinate[],
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  residenceGrid: GridCoordinate,
  topographySummary: TopographySummary,
): InfrastructurePlacement[] {
  const placedSoFar: InfrastructurePlacement[] = [];

  return input.preferences.infrastructure.map((infrastructureId, placementIndex) => {
    const infrastructure = infrastructureCatalog.find((candidate) => candidate.id === infrastructureId);

    if (!infrastructure) {
      const result: InfrastructurePlacement = {
        infrastructureId,
        name: infrastructureId,
        status: 'skipped',
        rationale: 'Infraestrutura nao encontrada no catalogo local.',
      };
      placedSoFar.push(result);
      return result;
    }

    const bestCandidate = findPlacementCandidate(
      infrastructure,
      input.terrain,
      sinkCoordinates,
      polygonMask,
      occupationGrid,
      residenceGrid,
      topographySummary,
      placedSoFar,
    );

    if (!bestCandidate) {
      const result: InfrastructurePlacement = {
        infrastructureId: infrastructure.id,
        name: infrastructure.name,
        status: 'skipped',
        rationale: 'Nenhuma area elegivel respeitou poligono, inclinacao e distancia da residencia.',
      };
      placedSoFar.push(result);
      return result;
    }

    fillFootprint(
      occupationGrid,
      input.terrain.gridWidth,
      bestCandidate.origin.x,
      bestCandidate.origin.y,
      bestCandidate.widthCells,
      bestCandidate.lengthCells,
      placementIndex + 1,
    );

    const result: InfrastructurePlacement = {
      infrastructureId: infrastructure.id,
      name: infrastructure.name,
      category: infrastructure.category,
      footprint: {
        length: infrastructure.footprintLength,
        width: infrastructure.footprintWidth,
      },
      status: 'placed',
      gridPosition: bestCandidate.center,
      worldPosition: {
        x: bestCandidate.worldPoint.x,
        y: bestCandidate.worldPoint.y,
        z: bestCandidate.elevation,
      },
      rationale: bestCandidate.rationale,
    };
    placedSoFar.push(result);
    return result;
  });
}

function findPlacementCandidate(
  infrastructure: IInfrastructure,
  terrain: ProceduralEngineInput['terrain'],
  sinkCoordinates: GridCoordinate[],
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  residenceGrid: GridCoordinate,
  topographySummary: TopographySummary,
  placedSoFar: InfrastructurePlacement[] = [],
): PlacementCandidate | null {
  const widthCells = metersToCells(infrastructure.footprintWidth, terrain.cellSize);
  const lengthCells = metersToCells(infrastructure.footprintLength, terrain.cellSize);

  // Collect world positions of preferred-near infrastructure already placed
  const dependencyPositions = collectDependencyPositions(infrastructure, placedSoFar, terrain);

  let bestCandidate: PlacementCandidate | null = null;

  for (let originY = 0; originY <= terrain.gridHeight - lengthCells; originY += 1) {
    for (let originX = 0; originX <= terrain.gridWidth - widthCells; originX += 1) {
      const fit = evaluateInfrastructureFootprint(
        originX,
        originY,
        widthCells,
        lengthCells,
        infrastructure,
        terrain,
        sinkCoordinates,
        polygonMask,
        occupationGrid,
        residenceGrid,
        topographySummary,
        dependencyPositions,
      );

      if (!fit || (bestCandidate && fit.score >= bestCandidate.score)) {
        continue;
      }

      bestCandidate = fit;
    }
  }

  return bestCandidate;
}

function evaluateInfrastructureFootprint(
  originX: number,
  originY: number,
  widthCells: number,
  lengthCells: number,
  infrastructure: IInfrastructure,
  terrain: ProceduralEngineInput['terrain'],
  sinkCoordinates: GridCoordinate[],
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  residenceGrid: GridCoordinate,
  topographySummary: TopographySummary,
  dependencyPositions: Array<{ x: number; y: number }> = [],
): PlacementCandidate | null {
  const terrainTolerance = toTerrainToleranceProfile(infrastructure.placementRules);
  const candidate = evaluateRectCandidate({
    lengthCells,
    occupationGrid,
    originX,
    originY,
    polygonMask,
    terrain,
    terrainTolerance,
    widthCells,
  });

  if (!candidate) {
    return null;
  }

  const residenceWorld = gridToWorld(residenceGrid.x, residenceGrid.y, terrain);
  const distanceToResidence = Math.hypot(
    candidate.worldPoint.x - residenceWorld.x,
    candidate.worldPoint.y - residenceWorld.y,
  );

  if (!isDistanceAllowedByConstraint(infrastructure.placementRules.proximityToResidence, distanceToResidence)) {
    return null;
  }

  const nearestSinkDistance = infrastructure.placementRules.requiresKeyline
    ? getNearestSinkDistance(candidate.center, sinkCoordinates, terrain.cellSize)
    : Number.POSITIVE_INFINITY;
  const dependencyProximityScore = getDependencyProximityScore(
    candidate.worldPoint,
    dependencyPositions,
  );
  const score = buildPlacementScore(
    infrastructure,
    distanceToResidence,
    nearestSinkDistance,
    topographySummary,
    candidate.elevation,
    candidate.maxSlope,
    candidate.elevationSpan,
    candidate.criticalCellRatio,
    candidate.flatCellRatio,
    dependencyProximityScore,
  );

  return {
    ...candidate,
    rationale: describePlacement(
      infrastructure,
      distanceToResidence,
      nearestSinkDistance,
      topographySummary,
      candidate.elevation,
      candidate.elevationSpan,
      candidate.criticalCellRatio,
      candidate.flatCellRatio,
    ),
    score,
  };
}

function buildPlacementScore(
  infrastructure: IInfrastructure,
  distanceToResidence: number,
  nearestSinkDistance: number,
  topographySummary: TopographySummary,
  averageElevation: number,
  maxSlope: number,
  elevationSpan: number,
  criticalCellRatio: number,
  flatCellRatio: number,
  dependencyProximityScore = 0,
): number {
  const distanceScore = getPreferredDistancePenalty(infrastructure.placementRules, distanceToResidence);
  const hydrologyScore = infrastructure.placementRules.requiresKeyline ? nearestSinkDistance * INFRA_HYDROLOGY_SINK_WEIGHT : 0;
  const topographyScore = getTopographyPreferencePenalty(
    infrastructure.placementRules.topographyPreference,
    averageElevation,
    topographySummary,
  );

  return (
    distanceScore +
    hydrologyScore +
    topographyScore +
    maxSlope * INFRA_SCORE_WEIGHT_MAX_SLOPE +
    elevationSpan * INFRA_SCORE_WEIGHT_ELEVATION_SPAN +
    criticalCellRatio * INFRA_SCORE_WEIGHT_CRITICAL_RATIO -
    flatCellRatio * (infrastructure.placementRules.topographyPreference === 'STABLE'
      ? INFRA_SCORE_FLAT_RATIO_STABLE
      : INFRA_SCORE_FLAT_RATIO_DEFAULT) -
    dependencyProximityScore
  );
}

/**
 * Collect world positions of already-placed infrastructure that this one
 * should be near (based on preferredNearInfrastructure).
 */
function collectDependencyPositions(
  infrastructure: IInfrastructure,
  placedSoFar: InfrastructurePlacement[],
  _terrain: ProceduralEngineInput['terrain'],
): Array<{ x: number; y: number }> {
  const preferredIds = infrastructure.preferredNearInfrastructure;

  if (!preferredIds || preferredIds.length === 0) {
    return [];
  }

  const positions: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < placedSoFar.length; i += 1) {
    const placed = placedSoFar[i];

    if (placed.status !== 'placed' || !placed.worldPosition) {
      continue;
    }

    if (preferredIds.includes(placed.infrastructureId)) {
      positions.push({ x: placed.worldPosition.x, y: placed.worldPosition.y });
    }
  }

  return positions;
}

/**
 * Score bonus (positive = better) for proximity to dependency infrastructure.
 * Returns a value that will be subtracted from the penalty score (lower = better).
 * Max bonus ~20 when within 15m, tapering to 0 at 60m.
 */
function getDependencyProximityScore(
  candidateWorld: { x: number; y: number },
  dependencyPositions: Array<{ x: number; y: number }>,
): number {
  if (dependencyPositions.length === 0) {
    return 0;
  }

  let totalBonus = 0;

  for (let i = 0; i < dependencyPositions.length; i += 1) {
    const dep = dependencyPositions[i];
    const distance = Math.hypot(candidateWorld.x - dep.x, candidateWorld.y - dep.y);

    // Bonus tapers linearly from DEPENDENCY_PROXIMITY_MAX_BONUS (at 0m) to 0 (at DEPENDENCY_PROXIMITY_FALLOFF_METERS)
    if (distance < DEPENDENCY_PROXIMITY_FALLOFF_METERS) {
      totalBonus += Math.max(0, DEPENDENCY_PROXIMITY_MAX_BONUS * (1 - distance / DEPENDENCY_PROXIMITY_FALLOFF_METERS));
    }
  }

  return totalBonus;
}

function describePlacement(
  infrastructure: IInfrastructure,
  distanceToResidence: number,
  nearestSinkDistance: number,
  topographySummary: TopographySummary,
  elevation: number,
  elevationSpan: number,
  criticalCellRatio: number,
  flatCellRatio: number,
): string {
  const proximity = buildDistanceRationale(infrastructure.placementRules, distanceToResidence);
  const hydrology = infrastructure.placementRules.requiresKeyline
    ? `proximo ao sink hidrologico mais proximo (${Math.round(nearestSinkDistance)}m)`
    : buildTopographyRationale(
        infrastructure.placementRules.topographyPreference,
        elevation,
        topographySummary,
      );
  const foundation =
    elevationSpan > INFRA_RATIONALE_FOUNDATION_THRESHOLD_METERS || criticalCellRatio > 0
      ? `com fundacao leve absorvendo variacao de ${roundTo(elevationSpan, 2)}m`
      : 'sem necessidade relevante de regularizacao altimetrica';
  const flatness =
    flatCellRatio >= INFRA_RATIONALE_FLAT_THRESHOLD_HIGH
      ? 'aproveitando uma faixa predominantemente plana'
      : flatCellRatio >= INFRA_RATIONALE_FLAT_THRESHOLD_LOW
        ? 'aproveitando uma faixa parcialmente plana'
        : 'em terreno com pouca planicidade util';

  return `Posicionado ${proximity}, ${hydrology}, ${flatness}, ${foundation}.`;
}

function isDistanceAllowedByConstraint(
  proximityRule: IInfrastructure['placementRules']['proximityToResidence'],
  distanceToResidence: number,
): boolean {
  if (proximityRule === 'NEAR') {
    return distanceToResidence <= NEAR_DISTANCE_METERS;
  }

  if (proximityRule === 'FAR') {
    return distanceToResidence >= FAR_DISTANCE_METERS;
  }

  return true;
}

function getPreferredDistancePenalty(
  placementRules: IInfrastructure['placementRules'],
  distanceToResidence: number,
): number {
  const { preferredDistanceMaxMeters, preferredDistanceMinMeters, proximityToResidence } = placementRules;

  if (preferredDistanceMinMeters !== undefined && distanceToResidence < preferredDistanceMinMeters) {
    return (preferredDistanceMinMeters - distanceToResidence) * INFRA_DISTANCE_BELOW_MIN_PENALTY;
  }

  if (preferredDistanceMaxMeters !== undefined && distanceToResidence > preferredDistanceMaxMeters) {
    return (distanceToResidence - preferredDistanceMaxMeters) * INFRA_DISTANCE_ABOVE_MAX_PENALTY;
  }

  if (preferredDistanceMinMeters !== undefined && preferredDistanceMaxMeters !== undefined) {
    const midpoint = (preferredDistanceMinMeters + preferredDistanceMaxMeters) / 2;
    return Math.abs(distanceToResidence - midpoint) * INFRA_DISTANCE_MIDPOINT_PENALTY;
  }

  if (proximityToResidence === 'NEAR') {
    return Math.abs(distanceToResidence - INFRA_NEAR_IDEAL_DISTANCE_METERS);
  }

  if (proximityToResidence === 'FAR') {
    return Math.abs(distanceToResidence - INFRA_FAR_IDEAL_DISTANCE_METERS) * INFRA_FAR_IDEAL_PENALTY_FACTOR;
  }

  return distanceToResidence * INFRA_FLEXIBLE_DISTANCE_PENALTY_FACTOR;
}

function getTopographyPreferencePenalty(
  preference: IInfrastructure['placementRules']['topographyPreference'],
  averageElevation: number,
  topographySummary: TopographySummary,
): number {
  const elevationRange = Math.max(
    0.1,
    topographySummary.maxElevation - topographySummary.minElevation,
  );

  switch (preference) {
    case 'LOWEST':
      return ((averageElevation - topographySummary.minElevation) / elevationRange) * TOPO_ELEVATION_WEIGHT_LOWEST_HIGHEST;
    case 'HIGHEST':
      return ((topographySummary.maxElevation - averageElevation) / elevationRange) * TOPO_ELEVATION_WEIGHT_LOWEST_HIGHEST;
    case 'MID':
      return (Math.abs(averageElevation - topographySummary.averageElevation) / elevationRange) * TOPO_ELEVATION_WEIGHT_MID;
    case 'STABLE':
      return 0;
    default:
      return 0;
  }
}

function buildDistanceRationale(
  placementRules: IInfrastructure['placementRules'],
  distanceToResidence: number,
): string {
  const distanceLabel = `${Math.round(distanceToResidence)}m da residencia`;

  if (
    placementRules.preferredDistanceMinMeters !== undefined &&
    placementRules.preferredDistanceMaxMeters !== undefined
  ) {
    return `${distanceLabel}, dentro da faixa operacional de ${placementRules.preferredDistanceMinMeters}-${placementRules.preferredDistanceMaxMeters}m`;
  }

  if (placementRules.proximityToResidence === 'NEAR') {
    return `${distanceLabel}, mantendo proximidade operacional`;
  }

  if (placementRules.proximityToResidence === 'FAR') {
    return `${distanceLabel}, respeitando afastamento da residencia`;
  }

  return `${distanceLabel}, em faixa operacional neutra`;
}

function buildTopographyRationale(
  preference: IInfrastructure['placementRules']['topographyPreference'],
  elevation: number,
  topographySummary: TopographySummary,
): string {
  switch (preference) {
    case 'LOWEST':
      return `priorizando cotas baixas (${roundTo(elevation, 1)}m dentro do intervalo ${topographySummary.minElevation}-${topographySummary.maxElevation}m)`;
    case 'HIGHEST':
      return `priorizando cotas altas e drenadas (${roundTo(elevation, 1)}m)`;
    case 'MID':
      return `em cota intermediaria de ${roundTo(elevation, 1)}m`;
    case 'STABLE':
      return `em cota estavel de ${roundTo(elevation, 1)}m`;
    default:
      return `em cota media de ${roundTo(elevation, 1)}m`;
  }
}
