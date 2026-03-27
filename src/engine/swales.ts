import type { LayoutGuide, ProductiveArea, WorldPosition } from '../core/types/generation';
import type { TerrainPoint, TerrainState } from '../core/types/terrain';
import {
  calculatePolygonCentroid,
  getGridIndex,
  pointInPolygon,
  sampleElevation,
  worldToGrid,
} from '../core/utils/terrain';

const MIN_SWALE_LENGTH_FACTOR = 1.35;
const MAX_SWALES_PER_AREA = 6;
export const SWALE_OCCUPATION_VALUE = -5;

interface SwaleCandidate {
  areaId: string;
  bandCoordinate: number;
  guide: LayoutGuide;
  sourcePriority: number;
}

export function generateSwales({
  guides,
  occupationGrid,
  productiveAreas,
  rowSpacingMeters,
  terrain,
}: {
  guides: LayoutGuide[];
  occupationGrid: Int32Array;
  productiveAreas: ProductiveArea[];
  rowSpacingMeters: number;
  terrain: TerrainState;
}): LayoutGuide[] {
  const slopeAreas = productiveAreas.filter((area) => area.type === 'SLOPE_PRODUCTIVE');

  if (slopeAreas.length === 0 || rowSpacingMeters <= 0) {
    return [];
  }

  const centroid = calculatePolygonCentroid(terrain.polygon) ?? terrain.polygon[0] ?? { x: 0, y: 0 };
  const angle = determineGuideOrientation(guides, terrain);
  const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const guideCandidates = buildGuideDerivedCandidates({
    centroid,
    guides,
    normal,
    occupationGrid,
    rowSpacingMeters,
    slopeAreas,
    terrain,
  });
  const fallbackCandidates = buildFallbackCandidates({
    centroid,
    normal,
    occupationGrid,
    rowSpacingMeters,
    slopeAreas,
    tangent,
    terrain,
  });
  const candidatesByArea = new Map<string, SwaleCandidate[]>();

  [...guideCandidates, ...fallbackCandidates].forEach((candidate) => {
    const areaCandidates = candidatesByArea.get(candidate.areaId);

    if (areaCandidates) {
      areaCandidates.push(candidate);
      return;
    }

    candidatesByArea.set(candidate.areaId, [candidate]);
  });

  const selectedSwales = slopeAreas.flatMap((area) =>
    selectAreaSwales(candidatesByArea.get(area.id) ?? [], area, rowSpacingMeters),
  );

  selectedSwales.forEach((guide) => reserveSwaleCells(guide, occupationGrid, terrain));

  return selectedSwales;
}

function buildGuideDerivedCandidates({
  centroid,
  guides,
  normal,
  occupationGrid,
  rowSpacingMeters,
  slopeAreas,
  terrain,
}: {
  centroid: TerrainPoint;
  guides: LayoutGuide[];
  normal: { x: number; y: number };
  occupationGrid: Int32Array;
  rowSpacingMeters: number;
  slopeAreas: ProductiveArea[];
  terrain: TerrainState;
}): SwaleCandidate[] {
  const orderedGuides = [...guides].sort(
    (left, right) =>
      getGuideSourcePriority(left) - getGuideSourcePriority(right) ||
      right.length - left.length ||
      right.averageElevation - left.averageElevation,
  );
  const candidates: SwaleCandidate[] = [];

  orderedGuides.forEach((guide) => {
    const sampleCount = Math.max(
      12,
      Math.min(480, Math.ceil(guide.length / Math.max(terrain.cellSize * 0.6, 0.45))),
    );
    const samples = resampleGuidePoints(guide.points, sampleCount);
    let currentAreaId: string | null = null;
    let currentPoints: WorldPosition[] = [];
    let previousGridKey: string | null = null;
    let segmentIndex = 0;

    const flushCurrentPoints = () => {
      if (!currentAreaId || currentPoints.length < 2) {
        currentAreaId = null;
        currentPoints = [];
        previousGridKey = null;
        return;
      }

      const swale = buildSwaleGuide(
        currentPoints,
        `swale-${currentAreaId}-${guide.id}`,
        segmentIndex,
      );

      if (swale.length >= rowSpacingMeters * MIN_SWALE_LENGTH_FACTOR) {
        candidates.push({
          areaId: currentAreaId,
          bandCoordinate: getGuideBandCoordinate(swale, centroid, normal),
          guide: swale,
          sourcePriority: getGuideSourcePriority(guide),
        });
      }

      currentAreaId = null;
      currentPoints = [];
      previousGridKey = null;
      segmentIndex += 1;
    };

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      const area = findContainingArea(sample, slopeAreas);

      if (!area) {
        flushCurrentPoints();
        continue;
      }

      const grid = worldToGrid(sample.x, sample.y, terrain);
      const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);

      if (occupationGrid[gridIndex] !== 0) {
        flushCurrentPoints();
        continue;
      }

      const gridKey = `${grid.x}:${grid.y}`;

      if (area.id !== currentAreaId) {
        flushCurrentPoints();
      }

      if (gridKey === previousGridKey) {
        continue;
      }

      currentAreaId = area.id;
      currentPoints.push(sample);
      previousGridKey = gridKey;
    }

    flushCurrentPoints();
  });

  return candidates;
}

