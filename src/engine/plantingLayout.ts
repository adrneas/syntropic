import type { LayoutGuide, LayoutGuideType, WorldPosition } from '../core/types/generation';
import type { TerrainState } from '../core/types/terrain';
import {
  calculatePolygonCentroid,
  clamp,
  getGridIndex,
  gridToWorld,
  worldToGrid,
} from '../core/utils/terrain';

const KEYLINE_FREQUENCY = 4;
const MIN_KEYLINES = 4;
const MAX_KEYLINES = 12;
const MIN_PLANTING_ROWS = 18;
const MAX_PLANTING_ROWS = 72;
const MAX_CONTOUR_LEVELS = 28;
const FLAT_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT = 10;
const GUIDE_BAND_BUFFER_RATIO = 0.55;
const MIN_GUIDE_LENGTH_FACTOR = 1.5;

const MARCHING_SQUARES_CASES: Record<number, Array<[number, number]>> = {
  0: [],
  1: [[3, 0]],
  2: [[0, 1]],
  3: [[3, 1]],
  4: [[1, 2]],
  5: [[3, 0], [1, 2]],
  6: [[0, 2]],
  7: [[3, 2]],
  8: [[2, 3]],
  9: [[0, 2]],
  10: [[0, 1], [2, 3]],
  11: [[1, 2]],
  12: [[3, 1]],
  13: [[0, 1]],
  14: [[3, 0]],
  15: [],
};

interface PlantingLayoutResult {
  contourInterval: number;
  interRows: LayoutGuide[];
  keylines: LayoutGuide[];
  plantingRows: LayoutGuide[];
  rowSpacingMeters: number;
}

interface PolygonStats {
  averageSlopePercent: number;
  flatCellRatio: number;
  maxElevation: number;
  minElevation: number;
  polygonArea: number;
}

interface Segment {
  start: WorldPosition;
  end: WorldPosition;
}

interface SupplementalGuideCandidate {
  averageSlopePercent: number;
  bandCoordinate: number;
  guide: LayoutGuide;
}

export function generatePlantingLayout(
  terrain: TerrainState,
  polygonMask: Uint8Array,
  slopeGrid: Float32Array,
): PlantingLayoutResult {
  const stats = collectPolygonStats(terrain, polygonMask, slopeGrid);

  if (!stats) {
    return {
      contourInterval: 0,
      interRows: [],
      keylines: [],
      plantingRows: [],
      rowSpacingMeters: 0,
    };
  }

  const rowSpacingMeters = determineRowSpacing(stats.averageSlopePercent);
  const guideLimits = determineGuideLimits(stats.polygonArea, rowSpacingMeters);
  const relief = stats.maxElevation - stats.minElevation;
  const contourInterval =
    relief >= 0.5
      ? roundTo(clamp((rowSpacingMeters * Math.max(stats.averageSlopePercent, 4)) / 100, 0.45, 2.4), 2)
      : 0;
  const contourLevels =
    contourInterval > 0
      ? buildContourLevels(stats.minElevation, stats.maxElevation, contourInterval)
      : [];

  const keylines: LayoutGuide[] = [];
  const plantingRows: LayoutGuide[] = [];

  contourLevels.forEach((level, index) => {
    const guideType: LayoutGuideType = index % KEYLINE_FREQUENCY === 0 ? 'KEYLINE' : 'PLANTING_ROW';
    const segments = extractContourSegments(terrain, polygonMask, level);
    const guides = buildLayoutGuides(segments, guideType, level, rowSpacingMeters);

    if (guideType === 'KEYLINE') {
      keylines.push(...guides);
    } else {
      plantingRows.push(...guides);
    }
  });

  const limitedKeylines = limitGuides(keylines, guideLimits.maxKeylines);
  const limitedPlantingRows = limitGuides(plantingRows, guideLimits.maxPlantingRows);
  const supplementalRows = buildSupplementalPlantingRows({
    existingGuides: [...limitedKeylines, ...limitedPlantingRows],
    existingPlantingRows: limitedPlantingRows,
    maxRows: guideLimits.maxPlantingRows - limitedPlantingRows.length,
    polygonMask,
    rowSpacingMeters,
    slopeGrid,
    stats,
    terrain,
  });
  const allPlantingRows = limitGuides(
    [...limitedPlantingRows, ...supplementalRows],
    guideLimits.maxPlantingRows,
  );
  const interRows = buildInterRowGuides({
    existingGuides: [...limitedKeylines, ...allPlantingRows],
    plantingRows: allPlantingRows,
    polygonMask,
    rowSpacingMeters,
    slopeGrid,
    terrain,
  });

  return {
    contourInterval,
    interRows,
    keylines: limitedKeylines,
    plantingRows: allPlantingRows,
    rowSpacingMeters,
  };
}

