import type { ClimateZone, ISpecies, Stratum, SuccessionPhase } from '../core/types/botanical';
import type {
  BotanicalPlacement,
  LayoutGuide,
  OperationalBand,
  PlantManagementProfile,
  ProductiveArea,
  ProductiveAreaType,
} from '../core/types/generation';
import type { TerrainState } from '../core/types/terrain';
import { getGridIndex, pointInPolygon, worldToGrid } from '../core/utils/terrain';

const BOTANICAL_OCCUPATION_VALUE = -3;
const SERVICE_CORRIDOR_OCCUPATION_VALUE = -4;
const MAX_PLANTS = 6000;
const SUCCESSION_PATTERNS: Record<Stratum, SuccessionPhase[]> = {
  EMERGENTE: ['PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II', 'CLIMAX'],
  ALTO: ['SECUNDARIA_I', 'SECUNDARIA_II', 'CLIMAX', 'PLACENTA_II'],
  MEDIO: ['PLACENTA_II', 'SECUNDARIA_I', 'CLIMAX', 'SECUNDARIA_II'],
  BAIXO: ['PLACENTA_I', 'PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II'],
  RASTEIRO: ['PLACENTA_I', 'PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II'],
};

/**
 * Syntropic line consortium spacing: along each planting guide, species are
 * placed at stratum-specific intervals. Taller strata have wider spacing,
 * shorter strata are denser. Perpendicular offsets separate strata visually
 * so the line has vertical structure (emergent far from center, ground cover
 * at the center).
 */
const LINE_STRATUM_CONFIG: Array<{
  alongSpacing: number;
  perpendicularOffset: number;
  stratum: Stratum;
}> = [
  { alongSpacing: 12, perpendicularOffset: 2.8, stratum: 'EMERGENTE' },
  { alongSpacing: 8, perpendicularOffset: 2.0, stratum: 'ALTO' },
  { alongSpacing: 5, perpendicularOffset: 1.2, stratum: 'MEDIO' },
  { alongSpacing: 3, perpendicularOffset: 0.6, stratum: 'BAIXO' },
  { alongSpacing: 2, perpendicularOffset: 0.0, stratum: 'RASTEIRO' },
];

const AREA_STRATUM_CONFIGS: Record<
  ProductiveAreaType,
  Array<{
    baseSpacing: number;
    stratum: Stratum;
  }>
> = {
  TOPO_CREST: [
    { baseSpacing: 13.5, stratum: 'EMERGENTE' },
    { baseSpacing: 9.2, stratum: 'ALTO' },
    { baseSpacing: 6.6, stratum: 'MEDIO' },
    { baseSpacing: 4.8, stratum: 'BAIXO' },
    { baseSpacing: 3.4, stratum: 'RASTEIRO' },
  ],
  FLAT_PRODUCTIVE: [
    { baseSpacing: 7.8, stratum: 'MEDIO' },
    { baseSpacing: 4.4, stratum: 'BAIXO' },
    { baseSpacing: 3.1, stratum: 'RASTEIRO' },
  ],
  SLOPE_PRODUCTIVE: [
    { baseSpacing: 3.4, stratum: 'RASTEIRO' },
    { baseSpacing: 4.8, stratum: 'BAIXO' },
    { baseSpacing: 7.2, stratum: 'MEDIO' },
    { baseSpacing: 10.4, stratum: 'ALTO' },
  ],
  GENERAL_FILL: [
    { baseSpacing: 11.2, stratum: 'ALTO' },
    { baseSpacing: 7.1, stratum: 'MEDIO' },
    { baseSpacing: 4.6, stratum: 'BAIXO' },
    { baseSpacing: 3.2, stratum: 'RASTEIRO' },
    { baseSpacing: 14.4, stratum: 'EMERGENTE' },
  ],
};
const STRATUM_ORDER: Record<Stratum, number> = {
  RASTEIRO: 0,
  BAIXO: 1,
  MEDIO: 2,
  ALTO: 3,
  EMERGENTE: 4,
};

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

type InfrastructureInfluence =
  | 'NONE'
  | 'FERTILITY'       // Aviário, compostagem — high-nutrient zone
  | 'POLLINATION'     // Apiário — prefers flowering species
  | 'FERTIGATION'     // Lago/biodigestor — water + nutrients downstream
  | 'NURSERY';        // Viveiro — diverse species near nursery

interface BotanicalServiceAnchorInput {
  center: { x: number; y: number };
  influence?: InfrastructureInfluence;
  kind: 'ANIMAL' | 'AGUA' | 'PROCESSAMENTO' | 'RESIDENCE';
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

interface CandidatePoint {
  allowedStrata?: Stratum[];
  guideId?: string;
  order: number;
  preferredWater?: WaterRequirement[];
  riparianStrength?: number; // 0-1, how strongly this point is in a drainage/riparian zone
  slopeBandRole?: 'GENERIC' | 'SWALE_CANOPY' | 'SWALE_EDGE' | 'SWALE_SUPPORT';
  swaleGuideId?: string;
  x: number;
  y: number;
  z: number;
}

interface ScoredSpecies {
  score: number;
  seedOrder: number;
  species: ISpecies;
}

/**
 * Spatial hash grid for O(1) neighbor lookups instead of O(n) full scan.
 * Plants are bucketed into cells of `cellSize` meters. To find neighbors
 * within radius R, only cells within ceil(R/cellSize) need checking.
 */
class PlantSpatialIndex {
  private readonly buckets = new Map<string, BotanicalPlacement[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = Math.max(1, cellSize);
  }

  private key(x: number, y: number): string {
    const bx = Math.floor(x / this.cellSize);
    const by = Math.floor(y / this.cellSize);
    return `${bx}:${by}`;
  }

  insert(plant: BotanicalPlacement): void {
    const k = this.key(plant.worldPosition.x, plant.worldPosition.y);
    const bucket = this.buckets.get(k);

    if (bucket) {
      bucket.push(plant);
    } else {
      this.buckets.set(k, [plant]);
    }
  }

