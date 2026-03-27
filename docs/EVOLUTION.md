# EVOLUTION.md - Divergências entre Documentação e Implementação

> Documento gerado em 2026-03-26.
> Base: `PROJECT_MASTER.md`, `TECH_STACK_AND_DATA.md`, `PROCEDURAL_GEN_ENGINE.md`, `UI_WIZARD_SPEC.md`
> Comparação: estado atual do código-fonte em `src/`

---

## 1. VISÃO GERAL

O projeto SSI (Sistema Sintrópico Inteligente) partiu de quatro documentos fundacionais que definiam arquitetura, stack, motor procedural e interface. Ao longo do desenvolvimento orgânico, a implementação **superou** a especificação original em vários eixos (algoritmos, tipos, UI), mas também **deixou para trás** alguns requisitos documentados. Este documento mapeia todas as divergências identificadas.

---

## 2. FUNCIONALIDADES DOCUMENTADAS MAS NÃO IMPLEMENTADAS

### 2.1. Toggle Isométrico/3D vs 2D (PROJECT_MASTER.md §4.2)

**Especificação:** "Add an `[Isometric/3D]` vs `[2D]` toggle button adjacent to the `[Altitude]` control."

**Estado atual:** O tipo `ViewMode = '2D' | '3D'` existe em `wizard.ts` e há um toggle funcional em `Step1Terrain.tsx`, mas ele controla a câmera (OrbitControls vs MapControls), não uma projeção isométrica verdadeira. A especificação original previa uma vista isométrica dedicada, distinta de uma câmera 3D livre.

**Impacto:** Baixo — a câmera 3D cumpre a intenção funcional, embora não seja isométrica.

---

### 2.2. Heatmap de Altimetria e Curvas de Nível no Editor (PROJECT_MASTER.md §4.2)

**Especificação:** "The altitude brush must dynamically apply a color gradient (Heatmap) and contour lines directly onto the WebGL mesh during interaction."

**Estado atual:** O `Scene.tsx` renderiza o terreno com geometria indexada e exibe o brush de elevação como um círculo, mas:
- **Heatmap gradient:** Não há shader de cor dinâmico baseado em altitude no modo editor. A coloração aparece apenas na visualização pós-geração.
- **Curvas de nível em tempo real:** Não implementadas no editor. Curvas de nível são calculadas apenas no motor procedural (`plantingLayout.ts` via marching squares) para gerar keylines/linhas de plantio.

**Impacto:** Médio — o usuário não tem feedback visual de altitude enquanto esculpe o terreno.

---

### 2.3. Upload de Dados de Altimetria (PROJECT_MASTER.md §5, STATE 1)

**Especificação:** "Altimetry sculpting (manual brush **or data upload**)."

**Estado atual:** Apenas o brush manual está implementado. Não há importação de DEM, GeoTIFF, CSV de altimetria ou qualquer formato externo.

**Impacto:** Alto para cenários reais — terrenos grandes dependem de dados topográficos reais.

---

### 2.4. Botão "Edit Requirements" Global (PROJECT_MASTER.md §5, STATE 5)

**Especificação:** "`[Edit Requirements]` button available **globally** to revert to previous states."

**Estado atual:** O botão "Editar Requisitos" existe apenas em `ProjectVisualization.tsx` (pós-geração). Durante o wizard, a navegação é por botões Voltar/Avançar. Não há acesso global ao botão de edição durante a geração ou em outros estados.

**Impacto:** Baixo — a navegação do wizard é suficiente durante o preenchimento.

---

### 2.5. Escala Configurável (PROJECT_MASTER.md §4.1)

**Especificação:** "Scale Selector: Fixed at '1m / square'."

**Estado atual:** A escala é de fato fixa (`DEFAULT_CELL_SIZE=1` em `terrain.ts`), mas o seletor visual de escala não existe na interface. O valor é hardcoded sem UI de confirmação.

