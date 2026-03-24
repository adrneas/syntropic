import { useWizardStore } from '../../store/wizardStore';
import { Map, Home, Sun, CheckSquare, List, MousePointer2 } from 'lucide-react';

interface WizardLayoutProps {
  children: React.ReactNode;
}

const STEPS = [
  { id: 1, title: 'Terreno', icon: Map },
  { id: 2, title: 'Residência', icon: Home },
  { id: 3, title: 'Clima', icon: Sun },
  { id: 4, title: 'Infraestrutura', icon: CheckSquare },
  { id: 5, title: 'Resumo', icon: List },
];

export const WizardLayout = ({ children }: WizardLayoutProps) => {
  const { currentStep, nextStep, prevStep, setGenerationStatus } = useWizardStore();

  const handleNext = () => {
    if (currentStep === 5) {
      setGenerationStatus('processing');
      setTimeout(() => setGenerationStatus('completed'), 2000);
    } else {
      nextStep();
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden select-none bg-figma-bg text-figma-text">
      {/* Top Toolbar (Figma Light Style) */}
      <header className="h-[44px] shrink-0 bg-figma-panel border-b border-figma-border flex items-center justify-between px-3 relative z-10 shadow-sm">
        {/* Left Side: Brand & Tools */}
        <div className="flex items-center gap-1">
          <div className="w-8 h-8 flex items-center justify-center mr-2 hover:bg-figma-hover rounded-[3px] cursor-pointer">
            {/* Figma Icon */}
            <svg width="14" height="21" viewBox="0 0 14 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 10.5C9.09176 10.5 10.7876 8.8166 10.7876 6.74102C10.7876 4.66544 9.09176 2.98205 7 2.98205C4.90824 2.98205 3.21239 4.66544 3.21239 6.74102C3.21239 8.8166 4.90824 10.5 7 10.5Z" fill="#F24E1E"/>
              <path d="M7 10.5C4.90824 10.5 3.21239 8.8166 3.21239 6.74102C3.21239 4.66544 1.51654 4.66544 0 6.74102V14.259C1.51654 16.3346 3.21239 16.3346 3.21239 14.259C3.21239 12.1834 4.90824 10.5 7 10.5Z" fill="#FF7262"/>
              <path d="M7 10.5C9.09176 10.5 10.7876 12.1834 10.7876 14.259C10.7876 16.3346 9.09176 18.0179 7 18.0179C4.90824 18.0179 3.21239 16.3346 3.21239 14.259C3.21239 12.1834 4.90824 10.5 7 10.5Z" fill="#1ABCFE"/>
              <path d="M7 10.5V18.0179C9.09176 18.0179 10.7876 16.3346 10.7876 14.259C10.7876 12.1834 9.09176 10.5 7 10.5Z" fill="#0ACF83"/>
              <path d="M14 6.74102C14 8.8166 12.3042 10.5 10.2124 10.5V2.98205C12.3042 2.98205 14 4.66544 14 6.74102Z" fill="#A259FF"/>
            </svg>
          </div>
          
          <div className="flex items-center">
            <button className="w-8 h-8 rounded-[3px] hover:bg-figma-hover flex items-center justify-center text-figma-text">
               <MousePointer2 size={15} />
            </button>
            <div className="w-[1px] h-4 bg-figma-border mx-2"></div>
            <div className="text-[12px] font-medium px-2 py-1 flex items-center gap-1 rounded-[3px] hover:bg-figma-hover cursor-pointer text-figma-text">
              <span className="font-semibold text-neutral-800">SISTEMA SINTRÓPICO</span>
              <span className="text-neutral-400">/</span>
              <span className="text-neutral-500">Draft</span>
            </div>
          </div>
        </div>

        {/* Center: Stepper with Text Titles */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isPast = currentStep > step.id;
            
            return (
              <div key={step.id} className="flex items-center">
                <div 
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-[4px] transition-colors cursor-pointer 
                    ${isActive ? 'bg-figma-hover text-figma-text font-semibold' : 
                      isPast ? 'text-figma-blue hover:bg-figma-hover' : 
                      'text-figma-text-muted hover:bg-figma-hover'}`}
                  title={step.title}
                >
                  <Icon size={14} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[12px]">{step.title}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`w-3 h-[1px] mx-1 ${isPast ? 'bg-figma-blue' : 'bg-figma-border'}`} />
                )}
              </div>
            );
          })}
        </div>
        
        {/* Right Side: Account/Play */}
        <div className="flex items-center gap-3">
           <button
             onClick={handleNext}
             className="flex items-center gap-1 text-[12px] px-3 py-1 font-medium bg-figma-blue hover:bg-figma-blue-hover text-white rounded-[4px] transition-colors"
           >
             <svg width="10" height="12" viewBox="0 0 10 12" fill="none"><path d="M0 11.2V0.8C0 0.358172 0.533333 0.136396 0.844781 0.447844L8.64478 5.64784C8.84004 5.84311 8.84004 6.15689 8.64478 6.35216L0.844781 11.5522C0.533333 11.8636 0 11.6418 0 11.2Z" fill="currentColor"/></svg>
             {currentStep === 5 ? 'Processar' : 'Avançar'}
           </button>

           <div className="w-[1px] h-4 bg-figma-border"></div>

           <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#A259FF] to-[#1ABCFE] flex items-center justify-center text-[11px] font-bold text-white shadow-sm cursor-pointer">
             M
           </div>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Central Canvas Container */}
        <main className={`flex-1 bg-figma-bg relative overflow-hidden flex items-center justify-center ${currentStep === 1 ? '' : 'p-8 overflow-auto'}`}>
           {children}
        </main>
      </div>

      {/* Property/Action StatusBar (Bottom) */}
      <footer className="h-[40px] shrink-0 bg-figma-panel border-t border-figma-border flex items-center justify-between px-4">
        <div className="flex items-center gap-4 text-figma-text-muted text-[11px]">
           <span>Modo Inspetor ({STEPS.find(s => s.id === currentStep)?.title})</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className="figma-btn figma-btn-secondary h-7 text-[12px] px-3 font-medium bg-white hover:bg-neutral-50 border-neutral-300 shadow-sm"
          >
            Fase Anterior
          </button>
        </div>
      </footer>
    </div>
  );
};
