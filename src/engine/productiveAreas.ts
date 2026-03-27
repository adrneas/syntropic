import type {
  LayoutGuide,
  ProductiveArea,
  ProductiveAreaType,
  WorldPosition,
} from '../core/types/generation';
import type { TerrainPoint, TerrainState } from '../core/types/terrain';
import {
  calculatePolygonCentroid,
  getGridIndex,
  gridToWorld,
  sampleElevation,
  worldToGrid,
} from '../core/utils/terrain';

const SERVICE_CORRIDOR_OCCUPATION_VALUE = -4;
const MAX_PRODUCTIVE_SLOPE_PERCENT = 65;
const FLAT_APRON_SLOPE_THRESHOLD_PERCENT = 12;
const CREST_SLOPE_THRESHOLD_PERCENT = 18;
const SLOPED_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT = 10;
const CARDINAL_NEIGHBORS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
] as const;

type AreaTypeCode = 0 | 1 | 2 | 3 | 4;

interface CellCoordinate {
  x: number;
  y: number;
}

export interface ProductiveAreasResult {
  areas: ProductiveArea[];
  coverageSquareMeters: number;
  deadSpaceSquareMeters: number;
}

interface BoundaryEdge {
  end: TerrainPoint;
  endKey: string;
  start: TerrainPoint;
  startKey: string;
}

