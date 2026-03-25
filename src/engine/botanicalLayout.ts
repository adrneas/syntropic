import type { ClimateZone, ISpecies, Stratum, SuccessionPhase } from '../core/types/botanical';
import type {
  BotanicalPlacement,
  LayoutGuide,
  OperationalBand,
  PlantManagementProfile,
  PlantManagementZone,
} from '../core/types/generation';
import type { TerrainState } from '../core/types/terrain';
import { getGridIndex, worldToGrid } from '../core/utils/terrain';

const BOTANICAL_OCCUPATION_VALUE = -3;
const SERVICE_CORRIDOR_OCCUPATION_VALUE = -4;
const MAX_PLANTS = 1800;
const ROW_STRATUM_CONFIGS: Array<{
  baseSpacing: number;
  lateralOffset: number;
  stratum: Stratum;
}> = [
  { baseSpacing: 12, lateralOffset: 0, stratum: 'EMERGENTE' },
  { baseSpacing: 8, lateralOffset: 0.75, stratum: 'ALTO' },
  { baseSpacing: 6, lateralOffset: -0.75, stratum: 'MEDIO' },
  { baseSpacing: 4, lateralOffset: 1.2, stratum: 'BAIXO' },
  { baseSpacing: 3, lateralOffset: -1.2, stratum: 'RASTEIRO' },
] as const;
const INTERROW_STRATUM_CONFIGS: Array<{
  baseSpacing: number;
  lateralOffset: number;
  stratum: Stratum;
}> = [
  { baseSpacing: 2.4, lateralOffset: 0.35, stratum: 'BAIXO' },
  { baseSpacing: 1.6, lateralOffset: -0.35, stratum: 'RASTEIRO' },
] as const;
const STRATUM_ORDER: Record<Stratum, number> = {
  RASTEIRO: 0,
  BAIXO: 1,
  MEDIO: 2,
  ALTO: 3,
  EMERGENTE: 4,
};
const SUCCESSION_PATTERNS: Record<Stratum, SuccessionPhase[]> = {
  EMERGENTE: ['PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II', 'CLIMAX'],
  ALTO: ['SECUNDARIA_I', 'SECUNDARIA_II', 'CLIMAX', 'PLACENTA_II'],
  MEDIO: ['PLACENTA_II', 'SECUNDARIA_I', 'CLIMAX', 'SECUNDARIA_II'],
  BAIXO: ['PLACENTA_I', 'PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II'],
  RASTEIRO: ['PLACENTA_I', 'PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II'],
};
const INTERROW_SUCCESSIONS: SuccessionPhase[] = ['PLACENTA_I', 'PLACENTA_II', 'SECUNDARIA_I'];

type WaterRequirement = ISpecies['waterRequirement'];

interface BotanicalLayoutResult {
  averageInterRowMaintenanceCycleDays: number;
  dominantInterRowProfile: PlantManagementProfile | 'NONE' | 'MIXED';
  interRowPlantCount: number;
  plants: BotanicalPlacement[];
  rowPlantCount: number;
  rowsPopulated: number;
  serviceCorePlantCount: number;
  status: 'generated' | 'limited' | 'pending';
  strataUsed: Stratum[];
}

interface BotanicalServiceAnchorInput {
  center: { x: number; y: number };
  kind: 'PROCESSAMENTO' | 'RESIDENCE';
  radiusMeters: number;
}

interface InterRowPolicy {
  fieldCycleDays: number;
  fieldProfile: Extract<
    PlantManagementProfile,
    'CUT_AND_DROP' | 'MULCH_RETENTION' | 'WINTER_COVER'
  >;
  preferredWater: WaterRequirement[];
  serviceCycleDays: number;
  servicePreferredWater: WaterRequirement[];
  supportCycleDays: number;
  supportPreferredWater: WaterRequirement[];
}

interface ManagementContext {
  maintenanceCycleDays: number;
  managementProfile: PlantManagementProfile;
  operationalBand: OperationalBand;
  preferredWater: WaterRequirement[];
}

interface PlantingConfig {
  baseSpacing: number;
  lateralOffset: number;
  stratum: Stratum;
}

interface PointAlongGuide {
  tangentX: number;
  tangentY: number;
  x: number;
  y: number;
  z: number;
}

interface ScoredSpecies {
  score: number;
  seedOrder: number;
  species: ISpecies;
}

