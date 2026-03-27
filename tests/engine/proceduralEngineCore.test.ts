import { describe, expect, it } from 'vitest';
import { calculatePolygonArea, createFlatElevationGrid, getGridIndex } from '../../src/core/utils/terrain';
import { generateProjectCore } from '../../src/engine/proceduralEngineCore';
import type { ProceduralEngineInput } from '../../src/engine/types';

describe('generateProjectCore', () => {
  it('rejects invalid terrain inputs', () => {
    expect(() =>
      generateProjectCore({
        climate: '',
        preferences: { infrastructure: [] },
        residence: { appliances: {}, area: 0, calculatedSolarNeed: 0 },
        terrain: {
          area: 0,
          cellSize: 1,
          elevationGrid: createFlatElevationGrid(16, 16),
          gridHeight: 16,
          gridWidth: 16,
          northAngle: 0,
          polygon: [],
        },
      }),
    ).toThrow('Terreno invalido para processamento.');
  });

  it('produces deterministic output for the same sloped terrain input', () => {
    const input = createEngineInput({ infrastructure: ['cisterna-ferrocimento', 'apiario'] });

    const first = generateProjectCore(input);
    const second = generateProjectCore(cloneInput(input));

    expect(first.seed).toBe(second.seed);
    expect(first.residence.worldPosition).toEqual(second.residence.worldPosition);
    expect(first.groundSolarPlacement).toEqual(second.groundSolarPlacement);
    expect(first.report.layout).toEqual(second.report.layout);
    expect(first.report.infrastructure.placements).toEqual(second.report.infrastructure.placements);
    expect(first.plants).toEqual(second.plants);
    expect(first.plantingRows.length).toBeGreaterThan(0);
    expect(first.plants.length).toBeGreaterThan(0);
  });

  it('mixes short and long succession phases while reserving plant occupation cells', () => {
    const project = generateProjectCore(createEngineInput());
    const successions = new Set(project.plants.map((plant) => plant.succession));
    const hasShortCycle = Array.from(successions).some((succession) => succession.startsWith('PLACENTA'));

    expect(hasShortCycle).toBe(true);
    expect(successions.has('CLIMAX')).toBe(true);
    expect(Array.from(project.occupationGrid).some((value) => value === -3)).toBe(true);
  });

  it('supports temperate filtering with compatible species and generated plants', () => {
    const project = generateProjectCore(createEngineInput({ climate: 'TEMPERADO' }));

    expect(project.report.botanical.compatibleSpeciesCount).toBeGreaterThan(0);
    expect(project.plants.length).toBeGreaterThan(0);
  });

  it('keeps flat terrain productive by generating supplemental planting rows and plants', () => {
    const project = generateProjectCore(
      createEngineInput({
        flatTerrain: true,
        gridHeight: 121,
        gridWidth: 121,
        polygon: [
          { x: -50, y: -50 },
          { x: 50, y: -50 },
          { x: 50, y: 50 },
          { x: -50, y: 50 },
        ],
      }),
    );

    expect(project.plantingRows.length).toBeGreaterThan(0);
    expect(project.productiveAreas.length).toBeGreaterThan(0);
    expect(project.plants.length).toBeGreaterThan(0);
    expect(project.interRows).toEqual([]);
    expect(project.report.botanical.status).toBe('generated');
    expect(project.report.layout.interRowCount).toBe(project.interRows.length);
    expect(project.report.layout.productiveAreaCount).toBe(project.productiveAreas.length);
    expect(project.report.layout.productiveAreaCoverageSquareMeters).toBeGreaterThan(0);
    expect(project.report.layout.rowSpacingMeters).toBeGreaterThan(0);
  });

  it('scales productive row count beyond the legacy fixed cap on broad flat terrain', () => {
    const project = generateProjectCore(
      createEngineInput({
        flatTerrain: true,
        gridHeight: 221,
        gridWidth: 221,
        polygon: [
          { x: -90, y: -90 },
          { x: 90, y: -90 },
          { x: 90, y: 90 },
          { x: -90, y: 90 },
        ],
      }),
    );

    expect(project.plantingRows.length).toBeGreaterThan(24);
    expect(project.report.layout.plantingRowCount).toBe(project.plantingRows.length);
  });

  it('keeps interrows disabled in the generated botanical report', () => {
    const project = generateProjectCore(
      createEngineInput({
        flatTerrain: true,
        gridHeight: 161,
        gridWidth: 161,
        polygon: [
          { x: -60, y: -60 },
          { x: 60, y: -60 },
          { x: 60, y: 60 },
          { x: -60, y: 60 },
        ],
      }),
    );
    const interRowPlants = project.plants.filter((plant) => plant.managementZone === 'INTERROW');

    expect(project.report.botanical.interRowPlantCount).toBe(interRowPlants.length);
    expect(project.report.botanical.rowPlantCount).toBe(
      project.plants.filter((plant) => plant.managementZone === 'ROW').length,
    );
    expect(interRowPlants).toEqual([]);
    expect(project.report.botanical.dominantInterRowProfile).toBe('NONE');
    expect(project.report.botanical.averageInterRowMaintenanceCycleDays).toBe(0);
  });

  it('keeps interrows disabled in semiarid terrain as well', () => {
    const project = generateProjectCore(
      createEngineInput({
        climate: 'SEMIARIDO',
        flatTerrain: true,
        gridHeight: 161,
        gridWidth: 161,
        polygon: [
          { x: -60, y: -60 },
          { x: 60, y: -60 },
          { x: 60, y: 60 },
          { x: -60, y: 60 },
        ],
      }),
    );

    expect(project.interRows).toEqual([]);
    expect(project.report.botanical.dominantInterRowProfile).toBe('NONE');
    expect(project.report.botanical.averageInterRowMaintenanceCycleDays).toBe(0);
  });

  it('does not allocate service-adjacent interrows near the residence and nursery', () => {
    const project = generateProjectCore(
      createEngineInput({
        flatTerrain: true,
        gridHeight: 181,
        gridWidth: 181,
        infrastructure: ['viveiro-mudas'],
        polygon: [
          { x: -70, y: -70 },
          { x: 70, y: -70 },
          { x: 70, y: 70 },
          { x: -70, y: 70 },
        ],
      }),
    );
    const serviceManagedInterrows = project.plants.filter(
      (plant) => plant.managementZone === 'INTERROW' && plant.operationalBand !== 'FIELD',
    );
    const serviceCorePlants = project.plants.filter(
      (plant) => plant.operationalBand === 'SERVICE_CORE',
    );

    expect(serviceManagedInterrows).toEqual([]);
    expect(project.report.botanical.serviceCorePlantCount).toBe(serviceCorePlants.length);
  });

  it('orients residence and ground solar from north angle and places solar on the preferred side', () => {
    const project = generateProjectCore(
      createEngineInput({
        calculatedSolarNeed: 820,
        gridHeight: 181,
        gridWidth: 181,
        northAngle: 90,
        polygon: [
          { x: -70, y: -70 },
          { x: 70, y: -70 },
          { x: 70, y: 70 },
          { x: -70, y: 70 },
        ],
        residenceArea: 40,
      }),
    );

    expect(project.residence.rotationRadians).toBeCloseTo(Math.PI, 5);
    expect(project.groundSolarPlacement).not.toBeNull();
    expect(project.groundSolarPlacement!.rotationRadians).toBeCloseTo(Math.PI, 5);
    expect(project.groundSolarPlacement!.worldPosition.x).toBeGreaterThan(project.residence.worldPosition.x);
  });

  it('keeps the residence out of a central depression to preserve the operational pole', () => {
    const project = generateProjectCore(
      createEngineInput({
        elevationFactory: ({ gridX, gridY }) => {
          const base = Number((gridY * 0.01 + gridX * 0.01).toFixed(3));
          const distanceToCenter = Math.hypot(gridX - 80, gridY - 80);
          const depression = distanceToCenter <= 10 ? Number(((10 - distanceToCenter) * 0.2).toFixed(3)) : 0;

          return Number((base - depression).toFixed(3));
        },
        gridHeight: 161,
        gridWidth: 161,
        polygon: [
          { x: -60, y: -60 },
          { x: 60, y: -60 },
          { x: 60, y: 60 },
          { x: -60, y: 60 },
        ],
      }),
    );

    expect(project.residence.elevation).toBeGreaterThan(project.report.topography.averageElevation);
    expect(
      Math.hypot(project.residence.worldPosition.x, project.residence.worldPosition.y),
    ).toBeGreaterThan(6);
  });

  it('keeps operational modules near the residence and apiaries far on larger terrain', () => {
    const project = generateProjectCore(
      createEngineInput({
        gridHeight: 201,
        gridWidth: 201,
        infrastructure: ['viveiro-mudas', 'apiario'],
        polygon: [
          { x: -80, y: -80 },
          { x: 80, y: -80 },
          { x: 80, y: 80 },
          { x: -80, y: 80 },
        ],
      }),
    );
    const viveiro = getPlacedInfrastructure(project, 'viveiro-mudas');
    const apiario = getPlacedInfrastructure(project, 'apiario');
    const viveiroDistance = getDistanceToResidence(project, viveiro);
    const apiarioDistance = getDistanceToResidence(project, apiario);

    expect(viveiroDistance).toBeGreaterThanOrEqual(8);
    expect(viveiroDistance).toBeLessThanOrEqual(22.5);
    expect(apiarioDistance).toBeGreaterThanOrEqual(95);
  });

  it('prioritizes lower hydrological placement over higher operational placement when both fit', () => {
    const project = generateProjectCore(
      createEngineInput({
        elevationFactory: ({ gridX, gridY }) => {
          const radialBase = Math.hypot(gridX - 80, gridY - 80) * 0.015;
          const sinkDistance = Math.hypot(gridX - 80, gridY - 106);
          const sinkDepression = sinkDistance <= 8 ? (8 - sinkDistance) * 0.12 : 0;

          return Number((radialBase - sinkDepression).toFixed(3));
        },
        gridHeight: 161,
        gridWidth: 161,
        infrastructure: ['cisterna-ferrocimento', 'viveiro-mudas'],
        polygon: [
          { x: -60, y: -60 },
          { x: 60, y: -60 },
          { x: 60, y: 60 },
          { x: -60, y: 60 },
        ],
      }),
    );
    const cisterna = getPlacedInfrastructure(project, 'cisterna-ferrocimento');
    const viveiro = getPlacedInfrastructure(project, 'viveiro-mudas');

    expect(cisterna.worldPosition!.z).toBeLessThan(viveiro.worldPosition!.z);
  });

  it('places the residence on mildly terraced terrain within foundation tolerance', () => {
    const project = generateProjectCore(
      createEngineInput({
        elevationFactory: ({ gridX }) => (gridX === 12 ? 0.16 : 0),
        polygon: [
          { x: -6, y: -6 },
          { x: 6, y: -6 },
          { x: 6, y: 6 },
          { x: -6, y: 6 },
        ],
        residenceArea: 120,
      }),
    );

    expect(project.report.topography.maxSlopePercent).toBeGreaterThan(12);
    expect(project.residence.footprint.width).toBe(12);
    expect(project.residence.worldPosition).toBeDefined();
  });

  it('samples sink coordinates on flat terrain without breaking hydrology placement', () => {
    const input = createEngineInput({
      flatTerrain: true,
      infrastructure: ['cisterna-ferrocimento'],
    });

    const project = generateProjectCore(input);

    expect(project.report.topography.sinkCount).toBeGreaterThan(256);
    expect(project.sinks.length).toBeLessThanOrEqual(256);
    expect(project.report.topography.flatCellCount).toBe(
      input.terrain.gridWidth * input.terrain.gridHeight,
    );
    expect(project.report.infrastructure.placements).toHaveLength(1);
    expect(['placed', 'skipped']).toContain(project.report.infrastructure.placements[0]?.status);
  });

  it('reports flatness in placement rationale when operational modules fit on stable terrain', () => {
    const project = generateProjectCore(
      createEngineInput({
        flatTerrain: true,
        gridHeight: 101,
        gridWidth: 101,
        infrastructure: ['viveiro-mudas'],
        polygon: [
          { x: -40, y: -40 },
          { x: 40, y: -40 },
          { x: 40, y: 40 },
          { x: -40, y: 40 },
        ],
      }),
    );
    const viveiro = getPlacedInfrastructure(project, 'viveiro-mudas');

    expect(viveiro.rationale).toContain('predominantemente plana');
  });

  it('creates service corridors and reserves circulation cells between the residence and modules', () => {
    const project = generateProjectCore(
      createEngineInput({
        calculatedSolarNeed: 820,
        flatTerrain: true,
        gridHeight: 181,
        gridWidth: 181,
        infrastructure: ['viveiro-mudas'],
        northAngle: 90,
        polygon: [
          { x: -70, y: -70 },
          { x: 70, y: -70 },
          { x: 70, y: 70 },
          { x: -70, y: 70 },
        ],
        residenceArea: 40,
      }),
    );
    const solarCorridor = project.serviceCorridors.find(
      (guide) => guide.id === 'service-corridor-solar-ground',
    );

    expect(project.serviceCorridors.length).toBeGreaterThan(0);
    expect(project.report.layout.serviceCorridorCount).toBe(project.serviceCorridors.length);
    expect(project.serviceCorridors.every((guide) => guide.type === 'SERVICE_CORRIDOR')).toBe(true);
    expect(project.serviceCorridors.some((guide) => guide.id === 'service-corridor-solar-ground')).toBe(true);
    expect(solarCorridor).toBeDefined();
    expect(solarCorridor!.points.length).toBeGreaterThan(3);
    expect(
      solarCorridor!.points.some(
        (point) =>
          Math.abs(point.x - Math.round(point.x)) > 0.001 ||
          Math.abs(point.y - Math.round(point.y)) > 0.001,
      ),
    ).toBe(true);
    expect(Array.from(project.occupationGrid).some((value) => value === -4)).toBe(true);
  });

  it('classifies plants by productive area type and keeps flat aprons around the operational core', () => {
    const project = generateProjectCore(
      createEngineInput({
        flatTerrain: true,
        gridHeight: 181,
        gridWidth: 181,
        infrastructure: ['viveiro-mudas'],
        polygon: [
          { x: -70, y: -70 },
          { x: 70, y: -70 },
          { x: 70, y: 70 },
          { x: -70, y: 70 },
        ],
      }),
    );
    const flatAreas = project.productiveAreas.filter((area) => area.type === 'FLAT_PRODUCTIVE');
    const flatAreaPlants = project.plants.filter((plant) => plant.productiveAreaType === 'FLAT_PRODUCTIVE');

    expect(flatAreas.length).toBeGreaterThan(0);
    expect(flatAreaPlants.length).toBeGreaterThan(0);
    expect(project.report.layout.productiveAreaDeadSpaceSquareMeters).toBeLessThanOrEqual(0.01);
  });

  it('fills inclined terrain with cultivable slope areas and corresponding plants', () => {
    const project = generateProjectCore(
      createEngineInput({
        elevationFactory: ({ gridX, gridY }) =>
          gridY < 34
            ? Number((gridX * 0.015).toFixed(3))
            : Number((((gridY - 34) * 0.34) + gridX * 0.015).toFixed(3)),
        gridHeight: 121,
        gridWidth: 121,
        polygon: [
          { x: -50, y: -50 },
          { x: 50, y: -50 },
          { x: 50, y: 50 },
          { x: -50, y: 50 },
        ],
      }),
    );
    const slopeAreas = project.productiveAreas.filter((area) => area.type === 'SLOPE_PRODUCTIVE');
    const slopePlants = project.plants.filter((plant) => plant.productiveAreaType === 'SLOPE_PRODUCTIVE');
    const slopeStrata = new Set(slopePlants.map((plant) => plant.stratum));

    expect(slopeAreas.length).toBeGreaterThan(0);
    expect(slopePlants.length).toBeGreaterThan(0);
    expect(slopePlants.length).toBeGreaterThanOrEqual(slopeAreas.length * 3);
    expect(slopeAreas.some((area) => area.averageSlopePercent >= 18)).toBe(true);
    expect(project.swales.length).toBeGreaterThan(0);
    expect(project.report.layout.swaleCount).toBe(project.swales.length);
    expect(project.swales.every((guide) => guide.type === 'SWALE')).toBe(true);
    expect(slopeStrata.has('BAIXO') || slopeStrata.has('RASTEIRO')).toBe(true);
    expect(slopeStrata.has('MEDIO') || slopeStrata.has('ALTO')).toBe(true);
  });
});