export function generateProductiveAreas({
  guides,
  occupationGrid,
  polygonMask,
  rowSpacingMeters,
  slopeGrid,
  terrain,
}: {
  guides: LayoutGuide[];
  occupationGrid: Int32Array;
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  slopeGrid: Float32Array;
  terrain: TerrainState;
}): ProductiveAreasResult {
  const totalCells = terrain.gridWidth * terrain.gridHeight;
  const assignedTypeGrid = new Int8Array(totalCells);
  const flatApronGrid = new Uint8Array(totalCells);
  const constructionCells: CellCoordinate[] = [];
  const centroid = calculatePolygonCentroid(terrain.polygon) ?? terrain.polygon[0] ?? { x: 0, y: 0 };
  let eligibleCellCount = 0;
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;

  for (let gridY = 0; gridY < terrain.gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth; gridX += 1) {
      const index = getGridIndex(gridX, gridY, terrain.gridWidth);

      if (polygonMask[index] !== 1) {
        continue;
      }

      const occupancyValue = occupationGrid[index] ?? 0;

      if (occupancyValue !== 0 && occupancyValue !== SERVICE_CORRIDOR_OCCUPATION_VALUE) {
        constructionCells.push({ x: gridX, y: gridY });
      }

      if (occupancyValue !== 0 || (slopeGrid[index] ?? 0) > MAX_PRODUCTIVE_SLOPE_PERCENT) {
        continue;
      }

      const elevation = terrain.elevationGrid[index] ?? 0;
      eligibleCellCount += 1;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
    }
  }

  if (eligibleCellCount === 0) {
    return {
      areas: [],
      coverageSquareMeters: 0,
      deadSpaceSquareMeters: 0,
    };
  }

  markFlatAprons({
    constructionCells,
    flatApronGrid,
    occupationGrid,
    polygonMask,
    rowSpacingMeters,
    slopeGrid,
    terrain,
  });

  const relief = Math.max(0, maxElevation - minElevation);
  const crestThreshold = maxElevation - Math.max(rowSpacingMeters * 0.28, relief * 0.18, terrain.cellSize * 2);

  for (let gridY = 0; gridY < terrain.gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth; gridX += 1) {
      const index = getGridIndex(gridX, gridY, terrain.gridWidth);

      if (polygonMask[index] !== 1 || occupationGrid[index] !== 0) {
        continue;
      }

      const slope = slopeGrid[index] ?? 0;

      if (slope > MAX_PRODUCTIVE_SLOPE_PERCENT) {
        continue;
      }

      if (flatApronGrid[index] === 1) {
        assignedTypeGrid[index] = 2;
        continue;
      }

      const elevation = terrain.elevationGrid[index] ?? 0;
      assignedTypeGrid[index] =
        elevation >= crestThreshold && slope <= CREST_SLOPE_THRESHOLD_PERCENT
          ? 1
          : slope >= SLOPED_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT
            ? 4
            : 3;
    }
  }

  const angle = determineAreaOrientationAngle(guides, terrain);
  const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const typeCells: Record<ProductiveAreaType, CellCoordinate[]> = {
    FLAT_PRODUCTIVE: [],
    GENERAL_FILL: [],
    SLOPE_PRODUCTIVE: [],
    TOPO_CREST: [],
  };

  for (let gridY = 0; gridY < terrain.gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth; gridX += 1) {
      const index = getGridIndex(gridX, gridY, terrain.gridWidth);
      const areaType = areaTypeFromCode(assignedTypeGrid[index] as AreaTypeCode);

      if (!areaType) {
        continue;
      }

      typeCells[areaType].push({ x: gridX, y: gridY });
    }
  }

  const areas: ProductiveArea[] = [];
  let coverageSquareMeters = 0;
  const appendAreasFromComponents = (
    type: Exclude<ProductiveAreaType, 'SLOPE_PRODUCTIVE'>,
    minCellCount: number,
  ) => {
    const components = splitConnectedComponents(
      typeCells[type],
      terrain.gridWidth,
      terrain.gridHeight,
    );

    components.forEach((component, componentIndex) => {
      if (component.length < minCellCount) {
        return;
      }

      const area = buildProductiveArea({
        centroid,
        component,
        id: `${type.toLowerCase()}-${componentIndex}`,
        slopeGrid,
        tangent,
        terrain,
        type,
      });

      if (!area) {
        return;
      }

      areas.push(area);
      coverageSquareMeters += area.areaSquareMeters;
    });
  };

  const slopeBands = splitSlopeCellsIntoBands({
    cells: typeCells.SLOPE_PRODUCTIVE,
    centroid,
    normal,
    rowSpacingMeters,
    terrain,
  });

  slopeBands.forEach((component, componentIndex) => {
    const area = buildProductiveArea({
      centroid,
      component,
      id: `slope-productive-band-${componentIndex}`,
      slopeGrid,
      tangent,
      terrain,
      type: 'SLOPE_PRODUCTIVE',
    });

    if (!area) {
      return;
    }

    areas.push(area);
    coverageSquareMeters += area.areaSquareMeters;
  });

  appendAreasFromComponents('FLAT_PRODUCTIVE', Math.max(8, Math.round((rowSpacingMeters * 0.65) / terrain.cellSize)));
  appendAreasFromComponents('TOPO_CREST', Math.max(10, Math.round((rowSpacingMeters * 0.8) / terrain.cellSize)));
  appendAreasFromComponents('GENERAL_FILL', Math.max(12, Math.round(rowSpacingMeters / terrain.cellSize)));

  const cellArea = terrain.cellSize * terrain.cellSize;
  const deadSpaceSquareMeters = roundTo(Math.max(0, eligibleCellCount * cellArea - coverageSquareMeters), 2);

  return {
    areas: areas.sort(
      (left, right) =>
        getProductiveAreaPriority(left.type) - getProductiveAreaPriority(right.type) ||
        right.areaSquareMeters - left.areaSquareMeters ||
        right.averageElevation - left.averageElevation,
    ),
    coverageSquareMeters: roundTo(coverageSquareMeters, 2),
    deadSpaceSquareMeters,
  };
}

