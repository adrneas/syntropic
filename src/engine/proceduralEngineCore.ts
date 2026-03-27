import { dataService } from '../core/services/dataService';
import type {
  GeneratedProject,
  ProjectReport,
} from '../core/types/generation';
import type { TerrainPoint } from '../core/types/terrain';
import {
  buildPolygonMask,
  calculatePolygonCentroid,
} from '../core/utils/terrain';
import { buildBotanicalServiceAnchors } from './botanicalAnchors';
import { generateBotanicalLayout } from './botanicalLayout';
import { placeInfrastructure } from './infrastructurePlacement';
import { hashSeed, normalizeSinkCoordinatesForPlacement } from './placementUtils';
import { generatePlantingLayout } from './plantingLayout';
import { generateProductiveAreas } from './productiveAreas';
import { placeGroundSolarArray, placeResidence } from './residencePlacement';
import { generateServiceCorridors } from './serviceCorridors';
import { generateSwales } from './swales';
import { analyzeTopography } from './topography';
import type { ProceduralEngineInput } from './types';

export { hashSeed } from './placementUtils';

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
  const botanicalServiceAnchors = buildBotanicalServiceAnchors(
    residence,
    placements,
    topography.flowDirectionGrid,
    input.terrain,
  );
  const seed = hashSeed(input);
  const plantingLayout = generatePlantingLayout(
    input.terrain,
    polygonMask,
    topography.slopeGrid,
    occupationGrid,
  );
  const productiveAreas = generateProductiveAreas({
    guides: [...plantingLayout.keylines, ...plantingLayout.plantingRows],
    occupationGrid,
    polygonMask,
    rowSpacingMeters: plantingLayout.rowSpacingMeters,
    slopeGrid: topography.slopeGrid,
    terrain: input.terrain,
  });
  const swales = generateSwales({
    guides: [...plantingLayout.keylines, ...plantingLayout.plantingRows],
    occupationGrid,
    productiveAreas: productiveAreas.areas,
    rowSpacingMeters: plantingLayout.rowSpacingMeters,
    terrain: input.terrain,
  });
  const botanicalLayout = generateBotanicalLayout({
    climate: input.climate,
    flowAccumulationGrid: topography.flowAccumulationGrid,
    guides: [...plantingLayout.keylines, ...plantingLayout.plantingRows],
    northAngle: input.terrain.northAngle,
    occupationGrid,
    polygonMask,
    productiveAreas: productiveAreas.areas,
    seed,
    serviceAnchors: botanicalServiceAnchors,
    speciesCatalog: botanicalCatalog,
    swales,
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
      productiveAreaCount: productiveAreas.areas.length,
      productiveAreaCoverageSquareMeters: productiveAreas.coverageSquareMeters,
      productiveAreaDeadSpaceSquareMeters: productiveAreas.deadSpaceSquareMeters,
      plantingRowCount: plantingLayout.plantingRows.length,
      rowSpacingMeters: plantingLayout.rowSpacingMeters,
      serviceCorridorCount: serviceCorridors.length,
      swaleCount: swales.length,
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
      productiveAreasPopulated: botanicalLayout.rowsPopulated,
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
    productiveAreas: productiveAreas.areas,
    serviceCorridors,
    swales,
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
