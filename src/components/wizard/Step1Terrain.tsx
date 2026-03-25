import { useEffect } from 'react';
import { Cuboid, Map, MousePointer2, Pencil, RotateCcw, RotateCw, Spline, Trash2 } from 'lucide-react';
import { Scene } from '../../webgl/Scene';
import { useWizardStore } from '../../store/wizardStore';

export const Step1Terrain = () => {
  const {
    brushSize,
    clearTerrain,
    history,
    setBrushSize,
    setToolMode,
    setViewMode,
    terrain,
    toolMode,
    undoTerrainPolygon,
    redoTerrainPolygon,
    updateNorthAngle,
    viewMode,
  } = useWizardStore();
  const canOpen3DView = terrain.polygon.length >= 3 && terrain.area > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();

        if (event.shiftKey) {
          redoTerrainPolygon();
        } else {
          undoTerrainPolygon();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redoTerrainPolygon, undoTerrainPolygon]);

  useEffect(() => {
    if (!canOpen3DView && viewMode === '3D') {
      setViewMode('2D');
    }
  }, [canOpen3DView, setViewMode, viewMode]);

  const elevationVariation = terrain.elevationGrid.reduce(
    (accumulator, height) => {
      accumulator.min = Math.min(accumulator.min, height);
      accumulator.max = Math.max(accumulator.max, height);

      return accumulator;
    },
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  );
  const elevationLabel =
    elevationVariation.max === elevationVariation.min
      ? 'Plano base'
      : `${elevationVariation.min.toFixed(1)}m a ${elevationVariation.max.toFixed(1)}m`;

  return (
    <div className="absolute inset-0 flex h-full w-full flex-col overflow-hidden bg-figma-bg">
      <div className="absolute inset-0 z-0 h-full w-full">
        <Scene />
      </div>

      <div className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-1 rounded-[6px] border border-figma-border bg-white p-1.5 shadow-sm">
        <button
          onClick={() => setToolMode('select')}
          className={`flex h-8 w-8 items-center justify-center rounded-[4px] transition-colors ${
            toolMode === 'select' ? 'bg-[#e5f4ff] text-figma-blue' : 'text-figma-text-muted hover:bg-neutral-100 hover:text-figma-text'
          }`}
          title="Selecionar vertices"
        >
          <MousePointer2 size={15} strokeWidth={2.5} />
        </button>
        <button
          onClick={() => {
            setToolMode('draw');
            setViewMode('2D');
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-[4px] transition-colors ${
            toolMode === 'draw' ? 'bg-[#e5f4ff] text-figma-blue' : 'text-figma-text-muted hover:bg-neutral-100 hover:text-figma-text'
          }`}
          title="Desenhar poligono"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={() => setToolMode('elevation')}
          className={`flex h-8 w-8 items-center justify-center rounded-[4px] transition-colors ${
            toolMode === 'elevation' ? 'bg-[#e5f4ff] text-figma-blue' : 'text-figma-text-muted hover:bg-neutral-100 hover:text-figma-text'
          }`}
          title="Esculpir altitude"
        >
          <Spline size={15} />
        </button>

        <div className="mx-1 h-5 w-px bg-neutral-200" />

        <div className="flex rounded-[4px] bg-neutral-100 p-0.5">
          <button
            onClick={() => setViewMode('2D')}
            className={`flex h-7 items-center gap-1.5 rounded-[3px] px-3 text-[11px] font-medium transition-all ${
              viewMode === '2D' ? 'bg-white text-figma-text shadow-sm' : 'text-figma-text-muted hover:text-figma-text'
            }`}
          >
            <Map size={13} /> 2D
          </button>
          <button
            onClick={() => {
              if (!canOpen3DView) {
                return;
              }

              setViewMode('3D');
              setToolMode('select');
            }}
            disabled={!canOpen3DView}
            className={`flex h-7 items-center gap-1.5 rounded-[3px] px-3 text-[11px] font-medium transition-all ${
              viewMode === '3D'
                ? 'bg-white text-figma-text shadow-sm'
                : 'text-figma-text-muted hover:text-figma-text disabled:cursor-not-allowed disabled:opacity-45'
            }`}
            title={canOpen3DView ? 'Visualizacao 3D' : 'Feche um poligono valido no 2D para habilitar o 3D'}
          >
            <Cuboid size={13} /> 3D
          </button>
        </div>

        <div className="mx-1 h-5 w-px bg-neutral-200" />

        <button
          onClick={undoTerrainPolygon}
          disabled={history.past.length === 0}
          className="flex h-8 w-8 items-center justify-center rounded-[4px] text-figma-text-muted transition-colors hover:bg-neutral-100 hover:text-figma-text disabled:cursor-not-allowed disabled:opacity-40"
          title="Desfazer"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={redoTerrainPolygon}
          disabled={history.future.length === 0}
          className="flex h-8 w-8 items-center justify-center rounded-[4px] text-figma-text-muted transition-colors hover:bg-neutral-100 hover:text-figma-text disabled:cursor-not-allowed disabled:opacity-40"
          title="Refazer"
        >
          <RotateCw size={14} />
        </button>
        <button
          onClick={clearTerrain}
          className="flex h-8 w-8 items-center justify-center rounded-[4px] text-figma-danger transition-colors hover:bg-[#fff1ee]"
          title="Limpar terreno"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="absolute right-6 top-6 z-10 flex w-[300px] flex-col overflow-hidden rounded-[6px] border border-figma-border bg-white shadow-md">
        <div className="flex h-10 items-center border-b border-figma-border px-4 text-[11px] font-semibold uppercase tracking-wide text-figma-text">
          Configuracoes do Terreno
        </div>

        <div className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Vertices" value={String(terrain.polygon.length)} />
            <Metric label="Area" value={`${terrain.area} m2`} />
            <Metric label="Resolucao" value={`${terrain.cellSize}m`} />
            <Metric label="Malha" value={`${terrain.gridWidth}x${terrain.gridHeight}`} />
          </div>

          <div className="h-px w-full bg-figma-border" />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-figma-text-muted">Norte</span>
              <span className="rounded-[3px] bg-[#e5f4ff] px-1.5 py-0.5 font-mono text-[11px] font-bold text-figma-blue">
                {terrain.northAngle}°
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="359"
              step="1"
              value={terrain.northAngle}
              onChange={(event) => updateNorthAngle(Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-figma-blue"
            />

            <input
              type="number"
              min="0"
              max="359"
              value={terrain.northAngle}
              onChange={(event) => updateNorthAngle(Math.max(0, Math.min(359, Number(event.target.value) || 0)))}
              className="figma-input w-full bg-figma-bg text-right text-[12px] font-mono"
            />
          </div>

          {toolMode === 'elevation' && (
            <>
              <div className="h-px w-full bg-figma-border" />

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-figma-text-muted">Pincel</span>
                  <span className="rounded-[3px] bg-[#e5f4ff] px-1.5 py-0.5 font-mono text-[11px] font-bold text-figma-blue">
                    {brushSize}m
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="50"
                  step="1"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-figma-blue"
                />
              </div>
            </>
          )}

          <div className="h-px w-full bg-figma-border" />

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-figma-text-muted">Altimetria</span>
            <span className="rounded-[4px] border border-dashed border-figma-blue bg-[#e5f4ff] px-3 py-2 text-center text-[11px] font-medium text-figma-blue">
              {elevationLabel}
            </span>
            <p className="text-[11px] leading-relaxed text-figma-text-muted">
              Desenhe o perimetro em 2D, ajuste o norte e feche um poligono valido para liberar a visualizacao 3D.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

interface MetricProps {
  label: string;
  value: string;
}

const Metric = ({ label, value }: MetricProps) => (
  <div className="rounded-[4px] border border-figma-border bg-figma-bg p-2">
    <div className="text-[10px] font-bold uppercase tracking-wide text-figma-text-muted">{label}</div>
    <div className="mt-1 font-mono text-[12px] text-figma-text">{value}</div>
  </div>
);
