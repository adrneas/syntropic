import { useWizardStore } from '../../store/wizardStore';
import { CloudRain, Sun, Leaf, Snowflake, Wind } from 'lucide-react';
import { dataService } from '../../core/services/dataService';
import type { ClimateZone } from '../../core/types/botanical';

const CLIMATES: Array<{ id: ClimateZone; name: string; icon: any; color: string }> = [
  { id: 'TROPICAL_UMIDO', name: 'Tropical Úmido', icon: CloudRain, color: '#1bc47d' },
  { id: 'TROPICAL_SECO', name: 'Tropical Seco', icon: Sun, color: '#f24822' },
  { id: 'SEMIARIDO', name: 'Semiárido', icon: Wind, color: '#f24822' },
  { id: 'TEMPERADO', name: 'Temperado', icon: Snowflake, color: '#18a0fb' },
  { id: 'SUBTROPICAL', name: 'Subtropical', icon: Leaf, color: '#18a0fb' },
];

export const Step3Climate = () => {
  const { climate, setClimate } = useWizardStore();

  return (
    <div className="w-[500px] figma-panel shadow-sm animate-in fade-in zoom-in-95 duration-200 bg-figma-panel">
      <div className="h-10 border-b border-figma-border flex items-center px-4 font-semibold text-[11px] text-figma-text">
        Filtro Bioclimático Master
      </div>

      <div className="p-5 flex flex-col gap-4">
        <p className="text-[11px] text-figma-text-muted leading-relaxed">
          Selecione o macrotipo climático predominante. Esta variável de sistema restringe o banco de dados botânico local, permitindo apenas espécies compatíveis visualizadas na Phase 4.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {CLIMATES.map(c => {
            const isSelected = climate === c.id;
            return (
              <div 
                key={c.id} 
                onClick={() => setClimate(c.id)}
                className={`flex items-center gap-3 p-3 rounded-[3px] border cursor-pointer transition-colors ${isSelected ? 'border-figma-blue bg-[#e5f4ff]' : 'border-figma-border bg-figma-panel hover:bg-neutral-50 mb-shadow'}`}
              >
                <div className="flex items-center justify-center bg-white p-1 rounded-sm shadow-sm border border-neutral-100" style={{ color: isSelected ? c.color : '#8a8a8a' }}>
                  <c.icon size={16} strokeWidth={isSelected ? 2.5 : 2} />
                </div>
                <div className="flex-1 flex flex-col">
                  <span className={`text-[12px] font-medium leading-none ${isSelected ? 'text-figma-blue' : 'text-figma-text'}`}>{c.name}</span>
                  <span className="text-[10px] text-figma-text-muted mt-1">
                    {dataService.getBotanicalData(c.id).length} espécies compatíveis
                  </span>
                </div>
                {isSelected && (
                  <div className="w-1.5 h-1.5 rounded-full bg-figma-blue" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
