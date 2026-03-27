import type { ThreeEvent } from '@react-three/fiber';
import type * as THREE from 'three';
import type { ProjectVisualTokenId } from '../components/project/projectVisualTokens';

export type PointerSceneEvent = ThreeEvent<PointerEvent>;

export interface EdgeMeasurement {
  distance: string;
  midX: number;
  midZ: number;
}

export interface RenderTerrainGeometry {
  geometry: THREE.BufferGeometry;
  sourceIndices: Int32Array;
  sourceIndexToVertex: Map<number, number>;
}

export interface VertexAngleVisualization {
  angleDegrees: number;
  arcPoints: THREE.Vector3[];
  bisectorPoint: THREE.Vector3;
}

export interface ProjectInspectionDetail {
  label: string;
  value: string;
}

export interface ProjectInspectionEntity {
  id: string;
  badge: string;
  description: string;
  details: ProjectInspectionDetail[];
  title: string;
  visualTokenId: ProjectVisualTokenId;
}

export interface ProjectHoverLabel {
  id: string;
  position: [number, number, number];
  subtitle: string;
  title: string;
  visualTokenId: ProjectVisualTokenId;
}

export interface SceneProps {
  mode?: 'editor' | 'project';
  onSelectEntity?: (entity: ProjectInspectionEntity | null) => void;
  onZoomChange?: (zoom: number) => void;
  selectedEntityId?: string | null;
}