export function generateBotanicalLayout({
  climate,
  interRows,
  occupationGrid,
  plantingRows,
  polygonMask,
  seed,
  serviceAnchors,
  speciesCatalog,
  terrain,
}: {
  climate?: ClimateZone | '';
  interRows: LayoutGuide[];
  occupationGrid: Int32Array;
  plantingRows: LayoutGuide[];
  polygonMask: Uint8Array;
  seed: number;
  serviceAnchors: BotanicalServiceAnchorInput[];
  speciesCatalog: ISpecies[];
  terrain: TerrainState;
}): BotanicalLayoutResult {
  if (speciesCatalog.length === 0) {
    return {
      averageInterRowMaintenanceCycleDays: 0,
      dominantInterRowProfile: 'NONE',
      interRowPlantCount: 0,
      plants: [],
      rowPlantCount: 0,
      rowsPopulated: 0,
      serviceCorePlantCount: 0,
      status: 'limited',
      strataUsed: [],
    };
  }

  if (plantingRows.length === 0) {
    return {
      averageInterRowMaintenanceCycleDays: 0,
      dominantInterRowProfile: 'NONE',
      interRowPlantCount: 0,
      plants: [],
      rowPlantCount: 0,
      rowsPopulated: 0,
      serviceCorePlantCount: 0,
      status: 'pending',
      strataUsed: [],
    };
  }

  const interRowPolicy = getInterRowPolicy(climate);
  const rowSpeciesByStratum = buildSpeciesByStratum(speciesCatalog, ROW_STRATUM_CONFIGS);
  const interRowSpeciesByStratum = buildSpeciesByStratum(
    speciesCatalog.filter(
      (species) =>
        (species.stratum === 'BAIXO' || species.stratum === 'RASTEIRO') &&
        INTERROW_SUCCESSIONS.includes(species.succession),
    ),
    INTERROW_STRATUM_CONFIGS,
  );
  const maxPlants = determineMaxPlantCount(terrain.area);
  const rowPlantBudget = Math.max(220, Math.round(maxPlants * 0.74));
  const plants: BotanicalPlacement[] = [];
  const populatedRows = new Set<string>();
  const usedStrata = new Set<Stratum>();

  const rowPlantCount = populateGuides({
    climate,
    guides: plantingRows,
    interRowPolicy,
    managementZone: 'ROW',
    maxPlants: rowPlantBudget,
    occupationGrid,
    plants,
    plantingConfigs: ROW_STRATUM_CONFIGS,
    polygonMask,
    populatedRows,
    seed,
    serviceAnchors,
    speciesByStratum: rowSpeciesByStratum,
    terrain,
    usedStrata,
  });
  const interRowPlantCount =
    plants.length >= maxPlants
      ? 0
      : populateGuides({
          climate,
          guides: interRows,
          interRowPolicy,
          managementZone: 'INTERROW',
          maxPlants,
          occupationGrid,
          plants,
          plantingConfigs: INTERROW_STRATUM_CONFIGS,
          polygonMask,
          populatedRows,
          seed: hashSeed(seed, 907),
          serviceAnchors,
          speciesByStratum: interRowSpeciesByStratum,
          terrain,
          usedStrata,
        });
  const interRowPlants = plants.filter((plant) => plant.managementZone === 'INTERROW');

  return {
    averageInterRowMaintenanceCycleDays:
      interRowPlants.length > 0
        ? roundTo(
            interRowPlants.reduce((sum, plant) => sum + plant.maintenanceCycleDays, 0) /
              interRowPlants.length,
            0,
          )
        : 0,
    dominantInterRowProfile: getDominantInterRowProfile(interRowPlants),
    interRowPlantCount,
    plants,
    rowPlantCount,
    rowsPopulated: populatedRows.size,
    serviceCorePlantCount: plants.filter((plant) => plant.operationalBand === 'SERVICE_CORE').length,
    status: plants.length > 0 ? 'generated' : 'limited',
    strataUsed: Array.from(usedStrata.values()),
  };
}

