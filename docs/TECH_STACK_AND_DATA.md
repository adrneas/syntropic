## 1. Pilha Tecnológica (Tech Stack)

A arquitetura do software exige alta performance no cliente para processamento espacial e renderização. Os agentes devem configurar o repositório base com as seguintes tecnologias restritas:

* **Core:** React (v18+) + TypeScript + Vite.
* **Gerenciamento de Estado:** Zustand (escolhido pela mínima sobrecarga de re-renders, crucial para interações rápidas na UI em paralelo ao WebGL).
* **Renderização 3D/Espacial:** Three.js orquestrado via `@react-three/fiber`. Para as primitivas botânicas instanciadas, utilizar `@react-three/drei` (especificamente o componente `Instances`).
* **Estilização UI:** TailwindCSS (para garantir um bundle leve e manutenção pragmática dos componentes do Wizard).
* **Banco de Dados Local:** O banco de espécies e componentes deve ser estruturado como arquivos JSON estáticos (hidratados na memória durante o *load* da aplicação), visto que o processamento ocorrerá inteiramente no *client-side*.

---

## 2. Estrutura de Dados Espaciais (Topologia)

Para garantir uma renderização a 60 FPS de terrenos que podem chegar a 500 hectares (5.000.000 de vértices a 1x1m), a abstração orientada a objetos (ex: criar um objeto de classe para cada "célula") é proibitiva. O sistema deve utilizar matrizes tipadas brutas.

### 2.1. Matriz Altimétrica (Z-Grid)
O estado primário da topografia não será uma matriz 2D de objetos, mas sim um único `Float32Array` unidimensional.
* **Mapeamento Indexado:** Para encontrar a elevação $Z$ de uma coordenada $(X, Y)$, a fórmula matemática de indexação linear deve ser estritamente aplicada: `index = (y * width) + x`.

```typescript
// Exemplo de alocação de memória para terreno genérico
const width = 100; // metros
const height = 100; // metros
// Array unidimensional contendo apenas a cota altimétrica (Z)
const elevationGrid = new Float32Array(width * height); 
```

### 2.2. Matriz de Ocupação (Collision e Instanciamento)
A grade de ocupação biológica/infraestrutura operará de forma paralela à malha altimétrica. Utilizaremos um `Uint16Array` ou `Int32Array` para atuar como um mapa de ponteiros, onde o valor em cada índice aponta para o ID da entidade (planta ou construção) ali alocada, ou `0` para espaço vazio.

---

## 3. Schemas do Banco de Dados Relacional (Estático)

O motor procedural precisa ler dados biológicos estruturados de forma padronizada. Os agentes devem construir os JSONs baseados nas seguintes interfaces estritas.

### 3.1. Schema Botânico (`ISpecies`)

A planta é a unidade fundamental da sucessão sintrópica. O schema deve contemplar os eixos de espaço (estrato) e tempo (ciclo).

```typescript
type Stratum = 'EMERGENTE' | 'ALTO' | 'MEDIO' | 'BAIXO' | 'RASTEIRO';
type SuccessionPhase = 'PLACENTA_I' | 'PLACENTA_II' | 'SECUNDARIA_I' | 'SECUNDARIA_II' | 'CLIMAX';
type ClimateZone = 'TROPICAL_UMIDO' | 'TROPICAL_SECO' | 'SEMIARIDO' | 'TEMPERADO' | 'SUBTROPICAL';

interface ISpecies {
  id: string;             // ex: "eucalyptus-grandis"
  popularName: string;    // ex: "Eucalipto"
  scientificName: string; // ex: "Eucalyptus grandis"
  stratum: Stratum;
  succession: SuccessionPhase;
  climateCompatibility: ClimateZone[]; // Climas onde a planta sobrevive
  waterRequirement: 'LOW' | 'MEDIUM' | 'HIGH';
  spacingArea: number;    // Área de projeção da copa/raiz em m² (determina a malha de colisão)
  
  // Matriz Lógica de Consórcio
  companions: string[];   // Array de IDs de espécies benéficas (simbiose)
  antagonists: string[];  // Array de IDs de espécies incompatíveis (alelopatia)
}
```

### 3.2. Schema de Infraestrutura (`IInfrastructure`)

As construções possuem "pegadas" (footprints) rígidas e regras de alocação baseadas na topografia e proximidade.

```typescript
interface IInfrastructure {
  id: string;               // ex: "cisterna-ferrocimento"
  name: string;             // ex: "Cisterna de Ferrocimento"
  category: 'AGUA' | 'ENERGIA' | 'ANIMAL' | 'PROCESSAMENTO';
  footprintWidth: number;   // Ocupação em X na grade (metros)
  footprintLength: number;  // Ocupação em Y na grade (metros)
  
  // Regras de Posicionamento para o Motor Procedural
  placementRules: {
    requiresKeyline: boolean;      // Precisa estar em uma linha de convergência de água?
    maxSlopePercentage: number;    // Inclinação máxima permitida para instalação
    proximityToResidence: 'NEAR' | 'FAR' | 'ANY'; // NEAR = < 50m, FAR = > 100m
  };
}
```
```