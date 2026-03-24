import { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, MapControls, Grid, OrthographicCamera, PerspectiveCamera, Line, Html } from '@react-three/drei';
import { useWizardStore } from '../store/wizardStore';
import * as THREE from 'three';

const TERRAIN_SIZE = 256;
const TERRAIN_SEGMENTS = 128; 

const TerrainContent = () => {
  const { viewMode, toolMode, brushSize, terrain, updateTerrainPolygon, updateElevationGrid } = useWizardStore();
  const [draggedNodeIndex, setDraggedNodeIndex] = useState<number | null>(null);
  const elevationMeshRef = useRef<THREE.Mesh>(null);
  const isBrushing = useRef(false);
  const brushDirection = useRef(1); // 1 for increase, -1 for decrease
  const [hoverElevation, setHoverElevation] = useState<{ x: number, y: number, z: number } | null>(null);
  const terrainUniforms = useRef({
    uViewMode2D: { value: 0.0 }
  });

  useEffect(() => {
    terrainUniforms.current.uViewMode2D.value = viewMode === '2D' ? 1.0 : 0.0;
  }, [viewMode]);

  const sharedGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  }, []);

  // Initialize mesh from store on mount
  useEffect(() => {
    if (sharedGeometry && terrain.elevationGrid) {
      const positionAttribute = sharedGeometry.attributes.position;
      positionAttribute.array.set(terrain.elevationGrid);
      positionAttribute.needsUpdate = true;
      sharedGeometry.computeVertexNormals();
      updateColors(sharedGeometry);
    }
  }, [sharedGeometry]);
  
  // Centralized area calculation
  const calculateArea = (polygon: Array<{x: number, y: number}>) => {
    let area = 0;
    if (polygon.length > 2) {
      let j = polygon.length - 1;
      for (let i = 0; i < polygon.length; i++) {
        area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
        j = i;
      }
      area = Math.abs(area / 2);
    }
    return Math.round(area);
  };

  const updateColors = (geometry: THREE.BufferGeometry) => {
    const position = geometry.attributes.position;
    const count = position.count;
    
    if (!geometry.attributes.color) {
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    }
    
    const colors = geometry.attributes.color;
    const color = new THREE.Color();
    
    for (let i = 0; i < count; i++) {
        const h = position.getZ(i); // Height
        
        // Organic Gradient: Very Low (Dark Green) -> Low (Green) -> Mid (Brown) -> High (Grey/White)
        if (h < 2) color.setHSL(0.25, 0.4, 0.2 + h * 0.05); // Grass
        else if (h < 10) color.setHSL(0.1, 0.3, 0.3); // Soil
        else color.setHSL(0, 0, 0.5 + h * 0.01); // Rock/Snow
        
        colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  };

  const getYAt = (x: number, z: number) => {
    const positionAttribute = sharedGeometry.attributes.position;
    const ix = Math.round(((x + TERRAIN_SIZE/2) / TERRAIN_SIZE) * TERRAIN_SEGMENTS);
    const iz = Math.round(((z + TERRAIN_SIZE/2) / TERRAIN_SIZE) * TERRAIN_SEGMENTS);
    const index = (iz * (TERRAIN_SEGMENTS + 1)) + ix;
    
    if (index >= 0 && index < positionAttribute.count) {
        return positionAttribute.getZ(index);
    }
    return 0;
  };

  const applyBrush = (point: THREE.Vector3, direction: number) => {
    if (!elevationMeshRef.current) return;
    const geometry = sharedGeometry;
    const positionAttribute = geometry.attributes.position;
    const radius = brushSize; 
    const intensity = 0.6 * direction;
    
    const v = new THREE.Vector3();
    const localPoint = elevationMeshRef.current.worldToLocal(point.clone());

    for (let i = 0; i < positionAttribute.count; i++) {
      v.fromBufferAttribute(positionAttribute, i);
      const dx = v.x - localPoint.x;
      const dy = v.y - localPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < radius) {
        const falloff = (Math.cos((distance / radius) * Math.PI) + 1) / 2;
        v.z += intensity * falloff; 
        positionAttribute.setZ(i, v.z);
      }
    }
    
    positionAttribute.needsUpdate = true;
    updateColors(geometry);
    geometry.computeVertexNormals(); 
  };

  const handlePlanePointerDown = (e: any) => {
    e.stopPropagation();
    if (toolMode === 'draw') {
      const x = Number(e.point.x.toFixed(2));
      const z = Number(e.point.z.toFixed(2));
      const newPolygon = [...terrain.polygon, { x, y: z }];
      updateTerrainPolygon(newPolygon, calculateArea(newPolygon));
    } else if (toolMode === 'elevation') {
      isBrushing.current = true;
      brushDirection.current = e.button === 2 ? -1 : 1;
      applyBrush(e.point, brushDirection.current);
    }
  };

  const handlePlanePointerMove = (e: any) => {
    if (toolMode === 'select' && draggedNodeIndex !== null) {
      e.stopPropagation();
      const x = Number(e.point.x.toFixed(2));
      const z = Number(e.point.z.toFixed(2));
      const newPolygon = [...terrain.polygon];
      if (newPolygon[draggedNodeIndex].x !== x || newPolygon[draggedNodeIndex].y !== z) {
        newPolygon[draggedNodeIndex] = { x, y: z };
        updateTerrainPolygon(newPolygon, calculateArea(newPolygon));
      }
    } else if (toolMode === 'elevation') {
      e.stopPropagation();
      const x = e.point.x;
      const z = e.point.z;
      const h = getYAt(x, z);
      setHoverElevation({ x, y: z, z: h });
      if (isBrushing.current) {
        applyBrush(e.point, brushDirection.current);
      }
    } else {
      if (hoverElevation) setHoverElevation(null);
    }
  };

  const handlePlanePointerUp = () => {
    if (draggedNodeIndex !== null) setDraggedNodeIndex(null);
    if (isBrushing.current && toolMode === 'elevation') {
      isBrushing.current = false;
      const positions = sharedGeometry.attributes.position.array;
      updateElevationGrid(new Float32Array(positions));
    }
  };

  const handleNodePointerDown = (e: any, index: number) => {
    e.stopPropagation();
    if (toolMode === 'select') setDraggedNodeIndex(index);
  };

  const getInternalAngle = (i: number) => {
    const len = terrain.polygon.length;
    if (len < 3) return null;
    const prev = terrain.polygon[i === 0 ? len - 1 : i - 1];
    const curr = terrain.polygon[i];
    const next = terrain.polygon[(i + 1) % len];
    const v1 = new THREE.Vector2(prev.x - curr.x, prev.y - curr.y);
    const v2 = new THREE.Vector2(next.x - curr.x, next.y - curr.y);
    return Math.round(v1.angleTo(v2) * (180 / Math.PI));
  };

  const labels = useMemo(() => {
    const result: Array<{x: number, y: number, z: number, label: string}> = [];
    if (!terrain.elevationGrid) return result;
    const step = Math.floor(TERRAIN_SEGMENTS / 4);
    const columns = [Math.floor(TERRAIN_SEGMENTS/2 - step), Math.floor(TERRAIN_SEGMENTS/2), Math.floor(TERRAIN_SEGMENTS/2 + step)];
    for (let ix of columns) {
      for (let iz = 0; iz <= TERRAIN_SEGMENTS; iz += 4) {
        const index = (iz * (TERRAIN_SEGMENTS + 1)) + ix;
        const h = terrain.elevationGrid[index * 3 + 2];
        const x = (ix / TERRAIN_SEGMENTS) * TERRAIN_SIZE - TERRAIN_SIZE/2;
        const z = (iz / TERRAIN_SEGMENTS) * TERRAIN_SIZE - TERRAIN_SIZE/2;
        if (h > 1 && Math.abs(h % 10) < 0.5) {
          result.push({ x, y: h, z, label: `${Math.round(h/10)*10}m` });
          iz += 20;
        }
      }
    }
    return result;
  }, [terrain.elevationGrid]);

  const points = terrain.polygon.map(p => new THREE.Vector3(p.x, getYAt(p.x, p.y) + 0.1, p.y));
  const drawPoints = points.length > 2 ? [...points, points[0].clone()] : points;

  const edges = [];
  if (terrain.polygon.length > 1) {
    for (let i = 0; i < terrain.polygon.length; i++) {
      const p1 = terrain.polygon[i];
      const nextIndex = i + 1 < terrain.polygon.length ? i + 1 : (terrain.polygon.length > 2 ? 0 : -1);
      if (nextIndex !== -1) {
        const p2 = terrain.polygon[nextIndex];
        edges.push({
          midX: (p1.x + p2.x) / 2,
          midZ: (p1.y + p2.y) / 2,
          distance: Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)).toFixed(1)
        });
      }
    }
  }

  return (
    <>
      <ambientLight intensity={0.5} />
      {viewMode === '2D' ? (
        <>
          <OrthographicCamera makeDefault position={[0, 100, 0]} zoom={20} near={0.1} far={1000} />
          <MapControls makeDefault enableRotate={false} enabled={draggedNodeIndex === null} />
        </>
      ) : (
        <>
          <PerspectiveCamera makeDefault position={[0, 30, 40]} fov={45} />
          <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} maxDistance={150} enabled={draggedNodeIndex === null} />
        </>
      )}

      {viewMode === '2D' && (
        <Grid 
          args={[1000, 1000]} cellSize={1} cellThickness={1} cellColor="#e9e9e9" 
          sectionSize={10} sectionThickness={1} sectionColor="#dfdfdf" 
          fadeDistance={200} position={[0, -0.01, 0]} 
        />
      )}

      <mesh 
        ref={elevationMeshRef}
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -0.02, 0]} 
        onPointerDown={handlePlanePointerDown}
        onPointerMove={handlePlanePointerMove}
        onPointerUp={handlePlanePointerUp}
        onPointerOut={() => setHoverElevation(null)}
        receiveShadow castShadow
      >
        <primitive object={sharedGeometry} attach="geometry" />
        <meshStandardMaterial 
          vertexColors={viewMode === '3D'}
          color="#ffffff"
          roughness={0.8} metalness={0.1}
          transparent={true} // Enabled for 2D transparency
          visible={viewMode === '3D' || toolMode === 'elevation'}
          onBeforeCompile={(shader) => {
            shader.uniforms.uViewMode2D = terrainUniforms.current.uViewMode2D;
            shader.vertexShader = `varying float vHeight;\nvarying vec3 vNormalAlt;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.z;\nvNormalAlt = normal;');
            shader.fragmentShader = `varying float vHeight;\nvarying vec3 vNormalAlt;\nuniform float uViewMode2D;\n${shader.fragmentShader}`.replace(
              '#include <dithering_fragment>',
              `#include <dithering_fragment>\n
               float h = vHeight;
               float fw = fwidth(h);
               
               // Sharp Contour Logic
               float primary = mod(h + 0.05, 10.0);
               float secondary = mod(h + 0.05, 2.0);
               
               float primaryLine = smoothstep(fw * 1.5, 0.0, abs(primary)) + smoothstep(fw * 1.5, 0.0, abs(10.0 - primary));
               float secondaryLine = (smoothstep(fw * 0.8, 0.0, abs(secondary)) + smoothstep(fw * 0.8, 0.0, abs(2.0 - secondary))) * 0.5;
               
               // Shaded relief only for 3D overlay (subtle)
               vec3 lightDir = normalize(vec3(-0.5, 0.5, 1.0)); 
               float hillshade = dot(normalize(vNormalAlt), lightDir) * 0.15 + 0.85;
               
               if (uViewMode2D > 0.5) {
                 // Pure Transparent Technical Layer for 2D
                 // Alpha is 1.0 for lines, 0.0 otherwise
                 float lineAlpha = clamp(primaryLine + secondaryLine, 0.0, 1.0);
                 vec3 lineColor = mix(vec3(0.5, 0.5, 0.5), vec3(0.1, 0.1, 0.1), primaryLine);
                 gl_FragColor.rgb = lineColor;
                 gl_FragColor.a = lineAlpha;
               } else {
                 // 3D Mode: Heatmap is solid
                 gl_FragColor.a = 1.0; 
                 gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0), primaryLine * 0.2);
                 gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0), secondaryLine * 0.05);
               }`
            );
          }}
        />
      </mesh>

      {viewMode === '3D' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
          <primitive object={sharedGeometry} attach="geometry" />
          <meshBasicMaterial color="#000000" wireframe transparent opacity={0.05} />
        </mesh>
      )}

      {labels.map((l, i) => (
        <Html key={`alt-${i}`} position={[l.x, l.y + 0.2, l.z]} center zIndexRange={[50, 0]}>
          <div className="bg-white/60 backdrop-blur-[2px] px-1 rounded-[2px] text-[7px] font-mono text-neutral-400 select-none pointer-events-none border border-neutral-100/50 shadow-sm">{l.label}</div>
        </Html>
      ))}

      {toolMode === 'elevation' && hoverElevation && (
        <group position={[hoverElevation.x, hoverElevation.z + 1.5, hoverElevation.y]}>
          <Html center>
            <div className="bg-figma-blue text-white px-2 py-1 rounded-full text-[10px] font-bold shadow-lg flex items-center gap-1.5 whitespace-nowrap backdrop-blur-md bg-opacity-90">
              <span className="opacity-70 text-[8px] uppercase tracking-wider">Alt:</span>
              <span>{hoverElevation.z.toFixed(2)}m</span>
            </div>
          </Html>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.45, 0]}>
            <ringGeometry args={[brushSize * 0.99, brushSize, 64]} />
            <meshBasicMaterial color="#18a0fb" transparent opacity={0.3} />
          </mesh>
        </group>
      )}

      <directionalLight 
        position={[100, 150, 50]} intensity={1.5} castShadow 
        shadow-camera-left={-150} shadow-camera-right={150} shadow-camera-top={150} shadow-camera-bottom={-150}
      />

      {drawPoints.length > 1 && <Line points={drawPoints} color="#18a0fb" lineWidth={viewMode === '2D' ? 3 : 2} />}
      
      {edges.map((edge, i) => (
        <Html key={`edge-${i}`} position={[edge.midX, 0.05, edge.midZ]} center zIndexRange={[100, 0]}>
          <div className="bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded-[3px] border border-figma-border text-[9px] font-mono text-figma-blue font-medium shadow-sm pointer-events-none whitespace-nowrap">{edge.distance}m</div>
        </Html>
      ))}

      {terrain.polygon.map((p, i) => {
        const angle = getInternalAngle(i);
        return (
          <group key={i} position={[p.x, 0.03, p.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerDown={(e) => handleNodePointerDown(e, i)} onPointerMove={handlePlanePointerMove} onPointerUp={handlePlanePointerUp}>
              <circleGeometry args={[0.4, 32]} />
              <meshBasicMaterial color={draggedNodeIndex === i ? "#f24822" : "white"} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
              <circleGeometry args={[0.3, 32]} />
              <meshBasicMaterial color={draggedNodeIndex === i ? "#f24822" : "#18a0fb"} />
            </mesh>
            {angle !== null && (
              <Html position={[0.7, 0, 0.7]} center zIndexRange={[100, 0]}>
                <div className="bg-white/80 backdrop-blur-sm px-1 py-0.5 rounded-[2px] text-[8px] font-mono text-neutral-500 shadow-sm pointer-events-none whitespace-nowrap">{angle}°</div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
};

export const Scene = () => {
  return (
    <Canvas 
      style={{ width: '100%', height: '100%', background: '#fafafa' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TerrainContent />
    </Canvas>
  );
};
