import { useMemo, useState } from 'react';
import { Cuboid, Map, PencilLine, Trees, Zap } from 'lucide-react';
import { useWizardStore } from '../../store/wizardStore';
import { Scene, type ProjectInspectionEntity } from '../../webgl/Scene';

const LEGEND_ITEMS = [
  { label: 'Residencia', color: '#5b6676' },
  { label: 'Solar', color: '#2691c2' },
  { label: 'Keyline', color: '#0f766e' },
  { label: 'Linha de plantio', color: '#5b9a57' },
  { label: 'Entrelinha produtiva', color: '#9fbf63' },
  { label: 'Corredor operacional', color: '#d97706' },
  { label: 'Emergente', color: '#1f6d4d' },
  { label: 'Alto', color: '#2d8f57' },
  { label: 'Medio', color: '#5aa05e' },
  { label: 'Baixo', color: '#8dbb61' },
  { label: 'Rasteiro', color: '#bfd97b' },
  { label: 'Agua', color: '#3b82c4' },
  { label: 'Animal', color: '#9a6b34' },
  { label: 'Processamento', color: '#4f7f52' },
  { label: 'Energia', color: '#d97706' },
] as const;

export const ProjectVisualization = () => {
  const generatedProject = useWizardStore((state) => state.generatedProject);
  const viewMode = useWizardStore((state) => state.viewMode);
  const setViewMode = useWizardStore((state) => state.setViewMode);
  const beginEditingProject = useWizardStore((state) => state.beginEditingProject);
  const [selectedEntity, setSelectedEntity] = useState<ProjectInspectionEntity | null>(null);

  const summary = useMemo(() => {
    if (!generatedProject) {
      return [];
    }

    const missingSolarArea = Math.max(
      0,
      generatedProject.residence.requiredSolarArea -
        generatedProject.residence.roofSolarAreaUsed -
        (generatedProject.groundSolarPlacement?.providedArea ?? 0),
    );
    const flatCellRatio =
      generatedProject.slopeGrid.length > 0
        ? (generatedProject.report.topography.flatCellCount / generatedProject.slopeGrid.length) * 100
        : 0;

    return [
      { label: 'Seed', value: String(generatedProject.seed) },
      {
        label: 'Infraestrutura',
        value: `${generatedProject.report.infrastructure.placed}/${generatedProject.report.infrastructure.requested}`,
      },
      {
        label: 'Guias',
        value: `${generatedProject.report.layout.plantingRowCount} rows / ${generatedProject.report.layout.interRowCount} entrelinhas / ${generatedProject.report.layout.keylineCount} keylines`,
      },
      {
        label: 'Plantas',
        value: `${generatedProject.report.botanical.placedCount} total / ${generatedProject.report.botanical.interRowPlantCount} entrelinhas`,
      },
      {
        label: 'Manejo',
        value:
          generatedProject.report.botanical.dominantInterRowProfile === 'NONE'
            ? 'sem entrelinha manejada'
            : `${generatedProject.report.botanical.dominantInterRowProfile} / ${generatedProject.report.botanical.averageInterRowMaintenanceCycleDays}d`,
      },
      { label: 'Banco botanico', value: `${generatedProject.report.botanical.compatibleSpeciesCount} especies` },
      {
        label: 'Areas planas',
        value: `${flatCellRatio.toFixed(0)}% da malha`,
      },
      {
        label: 'Solar atendido',
        value: missingSolarArea > 0 ? `parcial (${missingSolarArea.toFixed(1)} m2 faltantes)` : 'sim',
      },
      {
        label: 'Espacamento',
        value: `${generatedProject.report.layout.rowSpacingMeters}m`,
      },
      {
        label: 'Estratos',
        value: generatedProject.report.botanical.strataUsed.length
          ? generatedProject.report.botanical.strataUsed.join(', ')
          : 'nenhum',
      },
      {
        label: 'Faixa servico',
        value: `${generatedProject.report.botanical.serviceCorePlantCount} plantas em zona operacional`,
      },
    ];
  }, [generatedProject]);

  if (!generatedProject) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex h-full w-full flex-col overflow-hidden bg-figma-bg">
      <div className="absolute inset-0 z-0 h-full w-full">
        <Scene
          mode="project"
          onSelectEntity={setSelectedEntity}
          selectedEntityId={selectedEntity?.id ?? null}
        />
      </div>

      <div className="absolute left-6 top-6 z-10 flex items-center gap-3 rounded-[8px] border border-figma-border bg-white/95 p-3 shadow-lg backdrop-blur-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[#e5f4ff] text-figma-blue">
          <Trees size={18} />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-figma-text-muted">
            Projeto Gerado
          </span>
          <span className="text-[14px] font-semibold text-figma-text">
            Visualizacao operacional do layout
          </span>
        </div>

        <div className="mx-2 h-10 w-px bg-figma-border" />

        <div className="flex rounded-[5px] bg-figma-bg p-0.5">
          <button
            className={`flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-[11px] font-medium ${
              viewMode === '2D' ? 'bg-white text-figma-text shadow-sm' : 'text-figma-text-muted'
            }`}
            onClick={() => setViewMode('2D')}
          >
            <Map size={13} />
            2D
          </button>
          <button
            className={`flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-[11px] font-medium ${
              viewMode === '3D' ? 'bg-white text-figma-text shadow-sm' : 'text-figma-text-muted'
            }`}
            onClick={() => setViewMode('3D')}
          >
            <Cuboid size={13} />
            3D
          </button>
        </div>
      </div>

      <div className="absolute right-6 top-6 z-10 flex w-[320px] flex-col overflow-hidden rounded-[8px] border border-figma-border bg-white/95 shadow-lg backdrop-blur-sm">
        <div className="flex h-11 items-center justify-between border-b border-figma-border px-4">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-figma-text">
            {selectedEntity ? 'Inspecao de Entidade' : 'Resumo da Geracao'}
          </span>
          <span className="rounded-[4px] bg-figma-bg px-2 py-1 text-[10px] font-mono text-figma-text-muted">
            seed {generatedProject.seed}
          </span>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {selectedEntity ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[14px] font-semibold text-figma-text">{selectedEntity.title}</div>
                  <div className="mt-1 inline-flex rounded-full bg-[#e5f4ff] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-figma-blue">
                    {selectedEntity.badge}
                  </div>
                </div>

                <button
                  className="rounded-[4px] border border-figma-border px-2 py-1 text-[10px] font-medium text-figma-text-muted transition-colors hover:bg-figma-bg"
                  onClick={() => setSelectedEntity(null)}
                >
                  Fechar
                </button>
              </div>

              <p className="text-[11px] leading-relaxed text-figma-text-muted">
                {selectedEntity.description}
              </p>

              <div className="grid grid-cols-2 gap-2">
                {selectedEntity.details.map((detail) => (
                  <div
                    className="rounded-[4px] border border-figma-border bg-figma-bg px-2 py-1.5"
                    key={`${selectedEntity.id}-${detail.label}`}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-figma-text-muted">
                      {detail.label}
                    </div>
                    <div className="mt-1 text-[12px] font-mono text-figma-text">{detail.value}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-[6px] border border-[#bce4ff] bg-[#e5f4ff] px-3 py-2 text-[11px] leading-relaxed text-[#0065a8]">
                Clique em residencia, solar, plantas ou infraestrutura para abrir a justificativa e os dados da alocacao.
              </div>

              <div className="grid grid-cols-2 gap-2">
                {summary.map((item) => (
                  <div
                    className="rounded-[4px] border border-figma-border bg-figma-bg px-2 py-1.5"
                    key={item.label}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-figma-text-muted">
                      {item.label}
                    </div>
                    <div className="mt-1 text-[12px] font-mono text-figma-text">{item.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="absolute left-6 bottom-6 z-10 flex w-[320px] flex-col gap-3 rounded-[8px] border border-figma-border bg-white/95 p-4 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-figma-text">
          <Zap size={13} className="text-figma-blue" />
          Legenda Operacional
        </div>

        <div className="grid grid-cols-2 gap-2">
          {LEGEND_ITEMS.map((item) => (
            <div
              className="flex items-center gap-2 rounded-[4px] border border-figma-border bg-figma-bg px-2 py-1.5 text-[11px] text-figma-text"
              key={item.label}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="absolute right-6 bottom-6 z-10 flex items-center gap-3 rounded-[8px] border border-figma-border bg-white/95 p-3 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] text-figma-text-muted">
          <PencilLine size={13} />
          Editar requisitos e regenerar
        </div>

        <button
          className="figma-btn figma-btn-primary h-9 px-4 text-[12px]"
          onClick={beginEditingProject}
        >
          Editar Requisitos
        </button>
      </div>
    </div>
  );
};