function markFlatAprons({
  constructionCells,
  flatApronGrid,
  occupationGrid,
  polygonMask,
  rowSpacingMeters,
  slopeGrid,
  terrain,
}: {
  constructionCells: CellCoordinate[];
  flatApronGrid: Uint8Array;
  occupationGrid: Int32Array;
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  slopeGrid: Float32Array;
  terrain: TerrainState;
}): void {
  if (constructionCells.length === 0) {
    return;
  }

  const apronRadiusCells = Math.max(5, Math.ceil(Math.max(6, rowSpacingMeters * 1.45) / terrain.cellSize));
  const innerRadiusCells = Math.max(3, Math.ceil(Math.max(3, rowSpacingMeters * 0.82) / terrain.cellSize));
  const apronRadiusSquared = apronRadiusCells * apronRadiusCells;
  const innerRadiusSquared = innerRadiusCells * innerRadiusCells;

  for (let index = 0; index < constructionCells.length; index += 1) {
    const cell = constructionCells[index];

    for (let offsetY = -apronRadiusCells; offsetY <= apronRadiusCells; offsetY += 1) {
      for (let offsetX = -apronRadiusCells; offsetX <= apronRadiusCells; offsetX += 1) {
        const gridX = cell.x + offsetX;
        const gridY = cell.y + offsetY;

        if (
          gridX < 0 ||
          gridX >= terrain.gridWidth ||
          gridY < 0 ||
          gridY >= terrain.gridHeight
        ) {
          continue;
        }

        const distanceSquared = offsetX * offsetX + offsetY * offsetY;

        if (distanceSquared > apronRadiusSquared) {
          continue;
        }

        const candidateIndex = getGridIndex(gridX, gridY, terrain.gridWidth);

        if (polygonMask[candidateIndex] !== 1 || occupationGrid[candidateIndex] !== 0) {
          continue;
        }

        const slope = slopeGrid[candidateIndex] ?? 0;
        const relaxedThreshold =
          distanceSquared <= innerRadiusSquared
            ? FLAT_APRON_SLOPE_THRESHOLD_PERCENT + 4
            : FLAT_APRON_SLOPE_THRESHOLD_PERCENT;

        if (slope <= relaxedThreshold) {
          flatApronGrid[candidateIndex] = 1;
        }
      }
    }
  }
}

function determineAreaOrientationAngle(guides: LayoutGuide[], terrain: TerrainState): number {
  const longestGuide = guides.reduce<LayoutGuide | null>(
    (best, guide) => (!best || guide.length > best.length ? guide : best),
    null,
  );

  if (longestGuide && longestGuide.points.length >= 2) {
    const firstPoint = longestGuide.points[0];
    const lastPoint = longestGuide.points[longestGuide.points.length - 1];
    return normalizeAngle(Math.atan2(lastPoint.y - firstPoint.y, lastPoint.x - firstPoint.x));
  }

  let angle = 0;
  let longestEdge = 0;

  for (let index = 0; index < terrain.polygon.length; index += 1) {
    const current = terrain.polygon[index];
    const next = terrain.polygon[(index + 1) % terrain.polygon.length];
    const edgeLength = Math.hypot(next.x - current.x, next.y - current.y);

    if (edgeLength <= longestEdge) {
      continue;
    }

    longestEdge = edgeLength;
    angle = Math.atan2(next.y - current.y, next.x - current.x);
  }

  return normalizeAngle(angle);
}

