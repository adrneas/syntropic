import { useMemo, type ReactNode } from 'react';
import { CheckSquare, Home, List, Map, MousePointer2, Sun } from 'lucide-react';
import { runProceduralEngine } from '../../engine/proceduralEngine';
import { getStepValidation } from '../../core/validation/wizardValidation';
import { useWizardStore } from '../../store/wizardStore';

interface WizardLayoutProps {
  children: ReactNode;
}

const STEPS = [
  { id: 1, title: 'Terreno', icon: Map },
  { id: 2, title: 'Residencia', icon: Home },
  { id: 3, title: 'Clima', icon: Sun },
  { id: 4, title: 'Infraestrutura', icon: CheckSquare },
  { id: 5, title: 'Resumo', icon: List },
];

export const WizardLayout = ({ children }: WizardLayoutProps) => {
  const terrainPolygonLength = useWizardStore((state) => state.terrain.polygon.length);
  const terrainArea = useWizardStore((state) => state.terrain.area);
  const residenceArea = useWizardStore((state) => state.residence.area);
  const climate = useWizardStore((state) => state.climate);
  const currentStep = useWizardStore((state) => state.currentStep);
  const generationStatus = useWizardStore((state) => state.generationStatus);
  const nextStep = useWizardStore((state) => state.nextStep);
  const prevStep = useWizardStore((state) => state.prevStep);
  const setGenerationError = useWizardStore((state) => state.setGenerationError);
  const setGeneratedProject = useWizardStore((state) => state.setGeneratedProject);
  const setGenerationStatus = useWizardStore((state) => state.setGenerationStatus);
  const validation = useMemo(
    () =>
      getStepValidation({
        climate,
        currentStep,
        generationStatus,
        residenceArea,
        terrainArea,
        terrainPolygonLength,
      }),
    [climate, currentStep, generationStatus, residenceArea, terrainArea, terrainPolygonLength],
  );
  const canAdvance = validation.canAdvance && generationStatus !== 'processing';

  const handleNext = async () => {
    if (!canAdvance) {
      return;
    }

    if (currentStep !== 5) {
      nextStep();
      return;
    }

    const engineInput = useWizardStore.getState();
    setGenerationError(null);
    setGenerationStatus('processing');
    setGeneratedProject(null);

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const project = await runProceduralEngine(engineInput);
      setGeneratedProject(project);
      setGenerationStatus('completed');
    } catch (error) {
      setGenerationStatus('error');
      setGenerationError(error instanceof Error ? error.message : 'Falha desconhecida ao gerar o projeto.');
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden select-none bg-figma-bg text-figma-text">
      <header className="relative z-10 flex h-[44px] shrink-0 items-center justify-between border-b border-figma-border bg-figma-panel px-3 shadow-sm">
        <div className="flex items-center gap-1">
          <div className="mr-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-[3px] hover:bg-figma-hover">
            <svg width="14" height="21" viewBox="0 0 14 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 10.5C9.09176 10.5 10.7876 8.8166 10.7876 6.74102C10.7876 4.66544 9.09176 2.98205 7 2.98205C4.90824 2.98205 3.21239 4.66544 3.21239 6.74102C3.21239 8.8166 4.90824 10.5 7 10.5Z" fill="#F24E1E" />
              <path d="M7 10.5C4.90824 10.5 3.21239 8.8166 3.21239 6.74102C3.21239 4.66544 1.51654 4.66544 0 6.74102V14.259C1.51654 16.3346 3.21239 16.3346 3.21239 14.259C3.21239 12.1834 4.90824 10.5 7 10.5Z" fill="#FF7262" />
              <path d="M7 10.5C9.09176 10.5 10.7876 12.1834 10.7876 14.259C10.7876 16.3346 9.09176 18.0179 7 18.0179C4.90824 18.0179 3.21239 16.3346 3.21239 14.259C3.21239 12.1834 4.90824 10.5 7 10.5Z" fill="#1ABCFE" />
              <path d="M7 10.5V18.0179C9.09176 18.0179 10.7876 16.3346 10.7876 14.259C10.7876 12.1834 9.09176 10.5 7 10.5Z" fill="#0ACF83" />
              <path d="M14 6.74102C14 8.8166 12.3042 10.5 10.2124 10.5V2.98205C12.3042 2.98205 14 4.66544 14 6.74102Z" fill="#A259FF" />
            </svg>
          </div>

          <div className="flex items-center">
            <button className="flex h-8 w-8 items-center justify-center rounded-[3px] text-figma-text hover:bg-figma-hover">
              <MousePointer2 size={15} />
            </button>
            <div className="mx-2 h-4 w-px bg-figma-border" />
            <div className="flex cursor-pointer items-center gap-1 rounded-[3px] px-2 py-1 text-[12px] font-medium text-figma-text hover:bg-figma-hover">
              <span className="font-semibold text-neutral-800">SISTEMA SINTROPICO</span>
              <span className="text-neutral-400">/</span>
              <span className="text-neutral-500">Draft</span>
            </div>
          </div>
        </div>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isPast = currentStep > step.id;

            return (
              <div key={step.id} className="flex items-center">
                <div
                  className={`flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2 py-1 transition-colors ${
                    isActive
                      ? 'bg-figma-hover font-semibold text-figma-text'
                      : isPast
                        ? 'text-figma-blue hover:bg-figma-hover'
                        : 'text-figma-text-muted hover:bg-figma-hover'
                  }`}
                  title={step.title}
                >
                  <Icon size={14} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[12px]">{step.title}</span>
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`mx-1 h-px w-3 ${isPast ? 'bg-figma-blue' : 'bg-figma-border'}`} />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              void handleNext();
            }}
            disabled={!canAdvance}
            className="flex items-center gap-1 rounded-[4px] bg-figma-blue px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-figma-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={validation.message}
          >
            <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
              <path d="M0 11.2V0.8C0 0.358172 0.533333 0.136396 0.844781 0.447844L8.64478 5.64784C8.84004 5.84311 8.84004 6.15689 8.64478 6.35216L0.844781 11.5522C0.533333 11.8636 0 11.6418 0 11.2Z" fill="currentColor" />
            </svg>
            {currentStep === 5 ? (generationStatus === 'processing' ? 'Processando...' : 'Gerar') : 'Avancar'}
          </button>

          <div className="h-4 w-px bg-figma-border" />

          <div className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-gradient-to-tr from-[#A259FF] to-[#1ABCFE] text-[11px] font-bold text-white shadow-sm">
            M
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className={`relative flex flex-1 items-center justify-center overflow-hidden bg-figma-bg ${currentStep === 1 ? '' : 'overflow-auto p-8'}`}>
          {children}
        </main>
      </div>

      <footer className="flex h-[40px] shrink-0 items-center justify-between border-t border-figma-border bg-figma-panel px-4">
        <div className="flex items-center gap-4 text-[11px] text-figma-text-muted">
          <span>Modo Inspetor ({STEPS.find((step) => step.id === currentStep)?.title})</span>
          <span className={canAdvance ? 'text-figma-success' : 'text-figma-danger'}>{validation.message}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={prevStep}
            disabled={currentStep === 1 || generationStatus === 'processing'}
            className="figma-btn figma-btn-secondary h-7 border-neutral-300 bg-white px-3 text-[12px] font-medium shadow-sm hover:bg-neutral-50"
          >
            Fase Anterior
          </button>
        </div>
      </footer>
    </div>
  );
};