function populateGuides({
  climate,
  guides,
  interRowPolicy,
  managementZone,
  maxPlants,
  occupationGrid,
  plants,
  plantingConfigs,
  polygonMask,
  populatedRows,
  seed,
  serviceAnchors,
  speciesByStratum,
  terrain,
  usedStrata,
}: {
  climate?: ClimateZone | '';
  guides: LayoutGuide[];
  interRowPolicy: InterRowPolicy;
  managementZone: PlantManagementZone;
  maxPlants: number;
  occupationGrid: Int32Array;
  plants: BotanicalPlacement[];
  plantingConfigs: readonly PlantingConfig[];
  polygonMask: Uint8Array;
  populatedRows: Set<string>;
  seed: number;
  serviceAnchors: BotanicalServiceAnchorInput[];
  speciesByStratum: Record<Stratum, ISpecies[]>;
  terrain: TerrainState;
  usedStrata: Set<Stratum>;
}): number {
  const initialPlantCount = plants.length;

  for (let guideIndex = 0; guideIndex < guides.length; guideIndex += 1) {
    const guide = guides[guideIndex];

    for (let configIndex = 0; configIndex < plantingConfigs.length; configIndex += 1) {
      if (plants.length >= maxPlants) {
        break;
      }

      const config = plantingConfigs[configIndex];
      const stratumSpecies = speciesByStratum[config.stratum];

      if (stratumSpecies.length === 0) {
        continue;
      }

      const guideSeed = hashSeed(seed, guideIndex, configIndex);
      const startOffset = randomBetween(guideSeed, 0, config.baseSpacing * 0.75);
      let slotIndex = 0;

      for (
        let distance = startOffset;
        distance < guide.length && plants.length < maxPlants;
        distance += config.baseSpacing
      ) {
        const point = samplePointAlongGuide(guide, distance);

        if (!point) {
          slotIndex += 1;
          continue;
        }

        const managementContext = buildManagementContext({
          climate,
          interRowPolicy,
          managementZone,
          occupationGrid,
          point,
          serviceAnchors,
          terrain,
        });
        const slotSeed = hashSeed(guideSeed, slotIndex);
        const preferredSuccessions =
          managementZone === 'ROW'
            ? getPreferredSuccessions(config.stratum, guideIndex, slotIndex)
            : INTERROW_SUCCESSIONS;
        const rankedSpecies = rankSpeciesForSlot({
          candidates: stratumSpecies,
          managementContext,
          managementZone,
          plants,
          point,
          preferredSuccessions,
          rowGuideId: guide.id,
          seed: slotSeed,
        });

        let placement: BotanicalPlacement | null = null;

        for (let candidateIndex = 0; candidateIndex < rankedSpecies.length; candidateIndex += 1) {
          placement = buildPlantPlacement({
            guidePoint: point,
            lateralBaseOffset: config.lateralOffset,
            managementContext,
            managementZone,
            occupationGrid,
            plants,
            polygonMask,
            rowGuideId: guide.id,
            rowIndex: guideIndex,
            seed: hashSeed(slotSeed, candidateIndex),
            species: rankedSpecies[candidateIndex],
            terrain,
          });

          if (placement) {
            break;
          }
        }

        if (!placement) {
          slotIndex += 1;
          continue;
        }

        plants.push(placement);
        populatedRows.add(guide.id);
        usedStrata.add(placement.stratum);
        slotIndex += 1;
      }
    }
  }

  return plants.length - initialPlantCount;
}

function buildManagementContext({
  climate,
  interRowPolicy,
  managementZone,
  occupationGrid,
  point,
  serviceAnchors,
  terrain,
}: {
  climate?: ClimateZone | '';
  interRowPolicy: InterRowPolicy;
  managementZone: PlantManagementZone;
  occupationGrid: Int32Array;
  point: PointAlongGuide;
  serviceAnchors: BotanicalServiceAnchorInput[];
  terrain: TerrainState;
}): ManagementContext {
  const operationalBand = determineOperationalBand({
    occupationGrid,
    point,
    serviceAnchors,
    terrain,
  });

  if (managementZone === 'ROW') {
    return {
      maintenanceCycleDays: getRowMaintenanceCycleDays(operationalBand, climate),
      managementProfile: 'SUCCESSION_ROW',
      operationalBand,
      preferredWater: ['MEDIUM', 'LOW', 'HIGH'],
    };
  }

  if (operationalBand === 'SERVICE_CORE') {
    return {
      maintenanceCycleDays: interRowPolicy.serviceCycleDays,
      managementProfile: 'MOWED_ACCESS',
      operationalBand,
      preferredWater: interRowPolicy.servicePreferredWater,
    };
  }

  if (operationalBand === 'SUPPORT') {
    return {
      maintenanceCycleDays: interRowPolicy.supportCycleDays,
      managementProfile: 'MOWED_ACCESS',
      operationalBand,
      preferredWater: interRowPolicy.supportPreferredWater,
    };
  }

  return {
    maintenanceCycleDays: interRowPolicy.fieldCycleDays,
    managementProfile: interRowPolicy.fieldProfile,
    operationalBand,
    preferredWater: interRowPolicy.preferredWater,
  };
}

function buildSpeciesByStratum(
  speciesCatalog: ISpecies[],
  configs: readonly PlantingConfig[],
): Record<Stratum, ISpecies[]> {
  const speciesByStratum: Record<Stratum, ISpecies[]> = {
    ALTO: [],
    BAIXO: [],
    EMERGENTE: [],
    MEDIO: [],
    RASTEIRO: [],
  };

  configs.forEach((config) => {
    speciesByStratum[config.stratum] = speciesCatalog.filter(
      (species) => species.stratum === config.stratum,
    );
  });

  return speciesByStratum;
}

