import * as THREE from 'three';
import type { TerrainState } from '../../core/types/terrain';
import type { LayoutGuide, ProductiveArea, WorldPosition } from '../../core/types/generation';
import { getElevationAtWorld, roundTo } from './terrainGeometry';

export function buildGuideBandGeometry(
  guide: LayoutGuide,
  terrain: Pick<TerrainState, 'cellSize' | 'elevationGrid' | 'gridHeight' | 'gridWidth'>,
  width: number,
  yOffset: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const boundaries = buildGuideAreaBoundaries(guide, terrain, width);

  if (!boundaries || boundaries.left.length < 2 || boundaries.right.length < 2) {
    return geometry;
  }

  const positions = new Float32Array(boundaries.left.length * 6);
  const indices: number[] = [];

  for (let index = 0; index < boundaries.left.length; index += 1) {
    const leftPoint = boundaries.left[index];
    const rightPoint = boundaries.right[index];
    const baseIndex = index * 6;

    positions[baseIndex] = leftPoint.x;
    positions[baseIndex + 1] = leftPoint.z + yOffset;
    positions[baseIndex + 2] = leftPoint.y;
    positions[baseIndex + 3] = rightPoint.x;
    positions[baseIndex + 4] = rightPoint.z + yOffset;
    positions[baseIndex + 5] = rightPoint.y;

    if (index >= boundaries.left.length - 1) {
      continue;
    }

    const vertexIndex = index * 2;
    indices.push(
      vertexIndex,
      vertexIndex + 1,
      vertexIndex + 2,
      vertexIndex + 2,
      vertexIndex + 1,
      vertexIndex + 3,
    );
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export function buildGuidePolygonOutlinePoints(
  guide: LayoutGuide,
  terrain: Pick<TerrainState, 'cellSize' | 'elevationGrid' | 'gridHeight' | 'gridWidth'>,
  width: number,
  yOffset: number,
): THREE.Vector3[] {
  const boundaries = buildGuideAreaBoundaries(guide, terrain, width);

  if (!boundaries || boundaries.left.length < 2 || boundaries.right.length < 2) {
    return [];
  }

  const outline = [
    ...boundaries.left.map((point) => new THREE.Vector3(point.x, point.z + yOffset, point.y)),
    ...[...boundaries.right]
      .reverse()
      .map((point) => new THREE.Vector3(point.x, point.z + yOffset, point.y)),
  ];

  if (outline[0]) {
    outline.push(outline[0].clone());
  }

  return outline;
}

export function buildGuideAreaBoundaries(
  guide: LayoutGuide,
  terrain: Pick<TerrainState, 'cellSize' | 'elevationGrid' | 'gridHeight' | 'gridWidth'>,
  width: number,
): { left: WorldPosition[]; right: WorldPosition[] } | null {
  const polygon = guide.areaPolygon;

  if (polygon && polygon.length >= 4 && polygon.length % 2 === 0) {
    const boundaryPointCount = polygon.length / 2;

    return {
      left: smoothBoundaryPoints(polygon.slice(0, boundaryPointCount), terrain),
      right: smoothBoundaryPoints([...polygon.slice(boundaryPointCount)].reverse(), terrain),
    };
  }

  if (guide.points.length < 2 || width <= Number.EPSILON) {
    return null;
  }

  const halfWidth = width / 2;
  const leftBoundary: WorldPosition[] = [];
  const rightBoundary: WorldPosition[] = [];

  for (let index = 0; index < guide.points.length; index += 1) {
    const current = guide.points[index];
    const previous = guide.points[index - 1] ?? current;
    const next = guide.points[index + 1] ?? current;
    let directionX = next.x - previous.x;
    let directionY = next.y - previous.y;
    const directionLength = Math.hypot(directionX, directionY);

    if (directionLength <= Number.EPSILON) {
      directionX = 1;
      directionY = 0;
    } else {
      directionX /= directionLength;
      directionY /= directionLength;
    }

    const offsetX = -directionY * halfWidth;
    const offsetY = directionX * halfWidth;
    leftBoundary.push({ x: current.x + offsetX, y: current.y + offsetY, z: current.z });
    rightBoundary.push({ x: current.x - offsetX, y: current.y - offsetY, z: current.z });
  }

  return {
    left: smoothBoundaryPoints(leftBoundary, terrain),
    right: smoothBoundaryPoints(rightBoundary, terrain),
  };
}

export function buildProductiveAreaGeometry(
  area: ProductiveArea,
  yOffset: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  if (area.polygon.length < 3) {
    return geometry;
  }

  const outerLoop = normalizeAreaLoop(area.polygon, true);
  const holeLoops = (area.holes ?? []).map((loop) => normalizeAreaLoop(loop, false));
  const contour2D = outerLoop.map((point) => new THREE.Vector2(point.x, point.y));
  const holes2D = holeLoops.map((loop) => loop.map((point) => new THREE.Vector2(point.x, point.y)));
  const triangles = THREE.ShapeUtils.triangulateShape(contour2D, holes2D);
  const vertices = [outerLoop, ...holeLoops].flat();
  const positions = new Float32Array(vertices.length * 3);
  const indices: number[] = [];

  for (let index = 0; index < vertices.length; index += 1) {
    const point = vertices[index];
    const positionIndex = index * 3;

    positions[positionIndex] = point.x;
    positions[positionIndex + 1] = point.z + yOffset;
    positions[positionIndex + 2] = point.y;
  }

  for (let index = 0; index < triangles.length; index += 1) {
    const triangle = triangles[index];
    indices.push(triangle[0], triangle[1], triangle[2]);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export function buildProductiveAreaOutlineLoops(
  area: ProductiveArea,
  yOffset: number,
): THREE.Vector3[][] {
  const loops = [area.polygon, ...(area.holes ?? [])];

  return loops
    .filter((loop) => loop.length >= 3)
    .map((loop) => {
      const points = loop.map((point) => new THREE.Vector3(point.x, point.z + yOffset, point.y));

      points.push(points[0].clone());

      return points;
    });
}

export function normalizeAreaLoop(loop: WorldPosition[], shouldBeClockwise: boolean): WorldPosition[] {
  const points2D = loop.map((point) => new THREE.Vector2(point.x, point.y));
  const isClockwise = THREE.ShapeUtils.isClockWise(points2D);

  if (isClockwise === shouldBeClockwise) {
    return loop;
  }

  return [...loop].reverse();
}

export function smoothBoundaryPoints(
  points: WorldPosition[],
  terrain: Pick<TerrainState, 'cellSize' | 'elevationGrid' | 'gridHeight' | 'gridWidth'>,
): WorldPosition[] {
  if (points.length < 3) {
    return points.map((point) => projectPointToTerrain(point, terrain));
  }

  let smoothed = [...points];

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const nextPoints: WorldPosition[] = [smoothed[0]];

    for (let index = 0; index < smoothed.length - 1; index += 1) {
      const current = smoothed[index];
      const next = smoothed[index + 1];
      nextPoints.push(
        {
          x: roundTo(current.x * 0.75 + next.x * 0.25, 3),
          y: roundTo(current.y * 0.75 + next.y * 0.25, 3),
          z: 0,
        },
        {
          x: roundTo(current.x * 0.25 + next.x * 0.75, 3),
          y: roundTo(current.y * 0.25 + next.y * 0.75, 3),
          z: 0,
        },
      );
    }

    nextPoints.push(smoothed[smoothed.length - 1]);
    smoothed = nextPoints;
  }

  return smoothed.map((point) => projectPointToTerrain(point, terrain));
}

export function projectPointToTerrain(
  point: Pick<WorldPosition, 'x' | 'y'>,
  terrain: Pick<TerrainState, 'cellSize' | 'elevationGrid' | 'gridHeight' | 'gridWidth'>,
): WorldPosition {
  return {
    x: point.x,
    y: point.y,
    z: getElevationAtWorld(point.x, point.y, terrain, terrain.elevationGrid),
  };
}

export function toLinePoints(guide: LayoutGuide, yOffset: number): THREE.Vector3[] {
  return guide.points.map((point) => new THREE.Vector3(point.x, point.z + yOffset, point.y));
}
