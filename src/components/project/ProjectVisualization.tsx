import { useMemo, useState } from 'react';
import {
  Cuboid,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Trees,
  Zap,
} from 'lucide-react';
import type { Stratum } from '../../core/types/botanical';
import type { GeneratedProject, ProductiveAreaType } from '../../core/types/generation';
import type { InfrastructureCategory } from '../../core/types/infrastructure';
import { useWizardStore } from '../../store/wizardStore';
import { Scene, type ProjectInspectionEntity } from '../../webgl/Scene';
import {
  getInfrastructureCategoryToken,
  getProductiveAreaVisualToken,
  getProjectVisualToken,
  getStratumVisualToken,
  PROJECT_VISUAL_GROUP_LABELS,
  type ProjectVisualGroup,
  type ProjectVisualToken,
  withAlpha,
} from './projectVisualTokens';

interface LegendGroupItem {
  description: string;
  token: ProjectVisualToken;
  value: string;
}

interface LegendGroupData {
  emptyState: string;
  id: ProjectVisualGroup;
  items: LegendGroupItem[];
  summary: string;
}

export const ProjectVisualization = () => {
  const generatedProject = useWizardStore((state) => state.generatedProject);
  const viewMode = useWizardStore((state) => state.viewMode);
  const setViewMode = useWizardStore((state) => state.setViewMode);
  const beginEditingProject = useWizardStore((state) => state.beginEditingProject);
  const [isLegendCollapsed, setIsLegendCollapsed] = useState(false);
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
        ? (generatedProject.report.topography.flatCellCount /
            generatedProject.slopeGrid.length) *
          100
        : 0;

    return [
      { label: 'Seed', value: String(generatedProject.seed) },
      {
        label: 'Infraestrutura',
        value: `${generatedProject.report.infrastructure.placed}/${generatedProject.report.infrastructure.requested}`,
      },
      {
        label: 'Areas produtivas',
        value: `${generatedProject.report.layout.productiveAreaCount} areas / ${generatedProject.report.layout.swaleCount} swales`,
      },
      {
        label: 'Plantas',
        value: `${generatedProject.report.botanical.placedCount} total`,
      },
      {
        label: 'Areas ativas',
        value: `${generatedProject.report.botanical.productiveAreasPopulated} areas com plantio`,
      },
      {
        label: 'Banco botanico',
        value: `${generatedProject.report.botanical.compatibleSpeciesCount} especies`,
      },
      {
        label: 'Areas planas',
        value: `${flatCellRatio.toFixed(0)}% da malha`,
      },
      {
        label: 'Solar atendido',
        value:
          missingSolarArea > 0
            ? `parcial (${missingSolarArea.toFixed(1)} m2 faltantes)`
            : 'sim',
      },
      {
        label: 'Passo da malha',
        value: `${generatedProject.report.layout.rowSpacingMeters}m`,
      },
      {
        label: 'Cobertura',
        value: `${generatedProject.report.layout.productiveAreaCoverageSquareMeters.toFixed(0)} m2`,
      },
      {
        label: 'Residual livre',
        value: `${generatedProject.report.layout.productiveAreaDeadSpaceSquareMeters.toFixed(0)} m2`,
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
  const legendGroups = useMemo(
    () => (generatedProject ? buildLegendGroups(generatedProject) : []),
    [generatedProject],
  );
  const selectedEntityToken = selectedEntity
    ? getProjectVisualToken(selectedEntity.visualTokenId)
    : null;
  const SelectedEntityIcon = selectedEntityToken?.icon;

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
              viewMode === '2D'
                ? 'bg-white text-figma-text shadow-sm'
                : 'text-figma-text-muted'
            }`}
            onClick={() => setViewMode('2D')}
          >
            <Map size={13} />
            2D
          </button>
          <button
            className={`flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-[11px] font-medium ${
              viewMode === '3D'
                ? 'bg-white text-figma-text shadow-sm'
                : 'text-figma-text-muted'
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
                  <div className="text-[14px] font-semibold text-figma-text">
                    {selectedEntity.title}
                  </div>
                  {selectedEntityToken && SelectedEntityIcon && (
                    <div
                      className="mt-2 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        backgroundColor: withAlpha(selectedEntityToken.color, '16'),
                        borderColor: withAlpha(selectedEntityToken.color, '3A'),
                        color: selectedEntityToken.color,
                      }}
                    >
                      <span
                        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border bg-white px-1 font-mono text-[9px] leading-none"
                        style={{
                          borderColor: withAlpha(selectedEntityToken.color, '3A'),
                        }}
                      >
                        <SelectedEntityIcon size={10} strokeWidth={2.4} />
                      </span>
                      {selectedEntity.badge}
                    </div>
                  )}
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
                    <div className="mt-1 text-[12px] font-mono text-figma-text">
                      {detail.value}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-[6px] border border-[#bce4ff] bg-[#e5f4ff] px-3 py-2 text-[11px] leading-relaxed text-[#0065a8]">
                Passe o cursor para ler grupo, estrato ou guia. Clique para abrir a
                justificativa completa da alocacao.
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
                    <div className="mt-1 text-[12px] font-mono text-figma-text">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {isLegendCollapsed ? (
        <button
          className="absolute left-6 bottom-6 z-10 inline-flex items-center gap-2 rounded-[8px] border border-figma-border bg-white/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-figma-text shadow-lg backdrop-blur-sm transition-colors hover:bg-white"
          onClick={() => setIsLegendCollapsed(false)}
        >
          <PanelLeftOpen size={14} className="text-figma-blue" />
          Mostrar legenda
        </button>
      ) : (
        <div className="absolute left-6 bottom-6 z-10 flex max-h-[calc(100vh-156px)] w-[360px] flex-col gap-3 overflow-hidden rounded-[8px] border border-figma-border bg-white/95 p-4 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-figma-text">
              <Zap size={13} className="text-figma-blue" />
              Legenda Operacional
            </div>

            <button
              className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-figma-border bg-white text-figma-text-muted transition-colors hover:bg-figma-bg hover:text-figma-text"
              onClick={() => setIsLegendCollapsed(true)}
              title="Ocultar legenda"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {legendGroups.map((group) => (
              <section
                className="rounded-[6px] border border-figma-border bg-figma-bg/70 p-3"
                key={group.id}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-figma-text-muted">
                    {PROJECT_VISUAL_GROUP_LABELS[group.id]}
                  </span>
                  <span className="rounded-[4px] bg-white px-1.5 py-0.5 text-[10px] font-mono text-figma-text-muted">
                    {group.summary}
                  </span>
                </div>

                <div className="space-y-2">
                  {group.items.length === 0 ? (
                    <div className="rounded-[4px] border border-dashed border-figma-border bg-white px-2 py-2 text-[10px] leading-relaxed text-figma-text-muted">
                      {group.emptyState}
                    </div>
                  ) : (
                    group.items.map((item) => (
                      <div
                        className="flex items-center justify-between gap-3 rounded-[4px] border border-figma-border bg-white px-2 py-2"
                        key={`${group.id}-${item.token.id}`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="inline-flex h-7 min-w-7 items-center justify-center rounded-[4px] border bg-white px-1 font-mono text-[10px] font-semibold"
                            style={{
                              backgroundColor: withAlpha(item.token.color, '14'),
                              borderColor: withAlpha(item.token.color, '36'),
                              color: item.token.color,
                            }}
                          >
                            <item.token.icon size={14} strokeWidth={2.1} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-figma-text">
                              {item.token.label}
                            </div>
                            <div className="text-[10px] leading-relaxed text-figma-text-muted">
                              {item.description}
                            </div>
                          </div>
                        </div>

                        <span className="rounded-[4px] bg-figma-bg px-1.5 py-0.5 text-[10px] font-mono text-figma-text">
                          {item.value}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

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

function buildLegendGroups(project: GeneratedProject): LegendGroupData[] {
  const productiveAreaCounts: Record<ProductiveAreaType, number> = {
    FLAT_PRODUCTIVE: 0,
    GENERAL_FILL: 0,
    SLOPE_PRODUCTIVE: 0,
    TOPO_CREST: 0,
  };
  const infrastructureCounts: Record<InfrastructureCategory, number> = {
    AGUA: 0,
    ANIMAL: 0,
    ENERGIA: 0,
    PROCESSAMENTO: 0,
  };
  const stratumCounts: Record<Stratum, number> = {
    ALTO: 0,
    BAIXO: 0,
    EMERGENTE: 0,
    MEDIO: 0,
    RASTEIRO: 0,
  };

  project.report.infrastructure.placements.forEach((placement) => {
    if (placement.status === 'placed' && placement.category) {
      infrastructureCounts[placement.category] += 1;
    }
  });

  project.productiveAreas.forEach((area) => {
    productiveAreaCounts[area.type] += 1;
  });

  project.plants.forEach((plant) => {
    stratumCounts[plant.stratum] += 1;
  });

  const baseItems: LegendGroupItem[] = [
    {
      description: 'Base habitacional e polo inicial do sistema.',
      token: getProjectVisualToken('residence'),
      value: `${project.residence.footprint.width}x${project.residence.footprint.length}m`,
    },
  ];

  if (project.residence.roofSolarAreaUsed > 0) {
    baseItems.push({
      description: 'Area fotovoltaica absorvida na cobertura.',
      token: getProjectVisualToken('solar-roof'),
      value: `${project.residence.roofSolarAreaUsed.toFixed(1)} m2`,
    });
  }

  if (project.groundSolarPlacement) {
    baseItems.push({
      description: 'Excedente solar posicionado no solo.',
      token: getProjectVisualToken('solar-ground'),
      value: `${project.groundSolarPlacement.providedArea.toFixed(1)} m2`,
    });
  }

  const guideItems: LegendGroupItem[] = [
    {
      description: 'Leitura hidrologica principal do relevo.',
      token: getProjectVisualToken('guide-keyline'),
      value: String(project.keylines.length),
    },
    {
      description: 'Valas em curva de nivel organizando a infiltracao e a ordem de plantio em encostas.',
      token: getProjectVisualToken('guide-swale'),
      value: String(project.swales.length),
    },
    {
      description: 'Rotas de acesso e manutencao do sistema.',
      token: getProjectVisualToken('guide-service-corridor'),
      value: String(project.serviceCorridors.length),
    },
  ];

  const productiveAreaItems = (
    ['TOPO_CREST', 'FLAT_PRODUCTIVE', 'SLOPE_PRODUCTIVE', 'GENERAL_FILL'] as const
  )
    .filter((type) => productiveAreaCounts[type] > 0)
    .map((type) => ({
      description:
        type === 'TOPO_CREST'
          ? 'Malhas nos pontos mais altos e estaveis do relevo.'
          : type === 'FLAT_PRODUCTIVE'
            ? 'Preenchimento plano e util ao redor das construcoes.'
            : type === 'SLOPE_PRODUCTIVE'
              ? 'Cultivo distribuido em encostas acompanhando a topografia.'
            : 'Fechamento residual da malha para eliminar sobras.',
      token: getProductiveAreaVisualToken(type),
      value: String(productiveAreaCounts[type]),
    }));

  const stratumItems = (
    ['EMERGENTE', 'ALTO', 'MEDIO', 'BAIXO', 'RASTEIRO'] as const
  )
    .filter((stratum) => stratumCounts[stratum] > 0)
    .map((stratum) => ({
      description: `${stratumCounts[stratum]} plantas com este estrato ativo na geracao.`,
      token: getStratumVisualToken(stratum),
      value: String(stratumCounts[stratum]),
    }));

  const infrastructureItems = (
    ['AGUA', 'ANIMAL', 'PROCESSAMENTO', 'ENERGIA'] as const
  )
    .filter((category) => infrastructureCounts[category] > 0)
    .map((category) => ({
      description: `${infrastructureCounts[category]} modulos alocados nesta categoria.`,
      token: getInfrastructureCategoryToken(category),
      value: String(infrastructureCounts[category]),
    }));

  return [
    {
      emptyState: 'Nenhum elemento base visivel nesta iteracao.',
      id: 'BASE',
      items: baseItems,
      summary: `${baseItems.length} tipos`,
    },
    {
      emptyState: 'Nenhuma geometria operacional disponivel.',
      id: 'GUIDES',
      items: guideItems,
      summary: `${project.keylines.length + project.serviceCorridors.length + project.swales.length} guias`,
    },
    {
      emptyState: 'Nenhuma area produtiva foi gerada nesta iteracao.',
      id: 'AREAS',
      items: productiveAreaItems,
      summary: `${project.productiveAreas.length} areas`,
    },
    {
      emptyState: 'Nenhum estrato botanico ativo nesta iteracao.',
      id: 'STRATA',
      items: stratumItems,
      summary: `${project.plants.length} plantas`,
    },
    {
      emptyState: 'Nenhuma infraestrutura secundaria foi alocada.',
      id: 'INFRA',
      items: infrastructureItems,
      summary: `${project.report.infrastructure.placed} modulos`,
    },
  ];
}
