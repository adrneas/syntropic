import {
  getPlantVisualSubtitle,
  getStratumVisualToken,
} from '../../components/project/projectVisualTokens';
import type { BotanicalPlacement } from '../../core/types/generation';
import type { ProjectHoverLabel } from '../sceneTypes';
import { getPlantVisualRadius, getStratumColor } from '../utils/inspectionEntities';

export interface PlantMeshProps {
  plant: BotanicalPlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

export const PlantMesh = ({ plant, isSelected, onHoverChange, onSelect }: PlantMeshProps) => {
  const radius = getPlantVisualRadius(plant);

  return (
    <mesh
      castShadow
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOut={() => onHoverChange(null)}
      onPointerOver={(event) => {
        event.stopPropagation();
        const token = getStratumVisualToken(plant.stratum);
        onHoverChange({
          id: plant.id,
          position: [plant.worldPosition.x, plant.worldPosition.z + radius * 2.3, plant.worldPosition.y],
          subtitle: getPlantVisualSubtitle(plant.stratum, plant.managementZone),
          title: plant.popularName,
          visualTokenId: token.id,
        });
      }}
      position={[plant.worldPosition.x, plant.worldPosition.z + radius, plant.worldPosition.y]}
      receiveShadow
    >
      <sphereGeometry args={[radius, 12, 12]} />
      <meshStandardMaterial
        color={getStratumColor(plant.stratum, isSelected, plant.managementZone)}
        roughness={0.8}
      />
    </mesh>
  );
};