function collectPolygonStats(
  terrain: TerrainState,
  polygonMask: Uint8Array,
  slopeGrid: Float32Array,
): PolygonStats | null {
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  let slopeSum = 0;
  let flatCellCount = 0;
  let validCells = 0;

  for (let gridY = 0; gridY < terrain.gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth; gridX += 1) {
      const index = getGridIndex(gridX, gridY, terrain.gridWidth);

      if (polygonMask[index] !== 1) {
        continue;
      }

      const elevation = terrain.elevationGrid[index] ?? 0;
      const slope = slopeGrid[index] ?? 0;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
      slopeSum += slope;
      flatCellCount += slope <= FLAT_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT ? 1 : 0;
      validCells += 1;
    }
  }

  if (validCells === 0) {
    return null;
  }

  return {
    averageSlopePercent: slopeSum / validCells,
    flatCellRatio: flatCellCount / validCells,
    maxElevation,
    minElevation,
    polygonArea: validCells * terrain.cellSize * terrain.cellSize,
  };
}

function determineRowSpacing(averageSlopePercent: number): number {
  if (averageSlopePercent >= 16) {
    return 4;
  }

  if (averageSlopePercent >= 8) {
    return 5;
  }

  return 6;
}

function determineGuideLimits(
  polygonArea: number,
  rowSpacingMeters: number,
): { maxKeylines: number; maxPlantingRows: number } {
  const terrainSpanEstimate = Math.sqrt(Math.max(polygonArea, 1));
  const maxPlantingRows = Math.round(
    clamp(
      (terrainSpanEstimate / Math.max(rowSpacingMeters, 1)) * 1.15,
      MIN_PLANTING_ROWS,
      MAX_PLANTING_ROWS,
    ),
  );

  return {
    maxKeylines: Math.round(
      clamp(Math.ceil(maxPlantingRows / KEYLINE_FREQUENCY), MIN_KEYLINES, MAX_KEYLINES),
    ),
    maxPlantingRows,
  };
}

function buildContourLevels(minElevation: number, maxElevation: number, contourInterval: number): number[] {
  const levels: number[] = [];

  for (
    let level = minElevation + contourInterval;
    level < maxElevation - contourInterval / 2 && levels.length < MAX_CONTOUR_LEVELS;
    level += contourInterval
  ) {
    levels.push(roundTo(level, 2));
  }

  return levels;
}