  queryRadius(x: number, y: number, radius: number): BotanicalPlacement[] {
    const results: BotanicalPlacement[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const bx = Math.floor(x / this.cellSize);
    const by = Math.floor(y / this.cellSize);
    const radiusSq = radius * radius;

    for (let dy = -cellRadius; dy <= cellRadius; dy += 1) {
      for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
        const bucket = this.buckets.get(`${bx + dx}:${by + dy}`);

        if (!bucket) {
          continue;
        }

        for (let i = 0; i < bucket.length; i += 1) {
          const p = bucket[i];
          const distSq =
            (x - p.worldPosition.x) * (x - p.worldPosition.x) +
            (y - p.worldPosition.y) * (y - p.worldPosition.y);

          if (distSq <= radiusSq) {
            results.push(p);
          }
        }
      }
    }

    return results;
  }
}

export function generateBotanicalLayout({
  climate,
  flowAccumulationGrid,
  guides,
  northAngle = 0,
  occupationGrid,
  polygonMask,
  productiveAreas,
  seed,
  serviceAnchors,
  speciesCatalog,
  swales,
  terrain,
}: {
  climate?: ClimateZone | '';
  flowAccumulationGrid?: Uint16Array;
  guides: LayoutGuide[];
  northAngle?: number;
  occupationGrid: Int32Array;
  polygonMask: Uint8Array;
  productiveAreas: ProductiveArea[];
  seed: number;
  serviceAnchors: BotanicalServiceAnchorInput[];
  speciesCatalog: ISpecies[];
  swales: LayoutGuide[];
  terrain: TerrainState;
}): BotanicalLayoutResult {
  if (speciesCatalog.length === 0) {
    return emptyResult('limited');
  }

  if (productiveAreas.length === 0) {
    return emptyResult('pending');
  }

  const interRowPolicy = getInterRowPolicy(climate);
  const speciesByStratum = buildSpeciesByStratum(speciesCatalog);
  const maxPlants = determineMaxPlantCount(terrain.area);
  const plants: BotanicalPlacement[] = [];
  const spatialIndex = new PlantSpatialIndex(6);
  const populatedGuides = new Set<string>();
  const populatedAreas = new Set<string>();
  const usedStrata = new Set<Stratum>();

  // Compute riparian threshold: cells with flow accumulation above this
  // are considered drainage lines / talvegues (riparian zones).
  const riparianThreshold = flowAccumulationGrid
    ? computeRiparianThreshold(flowAccumulationGrid)
    : 0;

  // ─── PHASE 1: Line-based planting along guides (syntropic rows) ───
  // Each guide (keyline or planting row) becomes a syntropic line.
  // Walk each guide and place a vertical consortium at regular intervals.

  const plantingGuides = guides.filter(
    (guide) => guide.type === 'KEYLINE' || guide.type === 'PLANTING_ROW',
  );

  const guideBudget = Math.round(maxPlants * 0.6);
  let guidePlantCount = 0;

  for (let guideIndex = 0; guideIndex < plantingGuides.length; guideIndex += 1) {
    if (guidePlantCount >= guideBudget || plants.length >= maxPlants) {
      break;
    }

    const guide = plantingGuides[guideIndex];
    const guideSeed = hashSeed(seed, guideIndex, 7919);

    // Find which productive area contains this guide's midpoint
    const guideMidpoint = guide.points[Math.floor(guide.points.length / 2)];
    const containingArea = guideMidpoint
      ? findContainingArea(guideMidpoint, productiveAreas)
      : undefined;
    const areaType: ProductiveAreaType = containingArea?.type ?? 'GENERAL_FILL';
    const areaId = containingArea?.id ?? guide.id;

    // Walk each stratum along this guide at its specific spacing
    for (let stratumConfigIndex = 0; stratumConfigIndex < LINE_STRATUM_CONFIG.length; stratumConfigIndex += 1) {
      if (guidePlantCount >= guideBudget || plants.length >= maxPlants) {
        break;
      }

      const lineConfig = LINE_STRATUM_CONFIG[stratumConfigIndex];
      const stratumSpecies = speciesByStratum[lineConfig.stratum];

      if (stratumSpecies.length === 0) {
        continue;
      }

      const candidates = sampleCandidatesAlongGuide({
        guide,
        lineConfig,
        northAngle,
        seed: hashSeed(guideSeed, stratumConfigIndex),
        terrain,
      });

      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        if (guidePlantCount >= guideBudget || plants.length >= maxPlants) {
          break;
        }

        const candidate = candidates[candidateIndex];
        const managementContext = buildManagementContext({
          areaType,
          climate,
          interRowPolicy,
          occupationGrid,
          point: candidate,
          serviceAnchors,
          terrain,
        });
        const candidateSeed = hashSeed(guideSeed, stratumConfigIndex, candidateIndex);
        const preferredSuccessions = getPreferredSuccessions(areaType, lineConfig.stratum, candidateIndex);
        annotateRiparianStrength(candidate, flowAccumulationGrid, riparianThreshold, terrain);
        const rankedSpecies = rankSpeciesForSlot({
          areaType,
          candidates: stratumSpecies,
          managementContext,
          point: candidate,
          preferredSuccessions,
          productiveAreaId: areaId,
          seed: candidateSeed,
          serviceAnchors,
          spatialIndex,
        });

        let placement: BotanicalPlacement | null = null;

        for (let rankedIndex = 0; rankedIndex < rankedSpecies.length; rankedIndex += 1) {
          placement = buildPlantPlacement({
            candidate,
            guideId: guide.id,
            managementContext,
            occupationGrid,
            polygonMask,
            productiveArea: containingArea,
            productiveAreaId: areaId,
            productiveAreaType: areaType,
            seed: hashSeed(candidateSeed, rankedIndex),
            spatialIndex,
            species: rankedSpecies[rankedIndex],
            terrain,
          });

          if (placement) {
            break;
          }
        }

        if (!placement) {
          continue;
        }

        plants.push(placement);
        spatialIndex.insert(placement);
        guidePlantCount += 1;
        populatedGuides.add(guide.id);
        populatedAreas.add(areaId);
        usedStrata.add(placement.stratum);
      }
    }
  }

  // ─── PHASE 2: Area-based fill for zones not covered by guides ───
  // This handles FLAT_PRODUCTIVE areas (near infrastructure), TOPO_CREST,
  // and any GENERAL_FILL zones that didn't get guide coverage.

  const typeBudgets = determineAreaTypeBudgets(productiveAreas, maxPlants);
  const plantsByType: Record<ProductiveAreaType, number> = {
    FLAT_PRODUCTIVE: 0,
    GENERAL_FILL: 0,
    SLOPE_PRODUCTIVE: 0,
    TOPO_CREST: 0,
  };

  // Count guide-placed plants by area type
  for (let index = 0; index < plants.length; index += 1) {
    plantsByType[plants[index].productiveAreaType] += 1;
  }

  const swalesByArea = buildSwalesByArea(productiveAreas, swales);
  const orderedAreas = [...productiveAreas].sort(
    (left, right) =>
      getProductiveAreaPriority(left.type) - getProductiveAreaPriority(right.type) ||
      right.areaSquareMeters - left.areaSquareMeters ||
      right.averageElevation - left.averageElevation,
  );

