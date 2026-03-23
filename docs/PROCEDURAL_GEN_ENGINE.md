## 1. Arquitetura do Pipeline de Geração (Execution Pipeline)

O `ProceduralEngine` é uma função síncrona ou baseada em Web Workers (para não bloquear a thread principal) que recebe o `WizardState` completo e retorna duas estruturas de dados: a `OccupationGrid` (Matriz 2D de instâncias) e o `ProjectReport` (JSON com métricas geradas).

A execução deve seguir estritamente a seguinte ordem hierárquica:
1.  **Phase 1: Análise Físico-Hidrológica** (Processamento da Matriz Z).
2.  **Phase 2: Alocação de Infraestrutura** (Resolução de Restrições Espaciais).
3.  **Phase 3: Traçado de Linhas Sintrópicas** (Geometria de Plantio).
4.  **Phase 4: Preenchimento de Consórcios Botânicos** (Lógica Biológica).

---

## 2. Phase 1: Análise Físico-Hidrológica

O motor não possui "visão", logo, precisa interpretar o `Float32Array` de altimetria matematicamente.

### 2.1. Cálculo de Inclinação (Slope Map)
Para cada célula `(x, y)`, calcular o gradiente percentual em relação aos seus 8 vizinhos.
* **Regra de Ocupação:** Áreas com inclinação > 45% são marcadas em uma matriz paralela `RestrictionGrid` como zonas inaptas para infraestrutura pesada, sendo reservadas para plantio florestal de raízes profundas (contenção).

### 2.2. Algoritmo de Direção de Fluxo (D8 Flow) e Acúmulo
* **Implementação:** Identificar para qual dos 8 vizinhos a água escorreria (maior diferença de cota negativa).
* **Identificação de Keylines:** Linhas de contorno que interceptam o fluxo principal de descida. As *keylines* servirão como guias base (splines matemáticas) para o desenho das linhas de plantio.
* **Identificação de Bacias Locais (Sinks):** Células para onde o fluxo converge sem saída imediata. Estas coordenadas `(x, y)` são armazenadas no array `hydrologicalSinks`.

---

## 3. Phase 2: Alocação de Infraestrutura

Esta etapa resolve um Problema de Satisfação de Restrições (CSP). A infraestrutura deve ser posicionada antes das plantas, pois cria zonas de exclusão (footprints) na malha.

### 3.1. Processamento da Residência e Energia (Prioridade 0)
* **Alocação Solar:** O motor lê `residence.calculatedSolarNeed`. O algoritmo verifica a área da residência informada. Se a área do telhado comportar os painéis necessários, eles são anexados ao polígono da casa. Se houver excedente, uma área de solo adjacente à casa (idealmente ao Norte, sem bloqueio solar) é alocada e marcada na `OccupationGrid`.

### 3.2. Posicionamento por Categoria (Array `preferences.infrastructure`)
Iterar sobre os itens selecionados aplicando regras determinísticas:
* **Elementos Hídricos (Cisterna, Aquicultura):** Buscar as coordenadas no array `hydrologicalSinks` (pontos baixos). Tentar encaixar o `footprint` (ex: 5x5m para lago). Se o terreno permitir, marcar na grade e registrar como obstáculo.
* **Elementos Zootécnicos (Aviário, Apiário, Biodigestor):** Aplicar raios de distanciamento a partir da coordenada da residência. Ex: Apiário exige distância mínima euclidiana $d > 50m$ da casa.
* **Elementos Operacionais (Compostagem, Viveiro):** Posicionar em raio intermediário ($10m < d < 30m$) da residência, preferencialmente adjacentes às vias de acesso primárias.

---

## 4. Phase 3: Traçado de Linhas Sintrópicas (Skeleton Mapping)

Com os obstáculos fixados, o sistema define o "esqueleto" do plantio.

* **Geração de Guias:** A partir da cota mais alta do polígono do terreno, projetar curvas paralelas às *Keylines* calculadas na Phase 1, espaçadas por uma distância padrão (ex: 4 a 6 metros, dependendo do maquinário ou manejo humano parametrizado).
* **Diferenciação Espacial:** A grade agora possui dois estados booleanos para áreas não ocupadas por infraestrutura:
    * `isPlantingRow`: Linhas densas onde a sucessão ocorrerá.
    * `isInterRow`: Entrelinhas (geralmente mantidas com gramíneas para roçada e aporte de biomassa).

---

## 5. Phase 4: Preenchimento de Consórcios Botânicos

Esta é a iteração final, onde as células marcadas como `isPlantingRow` recebem as instâncias vegetais.

### 5.1. Filtragem da Biblioteca
* Ler o estado `climate` (ex: "TROPICAL_UMIDO"). Executar um `filter()` no banco estático de espécies, retendo apenas as plantas compatíveis.

### 5.2. O Algoritmo de Densidade e Estratificação
A lógica sintrópica dita que o espaço seja ocupado por luz. O motor percorrerá cada coordenada das linhas de plantio executando um loop por estrato:

1.  **Estrato Emergente (Ocupação ~20%):** Sortear do array filtrado uma espécie Emergente (ex: Eucalipto). Inserir na malha a cada $N$ metros (calculado pelo raio da copa `spacingArea`).
2.  **Estrato Alto (Ocupação ~40%):** Preencher os espaços vazios entre os emergentes com espécies de estrato Alto (ex: Mogno, Jaca), validando contra o array `antagonists` do banco de dados. Se a planta escolhida for antagonista do vizinho emergente já plantado, sortear outra.
3.  **Estratos Médio e Baixo (Ocupação 60-80%):** Preencher agressivamente as lacunas restantes com bananeiras, cacau, café, etc.
4.  **Tempo (Ciclos de Vida):** O consórcio gerado para cada bloco espacial deve conter obrigatoriamente misturas de plantas Placenta (ciclo curto, ex: rabanete, milho) para cobrir o solo nos primeiros meses, e plantas de ciclo longo (Clímax). O motor deve instanciar ambas na mesma área de influência espacial.

### 5.3. Saída Final (Output Mapping)
* Cada planta selecionada tem seu ID, coordenada `(X, Y, Z)`, e um fator de escala (levemente randomizado em $\pm 10\%$ para quebrar repetições visuais no WebGL) escritos em arrays contíguos (`Float32Array` para transformações, `Uint16Array` para IDs de instância).
* Estes buffers são passados diretamente para a engine Three.js para renderizar as `InstancedMesh`.

---

## 6. Constraints de Performance para Agentes
* **Zero Instanciação de Objetos no Loop Interno:** Durante o preenchimento da Phase 4, evite criar novos objetos JavaScript `{}` dentro do loop de varredura de vértices para evitar *Garbage Collection* agressivo. Opere alterando valores dentro dos buffers previamente alocados.
* **Determinismo Rigoroso:** Utilize um Gerador de Números Pseudoaleatórios (PRNG) com uma "semente" (seed) fixa baseada nas coordenadas do terreno. Isso garante que a mesma topologia com as mesmas configurações sempre gere exatamente a mesma floresta, permitindo reversibilidade sem armazenar toda a matriz gerada no banco de dados do usuário.