function createEngineInput({
  climate = 'TROPICAL_UMIDO',
  calculatedSolarNeed = 28,
  elevationFactory,
  flatTerrain = false,
  gridHeight = 65,
  gridWidth = 65,
  infrastructure = [],
  northAngle = 0,
  polygon = [
    { x: -20, y: -20 },
    { x: 20, y: -20 },
    { x: 20, y: 20 },
    { x: -20, y: 20 },
  ],
  residenceArea = 120,
}: {
  climate?: ProceduralEngineInput['climate'];
  calculatedSolarNeed?: number;
  elevationFactory?: (input: { gridX: number; gridY: number }) => number;
  flatTerrain?: boolean;
  gridHeight?: number;
  gridWidth?: number;
  infrastructure?: string[];
  northAngle?: number;
  polygon?: ProceduralEngineInput['terrain']['polygon'];
  residenceArea?: number;
} = {}): ProceduralEngineInput {
  const elevationGrid = createFlatElevationGrid(gridWidth, gridHeight);

  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      elevationGrid[getGridIndex(gridX, gridY, gridWidth)] = elevationFactory
        ? elevationFactory({ gridX, gridY })
        : flatTerrain
          ? 0
          : Number((gridY * 0.05 + gridX * 0.01).toFixed(3));
    }
  }

  return {
    climate,
    preferences: { infrastructure },
    residence: {
      appliances: {
        computador: 2,
        geladeira: 1,
      },
      area: residenceArea,
      calculatedSolarNeed,
    },
    terrain: {
      area: calculatePolygonArea(polygon),
      cellSize: 1,
      elevationGrid,
      gridHeight,
      gridWidth,
      northAngle,
      polygon,
    },
  };
}