function splitSlopeCellsIntoBands({
  cells,
  centroid,
  normal,
  rowSpacingMeters,
  terrain,
}: {
  cells: CellCoordinate[];
  centroid: TerrainPoint;
  normal: { x: number; y: number };
  rowSpacingMeters: number;
  terrain: TerrainState;
}): CellCoordinate[][] {
  if (cells.length === 0) {
    return [];
  }

  const bandWidth = Math.max(rowSpacingMeters * 2.2, terrain.cellSize * 6);
  const bandBuckets = new Map<number, CellCoordinate[]>();

  cells.forEach((cell) => {
    const world = gridToWorld(cell.x, cell.y, terrain);
    const normalCoordinate = projectPointOnAxis(world, centroid, normal);
    const bandIndex = Math.floor(normalCoordinate / bandWidth);
    const bucket = bandBuckets.get(bandIndex);

    if (bucket) {
      bucket.push(cell);
      return;
    }

    bandBuckets.set(bandIndex, [cell]);
  });

  return [...bandBuckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .flatMap(([, bandCells]) =>
      splitConnectedComponents(bandCells, terrain.gridWidth, terrain.gridHeight).filter(
        (component) => component.length >= Math.max(10, Math.round((rowSpacingMeters * 1.2) / terrain.cellSize)),
      ),
    );
}

function splitConnectedComponents(
  cells: CellCoordinate[],
  gridWidth: number,
  gridHeight: number,
): CellCoordinate[][] {
  const remaining = new Set<number>(
    cells.map((cell) => getGridIndex(cell.x, cell.y, gridWidth)),
  );
  const components: CellCoordinate[][] = [];

  while (remaining.size > 0) {
    const iterator = remaining.values().next();

    if (iterator.done) {
      break;
    }

    const component: CellCoordinate[] = [];
    const queue = [iterator.value];
    remaining.delete(iterator.value);

    while (queue.length > 0) {
      const currentIndex = queue.shift();

      if (currentIndex === undefined) {
        continue;
      }

      const cell = indexToCell(currentIndex, gridWidth);
      component.push(cell);

      for (let neighborIndex = 0; neighborIndex < CARDINAL_NEIGHBORS.length; neighborIndex += 1) {
        const neighbor = CARDINAL_NEIGHBORS[neighborIndex];
        const nextX = cell.x + neighbor.x;
        const nextY = cell.y + neighbor.y;

        if (
          nextX < 0 ||
          nextX >= gridWidth ||
          nextY < 0 ||
          nextY >= gridHeight
        ) {
          continue;
        }

        const nextIndex = getGridIndex(nextX, nextY, gridWidth);

        if (!remaining.has(nextIndex)) {
          continue;
        }

        remaining.delete(nextIndex);
        queue.push(nextIndex);
      }
    }

    if (component.length > 0) {
      components.push(component);
    }
  }

  return components;
}

function buildProductiveArea({
  centroid,
  component,
  id,
  slopeGrid,
  tangent,
  terrain,
  type,
}: {
  centroid: TerrainPoint;
  component: CellCoordinate[];
  id: string;
  slopeGrid: Float32Array;
  tangent: { x: number; y: number };
  terrain: TerrainState;
  type: ProductiveAreaType;
}): ProductiveArea | null {
  if (component.length === 0) {
    return null;
  }

  const loops = extractBoundaryLoops(component, terrain);

  if (loops.length === 0) {
    return null;
  }

  const orderedLoops = [...loops].sort(
    (left, right) => Math.abs(calculateLoopArea(right)) - Math.abs(calculateLoopArea(left)),
  );
  const polygon = smoothLoop(projectLoopToTerrain(orderedLoops[0], terrain), terrain);
  const holes = orderedLoops
    .slice(1)
    .map((loop) => smoothLoop(projectLoopToTerrain(loop, terrain), terrain))
    .filter((loop) => loop.length >= 3);

  if (polygon.length < 3) {
    return null;
  }

  let elevationSum = 0;
  let slopeSum = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < component.length; index += 1) {
    const cell = component[index];
    const cellIndex = getGridIndex(cell.x, cell.y, terrain.gridWidth);
    const world = gridToWorld(cell.x, cell.y, terrain);
    elevationSum += terrain.elevationGrid[cellIndex] ?? 0;
    slopeSum += slopeGrid[cellIndex] ?? 0;
    centroidX += world.x;
    centroidY += world.y;
  }

  const areaCentroidX = centroidX / component.length;
  const areaCentroidY = centroidY / component.length;
  const centroidGrid = worldToGrid(areaCentroidX, areaCentroidY, terrain);
  const centroidIndex = getGridIndex(centroidGrid.x, centroidGrid.y, terrain.gridWidth);
  const centroidElevation = terrain.elevationGrid[centroidIndex] ?? elevationSum / component.length;
  const areaSquareMeters = roundTo(component.length * terrain.cellSize * terrain.cellSize, 2);
  const anchorProjection = projectPointOnAxis({ x: areaCentroidX, y: areaCentroidY }, centroid, tangent);

  return {
    areaSquareMeters,
    averageElevation: roundTo(elevationSum / component.length, 2),
    averageSlopePercent: roundTo(slopeSum / component.length, 2),
    centroid: {
      x: roundTo(areaCentroidX, 3),
      y: roundTo(areaCentroidY, 3),
      z: roundTo(centroidElevation, 2),
    },
    holes: holes.length > 0 ? holes : undefined,
    id: `${id}-${Math.abs(Math.round(anchorProjection))}`,
    polygon,
    type,
  };
}

