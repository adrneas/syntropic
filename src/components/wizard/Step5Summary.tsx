import { useWizardStore } from '../../store/wizardStore';
import { Database, Cpu } from 'lucide-react';

export const Step5Summary = () => {
  const state = useWizardStore();
  
  return (
    <div className="w-[600px] figma-panel shadow-sm animate-in fade-in zoom-in-95 duration-200 bg-figma-panel flex flex-col pointer-events-none">
      <div className="h-10 border-b border-figma-border flex items-center px-4 font-semibold text-[11px] text-figma-text gap-2 uppercase tracking-wide">
        <Cpu size={13} className="text-figma-success" />
        Procedural Engine Pre-Flight
      </div>

      <div className="p-5 flex flex-col gap-5 bg-figma-bg">
        <div className="text-[11px] text-[#0065a8] flex gap-2 w-full p-2 bg-[#e5f4ff] border border-[#bce4ff] rounded-[3px]">
          <span className="font-semibold text-figma-blue">💡 INFO</span> 
          <span>O canvas central aguarda a aprovação dos tokens de estado abaixo para compilar a matriz 3D procedimental.</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="border border-figma-border bg-white p-3 rounded-[3px] shadow-sm">
            <div className="text-[10px] text-figma-text-muted font-bold tracking-wide uppercase mb-2">1. Terreno Topográfico</div>
            <div className="space-y-1">
               <div className="flex justify-between text-[11px]"><span className="text-figma-text-muted">Malha (Z-Grid)</span> <span className="text-figma-text font-mono bg-figma-bg px-1 rounded-sm border border-neutral-100">{state.terrain.area} m²</span></div>
               <div className="flex justify-between text-[11px]"><span className="text-figma-text-muted">Norte Geográfico</span> <span className="text-figma-text font-mono bg-figma-bg px-1 rounded-sm border border-neutral-100">{state.terrain.northAngle}°</span></div>
            </div>
          </div>

          <div className="border border-figma-border bg-white p-3 rounded-[3px] shadow-sm">
            <div className="text-[10px] text-figma-text-muted font-bold tracking-wide uppercase mb-2">2. Carga Energética</div>
            <div className="space-y-1">
               <div className="flex justify-between text-[11px]"><span className="text-figma-text-muted">Área Primária</span> <span className="text-figma-text font-mono bg-figma-bg px-1 rounded-sm border border-neutral-100">{state.residence.area} m²</span></div>
               <div className="flex justify-between text-[11px]"><span className="text-figma-text-muted">Tensão Calculada</span> <span className="text-figma-blue font-mono font-medium">{state.residence.calculatedSolarNeed} kWh</span></div>
            </div>
          </div>

          <div className="border border-figma-border bg-white p-3 rounded-[3px] shadow-sm">
            <div className="text-[10px] text-figma-text-muted font-bold tracking-wide uppercase mb-2">3. Configuração Bioclimática</div>
            <div className="text-[11px] font-mono text-figma-text bg-figma-bg border border-figma-border px-2 py-1 inline-block rounded-[2px]">
               {state.climate ? state.climate : 'NULL_OVERRIDE'}
            </div>
          </div>

          <div className="border border-figma-border bg-white p-3 rounded-[3px] overflow-hidden shadow-sm">
            <div className="text-[10px] text-figma-text-muted font-bold tracking-wide uppercase mb-2">4. Infra Estrutural</div>
            <div className="text-[10px] text-figma-text flex flex-wrap gap-1">
               {state.preferences.infrastructure.length > 0 ? 
                 state.preferences.infrastructure.map(i => <span key={i} className="bg-figma-bg border border-neutral-200 rounded-[2px] px-1.5 py-0.5">{i}</span>) : 
                 <span className="text-figma-text-muted italic">Zero Instâncias Selecionadas</span>
               }
            </div>
          </div>
        </div>
      </div>
      
      {state.generationStatus === 'processing' && (
         <div className="border-t border-figma-border p-3 flex items-center justify-center gap-2 bg-[#e5f4ff] text-figma-blue font-medium text-[11px] animate-pulse">
           <Database size={13} className="animate-spin" /> Compilando Matrizes Biológicas & D8 Flow...
         </div>
      )}
    </div>
  );
};