  for (let areaIndex = 0; areaIndex < orderedAreas.length; areaIndex += 1) {
    if (plants.length >= maxPlants) {
      break;
    }

    const area = orderedAreas[areaIndex];

    if (plantsByType[area.type] >= typeBudgets[area.type]) {
      continue;
    }

    const configs = AREA_STRATUM_CONFIGS[area.type];

    for (let configIndex = 0; configIndex < configs.length; configIndex += 1) {
      if (plants.length >= maxPlants || plantsByType[area.type] >= typeBudgets[area.type]) {
        break;
      }

      const config = configs[configIndex];
      const stratumSpecies = speciesByStratum[config.stratum];

      if (stratumSpecies.length === 0) {
        continue;
      }

      const candidates = sampleCandidatesForArea({
        area,
        baseSpacing: config.baseSpacing,
        seed: hashSeed(seed, areaIndex, configIndex),
        swales: swalesByArea.get(area.id) ?? [],
        terrain,
      }).filter(
        (candidate) =>
          !candidate.allowedStrata || candidate.allowedStrata.includes(config.stratum),
      );

      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        if (plants.length >= maxPlants || plantsByType[area.type] >= typeBudgets[area.type]) {
          break;
        }

        const candidate = candidates[candidateIndex];
        const managementContext = buildManagementContext({
          areaType: area.type,
          climate,
          interRowPolicy,
          occupationGrid,
          point: candidate,
          serviceAnchors,
          terrain,
        });
        const candidateSeed = hashSeed(seed, areaIndex, configIndex, candidateIndex);
        const preferredSuccessions = getPreferredSuccessions(area.type, config.stratum, candidateIndex);
        annotateRiparianStrength(candidate, flowAccumulationGrid, riparianThreshold, terrain);
        const rankedSpecies = rankSpeciesForSlot({
          areaType: area.type,
          candidates: stratumSpecies,
          managementContext,
          point: candidate,
          preferredSuccessions,
          productiveAreaId: area.id,
          seed: candidateSeed,
          serviceAnchors,
          spatialIndex,
        });

        let placement: BotanicalPlacement | null = null;

        for (let rankedIndex = 0; rankedIndex < rankedSpecies.length; rankedIndex += 1) {
          placement = buildPlantPlacement({
            candidate,
            managementContext,
            occupationGrid,
            polygonMask,
            productiveArea: area,
            productiveAreaId: area.id,
            productiveAreaType: area.type,
            seed: hashSeed(candidateSeed, rankedIndex),
            spatialIndex,
            species: rankedSpecies[rankedIndex],
            terrain,
          });

          if (placement) {
            break;
          }
        }

        if (!placement) {
          continue;
        }

        plants.push(placement);
        spatialIndex.insert(placement);
        plantsByType[area.type] += 1;
        populatedAreas.add(area.id);
        usedStrata.add(placement.stratum);
      }
    }
  }

  return {
    averageInterRowMaintenanceCycleDays: 0,
    dominantInterRowProfile: 'NONE',
    interRowPlantCount: 0,
    plants,
    rowPlantCount: plants.length,
    rowsPopulated: populatedGuides.size + populatedAreas.size,
    serviceCorePlantCount: plants.filter((plant) => plant.operationalBand === 'SERVICE_CORE').length,
    status: plants.length > 0 ? 'generated' : 'limited',
    strataUsed: Array.from(usedStrata.values()),
  };
}

function emptyResult(status: BotanicalLayoutResult['status']): BotanicalLayoutResult {
  return {
    averageInterRowMaintenanceCycleDays: 0,
    dominantInterRowProfile: 'NONE',
    interRowPlantCount: 0,
    plants: [],
    rowPlantCount: 0,
    rowsPopulated: 0,
    serviceCorePlantCount: 0,
    status,
    strataUsed: [],
  };
}

// ─── GUIDE-BASED SAMPLING (Syntropic Line Consortium) ───

function sampleCandidatesAlongGuide({
  guide,
  lineConfig,
  northAngle = 0,
  seed,
  terrain,
}: {
  guide: LayoutGuide;
  lineConfig: { alongSpacing: number; perpendicularOffset: number; stratum: Stratum };
  northAngle?: number;
  seed: number;
  terrain: TerrainState;
}): CandidatePoint[] {
  if (guide.points.length < 2 || guide.length < lineConfig.alongSpacing) {
    return [];
  }

  const candidates: CandidatePoint[] = [];
  const sampleCount = Math.max(
    2,
    Math.min(400, Math.ceil(guide.length / Math.max(lineConfig.alongSpacing, terrain.cellSize))),
  );
  const resampled = resampleGuidePoints(guide.points, sampleCount);

  // Solar orientation: compute the "equator-facing" vector.
  // In the southern hemisphere (default for Brazil), north-facing = sun-exposed.
  // Taller strata (EMERGENTE, ALTO) go to the south side of the line (away from sun)
  // to avoid shading shorter plants. Shorter strata go to the north side (sun-facing).
  const northRadians = (northAngle * Math.PI) / 180;
  const sunFacingX = Math.sin(northRadians);       // north vector X (equator-facing for S. hemisphere)
  const sunFacingY = -Math.cos(northRadians);      // north vector Y

  // Determine if this stratum is "tall" (should go to shade side)
  const isTallStratum = lineConfig.stratum === 'EMERGENTE' || lineConfig.stratum === 'ALTO';

  // Starting offset along the guide to stagger different strata
  const stratumOffset = randomBetween(hashSeed(seed, 31), 0, lineConfig.alongSpacing * 0.5);
  let accumulatedDistance = 0;
  let nextPlacementDistance = stratumOffset;

  for (let index = 1; index < resampled.length; index += 1) {
    const prev = resampled[index - 1];
    const curr = resampled[index];
    const segmentLength = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    accumulatedDistance += segmentLength;

    if (accumulatedDistance < nextPlacementDistance) {
      continue;
    }

    // Calculate direction and normal at this point
    const next = resampled[index + 1] ?? curr;
    let dirX = next.x - prev.x;
    let dirY = next.y - prev.y;
    const dirLen = Math.hypot(dirX, dirY);

    if (dirLen <= Number.EPSILON) {
      continue;
    }

    dirX /= dirLen;
    dirY /= dirLen;

    // Normal perpendicular to guide direction
    const normalX = -dirY;
    const normalY = dirX;

    // Solar-aware side selection:
    // Dot product of normal with sun-facing (north) vector determines which
    // side of the line faces the sun. Positive dot = normal points towards sun.
    // Tall strata go to the opposite side (shade side) so they don't block light.
    // Short/ground strata go to the sun side or stay centered.
    let side: number;
    if (lineConfig.perpendicularOffset < 0.1) {
      // RASTEIRO — no offset, stays on the line center
      side = 1;
    } else {
      const dotWithSun = normalX * sunFacingX + normalY * sunFacingY;
      // If dot > 0, the +normal side faces the sun
      // Tall strata go to the shade side (opposite of sun-facing normal)
      // Short strata go to the sun side
      if (isTallStratum) {
        side = dotWithSun >= 0 ? -1 : 1; // opposite of sun
      } else {
        side = dotWithSun >= 0 ? 1 : -1;  // towards sun
      }
    }
    const offset = lineConfig.perpendicularOffset * side;

    const worldX = roundTo(curr.x + normalX * offset, 3);
    const worldY = roundTo(curr.y + normalY * offset, 3);
    const grid = worldToGrid(worldX, worldY, terrain);
    const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);
    const elevation = terrain.elevationGrid[gridIndex] ?? curr.z;

    candidates.push({
      allowedStrata: [lineConfig.stratum],
      guideId: guide.id,
      order: index * 100 + STRATUM_ORDER[lineConfig.stratum],
      x: worldX,
      y: worldY,
      z: elevation,
    });

    nextPlacementDistance = accumulatedDistance + lineConfig.alongSpacing;
  }

  return candidates;
}

function findContainingArea(
  point: { x: number; y: number },
  areas: ProductiveArea[],
): ProductiveArea | undefined {
  for (let index = 0; index < areas.length; index += 1) {
    if (isPointInsideArea(point, areas[index])) {
      return areas[index];
    }
  }

  return undefined;
}

// ─── AREA-BASED SAMPLING (fallback for zones without guide coverage) ───

function sampleCandidatesForArea({
  area,
  baseSpacing,
  seed,
  swales,
  terrain,
}: {
  area: ProductiveArea;
  baseSpacing: number;
  seed: number;
  swales: LayoutGuide[];
  terrain: TerrainState;
}): CandidatePoint[] {
  if (area.type === 'SLOPE_PRODUCTIVE') {
    const swaleCandidates = sampleSlopeCandidatesInsideArea({
      area,
      baseSpacing,
      seed,
      swales,
      terrain,
    });

    if (swaleCandidates.length > 0) {
      return swaleCandidates;
    }
  }

  return sampleCandidatesInsideArea({
    area,
    baseSpacing,
    seed,
    terrain,
  });
}

