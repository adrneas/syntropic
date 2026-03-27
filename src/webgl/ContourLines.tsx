import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { TerrainGridConfig, TerrainPoint } from '../core/types/terrain';
import { generateContourLines } from './utils/contourLines';

interface ContourLinesProps {
  elevationGrid: Float32Array;
  gridConfig: TerrainGridConfig;
  polygon: TerrainPoint[];
}

export function ContourLines({ elevationGrid, gridConfig, polygon }: ContourLinesProps) {
  const contours = useMemo(
    () => generateContourLines(elevationGrid, gridConfig, polygon, 8),
    [elevationGrid, gridConfig, polygon],
  );

  if (contours.length === 0) {
    return null;
  }

  return (
    <>
      {contours.map((contour, index) => {
        const isMajor = Math.abs(contour.level % 10) < 0.01 ||
          Math.abs(contour.level % 10 - 10) < 0.01;

        return (
          <Line
            key={`contour-${contour.level}-${index}`}
            points={contour.points}
            color={isMajor ? '#1a1a1a' : '#555555'}
            lineWidth={isMajor ? 1.8 : 1.0}
            opacity={isMajor ? 0.6 : 0.35}
            transparent
            depthWrite={false}
          />
        );
      })}
    </>
  );
}
