import * as THREE from 'three';
import {
  clamp,
  getGridIndex,
  getPolygonBounds,
  getTerrainWorldSize,
  gridToWorld,
  isPointWithinBufferedPolygon,
  sampleElevation,
  worldToGrid,
} from '../../core/utils/terrain';
import type { TerrainGridConfig, TerrainPoint } from '../../core/types/terrain';
import type { RenderTerrainGeometry } from '../sceneTypes';

export function createInteractionPlaneGeometry(terrain: TerrainGridConfig): THREE.PlaneGeometry {
  const size = getTerrainWorldSize(terrain);

  return new THREE.PlaneGeometry(size.width, size.height);
}

export function createVisibleTerrainGeometry(
  terrain: TerrainGridConfig,
  polygon: TerrainPoint[],
  bufferMeters: number,
): RenderTerrainGeometry | null {
  const bounds = getPolygonBounds(polygon);

  if (!bounds) {
    return null;
  }

  const size = getTerrainWorldSize(terrain);
  const startX = clamp(Math.floor((bounds.minX - bufferMeters + size.width / 2) / terrain.cellSize), 0, terrain.gridWidth - 2);
  const endX = clamp(Math.ceil((bounds.maxX + bufferMeters + size.width / 2) / terrain.cellSize), startX + 1, terrain.gridWidth - 1);
  const startY = clamp(Math.floor((bounds.minY - bufferMeters + size.height / 2) / terrain.cellSize), 0, terrain.gridHeight - 2);
  const endY = clamp(Math.ceil((bounds.maxY + bufferMeters + size.height / 2) / terrain.cellSize), startY + 1, terrain.gridHeight - 1);
  const windowWidth = endX - startX + 1;
  const windowHeight = endY - startY + 1;
  const sourceIndices = new Int32Array(windowWidth * windowHeight);
  const positions = new Float32Array(windowWidth * windowHeight * 3);
  const sourceIndexToVertex = new Map<number, number>();

  for (let localY = 0; localY < windowHeight; localY += 1) {
    for (let localX = 0; localX < windowWidth; localX += 1) {
      const gridX = startX + localX;
      const gridY = startY + localY;
      const sourceIndex = getGridIndex(gridX, gridY, terrain.gridWidth);
      const vertexIndex = localY * windowWidth + localX;
      const world = gridToWorld(gridX, gridY, terrain);
      const positionIndex = vertexIndex * 3;

      sourceIndices[vertexIndex] = sourceIndex;
      sourceIndexToVertex.set(sourceIndex, vertexIndex);
      positions[positionIndex] = world.x;
      positions[positionIndex + 1] = -world.y;
      positions[positionIndex + 2] = 0;
    }
  }

  const indices: number[] = [];

  for (let localY = 0; localY < windowHeight - 1; localY += 1) {
    for (let localX = 0; localX < windowWidth - 1; localX += 1) {
      const worldTopLeft = gridToWorld(startX + localX, startY + localY, terrain);
      const cellCenter = {
        x: worldTopLeft.x + terrain.cellSize / 2,
        y: worldTopLeft.y + terrain.cellSize / 2,
      };

      if (!isPointWithinBufferedPolygon(cellCenter, polygon, bufferMeters)) {
        continue;
      }

      const topLeft = localY * windowWidth + localX;
      const topRight = topLeft + 1;
      const bottomLeft = (localY + 1) * windowWidth + localX;
      const bottomRight = bottomLeft + 1;

      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }

  if (indices.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return {
    geometry,
    sourceIndices,
    sourceIndexToVertex,
  };
}

export function syncGeometryFromGrid(renderGeometry: RenderTerrainGeometry, elevationGrid: Float32Array): void {
  const positionAttribute = renderGeometry.geometry.attributes.position as THREE.BufferAttribute;

  for (let index = 0; index < renderGeometry.sourceIndices.length; index += 1) {
    const sourceIndex = renderGeometry.sourceIndices[index];
    positionAttribute.setZ(index, elevationGrid[sourceIndex] ?? 0);
  }

  finalizeGeometryUpdate(renderGeometry.geometry);
}

export function updateColors(geometry: THREE.BufferGeometry): void {
  const position = geometry.attributes.position as THREE.BufferAttribute;

  if (!geometry.attributes.color) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(position.count * 3), 3));
  }

  const colors = geometry.attributes.color as THREE.BufferAttribute;
  const color = new THREE.Color();

  for (let index = 0; index < position.count; index += 1) {
    const height = position.getZ(index);

    if (height < 2) {
      color.setHSL(0.25, 0.4, 0.2 + height * 0.05);
    } else if (height < 10) {
      color.setHSL(0.1, 0.3, 0.3);
    } else {
      color.setHSL(0, 0, 0.5 + height * 0.01);
    }

    colors.setXYZ(index, color.r, color.g, color.b);
  }

  colors.needsUpdate = true;
}