function sampleCandidatesInsideArea({
  area,
  baseSpacing,
  seed,
  terrain,
}: {
  area: ProductiveArea;
  baseSpacing: number;
  seed: number;
  terrain: TerrainState;
}): CandidatePoint[] {
  if (area.polygon.length < 3) {
    return [];
  }

  const angle = getAreaAngle(area);
  const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const bounds = projectAreaBounds(area, tangent, normal);
  const rowSpacing = baseSpacing * 0.86;
  const tangentOffset = randomBetween(hashSeed(seed, 3), 0, baseSpacing * 0.9);
  const normalOffset = randomBetween(hashSeed(seed, 7), 0, rowSpacing * 0.9);
  const candidates: CandidatePoint[] = [];

  for (
    let normalCoordinate = bounds.minNormal + normalOffset, rowIndex = 0;
    normalCoordinate <= bounds.maxNormal;
    normalCoordinate += rowSpacing, rowIndex += 1
  ) {
    const staggerOffset = rowIndex % 2 === 1 ? baseSpacing * 0.5 : 0;

    for (
      let tangentCoordinate = bounds.minTangent + tangentOffset + staggerOffset;
      tangentCoordinate <= bounds.maxTangent;
      tangentCoordinate += baseSpacing
    ) {
      const point = {
        x: roundTo(area.centroid.x + tangent.x * tangentCoordinate + normal.x * normalCoordinate, 3),
        y: roundTo(area.centroid.y + tangent.y * tangentCoordinate + normal.y * normalCoordinate, 3),
      };

      if (!isPointInsideArea(point, area)) {
        continue;
      }

      const grid = worldToGrid(point.x, point.y, terrain);
      const index = getGridIndex(grid.x, grid.y, terrain.gridWidth);

      candidates.push({
        order: rowIndex * 1000 + candidates.length,
        x: point.x,
        y: point.y,
        z: terrain.elevationGrid[index] ?? area.centroid.z,
      });
    }
  }

  return candidates;
}

function sampleSlopeCandidatesInsideArea({
  area,
  baseSpacing,
  seed,
  swales,
  terrain,
}: {
  area: ProductiveArea;
  baseSpacing: number;
  seed: number;
  swales: LayoutGuide[];
  terrain: TerrainState;
}): CandidatePoint[] {
  const candidates: CandidatePoint[] = [];
  const usedCells = new Map<string, CandidatePoint>();
  const orderedSwales = [...swales].sort(
    (left, right) => left.averageElevation - right.averageElevation || right.length - left.length,
  );

  orderedSwales.forEach((swale, swaleIndex) => {
    const sampleCount = Math.max(
      10,
      Math.min(260, Math.ceil(swale.length / Math.max(baseSpacing * 0.82, terrain.cellSize))),
    );
    const samples = resampleGuidePoints(swale.points, sampleCount);

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const current = samples[sampleIndex];
      const previous = samples[sampleIndex - 1] ?? current;
      const next = samples[sampleIndex + 1] ?? current;
      let directionX = next.x - previous.x;
      let directionY = next.y - previous.y;
      const directionLength = Math.hypot(directionX, directionY);

      if (directionLength <= Number.EPSILON) {
        continue;
      }

      directionX /= directionLength;
      directionY /= directionLength;

      const normal = { x: -directionY, y: directionX };
      const bandConfigs = [
        {
          allowedStrata: ['RASTEIRO', 'BAIXO'] as Stratum[],
          offset: Math.max(terrain.cellSize * 1.1, baseSpacing * 0.42),
          preferredWater: ['HIGH', 'MEDIUM', 'LOW'] as WaterRequirement[],
          slopeBandRole: 'SWALE_EDGE' as const,
        },
        {
          allowedStrata: ['BAIXO', 'MEDIO'] as Stratum[],
          offset: Math.max(terrain.cellSize * 1.9, baseSpacing * 0.82),
          preferredWater: ['MEDIUM', 'HIGH', 'LOW'] as WaterRequirement[],
          slopeBandRole: 'SWALE_SUPPORT' as const,
        },
        {
          allowedStrata: ['MEDIO', 'ALTO'] as Stratum[],
          offset: Math.max(terrain.cellSize * 2.8, baseSpacing * 1.28),
          preferredWater: ['LOW', 'MEDIUM', 'HIGH'] as WaterRequirement[],
          slopeBandRole: 'SWALE_CANOPY' as const,
        },
      ];

      bandConfigs.forEach((bandConfig, bandIndex) => {
        [-1, 1].forEach((direction) => {
          const point = {
            x: roundTo(current.x + normal.x * bandConfig.offset * direction, 3),
            y: roundTo(current.y + normal.y * bandConfig.offset * direction, 3),
          };

          if (!isPointInsideArea(point, area)) {
            return;
          }

          const grid = worldToGrid(point.x, point.y, terrain);
          const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);
          const key = `${grid.x}:${grid.y}`;
          const existingCandidate = usedCells.get(key);
          const candidate: CandidatePoint = {
            allowedStrata: bandConfig.allowedStrata,
            order: swaleIndex * 100000 + bandIndex * 10000 + sampleIndex * 2 + (direction > 0 ? 1 : 0),
            preferredWater: bandConfig.preferredWater,
            slopeBandRole: bandConfig.slopeBandRole,
            swaleGuideId: swale.id,
            x: point.x,
            y: point.y,
            z: terrain.elevationGrid[gridIndex] ?? area.centroid.z,
          };

          if (existingCandidate && existingCandidate.order <= candidate.order) {
            return;
          }

          usedCells.set(key, candidate);
        });
      });
    }
  });

  usedCells.forEach((candidate) => {
    candidates.push(candidate);
  });

  const fallbackCandidates = sampleCandidatesInsideArea({
    area,
    baseSpacing: Math.max(baseSpacing * 0.92, terrain.cellSize * 2),
    seed: hashSeed(seed, 97),
    terrain,
  }).map((candidate, index) => ({
    ...candidate,
    order: 1_000_000 + index,
    preferredWater: ['LOW', 'MEDIUM', 'HIGH'] as WaterRequirement[],
    slopeBandRole: 'GENERIC' as const,
  }));

  return [...candidates, ...fallbackCandidates].sort(
    (left, right) => left.order - right.order || left.x - right.x || left.y - right.y,
  );
}

// ─── MANAGEMENT CONTEXT ───