function rankSpeciesForSlot({
  candidates,
  managementContext,
  managementZone,
  plants,
  point,
  preferredSuccessions,
  rowGuideId,
  seed,
}: {
  candidates: ISpecies[];
  managementContext: ManagementContext;
  managementZone: PlantManagementZone;
  plants: BotanicalPlacement[];
  point: PointAlongGuide;
  preferredSuccessions: SuccessionPhase[];
  rowGuideId: string;
  seed: number;
}): ISpecies[] {
  const orderedCandidates = orderCandidates(candidates, seed);
  const scoredSpecies: ScoredSpecies[] = [];

  for (let index = 0; index < orderedCandidates.length; index += 1) {
    const candidate = orderedCandidates[index];
    const canopyRadius = getCanopyRadius(candidate.spacingArea);
    const successionPreferenceIndex = preferredSuccessions.indexOf(candidate.succession);
    let sameGuideNeighbors = 0;
    let repeatedSpecies = 0;
    let score = canopyRadius * 0.1 - index * 0.25;
    let blocked = false;

    if (successionPreferenceIndex === 0) {
      score += managementZone === 'INTERROW' ? 3.4 : 3;
    } else if (successionPreferenceIndex > 0) {
      score += Math.max(0.4, 2 - successionPreferenceIndex * 0.35);
    } else if (managementZone === 'INTERROW') {
      score -= 2.8;
    }

    score += getWaterPreferenceScore(candidate.waterRequirement, managementContext.preferredWater);
    score += getManagementProfileScore(candidate, canopyRadius, managementContext);

    for (let plantIndex = 0; plantIndex < plants.length; plantIndex += 1) {
      const plant = plants[plantIndex];
      const distance = Math.hypot(point.x - plant.worldPosition.x, point.y - plant.worldPosition.y);
      const minDistance = getMinimumPlantDistance(
        candidate.stratum,
        plant.stratum,
        canopyRadius,
        plant.canopyRadius,
      );

      if (distance > getInteractionDistance(canopyRadius, plant.canopyRadius, minDistance)) {
        continue;
      }

      if (
        candidate.antagonists.includes(plant.speciesId) ||
        plant.antagonists.includes(candidate.id) ||
        distance < minDistance
      ) {
        blocked = true;
        break;
      }

      if (plant.rowGuideId === rowGuideId) {
        sameGuideNeighbors += 1;

        if (candidate.companions.includes(plant.speciesId)) {
          score += managementZone === 'INTERROW' ? 2.4 : 2;
        }

        if (plant.companions.includes(candidate.id)) {
          score += managementZone === 'INTERROW' ? 1.4 : 1;
        }

        if (plant.speciesId === candidate.id) {
          repeatedSpecies += 1;
        }
      }
    }

    if (blocked) {
      continue;
    }

    score -= repeatedSpecies * (managementZone === 'INTERROW' ? 0.85 : 1.5);

    if (sameGuideNeighbors === 0) {
      score += managementZone === 'INTERROW' ? 0.65 : 0.35;
    }

    scoredSpecies.push({
      score,
      seedOrder: index,
      species: candidate,
    });
  }

  return scoredSpecies
    .sort((left, right) => right.score - left.score || left.seedOrder - right.seedOrder)
    .map((entry) => entry.species);
}

