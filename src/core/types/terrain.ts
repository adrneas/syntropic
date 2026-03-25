export interface TerrainPoint {
  x: number;
  y: number;
}

export interface TerrainGridConfig {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
}

export interface TerrainState extends TerrainGridConfig {
  polygon: TerrainPoint[];
  area: number;
  northAngle: number;
  elevationGrid: Float32Array;
}

