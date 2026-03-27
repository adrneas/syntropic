import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
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
  getProjectVisualToken,
  withAlpha,
} from '../components/project/projectVisualTokens';
import { useWizardStore } from '../store/wizardStore';
import {
  clamp,
  getTerrainWorldSize,
  gridToWorld,
  isPointWithinBufferedPolygon,
} from '../core/utils/terrain';
import type { InfrastructurePlacement } from '../core/types/generation';
import type {
  ProjectHoverLabel,
  RenderTerrainGeometry,
  SceneProps,
  VertexAngleVisualization,
} from './sceneTypes';
import {
  buildAngleArcPoints,
  buildTerrainBoundaryPoints,
  createInteractionPlaneGeometry,
  createVisibleTerrainGeometry,
  getPolygonWinding,
  syncGeometryFromGrid,
} from './utils/terrainGeometry';
import { toLinePoints } from './utils/guideGeometry';
import {
  buildGroundSolarInspectionEntity,
  buildGuideHoverLabel,
  buildInfrastructureInspectionEntity,
  buildPlantInspectionEntity,
  buildProductiveAreaInspectionEntity,
  buildResidenceInspectionEntity,
  buildRoofSolarInspectionEntity,
} from './utils/inspectionEntities';
import { ResidenceMesh, RoofSolarMesh, GroundSolarMesh, InfrastructureMesh } from './meshes/StructureMeshes';
import { PlantMesh } from './meshes/PlantMesh';
import { InterRowBandMesh, ProductiveAreaMesh } from './meshes/AreaMeshes';
import { ContourLines } from './ContourLines';
import { useTerrainInteraction } from './hooks/useTerrainInteraction';

export type { ProjectInspectionDetail, ProjectInspectionEntity } from './sceneTypes';

const TERRAIN_RENDER_BUFFER_METERS = 5;

const TerrainContent = ({ mode = 'editor', onSelectEntity, onZoomChange, selectedEntityId }: SceneProps) => {
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
  const lastReportedZoomRef = useRef(0);
  useFrame(({ camera }) => {
    const zoom = 'zoom' in camera ? (camera as { zoom: number }).zoom : 12;
    if (onZoomChange && Math.abs(zoom - lastReportedZoomRef.current) > 0.5) {
      lastReportedZoomRef.current = zoom;
      onZoomChange(zoom);
    }
  });
  const [hoveredProjectLabel, setHoveredProjectLabel] = useState<ProjectHoverLabel | null>(null);
  const interactionPlaneGeometry = useMemo(() => createInteractionPlaneGeometry(terrainGridConfig), [terrainGridConfig]);
  const visibleTerrainGeometry = useMemo(
    () =>
      hasValidTerrainPolygon
        ? createVisibleTerrainGeometry(terrainGridConfig, terrain.polygon, TERRAIN_RENDER_BUFFER_METERS)
        : null,
    [hasValidTerrainPolygon, terrain.polygon, terrainGridConfig],
  );
  const visibleTerrainGeometryRef = useRef<RenderTerrainGeometry | null>(visibleTerrainGeometry);
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
  const productiveAreas = generatedProject?.productiveAreas ?? [];
  const serviceCorridors = generatedProject?.serviceCorridors ?? [];
  const swales = generatedProject?.swales ?? [];
  const hoveredProjectToken = hoveredProjectLabel
    ? getProjectVisualToken(hoveredProjectLabel.visualTokenId)
    : null;
  const interRowBandWidth = generatedProject
    ? Math.max(generatedProject.report.layout.rowSpacingMeters * 0.46, 1.6)
    : 1.8;
  const keylineVisualToken = getGuideVisualToken('KEYLINE');
  const interRowVisualToken = getGuideVisualToken('INTERROW');
  const serviceCorridorVisualToken = getGuideVisualToken('SERVICE_CORRIDOR');
  const swaleVisualToken = getGuideVisualToken('SWALE');

  const {
    draggedNodeIndex,
    handleNodePointerDown,
    handlePlanePointerDown,
    handlePlanePointerMove,
    handlePlanePointerUp,
    hoverElevation,
    isBrushActive,
    isShiftPressed,
    setHoverElevation,
  } = useTerrainInteraction({
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
  });

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
    if (visibleTerrainGeometry) {
      syncGeometryFromGrid(visibleTerrainGeometry, terrain.elevationGrid);
    }
  }, [terrain.elevationGrid, visibleTerrainGeometry]);

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

  const edges: Array<{ distance: string; midX: number; midZ: number }> = [];

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

      {shouldRenderTerrainMesh && hasValidTerrainPolygon && (
        <ContourLines
          elevationGrid={terrain.elevationGrid}
          gridConfig={terrainGridConfig}
          polygon={terrain.polygon}
        />
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

          {swales.map((guide) => (
            <Line
              color={swaleVisualToken.color}
              key={guide.id}
              lineWidth={2.5}
              onPointerOut={() => clearProjectHoverLabel(guide.id)}
              onPointerOver={(event) => {
                event.stopPropagation();
                setProjectHoverLabel(buildGuideHoverLabel(guide, 0.46));
              }}
              opacity={0.96}
              points={toLinePoints(guide, 0.22)}
              transparent
            />
          ))}

          {productiveAreas.map((area) => (
            <ProductiveAreaMesh
              area={area}
              is2D={viewMode === '2D'}
              isSelected={selectedEntityId === `area-${area.id}`}
              key={area.id}
              onHoverChange={setProjectHoverLabel}
              onHoverClear={clearProjectHoverLabel}
              onSelect={() => onSelectEntity?.(buildProductiveAreaInspectionEntity(area))}
            />
          ))}

          {interRows.map((guide) => (
            <InterRowBandMesh
              color={interRowVisualToken.color}
              guide={guide}
              is2D={viewMode === '2D'}
              key={guide.id}
              onHoverChange={setProjectHoverLabel}
              onHoverClear={clearProjectHoverLabel}
              terrain={terrain}
              width={interRowBandWidth}
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

export const Scene = ({ mode = 'editor', onSelectEntity, onZoomChange, selectedEntityId }: SceneProps) => (
  <Canvas
    onContextMenu={(event) => event.preventDefault()}
    onPointerMissed={() => onSelectEntity?.(null)}
    style={{ width: '100%', height: '100%', background: '#fafafa' }}
  >
    <TerrainContent mode={mode} onSelectEntity={onSelectEntity} onZoomChange={onZoomChange} selectedEntityId={selectedEntityId} />
  </Canvas>
);