function buildPlantPlacement({
  guidePoint,
  lateralBaseOffset,
  managementContext,
  managementZone,
  occupationGrid,
  plants,
  polygonMask,
  rowGuideId,
  rowIndex,
  seed,
  species,
  terrain,
}: {
  guidePoint: PointAlongGuide;
  lateralBaseOffset: number;
  managementContext: ManagementContext;
  managementZone: PlantManagementZone;
  occupationGrid: Int32Array;
  plants: BotanicalPlacement[];
  polygonMask: Uint8Array;
  rowGuideId: string;
  rowIndex: number;
  seed: number;
  species: ISpecies;
  terrain: TerrainState;
}): BotanicalPlacement | null {
  const tangentLength = Math.hypot(guidePoint.tangentX, guidePoint.tangentY) || 1;
  const normalX = -guidePoint.tangentY / tangentLength;
  const normalY = guidePoint.tangentX / tangentLength;
  const lateralOffset =
    lateralBaseOffset + randomBetween(hashSeed(seed, 11), -0.2, 0.2);
  const alongOffset =
    managementZone === 'INTERROW'
      ? randomBetween(hashSeed(seed, 17), -0.25, 0.25)
      : randomBetween(hashSeed(seed, 17), -0.45, 0.45);
  const canopyRadius = getCanopyRadius(species.spacingArea);
  const x =
    guidePoint.x +
    normalX * lateralOffset +
    (guidePoint.tangentX / tangentLength) * alongOffset;
  const y =
    guidePoint.y +
    normalY * lateralOffset +
    (guidePoint.tangentY / tangentLength) * alongOffset;
  const grid = worldToGrid(x, y, terrain);
  const index = getGridIndex(grid.x, grid.y, terrain.gridWidth);
  const groundElevation = terrain.elevationGrid[index] ?? guidePoint.z;

  if (polygonMask[index] !== 1 || occupationGrid[index] !== 0) {
    return null;
  }

  if (
    hasOperationalBufferConflict(
      occupationGrid,
      terrain.gridWidth,
      terrain.gridHeight,
      grid.x,
      grid.y,
      getOperationalBufferRadiusCells(managementZone, species.stratum, terrain.cellSize),
    )
  ) {
    return null;
  }

  if (hasPlantSpacingConflict(plants, species, x, y, canopyRadius)) {
    return null;
  }

  const reservationRadiusCells = getPlantReservationRadiusCells(
    managementZone,
    species.stratum,
    canopyRadius,
    terrain.cellSize,
  );

  if (
    !canReservePlantFootprint(
      occupationGrid,
      polygonMask,
      terrain.gridWidth,
      terrain.gridHeight,
      grid.x,
      grid.y,
      reservationRadiusCells,
    )
  ) {
    return null;
  }

  reservePlantFootprint(
    occupationGrid,
    terrain.gridWidth,
    terrain.gridHeight,
    grid.x,
    grid.y,
    reservationRadiusCells,
  );

  return {
    antagonists: species.antagonists,
    canopyRadius,
    companions: species.companions,
    id: `plant-${managementZone.toLowerCase()}-${species.id}-${rowIndex}-${seed}`,
    maintenanceCycleDays: managementContext.maintenanceCycleDays,
    managementProfile: managementContext.managementProfile,
    managementZone,
    operationalBand: managementContext.operationalBand,
    popularName: species.popularName,
    rowGuideId,
    scale: roundTo(randomBetween(hashSeed(seed, 23), 0.9, 1.1), 2),
    scientificName: species.scientificName,
    speciesId: species.id,
    stratum: species.stratum,
    succession: species.succession,
    waterRequirement: species.waterRequirement,
    worldPosition: {
      x: roundTo(x, 3),
      y: roundTo(y, 3),
      z: roundTo(groundElevation, 2),
    },
  };
}

function samplePointAlongGuide(guide: LayoutGuide, distance: number): PointAlongGuide | null {
  if (guide.points.length < 2) {
    return null;
  }

  let traversed = 0;

  for (let index = 1; index < guide.points.length; index += 1) {
    const previous = guide.points[index - 1];
    const current = guide.points[index];
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);

    if (segmentLength <= Number.EPSILON) {
      continue;
    }

    if (traversed + segmentLength >= distance) {
      const factor = (distance - traversed) / segmentLength;

      return {
        tangentX: current.x - previous.x,
        tangentY: current.y - previous.y,
        x: previous.x + (current.x - previous.x) * factor,
        y: previous.y + (current.y - previous.y) * factor,
        z: previous.z + (current.z - previous.z) * factor,
      };
    }

    traversed += segmentLength;
  }

  const previous = guide.points[guide.points.length - 2];
  const current = guide.points[guide.points.length - 1];

  return {
    tangentX: current.x - previous.x,
    tangentY: current.y - previous.y,
    x: current.x,
    y: current.y,
    z: current.z,
  };
}

function getPreferredSuccessions(
  stratum: Stratum,
  rowIndex: number,
  slotIndex: number,
): SuccessionPhase[] {
  const pattern = SUCCESSION_PATTERNS[stratum];
  const startIndex = (rowIndex + slotIndex) % pattern.length;

  return pattern.map((_, index) => pattern[(startIndex + index) % pattern.length]);
}

function getInterRowPolicy(climate?: ClimateZone | ''): InterRowPolicy {
  switch (climate) {
    case 'TROPICAL_UMIDO':
      return {
        fieldCycleDays: 45,
        fieldProfile: 'CUT_AND_DROP',
        preferredWater: ['MEDIUM', 'HIGH', 'LOW'],
        serviceCycleDays: 24,
        servicePreferredWater: ['LOW', 'MEDIUM'],
        supportCycleDays: 32,
        supportPreferredWater: ['MEDIUM', 'LOW'],
      };
    case 'TROPICAL_SECO':
      return {
        fieldCycleDays: 68,
        fieldProfile: 'MULCH_RETENTION',
        preferredWater: ['LOW', 'MEDIUM'],
        serviceCycleDays: 36,
        servicePreferredWater: ['LOW', 'MEDIUM'],
        supportCycleDays: 52,
        supportPreferredWater: ['LOW', 'MEDIUM'],
      };
    case 'SEMIARIDO':
      return {
        fieldCycleDays: 92,
        fieldProfile: 'MULCH_RETENTION',
        preferredWater: ['LOW', 'MEDIUM'],
        serviceCycleDays: 48,
        servicePreferredWater: ['LOW'],
        supportCycleDays: 68,
        supportPreferredWater: ['LOW', 'MEDIUM'],
      };
    case 'TEMPERADO':
      return {
        fieldCycleDays: 78,
        fieldProfile: 'WINTER_COVER',
        preferredWater: ['MEDIUM', 'LOW'],
        serviceCycleDays: 38,
        servicePreferredWater: ['LOW', 'MEDIUM'],
        supportCycleDays: 56,
        supportPreferredWater: ['MEDIUM', 'LOW'],
      };
    case 'SUBTROPICAL':
      return {
        fieldCycleDays: 58,
        fieldProfile: 'CUT_AND_DROP',
        preferredWater: ['MEDIUM', 'LOW'],
        serviceCycleDays: 28,
        servicePreferredWater: ['LOW', 'MEDIUM'],
        supportCycleDays: 42,
        supportPreferredWater: ['MEDIUM', 'LOW'],
      };
    default:
      return {
        fieldCycleDays: 60,
        fieldProfile: 'CUT_AND_DROP',
        preferredWater: ['MEDIUM', 'LOW', 'HIGH'],
        serviceCycleDays: 30,
        servicePreferredWater: ['LOW', 'MEDIUM'],
        supportCycleDays: 45,
        supportPreferredWater: ['MEDIUM', 'LOW'],
      };
  }
}

