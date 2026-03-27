import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  gridToWorld,
  isPointWithinBufferedPolygon,
  worldToGrid,
} from '../../core/utils/terrain';
import type { TerrainPoint, TerrainState } from '../../core/types/terrain';
import type { PointerSceneEvent, RenderTerrainGeometry } from '../sceneTypes';
import {
  finalizeGeometryUpdate,
  getElevationAtWorld,
  polygonsAreEqual,
} from '../utils/terrainGeometry';

const TERRAIN_RENDER_BUFFER_METERS = 5;

interface UseTerrainInteractionParams {
  brushSize: number;
  commitTerrainPolygonHistory: (previousPolygon: TerrainPoint[]) => void;
  isProjectMode: boolean;
  replaceTerrainPolygon: (polygon: TerrainPoint[]) => void;
  terrain: TerrainState;
  toolMode: string;
  updateElevationGrid: (grid: Float32Array) => void;
  updateTerrainPolygon: (polygon: TerrainPoint[]) => void;
  viewMode: string;
  visibleTerrainGeometryRef: React.RefObject<RenderTerrainGeometry | null>;
}

export function useTerrainInteraction({
  brushSize,
  commitTerrainPolygonHistory,
  isProjectMode,
  replaceTerrainPolygon,
  terrain,
  toolMode,
  updateElevationGrid,
  updateTerrainPolygon,
  viewMode,
  visibleTerrainGeometryRef,
}: UseTerrainInteractionParams) {
  const { camera, gl, raycaster } = useThree();
  const [draggedNodeIndex, setDraggedNodeIndex] = useState<number | null>(null);
  const [hoverElevation, setHoverElevation] = useState<{ x: number; y: number; z: number } | null>(null);
  const [isBrushActive, setIsBrushActive] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  const workingElevationGridRef = useRef<Float32Array>(terrain.elevationGrid.slice());
  const dragStartPolygonRef = useRef<TerrainPoint[] | null>(null);
  const isBrushing = useRef(false);
  const brushDirection = useRef(1);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerNdcRef = useRef(new THREE.Vector2());
  const pointerIntersectionRef = useRef(new THREE.Vector3());

  useEffect(() => {
    workingElevationGridRef.current = terrain.elevationGrid.slice();
  }, [terrain.elevationGrid]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(false);
      }
    };

    const handleBlur = () => {
      setIsShiftPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    const finishPointerInteraction = () => {
      if (draggedNodeIndex !== null) {
        const dragStartPolygon = dragStartPolygonRef.current;

        if (dragStartPolygon && !polygonsAreEqual(dragStartPolygon, terrain.polygon)) {
          commitTerrainPolygonHistory(dragStartPolygon);
        }

        dragStartPolygonRef.current = null;
        setDraggedNodeIndex(null);
      }

      if (isBrushing.current) {
        isBrushing.current = false;
        setIsBrushActive(false);
        updateElevationGrid(workingElevationGridRef.current.slice());
      }
    };

    window.addEventListener('pointerup', finishPointerInteraction);
    window.addEventListener('pointercancel', finishPointerInteraction);
    window.addEventListener('blur', finishPointerInteraction);

    return () => {
      window.removeEventListener('pointerup', finishPointerInteraction);
      window.removeEventListener('pointercancel', finishPointerInteraction);
      window.removeEventListener('blur', finishPointerInteraction);
    };
  }, [commitTerrainPolygonHistory, draggedNodeIndex, terrain.polygon, updateElevationGrid]);

  function applyBrush(point: THREE.Vector3, direction: number): void {
    const center = worldToGrid(point.x, point.z, terrain);
    const radiusInCells = Math.ceil(brushSize / terrain.cellSize);
    const nextGrid = workingElevationGridRef.current.slice();
    const liveGeometry = visibleTerrainGeometryRef.current;
    const positionAttribute = liveGeometry
      ? (liveGeometry.geometry.attributes.position as THREE.BufferAttribute)
      : null;
    const intensity = 0.6 * direction;

    for (
      let gridY = Math.max(0, center.y - radiusInCells);
      gridY <= Math.min(terrain.gridHeight - 1, center.y + radiusInCells);
      gridY += 1
    ) {
      for (
        let gridX = Math.max(0, center.x - radiusInCells);
        gridX <= Math.min(terrain.gridWidth - 1, center.x + radiusInCells);
        gridX += 1
      ) {
        const world = gridToWorld(gridX, gridY, terrain);
        const distance = Math.hypot(world.x - point.x, world.y - point.z);

        if (
          distance > brushSize ||
          !isPointWithinBufferedPolygon(world, terrain.polygon, TERRAIN_RENDER_BUFFER_METERS)
        ) {
          continue;
        }

        const falloff = (Math.cos((distance / brushSize) * Math.PI) + 1) / 2;
        const index = gridY * terrain.gridWidth + gridX;
        nextGrid[index] += intensity * falloff;

        if (liveGeometry && positionAttribute) {
          const vertexIndex = liveGeometry.sourceIndexToVertex.get(index);

          if (vertexIndex !== undefined) {
            positionAttribute.setZ(vertexIndex, nextGrid[index]);
          }
        }
      }
    }

    if (liveGeometry && positionAttribute) {
      finalizeGeometryUpdate(liveGeometry.geometry);
    }

    workingElevationGridRef.current = nextGrid;
  }

  function handlePlanePointerDown(event: PointerSceneEvent): void {
    if (isProjectMode) {
      return;
    }

    event.stopPropagation();

    if (toolMode === 'draw') {
      const nextPolygon = [
        ...terrain.polygon,
        {
          x: Number(event.point.x.toFixed(2)),
          y: Number(event.point.z.toFixed(2)),
        },
      ];

      updateTerrainPolygon(nextPolygon);
      return;
    }

    if (toolMode === 'elevation') {
      isBrushing.current = true;
      setIsBrushActive(true);
      brushDirection.current = event.button === 2 ? -1 : 1;
      applyBrush(event.point, brushDirection.current);
    }
  }

  function handlePlanePointerMove(event: PointerSceneEvent): void {
    if (isProjectMode) {
      return;
    }

    if (toolMode === 'select' && draggedNodeIndex !== null) {
      event.stopPropagation();

      const nextPolygon = [...terrain.polygon];
      nextPolygon[draggedNodeIndex] = {
        x: Number(event.point.x.toFixed(2)),
        y: Number(event.point.z.toFixed(2)),
      };

      replaceTerrainPolygon(nextPolygon);
      return;
    }

    if (toolMode === 'elevation') {
      event.stopPropagation();
      const sampledHeight = getElevationAtWorld(
        event.point.x,
        event.point.z,
        terrain,
        workingElevationGridRef.current,
      );

      setHoverElevation({
        x: event.point.x,
        y: event.point.z,
        z: sampledHeight,
      });

      if (isBrushing.current && viewMode === '2D') {
        applyBrush(event.point, brushDirection.current);
      }

      return;
    }

    if (hoverElevation) {
      setHoverElevation(null);
    }
  }

  function handlePlanePointerUp(): void {
    if (isProjectMode) {
      return;
    }

    if (draggedNodeIndex !== null) {
      setDraggedNodeIndex(null);
    }

    if (isBrushing.current && toolMode === 'elevation') {
      isBrushing.current = false;
      setIsBrushActive(false);
      updateElevationGrid(workingElevationGridRef.current.slice());
    }
  }

  function handleNodePointerDown(event: PointerSceneEvent, index: number): void {
    if (isProjectMode) {
      return;
    }

    event.stopPropagation();

    if (toolMode === 'select') {
      dragStartPolygonRef.current = terrain.polygon.map((point) => ({ ...point }));
      setDraggedNodeIndex(index);
    }
  }

  const handleGlobalBrushMove = useEffectEvent((event: PointerEvent) => {
    if (!isBrushing.current) {
      return;
    }

    const rect = gl.domElement.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    pointerNdcRef.current.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(pointerNdcRef.current, camera);

    const hitPoint = raycaster.ray.intersectPlane(groundPlane, pointerIntersectionRef.current);

    if (!hitPoint) {
      return;
    }

    const sampledHeight = getElevationAtWorld(
      hitPoint.x,
      hitPoint.z,
      terrain,
      workingElevationGridRef.current,
    );

    setHoverElevation({
      x: hitPoint.x,
      y: hitPoint.z,
      z: sampledHeight,
    });
    applyBrush(hitPoint, brushDirection.current);
  });

  const handleGlobalVertexDragMove = useEffectEvent((event: PointerEvent) => {
    if (draggedNodeIndex === null || isProjectMode || toolMode !== 'select') {
      return;
    }

    const rect = gl.domElement.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    pointerNdcRef.current.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(pointerNdcRef.current, camera);

    const hitPoint = raycaster.ray.intersectPlane(groundPlane, pointerIntersectionRef.current);

    if (!hitPoint) {
      return;
    }

    const nextPolygon = [...terrain.polygon];
    nextPolygon[draggedNodeIndex] = {
      x: Number(hitPoint.x.toFixed(2)),
      y: Number(hitPoint.z.toFixed(2)),
    };

    replaceTerrainPolygon(nextPolygon);
  });

  useEffect(() => {
    if (isProjectMode || viewMode !== '3D' || toolMode !== 'elevation') {
      return undefined;
    }

    window.addEventListener('pointermove', handleGlobalBrushMove);

    return () => {
      window.removeEventListener('pointermove', handleGlobalBrushMove);
    };
  }, [isProjectMode, toolMode, viewMode]);

  useEffect(() => {
    if (isProjectMode || toolMode !== 'select' || draggedNodeIndex === null) {
      return undefined;
    }

    window.addEventListener('pointermove', handleGlobalVertexDragMove);

    return () => {
      window.removeEventListener('pointermove', handleGlobalVertexDragMove);
    };
  }, [draggedNodeIndex, isProjectMode, toolMode]);

  return {
    draggedNodeIndex,
    handleNodePointerDown,
    handlePlanePointerDown,
    handlePlanePointerMove,
    handlePlanePointerUp,
    hoverElevation,
    isBrushActive,
    isShiftPressed,
    setHoverElevation,
    workingElevationGridRef,
  };
}