function buildManagementContext({
  areaType,
  climate,
  interRowPolicy,
  occupationGrid,
  point,
  serviceAnchors,
  terrain,
}: {
  areaType: ProductiveAreaType;
  climate?: ClimateZone | '';
  interRowPolicy: InterRowPolicy;
  occupationGrid: Int32Array;
  point: CandidatePoint;
  serviceAnchors: BotanicalServiceAnchorInput[];
  terrain: TerrainState;
}): ManagementContext {
  const operationalBand = determineOperationalBand({
    occupationGrid,
    point,
    serviceAnchors,
    terrain,
  });

  if (operationalBand === 'SERVICE_CORE') {
    return {
      maintenanceCycleDays: interRowPolicy.serviceCycleDays,
      managementProfile: 'MOWED_ACCESS',
      operationalBand,
      preferredWater: interRowPolicy.servicePreferredWater,
    };
  }

  if (areaType === 'FLAT_PRODUCTIVE') {
    return {
      maintenanceCycleDays:
        operationalBand === 'SUPPORT'
          ? interRowPolicy.supportCycleDays
          : interRowPolicy.fieldCycleDays,
      managementProfile:
        operationalBand === 'SUPPORT' ? 'MOWED_ACCESS' : interRowPolicy.fieldProfile,
      operationalBand,
      preferredWater:
        operationalBand === 'SUPPORT'
          ? interRowPolicy.supportPreferredWater
          : interRowPolicy.preferredWater,
    };
  }

  if (areaType === 'SLOPE_PRODUCTIVE') {
    return {
      maintenanceCycleDays:
        operationalBand === 'SUPPORT'
          ? Math.max(interRowPolicy.supportCycleDays, 40)
          : Math.max(getRowMaintenanceCycleDays(operationalBand, climate), 76),
      managementProfile: operationalBand === 'SUPPORT' ? 'MOWED_ACCESS' : 'SUCCESSION_ROW',
      operationalBand,
      preferredWater:
        point.preferredWater ??
        (climate === 'SEMIARIDO'
          ? ['LOW', 'MEDIUM', 'HIGH']
          : ['MEDIUM', 'LOW', 'HIGH']),
    };
  }

  return {
    maintenanceCycleDays: getRowMaintenanceCycleDays(operationalBand, climate),
    managementProfile: 'SUCCESSION_ROW',
    operationalBand,
    preferredWater:
      areaType === 'TOPO_CREST'
        ? ['MEDIUM', 'HIGH', 'LOW']
        : ['MEDIUM', 'LOW', 'HIGH'],
  };
}

function buildSpeciesByStratum(speciesCatalog: ISpecies[]): Record<Stratum, ISpecies[]> {
  return {
    ALTO: speciesCatalog.filter((species) => species.stratum === 'ALTO'),
    BAIXO: speciesCatalog.filter((species) => species.stratum === 'BAIXO'),
    EMERGENTE: speciesCatalog.filter((species) => species.stratum === 'EMERGENTE'),
    MEDIO: speciesCatalog.filter((species) => species.stratum === 'MEDIO'),
    RASTEIRO: speciesCatalog.filter((species) => species.stratum === 'RASTEIRO'),
  };
}

function determineAreaTypeBudgets(
  productiveAreas: ProductiveArea[],
  maxPlants: number,
): Record<ProductiveAreaType, number> {
  const budgets: Record<ProductiveAreaType, number> = {
    FLAT_PRODUCTIVE: 0,
    GENERAL_FILL: 0,
    SLOPE_PRODUCTIVE: 0,
    TOPO_CREST: 0,
  };
  const weights: Record<ProductiveAreaType, number> = {
    FLAT_PRODUCTIVE: 1.05,
    GENERAL_FILL: 0.95,
    SLOPE_PRODUCTIVE: 1.55,
    TOPO_CREST: 0.85,
  };
  const weightedAreas: Record<ProductiveAreaType, number> = {
    FLAT_PRODUCTIVE: 0,
    GENERAL_FILL: 0,
    SLOPE_PRODUCTIVE: 0,
    TOPO_CREST: 0,
  };
  const activeTypes = new Set<ProductiveAreaType>();

  productiveAreas.forEach((area) => {
    weightedAreas[area.type] += area.areaSquareMeters * weights[area.type];
    activeTypes.add(area.type);
  });

  const totalWeightedArea =
    weightedAreas.FLAT_PRODUCTIVE +
    weightedAreas.GENERAL_FILL +
    weightedAreas.SLOPE_PRODUCTIVE +
    weightedAreas.TOPO_CREST;

  if (totalWeightedArea <= Number.EPSILON) {
    return budgets;
  }

  (['FLAT_PRODUCTIVE', 'TOPO_CREST', 'SLOPE_PRODUCTIVE', 'GENERAL_FILL'] as const).forEach((type) => {
    if (!activeTypes.has(type)) {
      return;
    }

    budgets[type] = Math.max(
      type === 'SLOPE_PRODUCTIVE' ? Math.min(maxPlants, Math.round(maxPlants * 0.22)) : 8,
      Math.round((maxPlants * weightedAreas[type]) / totalWeightedArea),
    );
  });

  let totalBudget =
    budgets.FLAT_PRODUCTIVE +
    budgets.GENERAL_FILL +
    budgets.SLOPE_PRODUCTIVE +
    budgets.TOPO_CREST;

  while (totalBudget > maxPlants) {
    const typeToReduce =
      budgets.GENERAL_FILL > 0
        ? 'GENERAL_FILL'
        : budgets.FLAT_PRODUCTIVE > 0
          ? 'FLAT_PRODUCTIVE'
          : budgets.TOPO_CREST > 0
            ? 'TOPO_CREST'
            : 'SLOPE_PRODUCTIVE';

    if (budgets[typeToReduce] <= 1) {
      break;
    }

    budgets[typeToReduce] -= 1;
    totalBudget -= 1;
  }

  return budgets;
}

function buildSwalesByArea(
  productiveAreas: ProductiveArea[],
  swales: LayoutGuide[],
): Map<string, LayoutGuide[]> {
  const slopeAreas = productiveAreas.filter((area) => area.type === 'SLOPE_PRODUCTIVE');
  const swalesByArea = new Map<string, LayoutGuide[]>();

  swales.forEach((swale) => {
    const area = slopeAreas.find((candidate) =>
      swale.points.some((point) => isPointInsideArea(point, candidate)),
    );

    if (!area) {
      return;
    }

    const areaSwales = swalesByArea.get(area.id);

    if (areaSwales) {
      areaSwales.push(swale);
      return;
    }

    swalesByArea.set(area.id, [swale]);
  });

  return swalesByArea;
}

// ─── SPECIES RANKING ───