function determineOperationalBand({
  occupationGrid,
  point,
  serviceAnchors,
  terrain,
}: {
  occupationGrid: Int32Array;
  point: PointAlongGuide;
  serviceAnchors: BotanicalServiceAnchorInput[];
  terrain: TerrainState;
}): OperationalBand {
  const grid = worldToGrid(point.x, point.y, terrain);

  if (
    hasOccupationValueNearby(
      occupationGrid,
      terrain.gridWidth,
      terrain.gridHeight,
      grid.x,
      grid.y,
      2,
      SERVICE_CORRIDOR_OCCUPATION_VALUE,
    )
  ) {
    return 'SERVICE_CORE';
  }

  let supportMatch = false;

  for (let index = 0; index < serviceAnchors.length; index += 1) {
    const anchor = serviceAnchors[index];
    const distanceToAnchor =
      Math.hypot(grid.x - anchor.center.x, grid.y - anchor.center.y) * terrain.cellSize;

    if (distanceToAnchor <= anchor.radiusMeters) {
      return 'SERVICE_CORE';
    }

    if (distanceToAnchor <= anchor.radiusMeters + 14) {
      supportMatch = true;
    }
  }

  return supportMatch ? 'SUPPORT' : 'FIELD';
}

function hasOccupationValueNearby(
  occupationGrid: Int32Array,
  gridWidth: number,
  gridHeight: number,
  centerX: number,
  centerY: number,
  radiusCells: number,
  value: number,
): boolean {
  for (let offsetY = -radiusCells; offsetY <= radiusCells; offsetY += 1) {
    for (let offsetX = -radiusCells; offsetX <= radiusCells; offsetX += 1) {
      const gridX = centerX + offsetX;
      const gridY = centerY + offsetY;

      if (gridX < 0 || gridX >= gridWidth || gridY < 0 || gridY >= gridHeight) {
        continue;
      }

      if (occupationGrid[getGridIndex(gridX, gridY, gridWidth)] === value) {
        return true;
      }
    }
  }

  return false;
}

function getRowMaintenanceCycleDays(
  operationalBand: OperationalBand,
  climate?: ClimateZone | '',
): number {
  const climateBase =
    climate === 'SEMIARIDO'
      ? 105
      : climate === 'TEMPERADO'
        ? 96
        : climate === 'TROPICAL_UMIDO'
          ? 70
          : 84;

  switch (operationalBand) {
    case 'SERVICE_CORE':
      return Math.max(32, climateBase - 24);
    case 'SUPPORT':
      return Math.max(44, climateBase - 12);
    default:
      return climateBase;
  }
}

function getWaterPreferenceScore(
  waterRequirement: WaterRequirement,
  preferredWater: WaterRequirement[],
): number {
  const preferenceIndex = preferredWater.indexOf(waterRequirement);

  if (preferenceIndex === 0) {
    return 1.7;
  }

  if (preferenceIndex === 1) {
    return 0.85;
  }

  if (preferenceIndex === 2) {
    return 0.2;
  }

  return -0.8;
}