**Impacto:** Nenhum funcional, mas há divergência visual com o mockup de referência.

---

## 3. FUNCIONALIDADES IMPLEMENTADAS MAS NÃO DOCUMENTADAS

### 3.1. Sistema de Undo/Redo para Polígono de Terreno

**Implementação:** `wizardStore.ts` contém um sistema completo de histórico com `undoTerrainPolygon()`, `redoTerrainPolygon()`, `commitTerrainPolygonHistory()`, e suporte a atalhos CMD+Z / CMD+SHIFT+Z em `Step1Terrain.tsx`.

**Documentação:** Apenas menção genérica a "Undo, Clear" em PROJECT_MASTER.md §4.1, sem detalhar o mecanismo de histórico.

---

### 3.2. Áreas Produtivas Tipificadas (productiveAreas.ts)

**Implementação:** Classificação de células em 4 tipos (`TOPO_CREST`, `FLAT_PRODUCTIVE`, `SLOPE_PRODUCTIVE`, `GENERAL_FILL`) via análise de inclinação e elevação, com flood-fill para merging de regiões adjacentes e vetorização de polígonos de contorno.

**Documentação:** Nenhuma menção em qualquer documento original. É um conceito emergente da evolução do motor.

---

### 3.3. Swales (Valas de Infiltração) (swales.ts)

**Implementação:** Módulo dedicado para geração de swales em áreas com inclinação, com reserva de células no `occupationGrid` (valor `-5`), orientação derivada do terreno, e limites por área produtiva.

**Documentação:** Não mencionado nos documentos originais. A especificação do motor (PROCEDURAL_GEN_ENGINE.md) foca em keylines e linhas de plantio, mas não menciona swales como elemento separado.

---

### 3.4. Corredores de Serviço (Service Corridors)

**Implementação:** `proceduralEngineCore.ts` gera corredores de serviço via BFS entre residência e infraestruturas, marcando-os no `occupationGrid` com valor `-4`.

**Documentação:** Não especificado. A documentação menciona "acessibilidade" como critério de posicionamento, mas não um sistema de corredores explícitos.

---

### 3.5. Perfis de Manejo Botânico

**Implementação:** `generation.ts` define:
- `PlantManagementZone`: ROW | INTERROW
- `PlantManagementProfile`: CUT_AND_DROP | MULCH_RETENTION | WINTER_COVER | MOWED_ACCESS | SERVICE_CORE
- `OperationalBand`: SERVICE_CORE | SUPPORT | FIELD

Cada planta recebe zona, perfil e banda operacional.

**Documentação:** Não existe referência a zonas de manejo, perfis ou bandas. O conceito de "inter-row" é mencionado apenas superficialmente.

---

### 3.6. Relatório Detalhado Pós-Geração (Step5Summary.tsx)

**Implementação:** Após a geração, o Step 5 exibe:
- Análise topográfica completa (elevações, inclinação, células restritas)
- Resultados botânicos (espécies, plantas, estratos, ciclo de manejo)
- Status de cada infraestrutura (posicionada/ignorada + justificativa)
- Métricas de layout (linhas, swales, corredores, cobertura, espaço morto)

**Documentação:** UI_WIZARD_SPEC.md menciona apenas "Resumo e Geração" com estados de loading genéricos.

---

### 3.7. Sistema de Tokens Visuais (projectVisualTokens.ts)

**Implementação:** Design system completo com 20+ tokens visuais organizados em 5 grupos (BASE, GUIDES, AREAS, STRATA, INFRA), cada um com cor, ícone, hint e label em português.

**Documentação:** Nenhuma menção a um sistema de design visual ou paleta de cores.

---

### 3.8. Barra de Resumo na Visualização do Projeto

**Implementação:** `ProjectVisualization.tsx` exibe barra inferior com: seed, infraestrutura colocada/requisitada, áreas produtivas, contagem de plantas, espécies compatíveis, razão de planura, status solar.

**Documentação:** Não previsto nos documentos originais.