function rankSpeciesForSlot({
  areaType,
  candidates,
  managementContext,
  point,
  preferredSuccessions,
  productiveAreaId,
  seed,
  serviceAnchors,
  spatialIndex,
}: {
  areaType: ProductiveAreaType;
  candidates: ISpecies[];
  managementContext: ManagementContext;
  point: CandidatePoint;
  preferredSuccessions: SuccessionPhase[];
  productiveAreaId: string;
  seed: number;
  serviceAnchors: BotanicalServiceAnchorInput[];
  spatialIndex: PlantSpatialIndex;
}): ISpecies[] {
  const orderedCandidates = orderCandidates(candidates, seed);
  const scoredSpecies: ScoredSpecies[] = [];
  // Query neighbors once for all candidates at this point (max interaction ~ 8m)
  const nearbyPlants = spatialIndex.queryRadius(point.x, point.y, 8);

  // Boost CLIMAX when under-represented to maintain succession diversity
  const totalNearby = nearbyPlants.length;
  const climaxNearby = nearbyPlants.filter((p) => p.succession === 'CLIMAX').length;
  const climaxDeficit = totalNearby > 4 && climaxNearby === 0;

  // Syntropic rule: 40-60% of plants should be nitrogen fixers.
  // Boost fixers when ratio drops below 40%, penalize when above 60%.
  const fixerCount = nearbyPlants.filter((p) => {
    const spec = candidates.find((s) => s.id === p.speciesId);
    return spec?.nitrogenFixer === true;
  }).length;
  const fixerRatio = totalNearby > 0 ? fixerCount / totalNearby : 0;
  const nitrogenDeficit = totalNearby >= 3 && fixerRatio < 0.4;
  const nitrogenExcess = totalNearby >= 3 && fixerRatio > 0.6;

  // Detect active infrastructure influence zones at this point
  const activeInfluences = getActiveInfluences(point, serviceAnchors);

  for (let index = 0; index < orderedCandidates.length; index += 1) {
    const candidate = orderedCandidates[index];
    const canopyRadius = getCanopyRadius(candidate.spacingArea);
    const successionPreferenceIndex = preferredSuccessions.indexOf(candidate.succession);
    let sameAreaNeighbors = 0;
    let repeatedSpecies = 0;
    let score = canopyRadius * 0.08 - index * 0.24;
    let blocked = false;

    if (successionPreferenceIndex === 0) {
      score += 3;
    } else if (successionPreferenceIndex > 0) {
      score += Math.max(0.4, 2 - successionPreferenceIndex * 0.35);
    } else {
      score -= 1.8;
    }

    // Encourage CLIMAX species when absent from neighborhood
    if (climaxDeficit && candidate.succession === 'CLIMAX') {
      score += 2.5;
    }

    // Syntropic nitrogen fixation rule: maintain 40-60% fixers in neighborhood
    if (nitrogenDeficit && candidate.nitrogenFixer) {
      score += 2.2;
    } else if (nitrogenExcess && candidate.nitrogenFixer) {
      score -= 1.5;
    }

    // Infrastructure influence zone scoring
    score += getInfrastructureInfluenceScore(candidate, activeInfluences);

    // Riparian corridor scoring: near drainage lines, prefer water-loving species
    if (point.riparianStrength && point.riparianStrength > 0) {
      const rs = point.riparianStrength;
      if (candidate.waterRequirement === 'HIGH') {
        score += 2.0 * rs;
      } else if (candidate.waterRequirement === 'MEDIUM') {
        score += 0.8 * rs;
      } else {
        score -= 0.6 * rs; // penalize drought-tolerant near water
      }
      // Riparian zones favor preservation species (longer succession)
      if (candidate.succession === 'CLIMAX' || candidate.succession === 'SECUNDARIA_II') {
        score += 1.2 * rs;
      }
    }

    score += getWaterPreferenceScore(candidate.waterRequirement, managementContext.preferredWater);
    score += getManagementProfileScore(candidate, canopyRadius, managementContext, areaType, point);

    for (let plantIndex = 0; plantIndex < nearbyPlants.length; plantIndex += 1) {
      const plant = nearbyPlants[plantIndex];
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

      if (plant.productiveAreaId === productiveAreaId) {
        sameAreaNeighbors += 1;

        if (candidate.companions.includes(plant.speciesId)) {
          score += 1.8;
        }

        if (plant.companions.includes(candidate.id)) {
          score += 1;
        }

        if (plant.speciesId === candidate.id) {
          repeatedSpecies += 1;
        }
      }
    }

    if (blocked) {
      continue;
    }

    score -= repeatedSpecies * 1.2;

    if (sameAreaNeighbors === 0) {
      score += 0.6;
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

// ─── PLANT PLACEMENT ───

function buildPlantPlacement({
  candidate,
  guideId,
  managementContext,
  occupationGrid,
  polygonMask,
  productiveArea,
  productiveAreaId,
  productiveAreaType,
  seed,
  spatialIndex,
  species,
  terrain,
}: {
  candidate: CandidatePoint;
  guideId?: string;
  managementContext: ManagementContext;
  occupationGrid: Int32Array;
  polygonMask: Uint8Array;
  productiveArea?: ProductiveArea;
  productiveAreaId: string;
  productiveAreaType: ProductiveAreaType;
  seed: number;
  spatialIndex: PlantSpatialIndex;
  species: ISpecies;
  terrain: TerrainState;
}): BotanicalPlacement | null {
  const jitterRadius = productiveAreaType === 'FLAT_PRODUCTIVE' ? 0.22 : 0.36;
  const x = candidate.x + randomBetween(hashSeed(seed, 11), -jitterRadius, jitterRadius);
  const y = candidate.y + randomBetween(hashSeed(seed, 17), -jitterRadius, jitterRadius);

  if (productiveArea && !isPointInsideArea({ x, y }, productiveArea)) {
    return null;
  }

  const grid = worldToGrid(x, y, terrain);
  const index = getGridIndex(grid.x, grid.y, terrain.gridWidth);
  const groundElevation = terrain.elevationGrid[index] ?? candidate.z;
  const canopyRadius = getCanopyRadius(species.spacingArea);

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
      getOperationalBufferRadiusCells(species.stratum, terrain.cellSize),
    )
  ) {
    return null;
  }

  if (hasPlantSpacingConflict(spatialIndex, species, x, y, canopyRadius)) {
    return null;
  }

  const reservationRadiusCells = getPlantReservationRadiusCells(
    species.stratum,
    canopyRadius,
    terrain.cellSize,
    productiveAreaType,
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
    id: `plant-${productiveAreaType.toLowerCase()}-${species.id}-${seed}`,
    maintenanceCycleDays: managementContext.maintenanceCycleDays,
    managementProfile: managementContext.managementProfile,
    managementZone: 'ROW',
    operationalBand: managementContext.operationalBand,
    popularName: species.popularName,
    productiveAreaId,
    productiveAreaType,
    rowGuideId: guideId ?? candidate.guideId ?? productiveAreaId,
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

// ─── OPERATIONAL BAND DETECTION ───

function determineOperationalBand({
  occupationGrid,
  point,
  serviceAnchors,
  terrain,
}: {
  occupationGrid: Int32Array;
  point: CandidatePoint;
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

    // Only RESIDENCE and PROCESSAMENTO create service core / support bands.
    // ANIMAL and AGUA influence zones affect species selection, not operational bands.
    if (anchor.kind === 'ANIMAL' || anchor.kind === 'AGUA') {
      continue;
    }

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

// ─── SUCCESSION PATTERNS ───

function getPreferredSuccessions(
  areaType: ProductiveAreaType,
  stratum: Stratum,
  slotIndex: number,
): SuccessionPhase[] {
  if (areaType === 'FLAT_PRODUCTIVE') {
    const pattern =
      stratum === 'MEDIO'
        ? ['PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II', 'CLIMAX']
        : ['PLACENTA_I', 'PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II'];
    const startIndex = slotIndex % pattern.length;

    return pattern.map((_, index) => pattern[(startIndex + index) % pattern.length]) as SuccessionPhase[];
  }

  if (areaType === 'SLOPE_PRODUCTIVE') {
    const pattern =
      stratum === 'ALTO'
        ? ['SECUNDARIA_I', 'SECUNDARIA_II', 'CLIMAX', 'PLACENTA_II']
        : stratum === 'MEDIO'
          ? ['PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II', 'CLIMAX']
          : ['PLACENTA_I', 'PLACENTA_II', 'SECUNDARIA_I', 'SECUNDARIA_II'];
    const startIndex = slotIndex % pattern.length;

    return pattern.map((_, index) => pattern[(startIndex + index) % pattern.length]) as SuccessionPhase[];
  }

  const pattern = SUCCESSION_PATTERNS[stratum];
  const startIndex = slotIndex % pattern.length;

  return pattern.map((_, index) => pattern[(startIndex + index) % pattern.length]);
}

// ─── INTER-ROW POLICY ───

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

// ─── SCORING HELPERS ───

/**
 * Compute the flow accumulation threshold that identifies drainage lines.
 * Uses percentile approach: cells above the 90th percentile are considered
 * part of drainage corridors (talvegues).
 */
function computeRiparianThreshold(flowAccumulationGrid: Uint16Array): number {
  if (flowAccumulationGrid.length === 0) {
    return 0;
  }

  // Sample up to 10000 cells to avoid sorting huge arrays
  const sampleSize = Math.min(flowAccumulationGrid.length, 10000);
  const step = Math.max(1, Math.floor(flowAccumulationGrid.length / sampleSize));
  const samples: number[] = [];

  for (let i = 0; i < flowAccumulationGrid.length; i += step) {
    if (flowAccumulationGrid[i] > 1) {
      samples.push(flowAccumulationGrid[i]);
    }
  }

  if (samples.length < 10) {
    return 0;
  }

  samples.sort((a, b) => a - b);

  // 90th percentile — cells above this are drainage lines
  return samples[Math.floor(samples.length * 0.9)] ?? 0;
}

/**
 * Annotate a candidate point with riparian strength based on flow accumulation.
 * Points on high-accumulation cells get riparianStrength > 0.
 */
function annotateRiparianStrength(
  point: CandidatePoint,
  flowAccumulationGrid: Uint16Array | undefined,
  riparianThreshold: number,
  terrain: TerrainState,
): void {
  if (!flowAccumulationGrid || riparianThreshold <= 0) {
    return;
  }

  const grid = worldToGrid(point.x, point.y, terrain);
  const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);
  const accumulation = flowAccumulationGrid[gridIndex] ?? 0;

  if (accumulation >= riparianThreshold) {
    // Strength scaled by how far above threshold (capped at 1.0)
    point.riparianStrength = Math.min(1, (accumulation - riparianThreshold) / riparianThreshold + 0.5);
  }
}

interface ActiveInfluence {
  influence: InfrastructureInfluence;
  strength: number; // 0-1, based on distance/radius ratio
}

function getActiveInfluences(
  point: CandidatePoint,
  anchors: BotanicalServiceAnchorInput[],
): ActiveInfluence[] {
  const influences: ActiveInfluence[] = [];

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];

    if (!anchor.influence || anchor.influence === 'NONE') {
      continue;
    }

    const distance = Math.hypot(point.x - anchor.center.x, point.y - anchor.center.y);

    if (distance <= anchor.radiusMeters) {
      // Strength falls off linearly with distance (1.0 at center, 0.0 at edge)
      influences.push({
        influence: anchor.influence,
        strength: 1 - distance / anchor.radiusMeters,
      });
    }
  }

  return influences;
}

function getInfrastructureInfluenceScore(
  candidate: ISpecies,
  influences: ActiveInfluence[],
): number {
  let score = 0;

  for (let i = 0; i < influences.length; i += 1) {
    const { influence, strength } = influences[i];

    switch (influence) {
      case 'FERTILITY':
        // High-fertility zones from aviário/compostagem favor nutrient-demanding species
        // High water requirement = high nutrient demand
        if (candidate.waterRequirement === 'HIGH') {
          score += 1.8 * strength;
        } else if (candidate.waterRequirement === 'MEDIUM') {
          score += 0.6 * strength;
        }
        // Fruit trees (SECUNDARIA_II) thrive in fertile zones
        if (candidate.succession === 'SECUNDARIA_II') {
          score += 1.2 * strength;
        }
        break;

      case 'POLLINATION':
        // Apiário influence: prefer flowering/fruiting species for continuous bloom
        // SECUNDARIA_II (fruit trees) and CLIMAX provide long-term flowering
        if (candidate.succession === 'SECUNDARIA_II' || candidate.succession === 'CLIMAX') {
          score += 2.0 * strength;
        }
        // PLACENTA species (short-lived) provide quick seasonal flowers
        if (candidate.succession === 'PLACENTA_I' || candidate.succession === 'PLACENTA_II') {
          score += 1.0 * strength;
        }
        // Nitrogen fixers (leguminosas) are excellent bee forage
        if (candidate.nitrogenFixer) {
          score += 1.4 * strength;
        }
        break;

      case 'FERTIGATION':
        // Lago/biodigestor downstream: high water + nutrient availability
        if (candidate.waterRequirement === 'HIGH') {
          score += 2.2 * strength;
        } else if (candidate.waterRequirement === 'MEDIUM') {
          score += 1.0 * strength;
        }
        // Tall productive species benefit most from fertigation
        if (candidate.stratum === 'ALTO' || candidate.stratum === 'EMERGENTE') {
          score += 0.8 * strength;
        }
        break;

      case 'NURSERY':
        // Viveiro proximity: diverse species mix, faster succession
        if (candidate.succession === 'SECUNDARIA_I' || candidate.succession === 'SECUNDARIA_II') {
          score += 1.0 * strength;
        }
        break;
    }
  }

  return score;
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
  areaType: ProductiveAreaType,
  point: CandidatePoint,
): number {
  if (managementContext.managementProfile === 'MOWED_ACCESS') {
    return (
      (candidate.stratum === 'RASTEIRO' ? 2.2 : candidate.stratum === 'BAIXO' ? 0.7 : -2) +
      (candidate.spacingArea <= 0.8 ? 1.1 : candidate.spacingArea <= 1.2 ? 0.45 : -1.2) +
      (candidate.waterRequirement === 'LOW' ? 1.1 : candidate.waterRequirement === 'MEDIUM' ? 0.4 : -1) +
      (candidate.succession === 'CLIMAX' ? -2.8 : 0)
    );
  }

  if (areaType === 'FLAT_PRODUCTIVE') {
    return (
      (candidate.stratum === 'RASTEIRO' ? 1.8 : candidate.stratum === 'BAIXO' ? 1.2 : candidate.stratum === 'MEDIO' ? 0.4 : -1.6) +
      (candidate.succession.startsWith('PLACENTA') ? 1 : candidate.succession === 'SECUNDARIA_I' ? 0.6 : -0.4) -
      canopyRadius * 0.08
    );
  }

  if (areaType === 'SLOPE_PRODUCTIVE') {
    const swaleBandScore =
      point.slopeBandRole === 'SWALE_EDGE'
        ? candidate.stratum === 'RASTEIRO'
          ? 1.8
          : candidate.stratum === 'BAIXO'
            ? 1.2
            : -1.6
        : point.slopeBandRole === 'SWALE_SUPPORT'
          ? candidate.stratum === 'BAIXO'
            ? 1.1
            : candidate.stratum === 'MEDIO'
              ? 1.5
              : candidate.stratum === 'RASTEIRO'
                ? 0.2
                : -0.8
          : point.slopeBandRole === 'SWALE_CANOPY'
            ? candidate.stratum === 'MEDIO'
              ? 1.2
              : candidate.stratum === 'ALTO'
                ? 1.8
                : -0.7
            : 0;

    return (
      (candidate.stratum === 'MEDIO' ? 1.4 : candidate.stratum === 'BAIXO' ? 1.1 : candidate.stratum === 'ALTO' ? 0.8 : 0.5) +
      (candidate.waterRequirement === 'LOW' ? 1 : candidate.waterRequirement === 'MEDIUM' ? 0.7 : -0.6) +
      (candidate.succession === 'SECUNDARIA_I' || candidate.succession === 'PLACENTA_II' ? 0.9 : candidate.succession === 'CLIMAX' ? 0.4 : 0) -
      canopyRadius * 0.07 +
      swaleBandScore
    );
  }

  if (areaType === 'TOPO_CREST') {
    return (
      (candidate.stratum === 'EMERGENTE' ? 1.4 : candidate.stratum === 'ALTO' ? 1 : 0.2) +
      (candidate.succession === 'CLIMAX' ? 1.1 : candidate.succession === 'SECUNDARIA_II' ? 0.7 : 0) -
      canopyRadius * 0.05
    );
  }

  return (
    (candidate.stratum === 'MEDIO' ? 1 : candidate.stratum === 'BAIXO' ? 0.6 : 0) +
    (candidate.succession === 'PLACENTA_II' || candidate.succession === 'SECUNDARIA_I' ? 0.9 : 0) -
    canopyRadius * 0.07
  );
}

// ─── SPACING & COLLISION ───

function hasPlantSpacingConflict(
  spatialIndex: PlantSpatialIndex,
  species: ISpecies,
  x: number,
  y: number,
  canopyRadius: number,
): boolean {
  const nearby = spatialIndex.queryRadius(x, y, 6);

  for (let index = 0; index < nearby.length; index += 1) {
    const plant = nearby[index];
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

function getOperationalBufferRadiusCells(stratum: Stratum, cellSize: number): number {
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
  stratum: Stratum,
  canopyRadius: number,
  cellSize: number,
  areaType: ProductiveAreaType,
): number {
  const reservationFactor =
    areaType === 'FLAT_PRODUCTIVE'
      ? stratum === 'MEDIO'
        ? 0.12
        : stratum === 'BAIXO'
          ? 0.08
          : 0.04
      : areaType === 'SLOPE_PRODUCTIVE'
        ? stratum === 'ALTO'
          ? 0.18
          : stratum === 'MEDIO'
            ? 0.12
            : stratum === 'BAIXO'
              ? 0.08
              : 0.05
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
  // Scale plant count with terrain area for realistic syntropic density.
  // The O(n²) neighbor check bounds practical limits; spatial indexing
  // would allow higher caps in the future.
  if (area <= 400) {
    return Math.min(MAX_PLANTS, Math.max(360, Math.round(area * 0.9)));
  }

  if (area <= 5000) {
    return Math.min(MAX_PLANTS, Math.round(area / 3.5) + 260);
  }

  return Math.min(MAX_PLANTS, Math.round(area / 6) + 420);
}

// ─── GEOMETRY HELPERS ───

function orderCandidates(candidates: ISpecies[], seed: number): ISpecies[] {
  return [...candidates].sort((left, right) => {
    const leftScore = hashSeed(seed, hashText(left.id));
    const rightScore = hashSeed(seed, hashText(right.id));

    return leftScore - rightScore;
  });
}

function resampleGuidePoints(points: CandidatePoint[] | LayoutGuide['points'], sampleCount: number): CandidatePoint[] {
  if (points.length <= 1 || sampleCount <= 1) {
    return points.map((point) => ({ ...point, order: 0 }));
  }

  const cumulativeLengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    cumulativeLengths.push(
      cumulativeLengths[index - 1] + calculatePointDistance(points[index - 1], points[index]),
    );
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;

  if (totalLength <= Number.EPSILON) {
    return points.map((point) => ({ ...point, order: 0 }));
  }

  const resampled: CandidatePoint[] = [];

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const targetDistance = (totalLength * sampleIndex) / sampleCount;
    resampled.push(samplePointAlongPolyline(points, cumulativeLengths, targetDistance));
  }

  return resampled;
}

function samplePointAlongPolyline(
  points: CandidatePoint[] | LayoutGuide['points'],
  cumulativeLengths: number[],
  targetDistance: number,
): CandidatePoint {
  if (targetDistance <= 0) {
    return { ...points[0], order: 0 };
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;

  if (targetDistance >= totalLength) {
    return { ...points[points.length - 1], order: 0 };
  }

  for (let index = 1; index < cumulativeLengths.length; index += 1) {
    if (targetDistance > cumulativeLengths[index]) {
      continue;
    }

    const previousLength = cumulativeLengths[index - 1];
    const segmentLength = cumulativeLengths[index] - previousLength;
    const factor =
      segmentLength <= Number.EPSILON ? 0 : (targetDistance - previousLength) / segmentLength;
    const start = points[index - 1];
    const end = points[index];

    return {
      order: 0,
      x: roundTo(start.x + (end.x - start.x) * factor, 3),
      y: roundTo(start.y + (end.y - start.y) * factor, 3),
      z: roundTo(start.z + (end.z - start.z) * factor, 2),
    };
  }

  return { ...points[points.length - 1], order: 0 };
}

function calculatePointDistance(
  start: Pick<CandidatePoint, 'x' | 'y'>,
  end: Pick<CandidatePoint, 'x' | 'y'>,
): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function getAreaAngle(area: ProductiveArea): number {
  let angle = 0;
  let longestEdge = 0;

  for (let index = 0; index < area.polygon.length; index += 1) {
    const current = area.polygon[index];
    const next = area.polygon[(index + 1) % area.polygon.length];
    const edgeLength = Math.hypot(next.x - current.x, next.y - current.y);

    if (edgeLength <= longestEdge) {
      continue;
    }

    longestEdge = edgeLength;
    angle = Math.atan2(next.y - current.y, next.x - current.x);
  }

  const normalized = angle % Math.PI;
  return normalized < 0 ? normalized + Math.PI : normalized;
}

function projectAreaBounds(
  area: ProductiveArea,
  tangent: { x: number; y: number },
  normal: { x: number; y: number },
): {
  maxNormal: number;
  maxTangent: number;
  minNormal: number;
  minTangent: number;
} {
  let minTangent = Number.POSITIVE_INFINITY;
  let maxTangent = Number.NEGATIVE_INFINITY;
  let minNormal = Number.POSITIVE_INFINITY;
  let maxNormal = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < area.polygon.length; index += 1) {
    const point = area.polygon[index];
    const tangentValue = projectPointOnAxis(point, area.centroid, tangent);
    const normalValue = projectPointOnAxis(point, area.centroid, normal);

    minTangent = Math.min(minTangent, tangentValue);
    maxTangent = Math.max(maxTangent, tangentValue);
    minNormal = Math.min(minNormal, normalValue);
    maxNormal = Math.max(maxNormal, normalValue);
  }

  return { maxNormal, maxTangent, minNormal, minTangent };
}

function isPointInsideArea(
  point: Pick<CandidatePoint, 'x' | 'y'>,
  area: ProductiveArea,
): boolean {
  const outerPoint = { x: point.x, y: point.y };

  if (!pointInPolygon(outerPoint, area.polygon.map(({ x, y }) => ({ x, y })))) {
    return false;
  }

  if (!area.holes || area.holes.length === 0) {
    return true;
  }

  for (let index = 0; index < area.holes.length; index += 1) {
    const hole = area.holes[index];

    if (pointInPolygon(outerPoint, hole.map(({ x, y }) => ({ x, y })))) {
      return false;
    }
  }

  return true;
}

function getProductiveAreaPriority(type: ProductiveAreaType): number {
  switch (type) {
    case 'FLAT_PRODUCTIVE':
      return 0;
    case 'TOPO_CREST':
      return 1;
    case 'SLOPE_PRODUCTIVE':
      return 2;
    case 'GENERAL_FILL':
    default:
      return 3;
  }
}

function projectPointOnAxis(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  axis: { x: number; y: number },
): number {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
}

// ─── PRNG & UTILS ───

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
