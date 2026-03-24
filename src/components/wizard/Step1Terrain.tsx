import { useWizardStore } from '../../store/wizardStore';
import { MousePointer2, Pencil, Spline, Map, Cuboid } from 'lucide-react';
import { Scene } from '../../webgl/Scene';
import { useEffect } from 'react';

export const Step1Terrain = () => {
  const { 
    terrain, viewMode, toolMode, brushSize, 
    setViewMode, setToolMode, setBrushSize, 
    undoTerrainPolygon, redoTerrainPolygon 
  } = useWizardStore();
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redoTerrainPolygon();
        } else {
          undoTerrainPolygon();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoTerrainPolygon, redoTerrainPolygon]);
  
  return (
    <div className="absolute inset-0 w-full h-full flex flex-col bg-figma-bg overflow-hidden animate-in fade-in duration-300">
         
      {/* Canvas Viewport */}
      <div className="absolute inset-0 w-full h-full z-0">
        <Scene />
      </div>

      {/* Floating Toolbar (Top Center) */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white p-1.5 border border-figma-border rounded-[6px] shadow-sm z-10">
         <button 
           onClick={() => setToolMode('select')}
           className={`w-8 h-8 flex items-center justify-center rounded-[4px] cursor-pointer transition-colors ${toolMode === 'select' ? 'text-figma-blue bg-[#e5f4ff]' : 'text-figma-text-muted hover:text-figma-text hover:bg-neutral-100'}`} 
           title="Selecionar">
            <MousePointer2 size={15} strokeWidth={2.5}/>
         </button>
         <button 
           onClick={() => { setToolMode('draw'); setViewMode('2D'); }}
           className={`w-8 h-8 flex items-center justify-center rounded-[4px] cursor-pointer transition-colors ${toolMode === 'draw' ? 'text-figma-blue bg-[#e5f4ff]' : 'text-figma-text-muted hover:text-figma-text hover:bg-neutral-100'}`} 
           title="Desenhar Polígono (Força View 2D)">
            <Pencil size={15}/>
         </button>
         <button 
           onClick={() => setToolMode('elevation')}
           className={`w-8 h-8 flex items-center justify-center rounded-[4px] cursor-pointer transition-colors ${toolMode === 'elevation' ? 'text-figma-blue bg-[#e5f4ff]' : 'text-figma-text-muted hover:text-figma-text hover:bg-neutral-100'}`} 
           title="Pincel de Altitude">
            <Spline size={15}/>
         </button> 
         
         <div className="w-[1px] h-5 bg-neutral-200 mx-1"></div>
         
         <div className="flex bg-neutral-100 p-0.5 rounded-[4px]">
           <button 
             onClick={() => setViewMode('2D')}
             className={`flex items-center gap-1.5 px-3 h-7 rounded-[3px] text-[11px] font-medium transition-all ${viewMode === '2D' ? 'bg-white text-figma-text shadow-sm' : 'text-figma-text-muted hover:text-figma-text'}`}
           >
             <Map size={13} /> 2D
           </button>
           <button 
             onClick={() => { setViewMode('3D'); setToolMode('select'); }}
             className={`flex items-center gap-1.5 px-3 h-7 rounded-[3px] text-[11px] font-medium transition-all ${viewMode === '3D' ? 'bg-white text-figma-text shadow-sm' : 'text-figma-text-muted hover:text-figma-text'}`}
           >
             <Cuboid size={13} /> 3D
           </button>
         </div>
      </div>
      
      {/* Floating Property Panel (Right Side) */}
      <div className="absolute top-6 right-6 w-[280px] bg-white border border-figma-border rounded-[6px] shadow-md z-10 flex flex-col overflow-hidden">
        <div className="h-10 border-b border-figma-border flex items-center px-4 font-semibold text-[11px] text-figma-text uppercase tracking-wide">
          Configurações do Terreno
        </div>
        
        <div className="flex flex-col p-4 gap-4">
          <div className="flex items-center justify-between">
            <span className="text-figma-text-muted text-[11px] uppercase font-bold tracking-wide">Área Restrita</span>
            <div className="flex items-center gap-1">
               <span className="font-mono bg-figma-bg px-2 py-1 rounded-[3px] w-24 text-figma-text border border-figma-border text-right focus-within:border-figma-blue">{terrain.area}</span>
               <span className="text-[10px] text-figma-text-muted w-4">m²</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-figma-text-muted text-[11px] uppercase font-bold tracking-wide">Norte Zº</span>
            <div className="flex items-center gap-1">
               <span className="font-mono bg-figma-bg px-2 py-1 rounded-[3px] w-14 text-figma-text border border-figma-border text-right">{terrain.northAngle}</span>
               <span className="text-[10px] text-figma-text-muted w-4">°</span>
            </div>
          </div>

          <div className="h-[1px] bg-figma-border -mx-4 w-[calc(100%+32px)]"></div>

          <div className="h-[1px] bg-figma-border -mx-4 w-[calc(100%+32px)]"></div>

          {/* New: Brush Size Control (Only if in elevation mode) */}
          {toolMode === 'elevation' && (
            <div className="flex flex-col gap-3 animate-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between">
                <span className="text-figma-text-muted text-[11px] uppercase font-bold tracking-wide">Pincel (Raio)</span>
                <span className="font-mono text-[11px] text-figma-blue font-bold px-1.5 py-0.5 bg-[#e5f4ff] rounded-[3px]">{brushSize}m</span>
              </div>
              <input 
                type="range" 
                min="2" 
                max="50" 
                step="1"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-figma-blue hover:bg-neutral-300 transition-colors"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-figma-text-muted text-[11px] uppercase font-bold tracking-wide">Malha Altimétrica</span>
            <span className={`text-[11px] font-medium px-3 py-2 rounded-[4px] border border-dashed text-center transition-colors ${terrain.elevationGrid ? 'bg-[#e5f4ff] border-figma-blue text-figma-blue' : 'bg-figma-bg border-figma-border text-figma-text-muted hover:border-figma-text hover:text-figma-text cursor-pointer'}`}>
              {terrain.elevationGrid ? '✓ Z-Grid Validada' : '+ Upload DEM / Importar'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