---

## 4. DIVERGÊNCIAS CONCEITUAIS E ESTRUTURAIS

### 4.1. Modelo de Dados de Espécies

| Campo | TECH_STACK_AND_DATA.md | botanical.ts (implementado) |
|-------|------------------------|-----------------------------|
| `spacingArea` | Descrito como "m² de projeção de copa/raiz" | Implementado conforme ✓ |
| `companions` | Descrito como array de IDs | Implementado conforme ✓ |
| `antagonists` | Descrito como array de IDs | Implementado conforme ✓ |
| `waterRequirement` | LOW \| MEDIUM \| HIGH | Implementado conforme ✓ |
| `productiveFunction` | Não documentado | **Adicionado:** campo funcional (biomassa, fruto, etc.) |

**Status:** Schema implementado é superset do documentado.

---

### 4.2. Fases do Motor Procedural

| Fase | PROCEDURAL_GEN_ENGINE.md | Implementação |
|------|--------------------------|---------------|
| 1. Topografia | Slope + D8 Flow + Keylines + Sinks | `topography.ts`: Slope + Flow + Restriction + Flat grids ✓ |
| 2. Infraestrutura | Constraint satisfaction por categoria | `proceduralEngineCore.ts`: Implementado + Corredores de serviço (não documentado) |
| 3. Linhas Sintrópicas | Contour-parallel + Keylines | `plantingLayout.ts`: Marching squares + keylines + inter-rows ✓ |
| 4. Consórcio Botânico | Preenchimento por estrato | `botanicalLayout.ts` + `productiveAreas.ts` + `swales.ts`: **3 módulos** vs 1 fase documentada |

**Divergência principal:** A Fase 4 documentada como uma etapa monolítica foi decomposta em 3 subsistemas independentes (áreas produtivas, swales, layout botânico), cada um com seu próprio módulo e testes.

---

### 4.3. Algoritmo de Keylines

**Documentação:** "Contours intercepting main flow", espaçamento "every 4-6 meters".

**Implementação:** Marching Squares com 16 casos de lookup table. Keylines = cada 4ª curva de nível (`KEYLINE_FREQUENCY=4`). Espaçamento determinado dinamicamente pela inclinação média, não fixo em 4-6m.

---

### 4.4. Grid de Ocupação — Valores Semânticos

**Documentação:** "Uint16Array storing entity IDs (0 = empty)."

**Implementação:** `Int32Array` com valores negativos semânticos:
- `0` = vazio
- `-1` = residência
- `-2` = solar
- `-3` = botânico
- `-4` = corredor de serviço
- `-5` = swale
- `>0` = ID de infraestrutura

A mudança de `Uint16Array` para `Int32Array` foi necessária para suportar valores negativos.

---

### 4.5. Persistência

**Documentação (TECH_STACK_AND_DATA.md):** "Static JSON files in-memory (client-side only)."

**Implementação:** Zustand com middleware `persist` usando `localStorage`. Serialização customizada de typed arrays via `persistence.ts` (Float32Array, Int8Array, Int32Array, Uint8Array). O estado do wizard sobrevive a reloads de página — funcionalidade não prevista explicitamente.

---

### 4.6. Constantes de Distância e Tolerância

**Documentação:** Exemplos vagos ("Apiário > 50m", "raios de distanciamento").

**Implementação:** Sistema completo de regras em `infrastructure.ts`:
```typescript
placementRules: {
  requiresKeyline: boolean
  maxSlopePercentage: number
  maxCriticalSlopePercentage: number
  maxCriticalCellRatio: number
  maxAltitudeVariationMeters: number
  proximityToResidence: 'NEAR' | 'FAR' | 'ANY'
  preferredDistanceMinMeters: number
  preferredDistanceMaxMeters: number
  topographyPreference: 'LOWEST' | 'HIGHEST' | 'MID' | 'STABLE'
}
```

