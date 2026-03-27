import { useEffect, useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { getProductiveAreaVisualToken } from '../../components/project/projectVisualTokens';
import type { LayoutGuide, ProductiveArea } from '../../core/types/generation';
import type { TerrainState } from '../../core/types/terrain';
import type { ProjectHoverLabel } from '../sceneTypes';
import {
  buildGuideBandGeometry,
  buildGuidePolygonOutlinePoints,
  buildProductiveAreaGeometry,
  buildProductiveAreaOutlineLoops,
} from '../utils/guideGeometry';
import {
  buildGuideHoverLabel,
  buildProductiveAreaHoverLabel,
} from '../utils/inspectionEntities';

export interface InterRowBandMeshProps {
  color: string;
  guide: LayoutGuide;
  is2D: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onHoverClear: (hoverId: string) => void;
  terrain: TerrainState;
  width: number;
}

export const InterRowBandMesh = ({
  color,
  guide,
  is2D,
  onHoverChange,
  onHoverClear,
  terrain,
  width,
}: InterRowBandMeshProps) => {
  const geometry = useMemo(
    () => buildGuideBandGeometry(guide, terrain, width, is2D ? 0.04 : 0.075),
    [guide, is2D, terrain, width],
  );
  const outlinePoints = useMemo(
    () => buildGuidePolygonOutlinePoints(guide, terrain, width, is2D ? 0.055 : 0.095),
    [guide, is2D, terrain, width],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <group>
      <mesh
        onPointerOut={() => onHoverClear(guide.id)}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHoverChange(buildGuideHoverLabel(guide, is2D ? 0.52 : 0.36));
        }}
        renderOrder={is2D ? 6 : 32}
      >
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial
          color={color}
          depthTest
          depthWrite={false}
          opacity={is2D ? 0.06 : 0.09}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      {outlinePoints.length > 1 && (
        <Line
          color={color}
          depthTest
          depthWrite={false}
          lineWidth={is2D ? 1.15 : 0.95}
          opacity={is2D ? 0.78 : 0.86}
          points={outlinePoints}
          renderOrder={is2D ? 7 : 33}
          transparent
        />
      )}
    </group>
  );
};

export interface ProductiveAreaMeshProps {
  area: ProductiveArea;
  is2D: boolean;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onHoverClear: (hoverId: string) => void;
  onSelect: () => void;
}

export const ProductiveAreaMesh = ({
  area,
  is2D,
  isSelected,
  onHoverChange,
  onHoverClear,
  onSelect,
}: ProductiveAreaMeshProps) => {
  const token = getProductiveAreaVisualToken(area.type);
  const geometry = useMemo(
    () => buildProductiveAreaGeometry(area, is2D ? 0.04 : 0.08),
    [area, is2D],
  );
  const outlineLoops = useMemo(
    () => buildProductiveAreaOutlineLoops(area, is2D ? 0.055 : 0.095),
    [area, is2D],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <group>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerOut={() => onHoverClear(area.id)}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHoverChange(buildProductiveAreaHoverLabel(area, is2D ? 0.54 : 0.38));
        }}
        renderOrder={is2D ? 5 : 28}
      >
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial
          color={isSelected ? '#1f7f5c' : token.color}
          depthTest
          depthWrite={false}
          opacity={is2D ? 0.09 : 0.13}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      {outlineLoops.map((points, index) => (
        <Line
          color={isSelected ? '#1b5e45' : token.color}
          depthTest
          depthWrite={false}
          key={`${area.id}-outline-${index}`}
          lineWidth={is2D ? 1.25 : 1.05}
          opacity={is2D ? 0.84 : 0.9}
          points={points}
          renderOrder={is2D ? 7 : 33}
          transparent
        />
      ))}
    </group>
  );
};