export function finalizeGeometryUpdate(geometry: THREE.BufferGeometry): void {
  const positionAttribute = geometry.attributes.position as THREE.BufferAttribute;
  positionAttribute.needsUpdate = true;
  geometry.computeVertexNormals();
  updateColors(geometry);
}

export function polygonsAreEqual(left: TerrainPoint[], right: TerrainPoint[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.x !== right[index]?.x || left[index]?.y !== right[index]?.y) {
      return false;
    }
  }

  return true;
}

export function buildAngleArcPoints(
  origin: TerrainPoint,
  startAngle: number,
  interiorAngle: number,
  sweepDirection: number,
  radius: number,
): THREE.Vector3[] {
  const segmentCount = Math.max(12, Math.ceil(interiorAngle / (Math.PI / 18)));
  const points: THREE.Vector3[] = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const progress = index / segmentCount;
    const angle = startAngle + sweepDirection * interiorAngle * progress;

    points.push(
      new THREE.Vector3(
        origin.x + Math.cos(angle) * radius,
        0.03,
        origin.y + Math.sin(angle) * radius,
      ),
    );
  }

  return points;
}

export function getPolygonWinding(polygon: TerrainPoint[]): number {
  let signedArea = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    signedArea += polygon[index].x * polygon[nextIndex].y - polygon[nextIndex].x * polygon[index].y;
  }

  return signedArea >= 0 ? 1 : -1;
}

export function getElevationAtWorld(
  worldX: number,
  worldY: number,
  terrain: {
    cellSize: number;
    elevationGrid: Float32Array;
    gridHeight: number;
    gridWidth: number;
  },
  elevationGrid: Float32Array,
): number {
  const coordinates = worldToGrid(worldX, worldY, terrain);

  return sampleElevation(elevationGrid, terrain.gridWidth, coordinates.x, coordinates.y);
}

export function buildTerrainBoundaryPoints(
  polygon: TerrainPoint[],
  terrain: {
    cellSize: number;
    elevationGrid: Float32Array;
    gridHeight: number;
    gridWidth: number;
  },
  elevationGrid: Float32Array,
  yOffset: number,
): THREE.Vector3[] {
  if (polygon.length < 2) {
    return [];
  }

  const isClosedPolygon = polygon.length > 2;
  const segmentCount = isClosedPolygon ? polygon.length : polygon.length - 1;
  const sampleSpacing = Math.max(terrain.cellSize * 0.75, 0.75);
  const boundaryPoints: THREE.Vector3[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);

    if (segmentLength <= Number.EPSILON) {
      continue;
    }

    const sampleCount = Math.max(1, Math.ceil(segmentLength / sampleSpacing));

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const t = sampleIndex / sampleCount;
      const x = THREE.MathUtils.lerp(start.x, end.x, t);
      const y = THREE.MathUtils.lerp(start.y, end.y, t);
      const height = getElevationAtWorld(x, y, terrain, elevationGrid);

      boundaryPoints.push(new THREE.Vector3(x, height + yOffset, y));
    }
  }

  const lastPoint = isClosedPolygon ? polygon[0] : polygon[polygon.length - 1];
  const lastHeight = getElevationAtWorld(lastPoint.x, lastPoint.y, terrain, elevationGrid);
  boundaryPoints.push(new THREE.Vector3(lastPoint.x, lastHeight + yOffset, lastPoint.y));

  return boundaryPoints;
}

export function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