function buildFallbackCandidates({
  centroid,
  normal,
  occupationGrid,
  rowSpacingMeters,
  slopeAreas,
  tangent,
  terrain,
}: {
  centroid: TerrainPoint;
  normal: { x: number; y: number };
  occupationGrid: Int32Array;
  rowSpacingMeters: number;
  slopeAreas: ProductiveArea[];
  tangent: { x: number; y: number };
  terrain: TerrainState;
}): SwaleCandidate[] {
  const candidates: SwaleCandidate[] = [];
  const spacing = Math.max(rowSpacingMeters * 1.35, terrain.cellSize * 4);

  slopeAreas.forEach((area) => {
    const bounds = projectAreaBounds(area, tangent, normal);
    let bandIndex = 0;

    for (
      let normalCoordinate = bounds.minNormal + spacing * 0.5;
      normalCoordinate <= bounds.maxNormal - spacing * 0.25;
      normalCoordinate += spacing, bandIndex += 1
    ) {
      const points: WorldPosition[] = [];
      let previousGridKey: string | null = null;
      let segmentIndex = 0;

      const flushPoints = () => {
        if (points.length < 2) {
          points.length = 0;
          previousGridKey = null;
          return;
        }

        const swale = buildSwaleGuide(
          points,
          `swale-fallback-${area.id}-${bandIndex}`,
          segmentIndex,
        );

        if (swale.length >= rowSpacingMeters * MIN_SWALE_LENGTH_FACTOR) {
          candidates.push({
            areaId: area.id,
            bandCoordinate: getGuideBandCoordinate(swale, centroid, normal),
            guide: swale,
            sourcePriority: 2,
          });
        }

        points.length = 0;
        previousGridKey = null;
        segmentIndex += 1;
      };

      for (
        let tangentCoordinate = bounds.minTangent;
        tangentCoordinate <= bounds.maxTangent;
        tangentCoordinate += Math.max(terrain.cellSize, 0.85)
      ) {
        const samplePoint = {
          x: area.centroid.x + tangent.x * tangentCoordinate + normal.x * normalCoordinate,
          y: area.centroid.y + tangent.y * tangentCoordinate + normal.y * normalCoordinate,
        };

        if (!isPointInsideArea(samplePoint, area)) {
          flushPoints();
          continue;
        }

        const grid = worldToGrid(samplePoint.x, samplePoint.y, terrain);
        const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);

        if (occupationGrid[gridIndex] !== 0) {
          flushPoints();
          continue;
        }

        const gridKey = `${grid.x}:${grid.y}`;

        if (gridKey === previousGridKey) {
          continue;
        }

        points.push({
          x: roundTo(samplePoint.x, 3),
          y: roundTo(samplePoint.y, 3),
          z: roundTo(sampleElevation(terrain.elevationGrid, terrain.gridWidth, grid.x, grid.y), 2),
        });
        previousGridKey = gridKey;
      }

      flushPoints();
    }
  });

  return candidates;
}

function selectAreaSwales(
  candidates: SwaleCandidate[],
  area: ProductiveArea,
  rowSpacingMeters: number,
): LayoutGuide[] {
  if (candidates.length === 0) {
    return [];
  }

  const targetCount = determineAreaSwaleTarget(area, rowSpacingMeters);
  const minimumBandSeparation = Math.max(rowSpacingMeters * 1.1, 4);
  const selectedBands: number[] = [];

  return [...candidates]
    .sort(
      (left, right) =>
        left.sourcePriority - right.sourcePriority ||
        right.guide.length - left.guide.length ||
        right.guide.averageElevation - left.guide.averageElevation,
    )
    .filter((candidate) => {
      if (selectedBands.length >= targetCount) {
        return false;
      }

      if (
        selectedBands.some(
          (bandCoordinate) => Math.abs(bandCoordinate - candidate.bandCoordinate) < minimumBandSeparation,
        )
      ) {
        return false;
      }

      selectedBands.push(candidate.bandCoordinate);
      return true;
    })
    .map((candidate) => candidate.guide)
    .slice(0, targetCount);
}