function getManagementProfileScore(
  candidate: ISpecies,
  canopyRadius: number,
  managementContext: ManagementContext,
): number {
  switch (managementContext.managementProfile) {
    case 'SUCCESSION_ROW':
      return managementContext.operationalBand === 'SERVICE_CORE' && candidate.stratum === 'EMERGENTE'
        ? -0.4
        : 0;
    case 'CUT_AND_DROP':
      return (
        (candidate.stratum === 'BAIXO' ? 1.4 : candidate.stratum === 'RASTEIRO' ? 0.6 : -1.2) +
        (candidate.succession === 'SECUNDARIA_I' || candidate.succession === 'PLACENTA_II' ? 1.2 : 0) +
        (candidate.spacingArea >= 0.8 && candidate.spacingArea <= 1.4 ? 0.7 : 0) -
        canopyRadius * 0.12
      );
    case 'MULCH_RETENTION':
      return (
        (candidate.stratum === 'RASTEIRO' ? 1.9 : candidate.stratum === 'BAIXO' ? 0.7 : -1.5) +
        (candidate.waterRequirement === 'LOW' ? 1.6 : candidate.waterRequirement === 'MEDIUM' ? 0.35 : -1.2) +
        (candidate.succession.startsWith('PLACENTA') ? 0.8 : 0) -
        canopyRadius * 0.08
      );
    case 'WINTER_COVER':
      return (
        (candidate.stratum === 'RASTEIRO' ? 1.1 : candidate.stratum === 'BAIXO' ? 1.2 : -1.4) +
        (candidate.succession === 'PLACENTA_I' ? 1.4 : candidate.succession === 'PLACENTA_II' ? 0.8 : 0) +
        (candidate.waterRequirement === 'MEDIUM' ? 0.9 : candidate.waterRequirement === 'LOW' ? 0.45 : -0.7) -
        canopyRadius * 0.06
      );
    case 'MOWED_ACCESS':
      return (
        (candidate.stratum === 'RASTEIRO' ? 2.2 : candidate.stratum === 'BAIXO' ? 0.5 : -2) +
        (candidate.spacingArea <= 0.8 ? 1.2 : candidate.spacingArea <= 1.1 ? 0.5 : -1.4) +
        (candidate.waterRequirement === 'LOW' ? 1.2 : candidate.waterRequirement === 'MEDIUM' ? 0.35 : -1.1) +
        (candidate.succession === 'CLIMAX' ? -3 : 0)
      );
    default:
      return 0;
  }
}

function hasPlantSpacingConflict(
  plants: BotanicalPlacement[],
  species: ISpecies,
  x: number,
  y: number,
  canopyRadius: number,
): boolean {
  for (let index = 0; index < plants.length; index += 1) {
    const plant = plants[index];
    const distance = Math.hypot(x - plant.worldPosition.x, y - plant.worldPosition.y);
    const minDistance = getMinimumPlantDistance(
      species.stratum,
      plant.stratum,
      canopyRadius,
      plant.canopyRadius,
    );

    if (
      species.antagonists.includes(plant.speciesId) ||
      plant.antagonists.includes(species.id) ||
      distance < minDistance
    ) {
      return true;
    }
  }

  return false;
}

function hasOperationalBufferConflict(
  occupationGrid: Int32Array,
  gridWidth: number,
  gridHeight: number,
  centerX: number,
  centerY: number,
  radiusCells: number,
): boolean {
  if (radiusCells <= 0) {
    return false;
  }

  for (let offsetY = -radiusCells; offsetY <= radiusCells; offsetY += 1) {
    for (let offsetX = -radiusCells; offsetX <= radiusCells; offsetX += 1) {
      const gridX = centerX + offsetX;
      const gridY = centerY + offsetY;

      if (gridX < 0 || gridX >= gridWidth || gridY < 0 || gridY >= gridHeight) {
        continue;
      }

      if (occupationGrid[getGridIndex(gridX, gridY, gridWidth)] === SERVICE_CORRIDOR_OCCUPATION_VALUE) {
        return true;
      }
    }
  }

  return false;
}

function getOperationalBufferRadiusCells(
  managementZone: PlantManagementZone,
  stratum: Stratum,
  cellSize: number,
): number {
  if (managementZone === 'INTERROW') {
    return stratum === 'RASTEIRO' ? 0 : Math.max(1, Math.ceil(0.8 / cellSize));
  }

  switch (stratum) {
    case 'EMERGENTE':
      return Math.max(2, Math.ceil(2.2 / cellSize));
    case 'ALTO':
      return Math.max(2, Math.ceil(1.8 / cellSize));
    case 'MEDIO':
      return Math.max(1, Math.ceil(1.2 / cellSize));
    case 'BAIXO':
      return Math.max(1, Math.ceil(0.8 / cellSize));
    case 'RASTEIRO':
      return 0;
    default:
      return 1;
  }
}

function getMinimumPlantDistance(
  stratum: Stratum,
  otherStratum: Stratum,
  canopyRadius: number,
  otherCanopyRadius: number,
): number {
  const dominantRadius = Math.max(canopyRadius, otherCanopyRadius);
  const secondaryRadius = Math.min(canopyRadius, otherCanopyRadius);
  const stratumDistance = Math.abs(STRATUM_ORDER[stratum] - STRATUM_ORDER[otherStratum]);

  if (stratumDistance === 0) {
    return Math.max(1.1, dominantRadius * 0.85 + secondaryRadius * 0.55);
  }

  if (stratumDistance === 1) {
    return Math.max(0.9, dominantRadius * 0.65 + secondaryRadius * 0.3);
  }

  if (stratumDistance === 2) {
    return Math.max(0.7, dominantRadius * 0.5 + secondaryRadius * 0.2);
  }

  return Math.max(0.55, dominantRadius * 0.35);
}

