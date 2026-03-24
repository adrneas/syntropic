import { useWizardStore } from '../../store/wizardStore';
import { Settings2, Info } from 'lucide-react';
import { dataService } from '../../core/services/dataService';
import { useMemo } from 'react';

export const Step4Preferences = () => {
  const { preferences, toggleInfrastructure } = useWizardStore();
  const infrastructureOptions = useMemo(() => dataService.getInfrastructureData(), []);

  return (
    <div className="w-[450px] figma-panel shadow-sm animate-in fade-in zoom-in-95 duration-200 bg-figma-panel flex flex-col">
      <div className="h-10 border-b border-figma-border flex items-center justify-between px-4">
        <span className="font-semibold text-[11px] text-figma-text uppercase tracking-wide">Infraestrutura Constraints</span>
        <Settings2 size={13} className="text-figma-text-muted" />
      </div>

      <div className="p-4 flex flex-col gap-4">
        <div className="flex gap-2 items-start bg-[#e5f4ff] border border-[#bce4ff] p-2.5 rounded-[3px]">
          <Info size={14} className="text-figma-blue mt-0.5 shrink-0" />
          <p className="text-[11px] text-[#0065a8] leading-relaxed">
            Módulos fotovoltaicos são resolvidos automaticamente via algorítmo na Etapa 2. Use este painel para definir infraestruturas secundárias.
          </p>
        </div>

        <div className="space-y-[1px] bg-figma-bg p-1 rounded-[3px] border border-figma-border">
          {infrastructureOptions.map(item => {
            const isSelected = preferences.infrastructure.includes(item.id);
            return (
              <label 
                key={item.id} 
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors rounded-[2px] ${isSelected ? 'bg-[#e5f4ff]' : 'hover:bg-white'}`}
              >
                <div className="relative flex items-center justify-center w-3 h-3 border rounded-sm bg-white overflow-hidden transition-colors" style={{ borderColor: isSelected ? '#18a0fb' : '#cccccc' }}>
                  <input 
                    type="checkbox" 
                    checked={isSelected}
                    onChange={() => toggleInfrastructure(item.id)}
                    className="absolute opacity-0 cursor-pointer"
                  />
                  {isSelected && (
                    <div className="w-full h-full bg-figma-blue flex items-center justify-center">
                       <svg width="8" height="8" viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="2"><path d="M1 4L3.5 6.5L9 1" /></svg>
                    </div>
                  )}
                </div>
                
                <span className={`flex-1 text-[12px] ${isSelected ? 'text-figma-text font-medium' : 'text-figma-text'}`}>{item.name}</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-[2px] border bg-white ${isSelected ? 'border-figma-blue text-figma-blue' : 'border-neutral-200 text-neutral-500'}`}>
                  {item.category}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
};