function extractBoundaryLoops(cells: CellCoordinate[], terrain: TerrainState): TerrainPoint[][] {
  const edges = new Map<string, BoundaryEdge>();

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const corners = getCellCorners(cell, terrain);

    toggleBoundaryEdge(edges, corners.bottomLeft, corners.bottomRight);
    toggleBoundaryEdge(edges, corners.bottomRight, corners.topRight);
    toggleBoundaryEdge(edges, corners.topRight, corners.topLeft);
    toggleBoundaryEdge(edges, corners.topLeft, corners.bottomLeft);
  }

  if (edges.size === 0) {
    return [];
  }

  const outgoing = new Map<string, BoundaryEdge[]>();
  const edgeIds = new Map<string, BoundaryEdge>();

  edges.forEach((edge) => {
    const edgeId = buildDirectedEdgeKey(edge.startKey, edge.endKey);
    edgeIds.set(edgeId, edge);

    const existingEdges = outgoing.get(edge.startKey);

    if (existingEdges) {
      existingEdges.push(edge);
    } else {
      outgoing.set(edge.startKey, [edge]);
    }
  });

  const used = new Set<string>();
  const loops: TerrainPoint[][] = [];

  edgeIds.forEach((edge, edgeId) => {
    if (used.has(edgeId)) {
      return;
    }

    const loop: TerrainPoint[] = [edge.start, edge.end];
    let currentKey = edge.endKey;
    const startKey = edge.startKey;
    used.add(edgeId);

    while (currentKey !== startKey) {
      const candidates = outgoing.get(currentKey)?.filter((candidate) => {
        const candidateId = buildDirectedEdgeKey(candidate.startKey, candidate.endKey);
        return !used.has(candidateId);
      });

      if (!candidates || candidates.length === 0) {
        break;
      }

      const nextEdge = candidates[0];
      const nextEdgeId = buildDirectedEdgeKey(nextEdge.startKey, nextEdge.endKey);
      used.add(nextEdgeId);
      loop.push(nextEdge.end);
      currentKey = nextEdge.endKey;
    }

    const closedLoop = removeDuplicateClosingPoint(loop);

    if (closedLoop.length >= 3) {
      loops.push(removeCollinearPoints(closedLoop));
    }
  });

  return loops.filter((loop) => loop.length >= 3);
}

function toggleBoundaryEdge(
  edges: Map<string, BoundaryEdge>,
  start: TerrainPoint,
  end: TerrainPoint,
): void {
  const startKey = buildPointKey(start);
  const endKey = buildPointKey(end);
  const undirectedKey =
    startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;

  if (edges.has(undirectedKey)) {
    edges.delete(undirectedKey);
    return;
  }

  edges.set(undirectedKey, {
    end,
    endKey,
    start,
    startKey,
  });
}

function getCellCorners(
  cell: CellCoordinate,
  terrain: TerrainState,
): {
  bottomLeft: TerrainPoint;
  bottomRight: TerrainPoint;
  topLeft: TerrainPoint;
  topRight: TerrainPoint;
} {
  const center = gridToWorld(cell.x, cell.y, terrain);
  const halfCell = terrain.cellSize / 2;

  return {
    bottomLeft: {
      x: roundTo(center.x - halfCell, 3),
      y: roundTo(center.y - halfCell, 3),
    },
    bottomRight: {
      x: roundTo(center.x + halfCell, 3),
      y: roundTo(center.y - halfCell, 3),
    },
    topLeft: {
      x: roundTo(center.x - halfCell, 3),
      y: roundTo(center.y + halfCell, 3),
    },
    topRight: {
      x: roundTo(center.x + halfCell, 3),
      y: roundTo(center.y + halfCell, 3),
    },
  };
}

