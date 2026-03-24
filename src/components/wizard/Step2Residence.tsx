import { useWizardStore } from '../../store/wizardStore';
import { Home, Zap, Monitor, Snowflake, Coffee, Droplet } from 'lucide-react';

export const Step2Residence = () => {
  const { residence, updateResidenceArea, updateAppliance, calculateSolarNeed } = useWizardStore();
  
  const handleApplianceChange = (id: string, qty: number) => {
    updateAppliance(id, Math.max(0, qty));
    calculateSolarNeed();
  };

  const appliances = [
    { id: 'chuveiro', name: 'Chuveiro Elétrico', icon: Droplet },
    { id: 'ar-condicionado', name: 'Ar Condicionado', icon: Snowflake },
    { id: 'geladeira', name: 'Refrigeração', icon: Coffee },
    { id: 'computador', name: 'Computador/Notebook', icon: Monitor }
  ];

  return (
    <div className="w-[340px] figma-panel flex flex-col shadow-sm animate-in fade-in zoom-in-95 duration-200 bg-figma-panel">
      <div className="h-10 border-b border-figma-border flex items-center px-4 font-semibold text-[11px] text-figma-text">
        Residência & Carga Elétrica
      </div>

      <div className="p-4 space-y-4">
        {/* Section 1 */}
        <div>
          <div className="text-[10px] font-bold text-figma-text-muted mb-2 tracking-wide uppercase">Dimensões Base</div>
          <div className="flex items-center justify-between group">
             <div className="flex items-center gap-2 text-figma-text-muted group-hover:text-figma-text transition-colors">
               <Home size={14}/>
               <span className="text-[12px]">Área Construída</span>
             </div>
             <div className="flex items-center gap-1">
               <input 
                 type="number" 
                 className="figma-input w-16 text-right text-[12px] font-mono bg-figma-bg" 
                 value={residence.area || ''}
                 onChange={e => updateResidenceArea(Number(e.target.value))}
                 placeholder="0"
               />
               <span className="text-figma-text-muted text-[11px] w-4">m²</span>
             </div>
          </div>
        </div>

        <div className="h-[1px] bg-figma-border w-full"></div>

        {/* Section 2 */}
        <div>
           <div className="flex items-center justify-between mb-3 text-figma-text-muted">
             <div className="text-[10px] font-bold tracking-wide uppercase">Matriz Energética</div>
             <Zap size={12} />
           </div>
           
           <div className="space-y-1">
             {appliances.map(app => (
               <div key={app.id} className="flex items-center justify-between py-1 group">
                 <div className="flex items-center gap-2 text-figma-text-muted group-hover:text-figma-text transition-colors">
                   <app.icon size={13} />
                   <span className="text-[12px]">{app.name}</span>
                 </div>
                 
                 <div className="flex items-center bg-figma-bg border border-figma-border rounded-[2px] transition-colors hover:border-figma-border-hover focus-within:border-figma-blue">
                    <button onClick={() => handleApplianceChange(app.id, (residence.appliances[app.id] || 0) - 1)} className="w-6 h-6 flex items-center justify-center text-figma-text-muted hover:text-figma-text hover:bg-neutral-200 transition-colors">-</button>
                    <div className="w-6 text-center font-mono text-[11px] text-figma-text select-none leading-[24px] bg-white border-x border-figma-border">{residence.appliances[app.id] || 0}</div>
                    <button onClick={() => handleApplianceChange(app.id, (residence.appliances[app.id] || 0) + 1)} className="w-6 h-6 flex items-center justify-center text-figma-text-muted hover:text-figma-text hover:bg-neutral-200 transition-colors">+</button>
                 </div>
               </div>
             ))}
           </div>
        </div>

        <div className="h-[1px] bg-figma-border w-full"></div>

        {/* Inspector Result */}
        <div className="bg-figma-bg p-3 border border-figma-border rounded-[3px] flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[11px] text-figma-text">
             <span className="font-semibold text-figma-text">Consumo Estimado</span> (30d block)
          </div>
          <div className="flex items-baseline gap-1 mt-1">
             <span className="text-[20px] font-mono text-figma-blue leading-none tracking-tight">{residence.calculatedSolarNeed}</span>
             <span className="text-[11px] text-figma-text-muted font-medium">kWh</span>
          </div>
          
          <div className="mt-2 pt-2 border-t border-figma-border flex justify-between items-center text-[10px]">
             <span className="text-figma-text-muted">Painéis (Pegada Mínima):</span>
             <span className="text-figma-text font-mono bg-white px-1.5 py-0.5 rounded-[2px] border border-figma-border">
               {Math.ceil(residence.calculatedSolarNeed / 40) * 2} m²
             </span>
          </div>
        </div>
      </div>
    </div>
  );
};
