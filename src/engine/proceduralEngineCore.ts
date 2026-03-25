import { dataService } from '../core/services/dataService';
import type {
  GeneratedProject,
  GridCoordinate,
  InfrastructurePlacement,
  LayoutGuide,
  ProjectReport,
  ResidencePlacement,
  SolarPlacement,
  TopographySummary,
} from '../core/types/generation';
import type { IInfrastructure } from '../core/types/infrastructure';
import type { TerrainGridConfig, TerrainPoint } from '../core/types/terrain';
import {
  buildPolygonMask,
  calculatePolygonCentroid,
  getDistanceToPolygonBoundary,
  getGridIndex,
  gridToWorld,
  sampleElevation,
  worldToGrid,
} from '../core/utils/terrain';
import { generateBotanicalLayout } from './botanicalLayout';
import { generatePlantingLayout } from './plantingLayout';
import type { ProceduralEngineInput } from './types';
import { analyzeTopography, FLAT_SLOPE_THRESHOLD_PERCENT } from './topography';

const FAR_DISTANCE_METERS = 100;
const NEAR_DISTANCE_METERS = 50;
const RESIDENCE_TERRAIN_TOLERANCE: TerrainToleranceProfile = {
  maxAltitudeVariationMeters: 1.4,
  maxAverageSlopePercentage: 12,
  maxCriticalCellRatio: 0.28,
  maxCriticalSlopePercentage: 22,
};
const GROUND_SOLAR_TERRAIN_TOLERANCE: TerrainToleranceProfile = {
  maxAltitudeVariationMeters: 0.9,
  maxAverageSlopePercentage: 8,
  maxCriticalCellRatio: 0.12,
  maxCriticalSlopePercentage: 14,
};
const SOLAR_ROOF_UTILIZATION = 0.65;
const RESIDENCE_OCCUPATION_VALUE = -1;
const GROUND_SOLAR_OCCUPATION_VALUE = -2;
const SERVICE_CORRIDOR_OCCUPATION_VALUE = -4;
const MAX_SINK_COORDINATES_FOR_PLACEMENT = 256;
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

export function generateProjectCore(input: ProceduralEngineInput): GeneratedProject {
  const terrainValidationError = validateTerrain(input.terrain.polygon, input.terrain.area);

  if (terrainValidationError) {
    throw new Error(terrainValidationError);
  }

  const topography = analyzeTopography(input.terrain);
  const polygonMask = buildPolygonMask(input.terrain.polygon, input.terrain);
  const occupationGrid = new Int32Array(input.terrain.gridWidth * input.terrain.gridHeight);
  const infrastructureCatalog = dataService.getInfrastructureData();
  const botanicalCatalog = input.climate ? dataService.getBotanicalData(input.climate) : [];
  const placementSinkCoordinates = normalizeSinkCoordinatesForPlacement(
    topography.sinkCoordinates,
    input.terrain,
  );
  const centroid = calculatePolygonCentroid(input.terrain.polygon) ?? { x: 0, y: 0 };
  const residence = placeResidence(
    input,
    polygonMask,
    occupationGrid,
    centroid,
    topography.summary,
    placementSinkCoordinates,
  );
  const groundSolarPlacement = placeGroundSolarArray(
    input,
    polygonMask,
    occupationGrid,
    residence,
    topography.summary,
    placementSinkCoordinates,
  );
  const placements = placeInfrastructure(
    input,
    infrastructureCatalog,
    placementSinkCoordinates,
    polygonMask,
    occupationGrid,
    residence.center,
    topography.summary,
  );
  const serviceCorridors = generateServiceCorridors({
    groundSolarPlacement,
    infrastructurePlacements: placements,
    occupationGrid,
    polygonMask,
    residence,
    restrictionGrid: topography.restrictionGrid,
    slopeGrid: topography.slopeGrid,
    terrain: input.terrain,
  });
  const botanicalServiceAnchors = buildBotanicalServiceAnchors(residence, placements);
  const seed = hashSeed(input);
  const plantingLayout = generatePlantingLayout(input.terrain, polygonMask, topography.slopeGrid);
  const botanicalLayout = generateBotanicalLayout({
    climate: input.climate,
    interRows: plantingLayout.interRows,
    occupationGrid,
    plantingRows: plantingLayout.plantingRows,
    polygonMask,
    seed,
    serviceAnchors: botanicalServiceAnchors,
    speciesCatalog: botanicalCatalog,
    terrain: input.terrain,
  });
  const placedCount = placements.filter((placement) => placement.status === 'placed').length;

  const report: ProjectReport = {
    seed,
    terrainArea: input.terrain.area,
    topography: topography.summary,
    layout: {
      contourInterval: plantingLayout.contourInterval,
      interRowCount: plantingLayout.interRows.length,
      keylineCount: plantingLayout.keylines.length,
      plantingRowCount: plantingLayout.plantingRows.length,
      rowSpacingMeters: plantingLayout.rowSpacingMeters,
      serviceCorridorCount: serviceCorridors.length,
    },
    infrastructure: {
      requested: input.preferences.infrastructure.length,
      placed: placedCount,
      skipped: placements.length - placedCount,
      placements,
    },
    botanical: {
      averageInterRowMaintenanceCycleDays: botanicalLayout.averageInterRowMaintenanceCycleDays,
      dominantInterRowProfile: botanicalLayout.dominantInterRowProfile,
      compatibleSpeciesCount: botanicalCatalog.length,
      interRowPlantCount: botanicalLayout.interRowPlantCount,
      placedCount: botanicalLayout.plants.length,
      rowPlantCount: botanicalLayout.rowPlantCount,
      rowsPopulated: botanicalLayout.rowsPopulated,
      serviceCorePlantCount: botanicalLayout.serviceCorePlantCount,
      status: botanicalLayout.status,
      strataUsed: botanicalLayout.strataUsed,
    },
  };

  return {
    seed,
    slopeGrid: topography.slopeGrid,
    flowDirectionGrid: topography.flowDirectionGrid,
    restrictionGrid: topography.restrictionGrid,
    occupationGrid,
    sinks: placementSinkCoordinates,
    residence,
    groundSolarPlacement,
    interRows: plantingLayout.interRows,
    keylines: plantingLayout.keylines,
    plantingRows: plantingLayout.plantingRows,
    serviceCorridors,
    plants: botanicalLayout.plants,
    report,
  };
}

