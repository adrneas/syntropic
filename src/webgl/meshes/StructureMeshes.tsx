import {
  getInfrastructureCategoryToken,
  getProjectVisualToken,
} from '../../components/project/projectVisualTokens';
import type {
  InfrastructurePlacement,
  ResidencePlacement,
  SolarPlacement,
} from '../../core/types/generation';
import type { ProjectHoverLabel } from '../sceneTypes';
import { getInfrastructureColor, getInfrastructureHeight } from '../utils/inspectionEntities';

export interface ResidenceMeshProps {
  residence: ResidencePlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

export const ResidenceMesh = ({ residence, isSelected, onHoverChange, onSelect }: ResidenceMeshProps) => (
  <mesh
    castShadow
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    onPointerOut={() => onHoverChange(null)}
    onPointerOver={(event) => {
      event.stopPropagation();
      onHoverChange({
        id: 'residence',
        position: [residence.worldPosition.x, residence.worldPosition.z + 2.45, residence.worldPosition.y],
        subtitle: 'Estrutura base do sistema',
        title: 'Residencia principal',
        visualTokenId: 'residence',
      });
    }}
    position={[residence.worldPosition.x, residence.worldPosition.z + 1.05, residence.worldPosition.y]}
    rotation={[0, residence.rotationRadians, 0]}
    receiveShadow
  >
    <boxGeometry args={[residence.footprint.width, 2.1, residence.footprint.length]} />
    <meshStandardMaterial
      color={isSelected ? '#274c77' : getProjectVisualToken('residence').color}
      roughness={0.7}
    />
  </mesh>
);

export interface RoofSolarMeshProps {
  residence: ResidencePlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

export const RoofSolarMesh = ({ residence, isSelected, onHoverChange, onSelect }: RoofSolarMeshProps) => (
  <mesh
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    onPointerOut={() => onHoverChange(null)}
    onPointerOver={(event) => {
      event.stopPropagation();
      onHoverChange({
        id: 'solar-roof',
        position: [residence.worldPosition.x, residence.worldPosition.z + 2.75, residence.worldPosition.y],
        subtitle: 'Energia integrada a cobertura',
        title: 'Painel solar integrado',
        visualTokenId: 'solar-roof',
      });
    }}
    position={[residence.worldPosition.x, residence.worldPosition.z + 2.12, residence.worldPosition.y]}
    rotation={[-Math.PI / 2, residence.rotationRadians, 0]}
  >
    <planeGeometry args={[residence.footprint.width * 0.84, residence.footprint.length * 0.84]} />
    <meshStandardMaterial
      color={isSelected ? '#4fd1ff' : getProjectVisualToken('solar-roof').color}
      metalness={0.25}
      roughness={0.35}
    />
  </mesh>
);

export interface GroundSolarMeshProps {
  solar: SolarPlacement;
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

export const GroundSolarMesh = ({ solar, isSelected, onHoverChange, onSelect }: GroundSolarMeshProps) => (
  <mesh
    castShadow
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    onPointerOut={() => onHoverChange(null)}
    onPointerOver={(event) => {
      event.stopPropagation();
      onHoverChange({
        id: 'solar-ground',
        position: [solar.worldPosition.x, solar.worldPosition.z + 1.05, solar.worldPosition.y],
        subtitle: 'Energia complementar no terreno',
        title: 'Array solar em solo',
        visualTokenId: 'solar-ground',
      });
    }}
    position={[solar.worldPosition.x, solar.worldPosition.z + 0.18, solar.worldPosition.y]}
    rotation={[0, solar.rotationRadians, 0]}
    receiveShadow
  >
    <boxGeometry args={[solar.footprint.width, 0.36, solar.footprint.length]} />
    <meshStandardMaterial
      color={isSelected ? '#4fd1ff' : getProjectVisualToken('solar-ground').color}
      metalness={0.3}
      roughness={0.4}
    />
  </mesh>
);

export interface InfrastructureMeshProps {
  placement: InfrastructurePlacement & {
    category: NonNullable<InfrastructurePlacement['category']>;
    footprint: NonNullable<InfrastructurePlacement['footprint']>;
    worldPosition: NonNullable<InfrastructurePlacement['worldPosition']>;
  };
  isSelected: boolean;
  onHoverChange: (hoverLabel: ProjectHoverLabel | null) => void;
  onSelect: () => void;
}

export const InfrastructureMesh = ({ placement, isSelected, onHoverChange, onSelect }: InfrastructureMeshProps) => {
  const color = getInfrastructureColor(placement.category, isSelected);
  const height = getInfrastructureHeight(placement.category);

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
        const token = getInfrastructureCategoryToken(placement.category);
        onHoverChange({
          id: `infra-${placement.infrastructureId}`,
          position: [placement.worldPosition.x, placement.worldPosition.z + height + 0.7, placement.worldPosition.y],
          subtitle: token.label,
          title: placement.name,
          visualTokenId: token.id,
        });
      }}
      position={[placement.worldPosition.x, placement.worldPosition.z + height / 2, placement.worldPosition.y]}
      receiveShadow
    >
      <boxGeometry args={[placement.footprint.width, height, placement.footprint.length]} />
      <meshStandardMaterial color={color} roughness={0.65} />
    </mesh>
  );
};