function projectLoopToTerrain(loop: TerrainPoint[], terrain: TerrainState): WorldPosition[] {
  return loop.map((point) => {
    const grid = worldToGrid(point.x, point.y, terrain);
    const elevation = sampleElevation(terrain.elevationGrid, terrain.gridWidth, grid.x, grid.y);

    return {
      x: roundTo(point.x, 3),
      y: roundTo(point.y, 3),
      z: roundTo(elevation, 2),
    };
  });
}

function smoothLoop(loop: WorldPosition[], terrain: TerrainState): WorldPosition[] {
  if (loop.length < 4) {
    return loop;
  }

  let smoothed = [...loop];

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const next: WorldPosition[] = [];

    for (let index = 0; index < smoothed.length; index += 1) {
      const current = smoothed[index];
      const following = smoothed[(index + 1) % smoothed.length];

      next.push(projectPointToTerrain(lerpPoint(current, following, 0.25), terrain));
      next.push(projectPointToTerrain(lerpPoint(current, following, 0.75), terrain));
    }

    smoothed = next;
  }

  return removeAdjacentDuplicates(smoothed);
}

function projectPointToTerrain(
  point: Pick<WorldPosition, 'x' | 'y'>,
  terrain: TerrainState,
): WorldPosition {
  const grid = worldToGrid(point.x, point.y, terrain);
  const elevation = sampleElevation(terrain.elevationGrid, terrain.gridWidth, grid.x, grid.y);

  return {
    x: roundTo(point.x, 3),
    y: roundTo(point.y, 3),
    z: roundTo(elevation, 2),
  };
}

function lerpPoint(
  start: Pick<WorldPosition, 'x' | 'y'>,
  end: Pick<WorldPosition, 'x' | 'y'>,
  factor: number,
): Pick<WorldPosition, 'x' | 'y'> {
  return {
    x: roundTo(start.x + (end.x - start.x) * factor, 3),
    y: roundTo(start.y + (end.y - start.y) * factor, 3),
  };
}

function removeAdjacentDuplicates(points: WorldPosition[]): WorldPosition[] {
  if (points.length <= 1) {
    return points;
  }

  const filtered = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = filtered[filtered.length - 1];
    const current = points[index];

    if (
      Math.abs(previous.x - current.x) < 0.001 &&
      Math.abs(previous.y - current.y) < 0.001
    ) {
      continue;
    }

    filtered.push(current);
  }

  return filtered;
}

function removeDuplicateClosingPoint(points: TerrainPoint[]): TerrainPoint[] {
  if (points.length <= 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];

  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
}

function removeCollinearPoints(points: TerrainPoint[]): TerrainPoint[] {
  if (points.length <= 3) {
    return points;
  }

  const filtered: TerrainPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);

    if (Math.abs(cross) > 0.0001) {
      filtered.push(current);
    }
  }

  return filtered.length >= 3 ? filtered : points;
}

function calculateLoopArea(loop: TerrainPoint[]): number {
  let area = 0;

  for (let index = 0; index < loop.length; index += 1) {
    const nextIndex = (index + 1) % loop.length;
    area += loop[index].x * loop[nextIndex].y - loop[nextIndex].x * loop[index].y;
  }

  return area / 2;
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

function areaTypeFromCode(code: AreaTypeCode): ProductiveAreaType | null {
  switch (code) {
    case 1:
      return 'TOPO_CREST';
    case 2:
      return 'FLAT_PRODUCTIVE';
    case 3:
      return 'GENERAL_FILL';
    case 4:
      return 'SLOPE_PRODUCTIVE';
    default:
      return null;
  }
}

function indexToCell(index: number, gridWidth: number): CellCoordinate {
  return {
    x: index % gridWidth,
    y: Math.floor(index / gridWidth),
  };
}

function buildPointKey(point: TerrainPoint): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
}

function buildDirectedEdgeKey(startKey: string, endKey: string): string {
  return `${startKey}->${endKey}`;
}

function projectPointOnAxis(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  axis: { x: number; y: number },
): number {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
}

function normalizeAngle(value: number): number {
  const halfTurn = Math.PI;
  const normalized = value % halfTurn;
  return normalized < 0 ? normalized + halfTurn : normalized;
}

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