function validateTerrain(polygon: TerrainPoint[], area: number): string | null {
  if (polygon.length < 3 || area <= 0) {
    return 'Terreno invalido para processamento.';
  }

  return null;
}

function placeResidence(
  input: ProceduralEngineInput,
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  centroid: TerrainPoint,
  topographySummary: TopographySummary,
  sinkCoordinates: GridCoordinate[],
): ResidencePlacement {
  const footprint = buildFootprintFromArea(input.residence.area, 6);
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
        candidate.averageSlope * 2.5 +
        candidate.maxSlope * 1.1 +
        candidate.elevationSpan * 8 +
        candidate.criticalCellRatio * 35 -
        candidate.flatCellRatio * 18;

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

function placeGroundSolarArray(
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

  const footprint = buildFootprintFromArea(requiredGroundArea, 2);
  const rotationRadians = getOperationalRotationRadians(input.terrain.northAngle);
  const placementFootprint = getPlacementFootprintForRotation(footprint, rotationRadians);
  const widthCells = metersToCells(placementFootprint.width, input.terrain.cellSize);
  const lengthCells = metersToCells(placementFootprint.length, input.terrain.cellSize);
  const northVector = getNorthVector(input.terrain.northAngle);
  const offsetDistance =
    Math.ceil((residence.footprint.width + residence.footprint.length + footprint.width + footprint.length) / 4) + 4;
  const preferredDistanceMin = Math.max(8, offsetDistance - 4);
  const preferredDistanceMax = offsetDistance + 18;
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
        candidate.maxSlope * 2.1 +
        candidate.elevationSpan * 10 +
        candidate.criticalCellRatio * 40 -
        candidate.flatCellRatio * 24;

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

function placeInfrastructure(
  input: ProceduralEngineInput,
  infrastructureCatalog: IInfrastructure[],
  sinkCoordinates: GridCoordinate[],
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  residenceGrid: GridCoordinate,
  topographySummary: TopographySummary,
): InfrastructurePlacement[] {
  return input.preferences.infrastructure.map((infrastructureId, placementIndex) => {
    const infrastructure = infrastructureCatalog.find((candidate) => candidate.id === infrastructureId);

    if (!infrastructure) {
      return {
        infrastructureId,
        name: infrastructureId,
        status: 'skipped',
        rationale: 'Infraestrutura nao encontrada no catalogo local.',
      };
    }

    const bestCandidate = findPlacementCandidate(
      infrastructure,
      input.terrain,
      sinkCoordinates,
      polygonMask,
      occupationGrid,
      residenceGrid,
      topographySummary,
    );

    if (!bestCandidate) {
      return {
        infrastructureId: infrastructure.id,
        name: infrastructure.name,
        status: 'skipped',
        rationale: 'Nenhuma area elegivel respeitou poligono, inclinacao e distancia da residencia.',
      };
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

    return {
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
  });
}

function buildBotanicalServiceAnchors(
  residence: ResidencePlacement,
  placements: InfrastructurePlacement[],
): BotanicalServiceAnchor[] {
  const anchors: BotanicalServiceAnchor[] = [
    {
      center: residence.center,
      kind: 'RESIDENCE',
      radiusMeters: 24,
    },
  ];

  placements.forEach((placement) => {
    if (
      placement.status !== 'placed' ||
      !placement.gridPosition ||
      placement.category !== 'PROCESSAMENTO'
    ) {
      return;
    }

    anchors.push({
      center: placement.gridPosition,
      kind: 'PROCESSAMENTO',
      radiusMeters:
        placement.infrastructureId === 'viveiro-mudas'
          ? 20
          : placement.infrastructureId === 'compostagem'
            ? 18
            : 16,
    });
  });

  return anchors;
}

function findPlacementCandidate(
  infrastructure: IInfrastructure,
  terrain: ProceduralEngineInput['terrain'],
  sinkCoordinates: GridCoordinate[],
  polygonMask: Uint8Array,
  occupationGrid: Int32Array,
  residenceGrid: GridCoordinate,
  topographySummary: TopographySummary,
): PlacementCandidate | null {
  const widthCells = metersToCells(infrastructure.footprintWidth, terrain.cellSize);
  const lengthCells = metersToCells(infrastructure.footprintLength, terrain.cellSize);

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

function evaluateRectCandidate({
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
): number {
  const distanceScore = getPreferredDistancePenalty(infrastructure.placementRules, distanceToResidence);
  const hydrologyScore = infrastructure.placementRules.requiresKeyline ? nearestSinkDistance * 1.8 : 0;
  const topographyScore = getTopographyPreferencePenalty(
    infrastructure.placementRules.topographyPreference,
    averageElevation,
    topographySummary,
  );

  return (
    distanceScore +
    hydrologyScore +
    topographyScore +
    maxSlope * 1.2 +
    elevationSpan * 8 +
    criticalCellRatio * 40 -
    flatCellRatio * (infrastructure.placementRules.topographyPreference === 'STABLE' ? 24 : 14)
  );
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
    elevationSpan > 0.2 || criticalCellRatio > 0
      ? `com fundacao leve absorvendo variacao de ${roundTo(elevationSpan, 2)}m`
      : 'sem necessidade relevante de regularizacao altimetrica';
  const flatness =
    flatCellRatio >= 0.7
      ? 'aproveitando uma faixa predominantemente plana'
      : flatCellRatio >= 0.4
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
    return (preferredDistanceMinMeters - distanceToResidence) * 2.2;
  }

  if (preferredDistanceMaxMeters !== undefined && distanceToResidence > preferredDistanceMaxMeters) {
    return (distanceToResidence - preferredDistanceMaxMeters) * 1.8;
  }

  if (preferredDistanceMinMeters !== undefined && preferredDistanceMaxMeters !== undefined) {
    const midpoint = (preferredDistanceMinMeters + preferredDistanceMaxMeters) / 2;
    return Math.abs(distanceToResidence - midpoint) * 0.15;
  }

  if (proximityToResidence === 'NEAR') {
    return Math.abs(distanceToResidence - 20);
  }

  if (proximityToResidence === 'FAR') {
    return Math.abs(distanceToResidence - 120) * 0.4;
  }

  return distanceToResidence * 0.05;
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
      return ((averageElevation - topographySummary.minElevation) / elevationRange) * 25;
    case 'HIGHEST':
      return ((topographySummary.maxElevation - averageElevation) / elevationRange) * 25;
    case 'MID':
      return (Math.abs(averageElevation - topographySummary.averageElevation) / elevationRange) * 30;
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

function getLocalSlope(terrain: ProceduralEngineInput['terrain'], gridX: number, gridY: number): number {
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

function normalizeSinkCoordinatesForPlacement(
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

function getNearestSinkDistance(
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

function fillFootprint(
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

function generateServiceCorridors({
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
  const baseCost = 0.9 + slope / 15;

  return slope <= FLAT_SLOPE_THRESHOLD_PERCENT ? baseCost * 0.55 : baseCost;
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

  for (let iteration = 0; iteration < 2; iteration += 1) {
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

    smoothed.push(interpolateGuidePoint(current, next, 0.25));
    smoothed.push(interpolateGuidePoint(current, next, 0.75));
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

  const preferredSpacing = Math.max(terrain.cellSize * 0.65, 0.75);
  const sampleCount = Math.min(160, Math.max(3, Math.ceil(totalLength / preferredSpacing) + 1));
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
      Math.abs(previous.x - terrainPoint.x) < 0.001 &&
      Math.abs(previous.y - terrainPoint.y) < 0.001
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
      topographySummary.averageElevation + elevationRange * 0.12,
    ),
  );
  const elevationPenalty =
    (Math.abs(candidate.elevation - preferredElevation) / elevationRange) * 22 +
    (candidate.elevation < topographySummary.averageElevation
      ? ((topographySummary.averageElevation - candidate.elevation) / elevationRange) * 18
      : 0);
  const sinkPenalty = nearestSinkDistance < 18 ? (18 - nearestSinkDistance) * 3.2 : 0;
  const minimumBoundaryClearance = Math.max(6, Math.min(14, Math.max(footprint.width, footprint.length) * 0.55));
  const boundaryPenalty =
    boundaryClearance < minimumBoundaryClearance
      ? (minimumBoundaryClearance - boundaryClearance) * 4.5
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
      ? ((preferredElevation - candidate.elevation) / elevationRange) * 20
      : 0;
  const distancePenalty =
    distanceToResidence < preferredDistanceMin
      ? (preferredDistanceMin - distanceToResidence) * 2.4
      : distanceToResidence > preferredDistanceMax
        ? (distanceToResidence - preferredDistanceMax) * 1.8
        : Math.abs(distanceToResidence - (preferredDistanceMin + preferredDistanceMax) / 2) * 0.12;
  const sinkPenalty = nearestSinkDistance < 20 ? (20 - nearestSinkDistance) * 2.8 : 0;
  const boundaryPenalty = boundaryClearance < 5 ? (5 - boundaryClearance) * 4 : 0;
  const northPenalty = northAlignment < 0 ? Math.abs(northAlignment) * 28 : -northAlignment * 8;

  return elevationPenalty + distancePenalty + sinkPenalty + boundaryPenalty + northPenalty;
}

function buildFootprintFromArea(area: number, minSideMeters: number): { width: number; length: number } {
  const width = Math.max(minSideMeters, Math.ceil(Math.sqrt(area * 1.2)));
  const length = Math.max(minSideMeters, Math.ceil(area / width));

  return { width, length };
}

function getPlacementFootprintForRotation(
  footprint: { width: number; length: number },
  rotationRadians: number,
): { width: number; length: number } {
  const quarterTurns = Math.round(normalizeRadians(rotationRadians) / (Math.PI / 2)) % 4;

  return quarterTurns % 2 === 1
    ? { width: footprint.length, length: footprint.width }
    : footprint;
}

function calculateSolarFootprintArea(monthlyConsumptionKwh: number): number {
  if (monthlyConsumptionKwh <= 0) {
    return 0;
  }

  return Math.ceil(monthlyConsumptionKwh / 40) * 2;
}

function metersToCells(meters: number, cellSize: number): number {
  return Math.max(1, Math.ceil(meters / cellSize));
}

function worldPointToGrid(point: TerrainPoint, terrain: TerrainGridConfig): GridCoordinate {
  const halfWidth = ((terrain.gridWidth - 1) * terrain.cellSize) / 2;
  const halfHeight = ((terrain.gridHeight - 1) * terrain.cellSize) / 2;

  return {
    x: Math.max(0, Math.min(terrain.gridWidth - 1, Math.round((point.x + halfWidth) / terrain.cellSize))),
    y: Math.max(0, Math.min(terrain.gridHeight - 1, Math.round((point.y + halfHeight) / terrain.cellSize))),
  };
}

function getNorthVector(angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;

  return {
    x: Math.sin(radians),
    y: -Math.cos(radians),
  };
}

function getOperationalRotationRadians(northAngle: number): number {
  const eastWestDegrees = northAngle + 90;
  const quarterTurns = Math.round(eastWestDegrees / 90);

  return normalizeRadians(quarterTurns * (Math.PI / 2));
}

function normalizeRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = value % fullTurn;

  return normalized < 0 ? normalized + fullTurn : normalized;
}

function toTerrainToleranceProfile(
  placementRules: IInfrastructure['placementRules'],
): TerrainToleranceProfile {
  return {
    maxAltitudeVariationMeters: placementRules.maxAltitudeVariationMeters,
    maxAverageSlopePercentage: placementRules.maxSlopePercentage,
    maxCriticalCellRatio: placementRules.maxCriticalCellRatio,
    maxCriticalSlopePercentage: placementRules.maxCriticalSlopePercentage,
  };
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

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}

interface EvaluateRectCandidateInput {
  originX: number;
  originY: number;
  widthCells: number;
  lengthCells: number;
  terrain: ProceduralEngineInput['terrain'];
  polygonMask: Uint8Array;
  occupationGrid: Int32Array;
  terrainTolerance: TerrainToleranceProfile;
}

interface TerrainToleranceProfile {
  maxAverageSlopePercentage: number;
  maxCriticalSlopePercentage: number;
  maxCriticalCellRatio: number;
  maxAltitudeVariationMeters: number;
}

interface RectCandidate {
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

interface PlacementCandidate extends RectCandidate {
  rationale: string;
}

interface ServiceCorridorTarget {
  id: string;
  center: GridCoordinate;
  targetOccupancyValue: number;
}

interface BotanicalServiceAnchor {
  center: GridCoordinate;
  kind: 'PROCESSAMENTO' | 'RESIDENCE';
  radiusMeters: number;
}
