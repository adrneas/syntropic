import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber';
import {
  Grid,
  Html,
  Line,
  MapControls,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import * as THREE from 'three';
import {
  getGuideVisualToken,
  getInfrastructureCategoryToken,
  getPlantVisualSubtitle,
  getProjectVisualToken,
  getStratumVisualToken,
  type ProjectVisualTokenId,
  withAlpha,
} from '../components/project/projectVisualTokens';
import { useWizardStore } from '../store/wizardStore';
import {
  clamp,
  getGridIndex,
  getPolygonBounds,
  getTerrainWorldSize,
  gridToWorld,
  isPointWithinBufferedPolygon,
  sampleElevation,
  worldToGrid,
} from '../core/utils/terrain';
import type { TerrainGridConfig, TerrainPoint } from '../core/types/terrain';
import type {
  BotanicalPlacement,
  InfrastructurePlacement,
  LayoutGuide,
  ResidencePlacement,
  SolarPlacement,
} from '../core/types/generation';

type PointerSceneEvent = ThreeEvent<PointerEvent>;

const TERRAIN_RENDER_BUFFER_METERS = 5;

interface EdgeMeasurement {
  distance: string;
  midX: number;
  midZ: number;
}

interface RenderTerrainGeometry {
  geometry: THREE.BufferGeometry;
  sourceIndices: Int32Array;
  sourceIndexToVertex: Map<number, number>;
}

interface VertexAngleVisualization {
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

interface ProjectHoverLabel {
  id: string;
  position: [number, number, number];
  subtitle: string;
  title: string;
  visualTokenId: ProjectVisualTokenId;
}

interface SceneProps {
  mode?: 'editor' | 'project';
  onSelectEntity?: (entity: ProjectInspectionEntity | null) => void;
  selectedEntityId?: string | null;
}

const TerrainContent = ({ mode = 'editor', onSelectEntity, selectedEntityId }: SceneProps) => {
  const {
    brushSize,
    commitTerrainPolygonHistory,
    generatedProject,
    replaceTerrainPolygon,
    terrain,
    toolMode,
    updateElevationGrid,
    updateTerrainPolygon,
    viewMode,
  } = useWizardStore();
  const { camera, gl, raycaster } = useThree();
  const isProjectMode = mode === 'project';
  const terrainGridConfig = useMemo(
    () => ({
      cellSize: terrain.cellSize,
      gridHeight: terrain.gridHeight,
      gridWidth: terrain.gridWidth,
    }),
    [terrain.cellSize, terrain.gridHeight, terrain.gridWidth],
  );
  const hasValidTerrainPolygon = terrain.polygon.length >= 3 && terrain.area > 0;
  const shouldRenderTerrainMesh =
    hasValidTerrainPolygon && (isProjectMode || viewMode === '3D' || toolMode === 'elevation');
  const [draggedNodeIndex, setDraggedNodeIndex] = useState<number | null>(null);
  const [hoverElevation, setHoverElevation] = useState<{ x: number; y: number; z: number } | null>(null);
  const [hoveredProjectLabel, setHoveredProjectLabel] = useState<ProjectHoverLabel | null>(null);
  const [isBrushActive, setIsBrushActive] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const interactionPlaneGeometry = useMemo(() => createInteractionPlaneGeometry(terrainGridConfig), [terrainGridConfig]);
  const visibleTerrainGeometry = useMemo(
    () =>
      hasValidTerrainPolygon
        ? createVisibleTerrainGeometry(terrainGridConfig, terrain.polygon, TERRAIN_RENDER_BUFFER_METERS)
        : null,
    [hasValidTerrainPolygon, terrain.polygon, terrainGridConfig],
  );
  const visibleTerrainGeometryRef = useRef<RenderTerrainGeometry | null>(visibleTerrainGeometry);
  const workingElevationGridRef = useRef<Float32Array>(terrain.elevationGrid.slice());
  const dragStartPolygonRef = useRef<TerrainPoint[] | null>(null);
  const isBrushing = useRef(false);
  const brushDirection = useRef(1);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const pointerNdcRef = useRef(new THREE.Vector2());
  const pointerIntersectionRef = useRef(new THREE.Vector3());
  const terrainUniforms = useRef({
    uViewMode2D: { value: 0 },
  });
  const placedInfrastructure = useMemo(
    () =>
      generatedProject?.report.infrastructure.placements.filter(
        (placement): placement is InfrastructurePlacement & {
          category: NonNullable<InfrastructurePlacement['category']>;
          footprint: NonNullable<InfrastructurePlacement['footprint']>;
          worldPosition: NonNullable<InfrastructurePlacement['worldPosition']>;
        } =>
          placement.status === 'placed' &&
          Boolean(placement.category) &&
          Boolean(placement.footprint) &&
          Boolean(placement.worldPosition),
      ) ?? [],
    [generatedProject],
  );
  const groundSolarPlacement = generatedProject?.groundSolarPlacement ?? null;
  const interRows = generatedProject?.interRows ?? [];
  const keylines = generatedProject?.keylines ?? [];
  const plants = generatedProject?.plants ?? [];
  const plantingRows = generatedProject?.plantingRows ?? [];
  const serviceCorridors = generatedProject?.serviceCorridors ?? [];
  const hoveredProjectToken = hoveredProjectLabel
    ? getProjectVisualToken(hoveredProjectLabel.visualTokenId)
    : null;
  const keylineVisualToken = getGuideVisualToken('KEYLINE');
  const plantingRowVisualToken = getGuideVisualToken('PLANTING_ROW');
  const interRowVisualToken = getGuideVisualToken('INTERROW');
  const serviceCorridorVisualToken = getGuideVisualToken('SERVICE_CORRIDOR');

  const setProjectHoverLabel = (hoverLabel: ProjectHoverLabel | null) => {
    setHoveredProjectLabel(hoverLabel);
  };

  const clearProjectHoverLabel = (hoverId: string) => {
    setHoveredProjectLabel((current) => (current?.id === hoverId ? null : current));
  };

  const maxElevation = useMemo(() => {
    let maximum = 0;

    for (const height of terrain.elevationGrid) {
      maximum = Math.max(maximum, height);
    }

    return maximum;
  }, [terrain.elevationGrid]);

  useEffect(() => {
    terrainUniforms.current.uViewMode2D.value = viewMode === '2D' ? 1 : 0;
  }, [viewMode]);

  useEffect(() => {
    return () => {
      interactionPlaneGeometry.dispose();
    };
  }, [interactionPlaneGeometry]);

  useEffect(() => {
    visibleTerrainGeometryRef.current = visibleTerrainGeometry;

    return () => {
      visibleTerrainGeometry?.geometry.dispose();
    };
  }, [visibleTerrainGeometry]);

  useEffect(() => {
    workingElevationGridRef.current = terrain.elevationGrid.slice();

    if (visibleTerrainGeometry) {
      syncGeometryFromGrid(visibleTerrainGeometry, terrain.elevationGrid);
    }
  }, [terrain.elevationGrid, visibleTerrainGeometry]);

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

  const labels = useMemo(() => {
    const result: Array<{ label: string; x: number; y: number; z: number }> = [];

    if (!shouldRenderTerrainMesh || terrain.elevationGrid.length === 0) {
      return result;
    }

    const columns = [
      Math.floor(terrain.gridWidth / 4),
      Math.floor(terrain.gridWidth / 2),
      Math.floor((terrain.gridWidth * 3) / 4),
    ];

    columns.forEach((column) => {
      for (let row = 0; row < terrain.gridHeight; row += 8) {
        const world = gridToWorld(column, row, terrainGridConfig);

        if (!isPointWithinBufferedPolygon(world, terrain.polygon, TERRAIN_RENDER_BUFFER_METERS)) {
          continue;
        }

        const index = row * terrain.gridWidth + column;
        const height = terrain.elevationGrid[index] ?? 0;

        if (height <= 0.5 || Math.abs(height % 10) > 0.3) {
          continue;
        }

        result.push({
          label: `${Math.round(height / 10) * 10}m`,
          x: world.x,
          y: height,
          z: world.y,
        });
        row += 18;
      }
    });

    return result;
  }, [shouldRenderTerrainMesh, terrain.elevationGrid, terrain.gridHeight, terrain.gridWidth, terrain.polygon, terrainGridConfig]);

  const terrainBoundaryPoints = useMemo(
    () => buildTerrainBoundaryPoints(terrain.polygon, terrain, terrain.elevationGrid, 0.18),
    [terrain],
  );

  const edges: EdgeMeasurement[] = [];

  if (terrain.polygon.length > 1) {
    for (let index = 0; index < terrain.polygon.length; index += 1) {
      const point = terrain.polygon[index];
      const nextIndex = index + 1 < terrain.polygon.length ? index + 1 : terrain.polygon.length > 2 ? 0 : -1;

      if (nextIndex === -1) {
        continue;
      }

      const nextPoint = terrain.polygon[nextIndex];
      edges.push({
        distance: Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y).toFixed(1),
        midX: (point.x + nextPoint.x) / 2,
        midZ: (point.y + nextPoint.y) / 2,
      });
    }
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

  function getInternalAngle(index: number): VertexAngleVisualization | null {
    if (terrain.polygon.length < 3) {
      return null;
    }

    const previous = terrain.polygon[index === 0 ? terrain.polygon.length - 1 : index - 1];
    const current = terrain.polygon[index];
    const next = terrain.polygon[(index + 1) % terrain.polygon.length];
    const previousVector = new THREE.Vector2(previous.x - current.x, previous.y - current.y);
    const nextVector = new THREE.Vector2(next.x - current.x, next.y - current.y);

    if (previousVector.lengthSq() <= Number.EPSILON || nextVector.lengthSq() <= Number.EPSILON) {
      return null;
    }

    previousVector.normalize();
    nextVector.normalize();

    const polygonWinding = getPolygonWinding(terrain.polygon);
    const unsignedAngle = previousVector.angleTo(nextVector);
    const cross = previousVector.x * nextVector.y - previousVector.y * nextVector.x;
    const isConvex = cross * polygonWinding < 0;
    const interiorAngle = isConvex ? unsignedAngle : Math.PI * 2 - unsignedAngle;
    const startAngle = Math.atan2(previousVector.y, previousVector.x);
    const sweepDirection = polygonWinding > 0 ? -1 : 1;
    const edgeRadius = Math.min(
      Math.hypot(previous.x - current.x, previous.y - current.y),
      Math.hypot(next.x - current.x, next.y - current.y),
    );
    const arcRadius = clamp(edgeRadius * 0.22, 1.1, 4.2);
    const bisectorAngle = startAngle + sweepDirection * (interiorAngle / 2);

    return {
      angleDegrees: Math.round((interiorAngle * 180) / Math.PI),
      arcPoints: buildAngleArcPoints(current, startAngle, interiorAngle, sweepDirection, arcRadius),
      bisectorPoint: new THREE.Vector3(
        current.x + Math.cos(bisectorAngle) * (arcRadius + 0.65),
        0.03,
        current.y + Math.sin(bisectorAngle) * (arcRadius + 0.65),
      ),
    };
  }

  const terrainWorldSize = getTerrainWorldSize(terrainGridConfig);
  const interactionPlaneHeight = maxElevation + 5;

  return (
    <>
      <ambientLight intensity={0.5} />

      {viewMode === '2D' ? (
        <>
          <OrthographicCamera makeDefault position={[0, Math.max(100, interactionPlaneHeight + 20), 0]} zoom={12} near={0.1} far={1000} />
          <MapControls makeDefault enableRotate={false} enabled={draggedNodeIndex === null && !isBrushActive} />
        </>
      ) : (
        <>
          <PerspectiveCamera makeDefault position={[0, 60, 90]} fov={45} />
          <OrbitControls
            makeDefault
            enabled={draggedNodeIndex === null && (isProjectMode || toolMode !== 'elevation') && !isBrushActive}
            minPolarAngle={0}
            maxDistance={220}
            maxPolarAngle={Math.PI / 2.05}
          />
        </>
      )}

      {viewMode === '2D' && (
        <Grid
          args={[terrainWorldSize.width * 2, terrainWorldSize.height * 2]}
          cellColor="#e9e9e9"
          cellSize={1}
          cellThickness={1}
          fadeDistance={260}
          position={[0, -0.01, 0]}
          sectionColor="#dfdfdf"
          sectionSize={10}
          sectionThickness={1}
        />
      )}

      {viewMode === '2D' && !isProjectMode && toolMode !== 'select' && (
        <mesh
          onPointerDown={handlePlanePointerDown}
          onPointerMove={handlePlanePointerMove}
          onPointerOut={() => setHoverElevation(null)}
          onPointerUp={handlePlanePointerUp}
          position={[0, interactionPlaneHeight, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <primitive object={interactionPlaneGeometry} attach="geometry" />
          <meshBasicMaterial color="#ffffff" depthWrite={false} opacity={0} transparent />
        </mesh>
      )}

      {shouldRenderTerrainMesh && visibleTerrainGeometry && (
        <mesh
          castShadow
          onPointerDown={viewMode === '3D' ? handlePlanePointerDown : undefined}
          onPointerMove={viewMode === '3D' ? handlePlanePointerMove : undefined}
          onPointerOut={viewMode === '3D' ? () => setHoverElevation(null) : undefined}
          onPointerUp={viewMode === '3D' ? handlePlanePointerUp : undefined}
          position={[0, -0.02, 0]}
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <primitive object={visibleTerrainGeometry.geometry} attach="geometry" />
          <meshStandardMaterial
            color="#ffffff"
            metalness={0.1}
            onBeforeCompile={(shader) => {
              shader.uniforms.uViewMode2D = terrainUniforms.current.uViewMode2D;
              shader.vertexShader = `varying float vHeight;\nvarying vec3 vNormalAlt;\n${shader.vertexShader}`.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\nvHeight = position.z;\nvNormalAlt = normal;',
              );
              shader.fragmentShader = `varying float vHeight;\nvarying vec3 vNormalAlt;\nuniform float uViewMode2D;\n${shader.fragmentShader}`.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>\n
                 float h = vHeight;
                 float fw = fwidth(h);
                 float primary = mod(h + 0.05, 10.0);
                 float secondary = mod(h + 0.05, 2.0);
                 float primaryLine = smoothstep(fw * 1.5, 0.0, abs(primary)) + smoothstep(fw * 1.5, 0.0, abs(10.0 - primary));
                 float secondaryLine = (smoothstep(fw * 0.8, 0.0, abs(secondary)) + smoothstep(fw * 0.8, 0.0, abs(2.0 - secondary))) * 0.5;
                 if (uViewMode2D > 0.5) {
                   float lineAlpha = clamp(primaryLine + secondaryLine, 0.0, 1.0);
                   vec3 lineColor = mix(vec3(0.5, 0.5, 0.5), vec3(0.1, 0.1, 0.1), primaryLine);
                   gl_FragColor.rgb = lineColor;
                   gl_FragColor.a = lineAlpha;
                 } else {
                   gl_FragColor.a = 1.0;
                   gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0), primaryLine * 0.2);
                   gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0), secondaryLine * 0.05);
                 }`,
              );
            }}
            roughness={0.8}
            transparent
            vertexColors={viewMode === '3D'}
          />
        </mesh>
      )}

      {viewMode === '3D' && visibleTerrainGeometry && (
        <mesh position={[0, -0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <primitive object={visibleTerrainGeometry.geometry} attach="geometry" />
          <meshBasicMaterial color="#000000" opacity={0.05} transparent wireframe />
        </mesh>
      )}

      {isProjectMode && generatedProject && (
        <>
          <ResidenceMesh
            isSelected={selectedEntityId === 'residence'}
            onHoverChange={setProjectHoverLabel}
            onSelect={() => onSelectEntity?.(buildResidenceInspectionEntity(generatedProject.residence))}
            residence={generatedProject.residence}
          />

          {generatedProject.residence.roofSolarAreaUsed > 0 && (
            <RoofSolarMesh
              isSelected={selectedEntityId === 'solar-roof'}
              onHoverChange={setProjectHoverLabel}
              onSelect={() => onSelectEntity?.(buildRoofSolarInspectionEntity(generatedProject.residence))}
              residence={generatedProject.residence}
            />
          )}

          {groundSolarPlacement && (
            <GroundSolarMesh
              isSelected={selectedEntityId === 'solar-ground'}
              onHoverChange={setProjectHoverLabel}
              onSelect={() =>
                onSelectEntity?.(
                  buildGroundSolarInspectionEntity(
                    groundSolarPlacement,
                    generatedProject.residence,
                  ),
                )
              }
              solar={groundSolarPlacement}
            />
          )}

          {placedInfrastructure.map((placement) => (
            <InfrastructureMesh
              isSelected={selectedEntityId === `infra-${placement.infrastructureId}`}
              key={placement.infrastructureId}
              onHoverChange={setProjectHoverLabel}
              onSelect={() => onSelectEntity?.(buildInfrastructureInspectionEntity(placement))}
              placement={placement}
            />
          ))}

          {plants.map((plant) => (
            <PlantMesh
              isSelected={selectedEntityId === plant.id}
              key={plant.id}
              onHoverChange={setProjectHoverLabel}
              onSelect={() => onSelectEntity?.(buildPlantInspectionEntity(plant))}
              plant={plant}
            />
          ))}

          {keylines.map((guide) => (
            <Line
              color={keylineVisualToken.color}
              key={guide.id}
              lineWidth={2.2}
              onPointerOut={() => clearProjectHoverLabel(guide.id)}
              onPointerOver={(event) => {
                event.stopPropagation();
                setProjectHoverLabel(buildGuideHoverLabel(guide, 0.42));
              }}
              opacity={0.95}
              points={toLinePoints(guide, 0.18)}
              transparent
            />
          ))}

          {plantingRows.map((guide) => (
            <Line
              color={plantingRowVisualToken.color}
              key={guide.id}
              lineWidth={1.4}
              onPointerOut={() => clearProjectHoverLabel(guide.id)}
              onPointerOver={(event) => {
                event.stopPropagation();
                setProjectHoverLabel(buildGuideHoverLabel(guide, 0.34));
              }}
              opacity={0.85}
              points={toLinePoints(guide, 0.12)}
              transparent
            />
          ))}

          {interRows.map((guide) => (
            <Line
              color={interRowVisualToken.color}
              key={guide.id}
              lineWidth={1.1}
              onPointerOut={() => clearProjectHoverLabel(guide.id)}
              onPointerOver={(event) => {
                event.stopPropagation();
                setProjectHoverLabel(buildGuideHoverLabel(guide, 0.3));
              }}
              opacity={0.7}
              points={toLinePoints(guide, 0.1)}
              transparent
            />
          ))}

          {serviceCorridors.map((guide) => (
            <Line
              color={serviceCorridorVisualToken.color}
              key={guide.id}
              lineWidth={1.8}
              onPointerOut={() => clearProjectHoverLabel(guide.id)}
              onPointerOver={(event) => {
                event.stopPropagation();
                setProjectHoverLabel(buildGuideHoverLabel(guide, 0.38));
              }}
              opacity={0.9}
              points={toLinePoints(guide, 0.16)}
              transparent
            />
          ))}
        </>
      )}

      {isProjectMode && hoveredProjectLabel && hoveredProjectToken && (
        <Html
          center
          position={hoveredProjectLabel.position}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[120, 0]}
        >
          <div className="pointer-events-none min-w-[160px] rounded-[10px] border border-neutral-200/80 bg-white/95 px-2.5 py-2 shadow-md backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-7 min-w-7 items-center justify-center rounded-[5px] border bg-white px-1"
                style={{
                  backgroundColor: withAlpha(hoveredProjectToken.color, '16'),
                  borderColor: withAlpha(hoveredProjectToken.color, '36'),
                  color: hoveredProjectToken.color,
                }}
              >
                <hoveredProjectToken.icon size={14} strokeWidth={2.2} />
              </span>

              <div className="flex flex-col">
                <span className="text-[10px] font-semibold text-neutral-800">
                  {hoveredProjectLabel.title}
                </span>
                <span
                  className="text-[9px] uppercase tracking-wide"
                  style={{ color: hoveredProjectToken.color }}
                >
                  {hoveredProjectLabel.subtitle}
                </span>
              </div>
            </div>
          </div>
        </Html>
      )}

      {labels.map((label) => (
        <Html
          key={`${label.label}-${label.x}-${label.z}`}
          center
          position={[label.x, label.y + 0.2, label.z]}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[50, 0]}
        >
          <div className="pointer-events-none rounded-[2px] border border-neutral-100/50 bg-white/60 px-1 text-[7px] font-mono text-neutral-400 shadow-sm backdrop-blur-[2px]">
            {label.label}
          </div>
        </Html>
      ))}

      {toolMode === 'elevation' && hoverElevation && (
        <group position={[hoverElevation.x, hoverElevation.z + 1.5, hoverElevation.y]}>
          <Html center style={{ pointerEvents: 'none' }}>
            <div className="pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full bg-figma-blue bg-opacity-90 px-2 py-1 text-[10px] font-bold text-white shadow-lg backdrop-blur-md">
              <span className="text-[8px] uppercase tracking-wider opacity-70">Alt:</span>
              <span>{hoverElevation.z.toFixed(2)}m</span>
            </div>
          </Html>
          <mesh position={[0, -1.45, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[brushSize * 0.99, brushSize, 64]} />
            <meshBasicMaterial color="#18a0fb" opacity={0.3} transparent />
          </mesh>
        </group>
      )}

      <directionalLight
        castShadow
        intensity={1.5}
        position={[100, 150, 50]}
        shadow-camera-bottom={-150}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
      />

      {terrainBoundaryPoints.length > 1 && (
        <Line
          color={isProjectMode ? '#1d4ed8' : '#18a0fb'}
          depthTest={viewMode !== '2D'}
          depthWrite={false}
          lineWidth={viewMode === '2D' ? 3.4 : 2.4}
          opacity={isProjectMode ? 0.95 : 1}
          points={terrainBoundaryPoints}
          renderOrder={viewMode === '2D' ? 1200 : 40}
          transparent={isProjectMode}
        />
      )}

      {!isProjectMode && edges.map((edge) => (
        <Html
          key={`${edge.midX}-${edge.midZ}-${edge.distance}`}
          center
          position={[edge.midX, 0.05, edge.midZ]}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div className="pointer-events-none whitespace-nowrap rounded-[3px] border border-figma-border bg-white/90 px-1.5 py-0.5 text-[9px] font-medium text-figma-blue shadow-sm backdrop-blur-sm">
            {edge.distance}m
          </div>
        </Html>
      ))}

      {!isProjectMode && terrain.polygon.map((point, index) => {
        const angle = getInternalAngle(index);

        return (
          <group key={`${point.x}-${point.y}-${index}`} position={[point.x, 0.03, point.y]}>
            <mesh
              onPointerDown={(event) => handleNodePointerDown(event, index)}
              onPointerMove={handlePlanePointerMove}
              onPointerUp={handlePlanePointerUp}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[0.4, 32]} />
              <meshBasicMaterial color={draggedNodeIndex === index ? '#f24822' : 'white'} />
            </mesh>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.3, 32]} />
              <meshBasicMaterial color={draggedNodeIndex === index ? '#f24822' : '#18a0fb'} />
            </mesh>
            {angle !== null && toolMode === 'select' && isShiftPressed && (
              <>
                <Line color="#2563eb" lineWidth={1.8} opacity={0.95} points={angle.arcPoints} transparent />
                <Html center position={angle.bisectorPoint} style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
                  <div className="pointer-events-none whitespace-nowrap rounded-[2px] bg-white/85 px-1 py-0.5 text-[8px] font-mono text-neutral-600 shadow-sm backdrop-blur-sm">
                    {angle.angleDegrees}&deg;
                  </div>
                </Html>
              </>
            )}
          </group>
        );
      })}
    </>
  );
};

export const Scene = ({ mode = 'editor', onSelectEntity, selectedEntityId }: SceneProps) => (
  <Canvas
    onContextMenu={(event) => event.preventDefault()}
    onPointerMissed={() => onSelectEntity?.(null)}
    style={{ width: '100%', height: '100%', background: '#fafafa' }}
  >
    <TerrainContent mode={mode} onSelectEntity={onSelectEntity} selectedEntityId={selectedEntityId} />
  </Canvas>
);

interface ResidenceMeshProps {
  residence: ResidencePlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

const ResidenceMesh = ({ residence, isSelected, onHoverChange, onSelect }: ResidenceMeshProps) => (
  <mesh
    castShadow
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    onPointerOut={() => onHoverChange(null)}
    onPointerOver={(event) => {
      event.stopPropagation();
      onHoverChange({
        id: 'residence',
        position: [residence.worldPosition.x, residence.worldPosition.z + 2.45, residence.worldPosition.y],
        subtitle: 'Estrutura base do sistema',
        title: 'Residencia principal',
        visualTokenId: 'residence',
      });
    }}
    position={[residence.worldPosition.x, residence.worldPosition.z + 1.05, residence.worldPosition.y]}
    rotation={[0, residence.rotationRadians, 0]}
    receiveShadow
  >
    <boxGeometry args={[residence.footprint.width, 2.1, residence.footprint.length]} />
    <meshStandardMaterial
      color={isSelected ? '#274c77' : getProjectVisualToken('residence').color}
      roughness={0.7}
    />
  </mesh>
);

interface RoofSolarMeshProps {
  residence: ResidencePlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

const RoofSolarMesh = ({ residence, isSelected, onHoverChange, onSelect }: RoofSolarMeshProps) => (
  <mesh
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    onPointerOut={() => onHoverChange(null)}
    onPointerOver={(event) => {
      event.stopPropagation();
      onHoverChange({
        id: 'solar-roof',
        position: [residence.worldPosition.x, residence.worldPosition.z + 2.75, residence.worldPosition.y],
        subtitle: 'Energia integrada a cobertura',
        title: 'Painel solar integrado',
        visualTokenId: 'solar-roof',
      });
    }}
    position={[residence.worldPosition.x, residence.worldPosition.z + 2.12, residence.worldPosition.y]}
    rotation={[-Math.PI / 2, residence.rotationRadians, 0]}
  >
    <planeGeometry args={[residence.footprint.width * 0.84, residence.footprint.length * 0.84]} />
    <meshStandardMaterial
      color={isSelected ? '#4fd1ff' : getProjectVisualToken('solar-roof').color}
      metalness={0.25}
      roughness={0.35}
    />
  </mesh>
);

interface GroundSolarMeshProps {
  solar: SolarPlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

const GroundSolarMesh = ({ solar, isSelected, onHoverChange, onSelect }: GroundSolarMeshProps) => (
  <mesh
    castShadow
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    onPointerOut={() => onHoverChange(null)}
    onPointerOver={(event) => {
      event.stopPropagation();
      onHoverChange({
        id: 'solar-ground',
        position: [solar.worldPosition.x, solar.worldPosition.z + 1.05, solar.worldPosition.y],
        subtitle: 'Energia complementar no terreno',
        title: 'Array solar em solo',
        visualTokenId: 'solar-ground',
      });
    }}
    position={[solar.worldPosition.x, solar.worldPosition.z + 0.18, solar.worldPosition.y]}
    rotation={[0, solar.rotationRadians, 0]}
    receiveShadow
  >
    <boxGeometry args={[solar.footprint.width, 0.36, solar.footprint.length]} />
    <meshStandardMaterial
      color={isSelected ? '#4fd1ff' : getProjectVisualToken('solar-ground').color}
      metalness={0.3}
      roughness={0.4}
    />
  </mesh>
);

interface InfrastructureMeshProps {
  placement: InfrastructurePlacement & {
    category: NonNullable<InfrastructurePlacement['category']>;
    footprint: NonNullable<InfrastructurePlacement['footprint']>;
    worldPosition: NonNullable<InfrastructurePlacement['worldPosition']>;
  };
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

const InfrastructureMesh = ({ placement, isSelected, onHoverChange, onSelect }: InfrastructureMeshProps) => {
  const color = getInfrastructureColor(placement.category, isSelected);
  const height = getInfrastructureHeight(placement.category);

  return (
    <mesh
      castShadow
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOut={() => onHoverChange(null)}
      onPointerOver={(event) => {
        event.stopPropagation();
        const token = getInfrastructureCategoryToken(placement.category);
        onHoverChange({
          id: `infra-${placement.infrastructureId}`,
          position: [placement.worldPosition.x, placement.worldPosition.z + height + 0.7, placement.worldPosition.y],
          subtitle: token.label,
          title: placement.name,
          visualTokenId: token.id,
        });
      }}
      position={[placement.worldPosition.x, placement.worldPosition.z + height / 2, placement.worldPosition.y]}
      receiveShadow
    >
      <boxGeometry args={[placement.footprint.width, height, placement.footprint.length]} />
      <meshStandardMaterial color={color} roughness={0.65} />
    </mesh>
  );
};

interface PlantMeshProps {
  plant: BotanicalPlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

const PlantMesh = ({ plant, isSelected, onHoverChange, onSelect }: PlantMeshProps) => {
  const radius = getPlantVisualRadius(plant);

  return (
    <mesh
      castShadow
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOut={() => onHoverChange(null)}
      onPointerOver={(event) => {
        event.stopPropagation();
        const token = getStratumVisualToken(plant.stratum);
        onHoverChange({
          id: plant.id,
          position: [plant.worldPosition.x, plant.worldPosition.z + radius * 2.3, plant.worldPosition.y],
          subtitle: getPlantVisualSubtitle(plant.stratum, plant.managementZone),
          title: plant.popularName,
          visualTokenId: token.id,
        });
      }}
      position={[plant.worldPosition.x, plant.worldPosition.z + radius, plant.worldPosition.y]}
      receiveShadow
    >
      <sphereGeometry args={[radius, 12, 12]} />
      <meshStandardMaterial
        color={getStratumColor(plant.stratum, isSelected, plant.managementZone)}
        roughness={0.8}
      />
    </mesh>
  );
};

function createInteractionPlaneGeometry(terrain: TerrainGridConfig): THREE.PlaneGeometry {
  const size = getTerrainWorldSize(terrain);

  return new THREE.PlaneGeometry(size.width, size.height);
}

function createVisibleTerrainGeometry(
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

function syncGeometryFromGrid(renderGeometry: RenderTerrainGeometry, elevationGrid: Float32Array): void {
  const positionAttribute = renderGeometry.geometry.attributes.position as THREE.BufferAttribute;

  for (let index = 0; index < renderGeometry.sourceIndices.length; index += 1) {
    const sourceIndex = renderGeometry.sourceIndices[index];
    positionAttribute.setZ(index, elevationGrid[sourceIndex] ?? 0);
  }

  finalizeGeometryUpdate(renderGeometry.geometry);
}

function updateColors(geometry: THREE.BufferGeometry): void {
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

function finalizeGeometryUpdate(geometry: THREE.BufferGeometry): void {
  const positionAttribute = geometry.attributes.position as THREE.BufferAttribute;
  positionAttribute.needsUpdate = true;
  geometry.computeVertexNormals();
  updateColors(geometry);
}

function polygonsAreEqual(left: TerrainPoint[], right: TerrainPoint[]): boolean {
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

function buildAngleArcPoints(
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

function getPolygonWinding(polygon: TerrainPoint[]): number {
  let signedArea = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    signedArea += polygon[index].x * polygon[nextIndex].y - polygon[nextIndex].x * polygon[index].y;
  }

  return signedArea >= 0 ? 1 : -1;
}

function getElevationAtWorld(
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

function buildTerrainBoundaryPoints(
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

function toLinePoints(guide: LayoutGuide, yOffset: number): THREE.Vector3[] {
  return guide.points.map((point) => new THREE.Vector3(point.x, point.z + yOffset, point.y));
}

function buildGuideHoverLabel(guide: LayoutGuide, yOffset: number): ProjectHoverLabel {
  const token = getGuideVisualToken(guide.type);
  const position = getGuideMidpointPosition(guide, yOffset);

  return {
    id: guide.id,
    position,
    subtitle: `${Math.round(guide.length)}m de extensao`,
    title: token.label,
    visualTokenId: token.id,
  };
}

function getGuideMidpointPosition(guide: LayoutGuide, yOffset: number): [number, number, number] {
  if (guide.points.length === 0) {
    return [0, yOffset, 0];
  }

  if (guide.points.length === 1) {
    const point = guide.points[0];
    return [point.x, point.z + yOffset, point.y];
  }

  const totalLength =
    guide.length > Number.EPSILON
      ? guide.length
      : guide.points.reduce((sum, point, index) => {
          if (index === 0) {
            return sum;
          }

          const previous = guide.points[index - 1];
          return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
        }, 0);
  const midpointDistance = totalLength / 2;
  let traversed = 0;

  for (let index = 1; index < guide.points.length; index += 1) {
    const previous = guide.points[index - 1];
    const current = guide.points[index];
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);

    if (segmentLength <= Number.EPSILON) {
      continue;
    }

    if (traversed + segmentLength >= midpointDistance) {
      const factor = (midpointDistance - traversed) / segmentLength;
      const x = THREE.MathUtils.lerp(previous.x, current.x, factor);
      const y = THREE.MathUtils.lerp(previous.y, current.y, factor);
      const z = THREE.MathUtils.lerp(previous.z, current.z, factor);

      return [x, z + yOffset, y];
    }

    traversed += segmentLength;
  }

  const fallbackPoint = guide.points[Math.floor(guide.points.length / 2)];
  return [fallbackPoint.x, fallbackPoint.z + yOffset, fallbackPoint.y];
}

function buildResidenceInspectionEntity(residence: ResidencePlacement): ProjectInspectionEntity {
  return {
    id: 'residence',
    badge: getProjectVisualToken('residence').label,
    description:
      residence.requiredSolarArea > 0
        ? 'Residencia posicionada deterministicamente a partir do centroide e usada como base para o dimensionamento solar.'
        : 'Residencia posicionada deterministicamente a partir do centroide do poligono valido.',
    details: [
      { label: 'Pegada', value: `${residence.footprint.width}m x ${residence.footprint.length}m` },
      { label: 'Cota media', value: `${residence.elevation.toFixed(1)}m` },
      { label: 'Orientacao', value: `${Math.round((residence.rotationRadians * 180) / Math.PI)}deg` },
      { label: 'Solar requerido', value: `${residence.requiredSolarArea.toFixed(1)} m2` },
      { label: 'Solar no telhado', value: `${residence.roofSolarAreaUsed.toFixed(1)} / ${residence.roofSolarCapacityArea.toFixed(1)} m2` },
    ],
    title: 'Residencia Principal',
    visualTokenId: 'residence',
  };
}

function buildRoofSolarInspectionEntity(residence: ResidencePlacement): ProjectInspectionEntity {
  return {
    id: 'solar-roof',
    badge: getProjectVisualToken('solar-roof').label,
    description:
      'Parte da demanda solar foi absorvida pela cobertura da residencia antes de ocupar area de solo.',
    details: [
      { label: 'Area requerida', value: `${residence.requiredSolarArea.toFixed(1)} m2` },
      { label: 'Area no telhado', value: `${residence.roofSolarAreaUsed.toFixed(1)} m2` },
      { label: 'Capacidade util', value: `${residence.roofSolarCapacityArea.toFixed(1)} m2` },
      { label: 'Orientacao', value: `${Math.round((residence.rotationRadians * 180) / Math.PI)}deg` },
    ],
    title: 'Painel Solar Integrado',
    visualTokenId: 'solar-roof',
  };
}

function buildGroundSolarInspectionEntity(
  solar: SolarPlacement,
  residence: ResidencePlacement,
): ProjectInspectionEntity {
  return {
    id: 'solar-ground',
    badge: getProjectVisualToken('solar-ground').label,
    description:
      'Array fotovoltaico complementar alocado no terreno para absorver o excedente nao acomodado no telhado.',
    details: [
      { label: 'Pegada', value: `${solar.footprint.width}m x ${solar.footprint.length}m` },
      { label: 'Area provida', value: `${solar.providedArea.toFixed(1)} m2` },
      { label: 'Excedente apos telhado', value: `${Math.max(0, residence.requiredSolarArea - residence.roofSolarAreaUsed).toFixed(1)} m2` },
      { label: 'Cota media', value: `${solar.elevation.toFixed(1)}m` },
      { label: 'Orientacao', value: `${Math.round((solar.rotationRadians * 180) / Math.PI)}deg` },
    ],
    title: 'Array Fotovoltaico Complementar',
    visualTokenId: 'solar-ground',
  };
}

function buildInfrastructureInspectionEntity(
  placement: InfrastructurePlacement & {
    category: NonNullable<InfrastructurePlacement['category']>;
    footprint: NonNullable<InfrastructurePlacement['footprint']>;
    worldPosition: NonNullable<InfrastructurePlacement['worldPosition']>;
  },
): ProjectInspectionEntity {
  const token = getInfrastructureCategoryToken(placement.category);

  return {
    id: `infra-${placement.infrastructureId}`,
    badge: token.label,
    description: placement.rationale,
    details: [
      { label: 'Pegada', value: `${placement.footprint.width}m x ${placement.footprint.length}m` },
      { label: 'Posicao', value: `x ${placement.worldPosition.x.toFixed(1)} / y ${placement.worldPosition.y.toFixed(1)}` },
      { label: 'Cota media', value: `${placement.worldPosition.z.toFixed(1)}m` },
      { label: 'Status', value: placement.status },
    ],
    title: placement.name,
    visualTokenId: token.id,
  };
}

function buildPlantInspectionEntity(plant: BotanicalPlacement): ProjectInspectionEntity {
  const token = getStratumVisualToken(plant.stratum);

  return {
    id: plant.id,
    badge: getPlantVisualSubtitle(plant.stratum, plant.managementZone),
    description: buildPlantDescription(plant),
    details: [
      { label: 'Nome cientifico', value: plant.scientificName },
      { label: 'Manejo', value: plant.managementZone === 'INTERROW' ? 'Entrelinha produtiva' : 'Linha principal' },
      { label: 'Perfil', value: plant.managementProfile },
      { label: 'Faixa operacional', value: plant.operationalBand },
      { label: 'Ciclo', value: `${plant.maintenanceCycleDays} dias` },
      { label: 'Sucessao', value: plant.succession },
      { label: 'Agua', value: plant.waterRequirement },
      { label: 'Escala', value: `${plant.scale.toFixed(2)}x` },
      { label: 'Companheiras', value: plant.companions.length ? plant.companions.join(', ') : 'nenhuma' },
      { label: 'Antagonistas', value: plant.antagonists.length ? plant.antagonists.join(', ') : 'nenhum' },
    ],
    title: plant.popularName,
    visualTokenId: token.id,
  };
}

function getInfrastructureColor(category: NonNullable<InfrastructurePlacement['category']>, isSelected: boolean): string {
  if (isSelected) {
    return '#1769aa';
  }

  return getInfrastructureCategoryToken(category).color;
}

function getInfrastructureHeight(category: NonNullable<InfrastructurePlacement['category']>): number {
  switch (category) {
    case 'AGUA':
      return 1.2;
    case 'ENERGIA':
      return 1.4;
    case 'ANIMAL':
      return 1.8;
    case 'PROCESSAMENTO':
      return 1.6;
    default:
      return 1.5;
  }
}

function getPlantVisualRadius(plant: BotanicalPlacement): number {
  const baseRadius = plant.canopyRadius * plant.scale;
  const zoneFactor = plant.managementZone === 'INTERROW' ? 0.82 : 1;

  switch (plant.stratum) {
    case 'EMERGENTE':
      return baseRadius * 1.2 * zoneFactor;
    case 'ALTO':
      return baseRadius * 1.05 * zoneFactor;
    case 'MEDIO':
      return baseRadius * 0.95 * zoneFactor;
    case 'BAIXO':
      return baseRadius * 0.8 * zoneFactor;
    case 'RASTEIRO':
      return Math.max(0.22, baseRadius * 0.65 * zoneFactor);
    default:
      return baseRadius * zoneFactor;
  }
}

function getStratumColor(
  stratum: BotanicalPlacement['stratum'],
  isSelected: boolean,
  managementZone: BotanicalPlacement['managementZone'] = 'ROW',
): string {
  if (isSelected) {
    return '#0f766e';
  }

  const baseColor = getStratumVisualToken(stratum).color;

  if (managementZone === 'INTERROW') {
    switch (stratum) {
      case 'BAIXO':
        return '#a8c66c';
      case 'RASTEIRO':
        return '#d6e68a';
      default:
        return baseColor;
    }
  }

  return baseColor;
}

function buildPlantDescription(plant: BotanicalPlacement): string {
  if (plant.managementZone === 'INTERROW') {
    if (plant.managementProfile === 'MOWED_ACCESS') {
      return 'Especie de cobertura mantida baixa em faixa de servico, priorizando acesso, visibilidade e manutencao frequente perto da casa ou dos modulos operacionais.';
    }

    if (plant.managementProfile === 'MULCH_RETENTION') {
      return 'Especie de entrelinha voltada a cobertura persistente e retencao de mulch, adequada para reduzir evaporacao e proteger o solo em condicoes mais secas.';
    }

    if (plant.managementProfile === 'WINTER_COVER') {
      return 'Especie de entrelinha usada como cobertura sazonal, sustentando biomassa e protecao do solo em regime subtropical ou temperado.';
    }

    return 'Especie de cobertura e biomassa alocada na entrelinha para fechar solo, aportar materia organica e manter a faixa produtiva sem adensamento arboreo.';
  }

  switch (plant.stratum) {
    case 'EMERGENTE':
      return 'Elemento estrutural de estrato emergente, usado para abrir altura e acelerar biomassa no consorcio.';
    case 'ALTO':
      return 'Espécie de estrato alto posicionada para preencher o dossel produtivo principal sobre a linha.';
    case 'MEDIO':
      return 'Espécie de estrato médio inserida para densificar a sucessao e ocupar lacunas intermediarias de luz.';
    case 'BAIXO':
      return 'Espécie de estrato baixo usada para adensar a linha e sustentar a cobertura produtiva inicial.';
    case 'RASTEIRO':
      return 'Espécie rasteira usada para fechar o solo, reduzir exposição e completar a ocupação do consorcio.';
    default:
      return 'Espécie alocada deterministicamente sobre a linha de plantio.';
  }
}

