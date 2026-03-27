# PLANO DE APRIMORAMENTOS — Motor Procedural SSI

> Documento gerado em 2026-03-26.
> Baseado na análise cruzada entre documentação fundacional, código-fonte e resultados visuais.

---

## PRIORIZAÇÃO

| # | Aprimoramento | Esforço | Impacto | Status |
|---|---------------|---------|---------|--------|
| 1 | Plantio ao longo de linhas (não em grid por área) | Alto | Crítico — muda o paradigma visual e funcional | CONCLUÍDO |
| 2 | Zonas de influência de infraestrutura animal | Médio | Alto — integração sintrópica real | CONCLUÍDO |
| 3 | Orientação solar nas linhas de plantio | Médio | Alto — eficiência fotossintética | CONCLUÍDO |
| 4 | Escalar MAX_PLANTS por área real | Baixo | Alto — terrenos grandes ficam vazios | CONCLUÍDO |
| 5 | Adicionar espécies SECUNDARIA_II ao banco | Baixo | Médio — completa sucessão ecológica | CONCLUÍDO |
| 6 | Adicionar atributo `nitrogenFixer` e regra de 40-60% | Baixo | Alto — princípio sintrópico fundamental | CONCLUÍDO |
| 7 | Flow accumulation e corredores ripários | Alto | Médio — manejo hídrico avançado | CONCLUÍDO |
| 8 | Dependências entre infraestruturas (clusters) | Médio | Médio — logística operacional | CONCLUÍDO |
| 9 | Expandir banco botânico (TEMPERADO/SEMIARIDO) | Baixo | Médio — amplia cobertura geográfica | CONCLUÍDO |
| 10 | Conectar efluente do lago/biodigestor ao plantio | Médio | Alto — fertirrigação é pilar sintrópico | CONCLUÍDO |

---

## DETALHAMENTO

### 1. Plantio ao Longo de Linhas Sintrópicas

**Problema:** O algoritmo atual distribui plantas em grid regular dentro de áreas produtivas (`productiveAreas`), com jitter aleatório. As plantas não se alinham às linhas de plantio geradas pelo `plantingLayout.ts`. Na sintropía Ernst Götsch, cada linha sintrópica é um consórcio vertical completo.

**Solução:**
- Cada `LayoutGuide` do tipo `PLANTING_ROW` e `KEYLINE` passa a ser o eixo central de uma linha sintrópica
- O `botanicalLayout.ts` itera sobre cada guia, e ao longo de cada metro linear, posiciona um consórcio vertical:
  - 1 EMERGENTE a cada ~12m
  - 1 ALTO a cada ~8m
  - 1 MEDIO a cada ~5m
  - 1 BAIXO a cada ~3m
  - RASTEIRO contínuo (cobertura)
- Plantas são posicionadas com offset perpendicular à linha conforme estrato (emergentes mais afastadas, rasteiras no centro)
- Entrelinhas (INTERROW) recebem apenas gramíneas/leguminosas de biomassa

---

### 2. Zonas de Influência de Infraestrutura Animal

**Problema:** Galinheiro, apiário e tanque de peixes são tratados como caixas estáticas. Na sintropía integrada, cada infraestrutura animal gera fluxos (fertilidade, polinização, controle de pragas) que alimentam zonas de plantio.

**Solução:**
- Criar `InfrastructureInfluenceZone` com raio e tipo de influência
- Aviário: circuito de rotação com canteiros rotativos adjacentes
- Lago de aquicultura: zona de fertirrigação a jusante
- Apiário: corredores de floração contínua em raio de 200-500m
- Biodigestor/Compostagem: zonas preferenciais de distribuição de fertilizante

---

### 3. Orientação Solar nas Linhas de Plantio

**Problema:** O `northAngle` não influencia o posicionamento botânico.

**Solução:**
- Linhas de plantio preferencialmente leste-oeste
- Estratos mais altos no lado de menor insolação da linha
- Faces norte (hemisfério sul) = quentes/secas, faces sul = úmidas/sombreadas

---

### 4. Escalar MAX_PLANTS por Área Real

**Problema:** MAX_PLANTS=1800 é insuficiente para terrenos grandes (1ha real = ~2000-4000 plantas).

**Solução:**
- Fórmula: `MAX_PLANTS = MIN(area_m2 * 0.3, 50000)` com LOD por chunks
- Instanciamento WebGL otimizado para >10k plantas

---

### 5. Adicionar Espécies SECUNDARIA_II

**Problema:** Nenhuma das 33 espécies tem `succession: 'SECUNDARIA_II'`, criando buraco na transição sucessional.

**Solução:** Adicionar ao banco: Citros, Abacate, Manga, Jabuticaba, Pitanga, Goiaba.

---

### 6. Atributo nitrogenFixer e Regra 40-60%

**Problema:** Fixação de nitrogênio é pilar sintrópico (Feijão Guandu, Acácia, Inga, Gliricidia são fixadoras) mas não há marcação nem regra.

**Solução:**
- Adicionar `nitrogenFixer: boolean` ao `ISpecies`
- Regra no `botanicalLayout.ts`: cada linha deve ter 40-60% de espécies fixadoras

---

### 7. Flow Accumulation e Corredores Ripários

**Problema:** O D8 flow direction é calculado mas não é usado para acumulação de fluxo, talvegues naturais ou corredores ripários.

**Solução:**
- Calcular flow accumulation a partir do D8
- Identificar talvegues (linhas de drenagem) como áreas de preservação
- Criar `RiparianCorridor` como tipo de área produtiva com espécies ripárias

---

### 8. Dependências entre Infraestruturas

**Problema:** Cada item é posicionado independentemente. Aviário→Compostagem→Viveiro é cadeia produtiva.

**Solução:**
- Adicionar `preferredNearInfrastructure: string[]` ao `IInfrastructure`
- Scoring de proximidade entre itens interdependentes

---

### 9. Expandir Banco Botânico

**Problema:** TEMPERADO tem 6 espécies, SEMIARIDO tem 8. Insuficiente para consórcios diversos.

**Solução:** Adicionar ~15 espécies por clima deficitário.

---

### 10. Efluente do Lago/Biodigestor ao Plantio

**Problema:** Fertirrigação por gravidade é pilar sintrópico mas não há modelagem.

**Solução:**
- Calcular zona de irrigação gravitacional a jusante do lago/biodigestor
- Priorizar espécies de alta demanda hídrica nessa zona