function getPlacedInfrastructure(
  project: ReturnType<typeof generateProjectCore>,
  infrastructureId: string,
) {
  const placement = project.report.infrastructure.placements.find(
    (candidate) => candidate.infrastructureId === infrastructureId,
  );

  expect(placement?.status).toBe('placed');
  expect(placement?.worldPosition).toBeDefined();

  return placement!;
}

function getDistanceToResidence(
  project: ReturnType<typeof generateProjectCore>,
  placement: NonNullable<ReturnType<typeof getPlacedInfrastructure>>,
): number {
  return Math.hypot(
    placement.worldPosition!.x - project.residence.worldPosition.x,
    placement.worldPosition!.y - project.residence.worldPosition.y,
  );
}

function cloneInput(input: ProceduralEngineInput): ProceduralEngineInput {
  return {
    climate: input.climate,
    preferences: {
      infrastructure: [...input.preferences.infrastructure],
    },
    residence: {
      appliances: { ...input.residence.appliances },
      area: input.residence.area,
      calculatedSolarNeed: input.residence.calculatedSolarNeed,
    },
    terrain: {
      ...input.terrain,
      elevationGrid: input.terrain.elevationGrid.slice(),
      polygon: input.terrain.polygon.map((point) => ({ ...point })),
    },
  };
}