A implementação é ordens de magnitude mais rica que a especificação.

---

## 5. LIMITES E CONSTANTES HARDCODED (NÃO DOCUMENTADOS)

| Constante | Valor | Arquivo | Documentada? |
|-----------|-------|---------|--------------|
| `DEFAULT_TERRAIN_GRID_WIDTH` | 257 | `terrain.ts` | Parcial (TECH_STACK menciona 257×257) |
| `FLAT_SLOPE_THRESHOLD_PERCENT` | 6% | `topography.ts` | Não |
| `KEYLINE_FREQUENCY` | 4 | `plantingLayout.ts` | Não |
| `MIN_KEYLINES` / `MAX_KEYLINES` | 4 / 12 | `plantingLayout.ts` | Não |
| `MIN_PLANTING_ROWS` / `MAX_PLANTING_ROWS` | 18 / 72 | `plantingLayout.ts` | Não |
| `MAX_PLANTS` | 1800 | `botanicalLayout.ts` | Não |
| `MAX_PRODUCTIVE_SLOPE_PERCENT` | 65% | `productiveAreas.ts` | Não |
| `SOLAR_ROOF_UTILIZATION` | 0.65 | `proceduralEngineCore.ts` | Sim (PROCEDURAL_GEN_ENGINE.md) |
| `RESIDENCE_TERRAIN_TOLERANCE` | slope 12%, alt 1.4m | `proceduralEngineCore.ts` | Sim |

---

## 6. COBERTURA DE TESTES

**Documentação:** Nenhuma menção a estratégia de testes.

**Implementação atual:**
- `tests/engine/proceduralEngineCore.test.ts` — Motor principal
- `tests/engine/plantingLayout.test.ts` — Layout de plantio (novo)
- `tests/engine/productiveAreas.test.ts` — Áreas produtivas (novo)
- `tests/engine/swales.test.ts` — Swales (novo)

**Lacunas:** Sem testes para `topography.ts`, `botanicalLayout.ts`, componentes React, store, validação, ou persistência.

---

## 7. RESUMO DAS DIVERGÊNCIAS

### Implementação AQUÉM da documentação:
1. Heatmap de altitude no editor de terreno
2. Curvas de nível em tempo real no editor
3. Upload/importação de dados topográficos
4. Vista isométrica verdadeira (implementada como câmera 3D livre)
5. Seletor de escala visual na UI

### Implementação ALÉM da documentação:
1. Sistema de undo/redo com histórico
2. Áreas produtivas tipificadas (4 tipos)
3. Swales como elemento de projeto independente
4. Corredores de serviço via BFS
5. Perfis de manejo botânico (5 perfis + zonas + bandas)
6. Relatório detalhado pós-geração
7. Sistema de tokens visuais (20+ tokens)
8. Barra de resumo na visualização
9. Persistência em localStorage com serialização de typed arrays
10. Testes unitários para módulos do motor

### Divergências estruturais:
1. Fase 4 monolítica → decomposta em 3 módulos
2. OccupationGrid: Uint16Array → Int32Array com valores negativos semânticos
3. Keylines: espaçamento fixo → dinâmico por inclinação (marching squares)
4. Regras de infraestrutura: exemplos vagos → schema completo de placement rules
5. Constantes de motor: não documentadas, definidas empiricamente no código

---

## 8. RECOMENDAÇÕES

1. **Atualizar PROJECT_MASTER.md** para refletir os módulos de áreas produtivas, swales e corredores de serviço.
2. **Documentar constantes do motor** (MAX_PLANTS, KEYLINE_FREQUENCY, etc.) em PROCEDURAL_GEN_ENGINE.md.
3. **Registrar o schema de PlantManagementProfile** em TECH_STACK_AND_DATA.md, pois afeta a lógica de consórcio.
4. **Decidir sobre heatmap/contour no editor:** implementar ou remover da especificação.
5. **Avaliar importação de dados topográficos** como feature de alto impacto para uso real.