function determineAreaSwaleTarget(area: ProductiveArea, rowSpacingMeters: number): number {
  const spanEstimate = Math.sqrt(Math.max(area.areaSquareMeters, 1));
  return Math.max(
    1,
    Math.min(MAX_SWALES_PER_AREA, Math.round(spanEstimate / Math.max(rowSpacingMeters * 2.6, 6))),
  );
}

function reserveSwaleCells(
  guide: LayoutGuide,
  occupationGrid: Int32Array,
  terrain: TerrainState,
): void {
  const sampleCount = Math.max(
    8,
    Math.min(640, Math.ceil(guide.length / Math.max(terrain.cellSize * 0.55, 0.45))),
  );
  const samples = resampleGuidePoints(guide.points, sampleCount);

  samples.forEach((sample) => {
    const grid = worldToGrid(sample.x, sample.y, terrain);
    const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);

    if (occupationGrid[gridIndex] === 0) {
      occupationGrid[gridIndex] = SWALE_OCCUPATION_VALUE;
    }
  });
}

function buildSwaleGuide(points: WorldPosition[], idPrefix: string, segmentIndex: number): LayoutGuide {
  const simplifiedPoints = simplifyGuidePoints(points);

  return {
    averageElevation: roundTo(
      simplifiedPoints.reduce((sum, point) => sum + point.z, 0) / simplifiedPoints.length,
      2,
    ),
    id: `${idPrefix}-${segmentIndex}`,
    length: roundTo(calculatePolylineLength(simplifiedPoints), 2),
    points: simplifiedPoints,
    type: 'SWALE',
  };
}

function determineGuideOrientation(guides: LayoutGuide[], terrain: TerrainState): number {
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

function findContainingArea(
  point: Pick<WorldPosition, 'x' | 'y'>,
  areas: ProductiveArea[],
): ProductiveArea | null {
  for (let index = 0; index < areas.length; index += 1) {
    if (isPointInsideArea(point, areas[index])) {
      return areas[index];
    }
  }

  return null;
}

function isPointInsideArea(
  point: Pick<WorldPosition, 'x' | 'y'>,
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

function getGuideSourcePriority(guide: LayoutGuide): number {
  switch (guide.type) {
    case 'KEYLINE':
      return 0;
    case 'PLANTING_ROW':
      return 1;
    default:
      return 2;
  }
}

function getGuideBandCoordinate(
  guide: LayoutGuide,
  centroid: TerrainPoint,
  normal: { x: number; y: number },
): number {
  const point = guide.points[Math.floor(guide.points.length / 2)] ?? guide.points[0];
  return projectPointOnAxis(point, centroid, normal);
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

function projectPointOnAxis(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  axis: { x: number; y: number },
): number {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
}

function resampleGuidePoints(points: WorldPosition[], sampleCount: number): WorldPosition[] {
  if (points.length <= 1 || sampleCount <= 1) {
    return [...points];
  }

  const cumulativeLengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    cumulativeLengths.push(
      cumulativeLengths[index - 1] + calculatePointDistance(points[index - 1], points[index]),
    );
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;

  if (totalLength <= Number.EPSILON) {
    return [...points];
  }

  const resampled: WorldPosition[] = [];

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const targetDistance = (totalLength * sampleIndex) / sampleCount;
    resampled.push(samplePointAlongPolyline(points, cumulativeLengths, targetDistance));
  }

  return resampled;
}

function samplePointAlongPolyline(
  points: WorldPosition[],
  cumulativeLengths: number[],
  targetDistance: number,
): WorldPosition {
  if (targetDistance <= 0) {
    return { ...points[0] };
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;

  if (targetDistance >= totalLength) {
    return { ...points[points.length - 1] };
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
      x: roundTo(start.x + (end.x - start.x) * factor, 3),
      y: roundTo(start.y + (end.y - start.y) * factor, 3),
      z: roundTo(start.z + (end.z - start.z) * factor, 2),
    };
  }

  return { ...points[points.length - 1] };
}

function simplifyGuidePoints(points: WorldPosition[]): WorldPosition[] {
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

function calculatePolylineLength(points: WorldPosition[]): number {
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    length += calculatePointDistance(points[index - 1], points[index]);
  }

  return length;
}

function calculatePointDistance(
  start: Pick<WorldPosition, 'x' | 'y'>,
  end: Pick<WorldPosition, 'x' | 'y'>,
): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function normalizeAngle(value: number): number {
  const halfTurn = Math.PI;
  const normalized = value % halfTurn;
  return normalized < 0 ? normalized + halfTurn : normalized;
}

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