function getInteractionDistance(
  canopyRadius: number,
  otherCanopyRadius: number,
  minimumDistance: number,
): number {
  return Math.max(2.5, minimumDistance + Math.max(canopyRadius, otherCanopyRadius));
}

function getCanopyRadius(spacingArea: number): number {
  return roundTo(Math.max(0.35, Math.sqrt(spacingArea / Math.PI)), 2);
}

function getPlantReservationRadiusCells(
  managementZone: PlantManagementZone,
  stratum: Stratum,
  canopyRadius: number,
  cellSize: number,
): number {
  const reservationFactor =
    managementZone === 'INTERROW'
      ? stratum === 'BAIXO'
        ? 0.08
        : 0.04
      : stratum === 'EMERGENTE'
        ? 0.3
        : stratum === 'ALTO'
          ? 0.24
          : stratum === 'MEDIO'
            ? 0.18
            : stratum === 'BAIXO'
              ? 0.12
              : 0.08;

  return Math.max(0, Math.floor((canopyRadius * reservationFactor) / cellSize));
}

function canReservePlantFootprint(
  occupationGrid: Int32Array,
  polygonMask: Uint8Array,
  gridWidth: number,
  gridHeight: number,
  centerX: number,
  centerY: number,
  radiusCells: number,
): boolean {
  for (let offsetY = -radiusCells; offsetY <= radiusCells; offsetY += 1) {
    for (let offsetX = -radiusCells; offsetX <= radiusCells; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radiusCells * radiusCells) {
        continue;
      }

      const gridX = centerX + offsetX;
      const gridY = centerY + offsetY;

      if (gridX < 0 || gridX >= gridWidth || gridY < 0 || gridY >= gridHeight) {
        return false;
      }

      const index = getGridIndex(gridX, gridY, gridWidth);

      if (polygonMask[index] !== 1 || occupationGrid[index] !== 0) {
        return false;
      }
    }
  }

  return true;
}

function reservePlantFootprint(
  occupationGrid: Int32Array,
  gridWidth: number,
  gridHeight: number,
  centerX: number,
  centerY: number,
  radiusCells: number,
): void {
  for (let offsetY = -radiusCells; offsetY <= radiusCells; offsetY += 1) {
    for (let offsetX = -radiusCells; offsetX <= radiusCells; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radiusCells * radiusCells) {
        continue;
      }

      const gridX = centerX + offsetX;
      const gridY = centerY + offsetY;

      if (gridX < 0 || gridX >= gridWidth || gridY < 0 || gridY >= gridHeight) {
        continue;
      }

      occupationGrid[getGridIndex(gridX, gridY, gridWidth)] = BOTANICAL_OCCUPATION_VALUE;
    }
  }
}

function determineMaxPlantCount(area: number): number {
  return Math.min(MAX_PLANTS, Math.max(360, Math.round(area / 45)));
}

function getDominantInterRowProfile(
  interRowPlants: BotanicalPlacement[],
): PlantManagementProfile | 'NONE' | 'MIXED' {
  if (interRowPlants.length === 0) {
    return 'NONE';
  }

  const counts = new Map<PlantManagementProfile, number>();

  interRowPlants.forEach((plant) => {
    counts.set(plant.managementProfile, (counts.get(plant.managementProfile) ?? 0) + 1);
  });

  const ordered = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  const [topProfile, topCount] = ordered[0] ?? [];

  if (!topProfile || topCount === undefined) {
    return 'NONE';
  }

  return ordered.length === 1 || topCount / interRowPlants.length >= 0.6 ? topProfile : 'MIXED';
}

function orderCandidates(candidates: ISpecies[], seed: number): ISpecies[] {
  return [...candidates].sort((left, right) => {
    const leftScore = hashSeed(seed, hashText(left.id));
    const rightScore = hashSeed(seed, hashText(right.id));

    return leftScore - rightScore;
  });
}

function randomBetween(seed: number, min: number, max: number): number {
  const normalized = (hashSeed(seed) >>> 0) / 4294967295;
  return min + (max - min) * normalized;
}

function hashText(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function hashSeed(...parts: number[]): number {
  let hash = 2166136261;

  parts.forEach((part, index) => {
    hash ^= (part + index * 374761393) >>> 0;
    hash = Math.imul(hash, 16777619);
  });

  return hash >>> 0;
}

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
