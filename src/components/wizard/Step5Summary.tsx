import { AlertTriangle, Cpu, Database, MapPinned, Trees } from 'lucide-react';
import { useWizardStore } from '../../store/wizardStore';

export const Step5Summary = () => {
  const state = useWizardStore();
  const report = state.generatedProject?.report;

  return (
    <div className="flex w-[760px] flex-col rounded-[3px] border border-figma-border bg-figma-panel shadow-sm">
      <div className="flex h-10 items-center gap-2 border-b border-figma-border px-4 text-[11px] font-semibold uppercase tracking-wide text-figma-text">
        <Cpu size={13} className="text-figma-success" />
        Procedural Engine Pre-Flight
      </div>

      <div className="flex flex-col gap-5 bg-figma-bg p-5">
        <div className="flex w-full gap-2 rounded-[3px] border border-[#bce4ff] bg-[#e5f4ff] p-2 text-[11px] text-[#0065a8]">
          <span className="font-semibold text-figma-blue">INFO</span>
          <span>Revise os tokens de entrada e execute a primeira analise topografica do projeto.</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SummaryCard
            title="1. Terreno Topografico"
            rows={[
              ['Poligono', `${state.terrain.polygon.length} vertices`],
              ['Area', `${state.terrain.area} m2`],
              ['Norte', `${state.terrain.northAngle}°`],
              ['Malha', `${state.terrain.gridWidth} x ${state.terrain.gridHeight}`],
            ]}
          />

          <SummaryCard
            title="2. Carga Energetica"
            rows={[
              ['Area primaria', `${state.residence.area} m2`],
              ['Consumo calculado', `${state.residence.calculatedSolarNeed} kWh`],
              ['Appliances', `${Object.keys(state.residence.appliances).length} itens`],
            ]}
          />

          <SummaryCard
            title="3. Configuracao Bioclimatica"
            rows={[
              ['Clima', state.climate || 'Nao selecionado'],
              ['Status', report ? `${report.botanical.compatibleSpeciesCount} especies compativeis` : 'Aguardando analise'],
            ]}
          />

          <SummaryCard
            title="4. Infraestrutura"
            rows={[
              ['Solicitadas', `${state.preferences.infrastructure.length}`],
              ['Status', report ? `${report.infrastructure.placed} alocadas` : 'Aguardando analise'],
            ]}
          />
        </div>

        {state.generationStatus === 'processing' && (
          <div className="flex items-center justify-center gap-2 rounded-[3px] border border-[#bce4ff] bg-[#e5f4ff] p-3 text-[11px] font-medium text-figma-blue animate-pulse">
            <Database size={13} className="animate-spin" />
            Executando slope map, fluxo D8 e avaliacao de alocacao de infraestrutura...
          </div>
        )}

        {state.generationStatus === 'error' && state.generationError && (
          <div className="flex items-start gap-2 rounded-[3px] border border-[#ffd7cc] bg-[#fff1ee] p-3 text-[11px] text-figma-danger">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{state.generationError}</span>
          </div>
        )}

        {report && (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[3px] border border-figma-border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-figma-text">
                <MapPinned size={13} className="text-figma-blue" />
                Analise Topografica
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Metric label="Cota minima" value={`${report.topography.minElevation}m`} />
                <Metric label="Cota maxima" value={`${report.topography.maxElevation}m`} />
                <Metric label="Cota media" value={`${report.topography.averageElevation}m`} />
                <Metric label="Declive max." value={`${report.topography.maxSlopePercent}%`} />
                <Metric label="Areas planas" value={`${report.topography.flatCellCount} celulas`} />
                <Metric label="Sinks" value={`${report.topography.sinkCount}`} />
                <Metric label="Restricoes" value={`${report.topography.restrictedCellCount} celulas`} />
              </div>
            </div>

            <div className="rounded-[3px] border border-figma-border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-figma-text">
                <Trees size={13} className="text-figma-success" />
                Resultado Inicial
              </div>
              <div className="space-y-2">
                <Metric label="Seed" value={`${report.seed}`} />
                <Metric label="Infra solicitadas" value={`${report.infrastructure.requested}`} />
                <Metric label="Infra alocadas" value={`${report.infrastructure.placed}`} />
                <Metric label="Corredores" value={`${report.layout.serviceCorridorCount}`} />
                <Metric label="Entrelinhas" value={`${report.layout.interRowCount}`} />
                <Metric label="Manejo base" value={`${report.botanical.dominantInterRowProfile}`} />
                <Metric label="Ciclo medio" value={`${report.botanical.averageInterRowMaintenanceCycleDays} dias`} />
                <Metric label="Banco botanico" value={`${report.botanical.compatibleSpeciesCount} especies`} />
              </div>
            </div>

            <div className="col-span-2 rounded-[3px] border border-figma-border bg-white p-4 shadow-sm">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-figma-text">
                Alocacao de Infraestrutura
              </div>
              <div className="space-y-2 text-[11px]">
                {report.infrastructure.placements.length === 0 && (
                  <div className="rounded-[3px] border border-dashed border-figma-border bg-figma-bg px-3 py-2 text-figma-text-muted">
                    Nenhuma infraestrutura selecionada nesta iteracao.
                  </div>
                )}

                {report.infrastructure.placements.map((placement) => (
                  <div
                    key={placement.infrastructureId}
                    className={`rounded-[3px] border px-3 py-2 ${
                      placement.status === 'placed'
                        ? 'border-[#bce4ff] bg-[#f4fbff]'
                        : 'border-[#ffd7cc] bg-[#fff7f5]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-figma-text">{placement.name}</span>
                      <span
                        className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] ${
                          placement.status === 'placed' ? 'bg-[#e5f4ff] text-figma-blue' : 'bg-[#fff1ee] text-figma-danger'
                        }`}
                      >
                        {placement.status}
                      </span>
                    </div>
                    <div className="mt-1 text-figma-text-muted">{placement.rationale}</div>
                    {placement.worldPosition && (
                      <div className="mt-2 font-mono text-[10px] text-figma-text">
                        x={placement.worldPosition.x.toFixed(1)} y={placement.worldPosition.y.toFixed(1)} z={placement.worldPosition.z.toFixed(1)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface SummaryCardProps {
  title: string;
  rows: Array<[string, string]>;
}

const SummaryCard = ({ title, rows }: SummaryCardProps) => (
  <div className="rounded-[3px] border border-figma-border bg-white p-3 shadow-sm">
    <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-figma-text-muted">{title}</div>
    <div className="space-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 text-[11px]">
          <span className="text-figma-text-muted">{label}</span>
          <span className="rounded-sm border border-neutral-100 bg-figma-bg px-1 font-mono text-figma-text">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

interface MetricProps {
  label: string;
  value: string;
}

const Metric = ({ label, value }: MetricProps) => (
  <div className="rounded-[3px] border border-figma-border bg-figma-bg px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-wide text-figma-text-muted">{label}</div>
    <div className="mt-1 font-mono text-[12px] text-figma-text">{value}</div>
  </div>
);