function buildSupplementalPlantingRows({
  existingGuides,
  existingPlantingRows,
  maxRows,
  polygonMask,
  rowSpacingMeters,
  slopeGrid,
  stats,
  terrain,
}: {
  existingGuides: LayoutGuide[];
  existingPlantingRows: LayoutGuide[];
  maxRows: number;
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  slopeGrid: Float32Array;
  stats: PolygonStats;
  terrain: TerrainState;
}): LayoutGuide[] {
  if (maxRows <= 0) {
    return [];
  }

  const relief = stats.maxElevation - stats.minElevation;
  const currentCoverage = estimateProductiveCoverage(existingPlantingRows, rowSpacingMeters);
  const targetCoverage =
    stats.polygonArea * determineTargetCoverageRatio(stats.averageSlopePercent, stats.flatCellRatio);

  if (
    currentCoverage >= targetCoverage ||
    (existingPlantingRows.length > 0 && stats.flatCellRatio < 0.22 && relief >= 1.2)
  ) {
    return [];
  }

  const centroid = calculatePolygonCentroid(terrain.polygon) ?? terrain.polygon[0] ?? { x: 0, y: 0 };
  const rowAngle = determineSupplementalRowAngle(existingGuides, terrain);
  const tangent = { x: Math.cos(rowAngle), y: Math.sin(rowAngle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const normalCoordinates = terrain.polygon.map((point) => projectPointOnAxis(point, centroid, normal));

  if (normalCoordinates.length === 0) {
    return [];
  }

  const minNormal = Math.min(...normalCoordinates);
  const maxNormal = Math.max(...normalCoordinates);
  const existingBands = existingGuides.map((guide) =>
    getGuideBandCoordinate(guide, centroid, normal),
  );
  const candidates: SupplementalGuideCandidate[] = [];

  for (
    let bandCoordinate = minNormal + rowSpacingMeters / 2, bandIndex = 0;
    bandCoordinate <= maxNormal - rowSpacingMeters / 2;
    bandCoordinate += rowSpacingMeters, bandIndex += 1
  ) {
    const hasNearbyGuide = existingBands.some(
      (existingBand) =>
        Math.abs(existingBand - bandCoordinate) < rowSpacingMeters * GUIDE_BAND_BUFFER_RATIO,
    );

    if (hasNearbyGuide) {
      continue;
    }

    candidates.push(
      ...sampleSupplementalGuidesForBand({
        bandCoordinate,
        bandIndex,
        centroid,
        normal,
        polygonMask,
        rowSpacingMeters,
        slopeGrid,
        tangent,
        terrain,
      }),
    );
  }

  candidates.sort(
    (left, right) =>
      right.guide.length - left.guide.length ||
      left.averageSlopePercent - right.averageSlopePercent ||
      Math.abs(left.bandCoordinate) - Math.abs(right.bandCoordinate),
  );

  const selected: LayoutGuide[] = [];
  const occupiedBands = [...existingBands];
  let accumulatedCoverage = currentCoverage;

  for (let index = 0; index < candidates.length; index += 1) {
    if (selected.length >= maxRows || accumulatedCoverage >= targetCoverage) {
      break;
    }

    const candidate = candidates[index];
    const hasNearbySelectedBand = occupiedBands.some(
      (existingBand) =>
        Math.abs(existingBand - candidate.bandCoordinate) <
        rowSpacingMeters * GUIDE_BAND_BUFFER_RATIO,
    );

    if (hasNearbySelectedBand) {
      continue;
    }

    selected.push(candidate.guide);
    occupiedBands.push(candidate.bandCoordinate);
    accumulatedCoverage += candidate.guide.length * rowSpacingMeters;
  }

  return selected;
}

function buildInterRowGuides({
  existingGuides,
  plantingRows,
  polygonMask,
  rowSpacingMeters,
  slopeGrid,
  terrain,
}: {
  existingGuides: LayoutGuide[];
  plantingRows: LayoutGuide[];
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  slopeGrid: Float32Array;
  terrain: TerrainState;
}): LayoutGuide[] {
  if (plantingRows.length < 2) {
    return [];
  }

  const centroid = calculatePolygonCentroid(terrain.polygon) ?? terrain.polygon[0] ?? { x: 0, y: 0 };
  const rowAngle = determineSupplementalRowAngle(existingGuides, terrain);
  const tangent = { x: Math.cos(rowAngle), y: Math.sin(rowAngle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const sortedBands = plantingRows
    .map((guide) => ({
      bandCoordinate: getGuideBandCoordinate(guide, centroid, normal),
      guide,
    }))
    .sort((left, right) => left.bandCoordinate - right.bandCoordinate);
  const interRows: LayoutGuide[] = [];

  for (let index = 0; index < sortedBands.length - 1; index += 1) {
    const current = sortedBands[index];
    const next = sortedBands[index + 1];
    const distanceBetweenBands = next.bandCoordinate - current.bandCoordinate;

    if (
      distanceBetweenBands < rowSpacingMeters * 0.6 ||
      distanceBetweenBands > rowSpacingMeters * 1.8
    ) {
      continue;
    }

    const bandCoordinate = (current.bandCoordinate + next.bandCoordinate) / 2;
    const candidates = sampleGuidesForBand({
      bandCoordinate,
      bandIndex: index,
      centroid,
      guideIdPrefix: 'interrow',
      guideType: 'INTERROW',
      normal,
      polygonMask,
      rowSpacingMeters,
      slopeGrid,
      tangent,
      terrain,
    });

    interRows.push(...candidates.map((candidate) => candidate.guide));
  }

  return limitGuides(interRows, plantingRows.length);
}

function extractContourSegments(
  terrain: TerrainState,
  polygonMask: Uint8Array,
  level: number,
): Segment[] {
  const segments: Segment[] = [];

  for (let gridY = 0; gridY < terrain.gridHeight - 1; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth - 1; gridX += 1) {
      const topLeftIndex = getGridIndex(gridX, gridY, terrain.gridWidth);
      const topRightIndex = getGridIndex(gridX + 1, gridY, terrain.gridWidth);
      const bottomRightIndex = getGridIndex(gridX + 1, gridY + 1, terrain.gridWidth);
      const bottomLeftIndex = getGridIndex(gridX, gridY + 1, terrain.gridWidth);
      const inclusionCount =
        polygonMask[topLeftIndex] +
        polygonMask[topRightIndex] +
        polygonMask[bottomRightIndex] +
        polygonMask[bottomLeftIndex];

      if (inclusionCount === 0) {
        continue;
      }

      const values = [
        terrain.elevationGrid[topLeftIndex] ?? 0,
        terrain.elevationGrid[topRightIndex] ?? 0,
        terrain.elevationGrid[bottomRightIndex] ?? 0,
        terrain.elevationGrid[bottomLeftIndex] ?? 0,
      ];
      const caseIndex =
        (values[0] >= level ? 1 : 0) |
        (values[1] >= level ? 2 : 0) |
        (values[2] >= level ? 4 : 0) |
        (values[3] >= level ? 8 : 0);
      const caseSegments = MARCHING_SQUARES_CASES[caseIndex];

      if (!caseSegments || caseSegments.length === 0) {
        continue;
      }

      const corners = [
        gridToWorld(gridX, gridY, terrain),
        gridToWorld(gridX + 1, gridY, terrain),
        gridToWorld(gridX + 1, gridY + 1, terrain),
        gridToWorld(gridX, gridY + 1, terrain),
      ];

      caseSegments.forEach(([startEdge, endEdge]) => {
        const start = interpolateEdge(corners, values, startEdge, level);
        const end = interpolateEdge(corners, values, endEdge, level);

        if (!start || !end) {
          return;
        }

        segments.push({ end, start });
      });
    }
  }

  return segments;
}

function buildLayoutGuides(
  segments: Segment[],
  type: LayoutGuideType,
  level: number,
  rowSpacingMeters: number,
): LayoutGuide[] {
  const polylines = joinSegmentsToPolylines(segments);

  return polylines
    .map((points, index) => ({
      averageElevation: roundTo(level, 2),
      id: `${type.toLowerCase()}-${roundTo(level, 2)}-${index}`,
      length: roundTo(calculatePolylineLength(points), 2),
      points: simplifyPolyline(points),
      type,
    }))
    .filter(
      (guide) =>
        guide.length >= rowSpacingMeters * MIN_GUIDE_LENGTH_FACTOR && guide.points.length >= 2,
    );
}

function sampleSupplementalGuidesForBand({
  bandCoordinate,
  bandIndex,
  centroid,
  normal,
  polygonMask,
  rowSpacingMeters,
  slopeGrid,
  tangent,
  terrain,
}: {
  bandCoordinate: number;
  bandIndex: number;
  centroid: { x: number; y: number };
  normal: { x: number; y: number };
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  slopeGrid: Float32Array;
  tangent: { x: number; y: number };
  terrain: TerrainState;
}): SupplementalGuideCandidate[] {
  return sampleGuidesForBand({
    bandCoordinate,
    bandIndex,
    centroid,
    guideIdPrefix: 'planting_row-flat',
    guideType: 'PLANTING_ROW',
    normal,
    polygonMask,
    rowSpacingMeters,
    slopeGrid,
    tangent,
    terrain,
  });
}

function sampleGuidesForBand({
  bandCoordinate,
  bandIndex,
  centroid,
  guideIdPrefix,
  guideType,
  normal,
  polygonMask,
  rowSpacingMeters,
  slopeGrid,
  tangent,
  terrain,
}: {
  bandCoordinate: number;
  bandIndex: number;
  centroid: { x: number; y: number };
  guideIdPrefix: string;
  guideType: LayoutGuideType;
  normal: { x: number; y: number };
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  slopeGrid: Float32Array;
  tangent: { x: number; y: number };
  terrain: TerrainState;
}): SupplementalGuideCandidate[] {
  const tangentCoordinates = terrain.polygon.map((point) => projectPointOnAxis(point, centroid, tangent));
  const minTangent = Math.min(...tangentCoordinates) - terrain.cellSize;
  const maxTangent = Math.max(...tangentCoordinates) + terrain.cellSize;
  const candidates: SupplementalGuideCandidate[] = [];
  let currentPoints: WorldPosition[] = [];
  let currentSlopeSum = 0;
  let currentSlopeSamples = 0;
  let previousGridKey: string | null = null;
  let segmentIndex = 0;

  const flushCurrentSegment = () => {
    if (currentPoints.length < 2) {
      currentPoints = [];
      currentSlopeSum = 0;
      currentSlopeSamples = 0;
      previousGridKey = null;
      return;
    }

    const guide = buildSupplementalGuide(currentPoints, bandIndex, guideIdPrefix, guideType, segmentIndex);

    if (guide.length >= rowSpacingMeters * MIN_GUIDE_LENGTH_FACTOR) {
      candidates.push({
        averageSlopePercent:
          currentSlopeSamples > 0 ? currentSlopeSum / currentSlopeSamples : Number.POSITIVE_INFINITY,
        bandCoordinate,
        guide,
      });
    }

    currentPoints = [];
    currentSlopeSum = 0;
    currentSlopeSamples = 0;
    previousGridKey = null;
  };

  for (
    let tangentCoordinate = minTangent;
    tangentCoordinate <= maxTangent;
    tangentCoordinate += terrain.cellSize
  ) {
    const samplePoint = {
      x: centroid.x + tangent.x * tangentCoordinate + normal.x * bandCoordinate,
      y: centroid.y + tangent.y * tangentCoordinate + normal.y * bandCoordinate,
    };
    const grid = worldToGrid(samplePoint.x, samplePoint.y, terrain);
    const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);

    if (polygonMask[gridIndex] !== 1) {
      flushCurrentSegment();
      segmentIndex += 1;
      continue;
    }

    const gridKey = `${grid.x}:${grid.y}`;

    if (previousGridKey === gridKey) {
      continue;
    }

    currentPoints.push({
      x: roundTo(samplePoint.x, 3),
      y: roundTo(samplePoint.y, 3),
      z: roundTo(terrain.elevationGrid[gridIndex] ?? 0, 2),
    });
    currentSlopeSum += slopeGrid[gridIndex] ?? 0;
    currentSlopeSamples += 1;
    previousGridKey = gridKey;
  }

  flushCurrentSegment();

  return candidates;
}

function buildSupplementalGuide(
  points: WorldPosition[],
  bandIndex: number,
  guideIdPrefix: string,
  guideType: LayoutGuideType,
  segmentIndex: number,
): LayoutGuide {
  const simplifiedPoints = simplifyPolyline(points);

  return {
    averageElevation: roundTo(
      simplifiedPoints.reduce((sum, point) => sum + point.z, 0) / simplifiedPoints.length,
      2,
    ),
    id: `${guideIdPrefix}-${bandIndex}-${segmentIndex}`,
    length: roundTo(calculatePolylineLength(simplifiedPoints), 2),
    points: simplifiedPoints,
    type: guideType,
  };
}

function joinSegmentsToPolylines(segments: Segment[]): WorldPosition[][] {
  const polylines: Array<WorldPosition[] | null> = [];
  const endpointMap = new Map<string, { at: 'start' | 'end'; index: number }>();

  const unregisterEndpoints = (index: number) => {
    const polyline = polylines[index];

    if (!polyline || polyline.length === 0) {
      return;
    }

    endpointMap.delete(buildPointKey(polyline[0]));
    endpointMap.delete(buildPointKey(polyline[polyline.length - 1]));
  };

  const registerEndpoints = (index: number) => {
    const polyline = polylines[index];

    if (!polyline || polyline.length === 0) {
      return;
    }

    endpointMap.set(buildPointKey(polyline[0]), { at: 'start', index });
    endpointMap.set(buildPointKey(polyline[polyline.length - 1]), { at: 'end', index });
  };

  segments.forEach((segment) => {
    const startKey = buildPointKey(segment.start);
    const endKey = buildPointKey(segment.end);
    const startMatch = endpointMap.get(startKey);
    const endMatch = endpointMap.get(endKey);

    if (!startMatch && !endMatch) {
      const polyline = [segment.start, segment.end];
      const index = polylines.push(polyline) - 1;
      registerEndpoints(index);
      return;
    }

    if (startMatch && !endMatch) {
      const polyline = polylines[startMatch.index];

      if (!polyline) {
        return;
      }

      unregisterEndpoints(startMatch.index);

      if (startMatch.at === 'start') {
        polyline.reverse();
      }

      polyline.push(segment.end);
      registerEndpoints(startMatch.index);
      return;
    }

    if (!startMatch && endMatch) {
      const polyline = polylines[endMatch.index];

      if (!polyline) {
        return;
      }

      unregisterEndpoints(endMatch.index);

      if (endMatch.at === 'start') {
        polyline.reverse();
      }

      polyline.push(segment.start);
      registerEndpoints(endMatch.index);
      return;
    }

    if (!startMatch || !endMatch) {
      return;
    }

    if (startMatch.index === endMatch.index) {
      return;
    }

    const startPolyline = polylines[startMatch.index];
    const endPolyline = polylines[endMatch.index];

    if (!startPolyline || !endPolyline) {
      return;
    }

    unregisterEndpoints(startMatch.index);
    unregisterEndpoints(endMatch.index);

    if (startMatch.at === 'start') {
      startPolyline.reverse();
    }

    if (endMatch.at === 'end') {
      endPolyline.reverse();
    }

    polylines[startMatch.index] = [...startPolyline, ...endPolyline];
    polylines[endMatch.index] = null;
    registerEndpoints(startMatch.index);
  });

  return polylines.filter((polyline): polyline is WorldPosition[] => Boolean(polyline));
}

function interpolateEdge(
  corners: ReturnType<typeof gridToWorld>[],
  values: number[],
  edge: number,
  level: number,
): WorldPosition | null {
  switch (edge) {
    case 0:
      return interpolatePoint(corners[0], corners[1], values[0], values[1], level);
    case 1:
      return interpolatePoint(corners[1], corners[2], values[1], values[2], level);
    case 2:
      return interpolatePoint(corners[2], corners[3], values[2], values[3], level);
    case 3:
      return interpolatePoint(corners[3], corners[0], values[3], values[0], level);
    default:
      return null;
  }
}

function interpolatePoint(
  start: ReturnType<typeof gridToWorld>,
  end: ReturnType<typeof gridToWorld>,
  startValue: number,
  endValue: number,
  level: number,
): WorldPosition {
  const factor =
    Math.abs(endValue - startValue) <= Number.EPSILON
      ? 0.5
      : clamp((level - startValue) / (endValue - startValue), 0, 1);

  return {
    x: roundTo(start.x + (end.x - start.x) * factor, 3),
    y: roundTo(start.y + (end.y - start.y) * factor, 3),
    z: roundTo(level, 2),
  };
}

function calculatePolylineLength(points: WorldPosition[]): number {
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }

  return length;
}

function estimateProductiveCoverage(guides: LayoutGuide[], rowSpacingMeters: number): number {
  return guides.reduce((sum, guide) => sum + guide.length * rowSpacingMeters, 0);
}

function determineTargetCoverageRatio(averageSlopePercent: number, flatCellRatio: number): number {
  if (flatCellRatio >= 0.7 || averageSlopePercent <= FLAT_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT) {
    return 0.82;
  }

  if (flatCellRatio >= 0.45 || averageSlopePercent <= 14) {
    return 0.7;
  }

  return 0.58;
}

function determineSupplementalRowAngle(existingGuides: LayoutGuide[], terrain: TerrainState): number {
  const longestGuide = existingGuides.reduce<LayoutGuide | null>(
    (best, guide) => (!best || guide.length > best.length ? guide : best),
    null,
  );

  if (longestGuide && longestGuide.points.length >= 2) {
    const firstPoint = longestGuide.points[0];
    const lastPoint = longestGuide.points[longestGuide.points.length - 1];
    return normalizeGuideAngle(Math.atan2(lastPoint.y - firstPoint.y, lastPoint.x - firstPoint.x));
  }

  let dominantAngle = 0;
  let longestEdgeLength = 0;

  for (let index = 0; index < terrain.polygon.length; index += 1) {
    const currentPoint = terrain.polygon[index];
    const nextPoint = terrain.polygon[(index + 1) % terrain.polygon.length];
    const edgeLength = Math.hypot(nextPoint.x - currentPoint.x, nextPoint.y - currentPoint.y);

    if (edgeLength <= longestEdgeLength) {
      continue;
    }

    longestEdgeLength = edgeLength;
    dominantAngle = Math.atan2(nextPoint.y - currentPoint.y, nextPoint.x - currentPoint.x);
  }

  return normalizeGuideAngle(dominantAngle);
}

function getGuideBandCoordinate(
  guide: LayoutGuide,
  centroid: { x: number; y: number },
  normal: { x: number; y: number },
): number {
  const point = guide.points[Math.floor(guide.points.length / 2)] ?? guide.points[0];
  return projectPointOnAxis(point, centroid, normal);
}

function projectPointOnAxis(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  axis: { x: number; y: number },
): number {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
}

function normalizeGuideAngle(angle: number): number {
  const halfTurn = Math.PI;
  const normalized = angle % halfTurn;
  return normalized < 0 ? normalized + halfTurn : normalized;
}

function simplifyPolyline(points: WorldPosition[]): WorldPosition[] {
  if (points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);

    if (Math.abs(cross) > 0.005) {
      simplified.push(current);
    }
  }

  simplified.push(points[points.length - 1]);

  return simplified;
}

function buildPointKey(point: WorldPosition): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(2)}`;
}

function limitGuides(guides: LayoutGuide[], maxCount: number): LayoutGuide[] {
  return guides
    .sort((left, right) => right.length - left.length || right.averageElevation - left.averageElevation)
    .slice(0, maxCount)
    .sort((left, right) => right.averageElevation - left.averageElevation);
}

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
