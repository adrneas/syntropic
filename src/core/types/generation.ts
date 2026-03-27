import type { Stratum, SuccessionPhase } from './botanical';
import type { InfrastructureCategory } from './infrastructure';

export type PlacementStatus = 'placed' | 'skipped';
export type SolarMounting = 'ground';
export type LayoutGuideType =
  | 'KEYLINE'
  | 'PLANTING_ROW'
  | 'INTERROW'
  | 'SERVICE_CORRIDOR'
  | 'SWALE';
export type ProductiveAreaType =
  | 'TOPO_CREST'
  | 'FLAT_PRODUCTIVE'
  | 'SLOPE_PRODUCTIVE'
  | 'GENERAL_FILL';
export type PlantManagementZone = 'ROW' | 'INTERROW';
export type PlantManagementProfile =
  | 'SUCCESSION_ROW'
  | 'CUT_AND_DROP'
  | 'MULCH_RETENTION'
  | 'WINTER_COVER'
  | 'MOWED_ACCESS';
export type OperationalBand = 'SERVICE_CORE' | 'SUPPORT' | 'FIELD';

export interface GridCoordinate {
  x: number;
  y: number;
}

export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

export interface FootprintSize {
  width: number;
  length: number;
}

export interface RectPlacement {
  center: GridCoordinate;
  origin: GridCoordinate;
  worldPosition: WorldPosition;
  footprint: FootprintSize;
  elevation: number;
  rotationRadians: number;
}

export interface LayoutGuide {
  averageElevation: number;
  areaPolygon?: WorldPosition[];
  id: string;
  length: number;
  points: WorldPosition[];
  type: LayoutGuideType;
}

export interface ProductiveArea {
  areaSquareMeters: number;
  averageElevation: number;
  averageSlopePercent: number;
  centroid: WorldPosition;
  holes?: WorldPosition[][];
  id: string;
  polygon: WorldPosition[];
  type: ProductiveAreaType;
}

export interface BotanicalPlacement {
  antagonists: string[];
  canopyRadius: number;
  companions: string[];
  id: string;
  maintenanceCycleDays: number;
  managementZone: PlantManagementZone;
  managementProfile: PlantManagementProfile;
  operationalBand: OperationalBand;
  popularName: string;
  productiveAreaId: string;
  productiveAreaType: ProductiveAreaType;
  rowGuideId: string;
  scale: number;
  scientificName: string;
  speciesId: string;
  stratum: Stratum;
  succession: SuccessionPhase;
  waterRequirement: 'LOW' | 'MEDIUM' | 'HIGH';
  worldPosition: WorldPosition;
}

export interface ResidencePlacement extends RectPlacement {
  requiredSolarArea: number;
  roofSolarCapacityArea: number;
  roofSolarAreaUsed: number;
}

export interface SolarPlacement extends RectPlacement {
  mounting: SolarMounting;
  providedArea: number;
}

export interface InfrastructurePlacement {
  infrastructureId: string;
  name: string;
  status: PlacementStatus;
  gridPosition?: GridCoordinate;
  worldPosition?: WorldPosition;
  footprint?: FootprintSize;
  category?: InfrastructureCategory;
  rationale: string;
}

export interface TopographySummary {
  minElevation: number;
  maxElevation: number;
  averageElevation: number;
  maxSlopePercent: number;
  flatCellCount: number;
  restrictedCellCount: number;
  sinkCount: number;
}

export interface ProjectReport {
  seed: number;
  terrainArea: number;
  topography: TopographySummary;
  layout: {
    contourInterval: number;
    interRowCount: number;
    keylineCount: number;
    productiveAreaCount: number;
    productiveAreaCoverageSquareMeters: number;
    productiveAreaDeadSpaceSquareMeters: number;
    plantingRowCount: number;
    rowSpacingMeters: number;
    serviceCorridorCount: number;
    swaleCount: number;
  };
  infrastructure: {
    requested: number;
    placed: number;
    skipped: number;
    placements: InfrastructurePlacement[];
  };
  botanical: {
    dominantInterRowProfile: PlantManagementProfile | 'NONE' | 'MIXED';
    averageInterRowMaintenanceCycleDays: number;
    compatibleSpeciesCount: number;
    interRowPlantCount: number;
    placedCount: number;
    rowPlantCount: number;
    rowsPopulated: number;
    productiveAreasPopulated: number;
    serviceCorePlantCount: number;
    status: 'generated' | 'limited' | 'pending';
    strataUsed: Stratum[];
  };
}

export interface GeneratedProject {
  seed: number;
  slopeGrid: Float32Array;
  flowDirectionGrid: Int8Array;
  restrictionGrid: Uint8Array;
  occupationGrid: Int32Array;
  sinks: GridCoordinate[];
  residence: ResidencePlacement;
  groundSolarPlacement: SolarPlacement | null;
  interRows: LayoutGuide[];
  keylines: LayoutGuide[];
  plantingRows: LayoutGuide[];
  productiveAreas: ProductiveArea[];
  serviceCorridors: LayoutGuide[];
  swales: LayoutGuide[];
  plants: BotanicalPlacement[];
  report: ProjectReport;
}
