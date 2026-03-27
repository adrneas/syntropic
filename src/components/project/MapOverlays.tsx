import { useMemo } from 'react';
import { Mountain, Ruler, TrendingUp } from 'lucide-react';
import type { GeneratedProject } from '../../core/types/generation';

interface MapOverlaysProps {
  northAngle: number;
  terrainArea: number;
  report: GeneratedProject['report'];
  cameraZoom: number;
  showNorth?: boolean;
  showScale?: boolean;
  showMetrics?: boolean;
  onCollapseNorth?: () => void;
  onCollapseScale?: () => void;
  onCollapseMetrics?: () => void;
}

function CollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-figma-border bg-white text-figma-text-muted transition-colors hover:bg-figma-bg hover:text-figma-text"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Minimizar"
    >
      <svg height="10" viewBox="0 0 10 10" width="10">
        <line stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" x1="3" x2="7" y1="5" y2="5" />
      </svg>
    </button>
  );
}

export function MapOverlays({
  northAngle,
  terrainArea,
  report,
  cameraZoom,
  showNorth = true,
  showScale = true,
  showMetrics = true,
  onCollapseNorth,
  onCollapseScale,
  onCollapseMetrics,
}: MapOverlaysProps) {
  const { minElevation, maxElevation, averageElevation, maxSlopePercent } = report.topography;
  const elevRange = maxElevation - minElevation;

  return (
    <>
      {/* North indicator — top-right, beside summary panel */}
      {showNorth && (
        <div className="absolute right-[348px] top-6 z-10 flex flex-col items-center rounded-[8px] border border-figma-border bg-white/95 p-2.5 shadow-lg backdrop-blur-sm">
          <div className="flex w-full justify-end">
            {onCollapseNorth && <CollapseButton onClick={onCollapseNorth} />}
          </div>
          <svg
            height="44"
            style={{ transform: `rotate(${northAngle}deg)` }}
            viewBox="0 0 44 44"
            width="44"
          >
            <circle
              cx="22"
              cy="22"
              fill="none"
              opacity="0.15"
              r="20"
              stroke="#333"
              strokeWidth="1"
            />
            <polygon fill="#e53e3e" points="22,4 18,22 22,19 26,22" />
            <polygon fill="#a0aec0" points="22,40 18,22 22,25 26,22" />
            <text
              dominantBaseline="middle"
              fill="#e53e3e"
              fontSize="7"
              fontWeight="700"
              textAnchor="middle"
              x="22"
              y="13"
            >
              N
            </text>
          </svg>
          <span className="mt-1 text-[9px] font-medium text-figma-text-muted">
            {northAngle}°
          </span>
        </div>
      )}

      {/* Scale bar — bottom-left */}
      {showScale && (
        <div className="absolute bottom-6 left-6 z-10 flex items-center gap-2 rounded-[8px] border border-figma-border bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm">
          <Ruler className="text-figma-text-muted" size={12} />
          <ScaleBar cameraZoom={cameraZoom} />
          {onCollapseScale && <CollapseButton onClick={onCollapseScale} />}
        </div>
      )}

      {/* Terrain metrics — bottom-center */}
      {showMetrics && (
        <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-[8px] border border-figma-border bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
          <MetricItem
            icon={<Mountain size={12} />}
            label="Elevacao"
            value={`${minElevation.toFixed(1)}–${maxElevation.toFixed(1)}m`}
          />
          <div className="h-5 w-px bg-figma-border" />
          <MetricItem
            label="Desnivel"
            value={`${elevRange.toFixed(1)}m`}
          />
          <div className="h-5 w-px bg-figma-border" />
          <MetricItem
            label="Media"
            value={`${averageElevation.toFixed(1)}m`}
          />
          <div className="h-5 w-px bg-figma-border" />
          <MetricItem
            icon={<TrendingUp size={12} />}
            label="Declive max"
            value={`${maxSlopePercent.toFixed(0)}%`}
          />
          <div className="h-5 w-px bg-figma-border" />
          <MetricItem
            label="Area"
            value={`${terrainArea.toFixed(0)} m²`}
          />
          {onCollapseMetrics && (
            <>
              <div className="h-5 w-px bg-figma-border" />
              <CollapseButton onClick={onCollapseMetrics} />
            </>
          )}
        </div>
      )}
    </>
  );
}

function MetricItem({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-figma-text-muted">
        {icon}
        {label}
      </div>
      <span className="text-[12px] font-semibold text-figma-text">{value}</span>
    </div>
  );
}

const NICE_SCALES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const SCALE_BAR_TARGET_PX = 80;

function ScaleBar({ cameraZoom }: { cameraZoom: number }) {
  const { barMeters, barPx } = useMemo(() => {
    const metersInTarget = SCALE_BAR_TARGET_PX / Math.max(cameraZoom, 1);
    const nice = NICE_SCALES.find((s) => s >= metersInTarget) ?? NICE_SCALES[NICE_SCALES.length - 1];
    const px = Math.round(nice * cameraZoom);
    return { barMeters: nice, barPx: Math.min(px, 160) };
  }, [cameraZoom]);

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-end">
        <div className="h-[6px] w-px bg-figma-text" />
        <div className="h-px bg-figma-text" style={{ width: barPx }} />
        <div className="h-[6px] w-px bg-figma-text" />
      </div>
      <span className="text-[10px] font-medium text-figma-text-muted">
        {barMeters >= 1000 ? `${barMeters / 1000}km` : `${barMeters}m`}
      </span>
    </div>
  );
}
