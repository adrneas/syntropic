## 1. Arquitetura de Estado do Wizard (State Machine)

O Wizard não é apenas uma sequência de telas, mas um gerenciador de estado global (`WizardState`) que acumula parâmetros até a injeção no `ProceduralEngine`. O agente deve implementar um gerenciador de estado global (ex: Zustand, Redux Toolkit ou Context API otimizado) para persistir as seguintes variáveis em memória durante a navegação.

### 1.1. Interface de Estado Global (`IWizardState`)

```typescript
interface IWizardState {
  currentStep: number; // 1 a 5
  terrain: {
    polygon: Array<{x: number, y: number}>;
    area: number; // em m²
    northAngle: number; // 0 a 360 graus
    elevationGrid: Float32Array; // Estado da malha altimétrica
  };
  residence: {
    area: number; // em m²
    appliances: Record<string, number>; // { "chuveiro": 1, "geladeira": 2 }
    calculatedSolarNeed: number; // em kWh/mês (Calculado em tempo real)
  };
  climate: string; // ID do clima selecionado
  preferences: {
    infrastructure: Array<string>; // IDs das estruturas selecionadas (ex: 'aquicultura', 'apiario')
  };
  generationStatus: 'idle' | 'processing' | 'completed';
}
```

---

## 2. Especificação Macro das Etapas (Views)

Cada etapa deve possuir um layout estrutural que preserve uma **Barra de Progresso Global** no topo (indicando a etapa atual) e uma **Barra de Ações** na parte inferior (`[Voltar]`, `[Próximo / Confirmar]`).

### ETAPA 1: Definição do Terreno
**Objetivo:** Capturar as restrições físicas e a topografia.
**Componentes UI:**
* **Viewport Central:** Canvas WebGL ocupando a maior parte da tela.
* **Barra de Ferramentas Topo:** (Conforme imagem de referência base)
    * `Toggle Group`: [Desenhar Polígono] | [Mover Vértices] | [Pincel de Altitude].
    * `Toggle View`: [2D Top-Down] | [Isométrico 3D] -> *Altera apenas a câmera WebGL*.
    * `Select`: Resolução da Escala (Default: 1m / quadrado).
    * `Dial/Select`: Orientação do Norte.
* **Painel Flutuante (Overlay):** Estatísticas em tempo real (Área em m², Quantidade de Vértices).
* **Regras de Validação:** O botão "Próximo" só é habilitado se o polígono estiver fechado e a área for maior que 0.

### ETAPA 2: Residência e Carga Energética
**Objetivo:** Coletar dados para dimensionamento do sistema de energia solar e ocupação espacial da casa.
**Componentes UI:**
* **Input Numérico:** Metragem quadrada da residência (m²).
* **Grid de Seleção de Eletrodomésticos:** Uma lista visual com contadores (+ / -).

| Componente | Potência Média (W) | Tempo Uso Est. (h/dia) | UI Control |
| :--- | :--- | :--- | :--- |
| Chuveiro Elétrico | 5500 | 0.5 | Contador numérico |
| Ar Condicionado | 1500 | 8 | Contador numérico |
| Geladeira | 250 | 24 | Contador numérico |
| Computador/Notebook | 150 | 8 | Contador numérico |

* **Painel de Feedback em Tempo Real:** Conforme o usuário adiciona itens, um painel lateral exibe o "Consumo Mensal Estimado (kWh)" e a "Área Mínima de Placas Solares (m²)".
* **Regras de Negócio (Lógica Local):** O cálculo da necessidade solar não exige o motor procedural completo; a UI deve calcular isso instantaneamente usando constantes predefinidas de eficiência de painel para dar feedback imediato.

### ETAPA 3: Clima
**Objetivo:** Definir o filtro master para o banco de espécies vegetais.
**Componentes UI:**
* **Card Selector:** Um grid de cards ilustrados para os macrotipos climáticos.
    * Opções sugeridas: Tropical Úmido, Tropical Seco, Semiárido, Subtropical, Temperado.
* **Regras de Negócio:** Esta seleção afetará a biblioteca de espécies carregada na fase de processamento, impedindo a alocação de plantas incompatíveis com o regime hídrico ou de temperatura.

### ETAPA 4: Preferências de Infraestrutura
**Objetivo:** Coletar o inventário de elementos não-botânicos que o motor procedural deve posicionar no terreno.
**Componentes UI:**
* **Checkbox Grid Multiseleção:** Lista de itens com ícones e descrições breves.
    * *Estruturas:* Aquicultura (Lagos), Aviário Rotativo, Compostagem, Viveiro de Mudas, Cisterna, Biodigestor, Apiário.
    * *Nota Oculta no Card do Painel Solar:* "Será dimensionado automaticamente com base na Etapa 2. O algoritmo priorizará o telhado da residência antes de ocupar área de solo."
* **Regras de Negócio:** A ordem de seleção não importa. Os dados são salvos no array `preferences.infrastructure` no estado global.

### ETAPA 5: Resumo e Geração
**Objetivo:** Confirmar parâmetros, bloquear a edição e invocar o `ProceduralEngine`.
**Componentes UI:**
* **Painel de Resumo (Read-Only):** Exibe as decisões das Etapas 1 a 4.
* **Call to Action:** Botão Primário `[Gerar Sistema Sintrópico]`.
* **Estado de Carregamento:** Ao clicar, a UI deve apresentar um loader ("Analisando Topografia...", "Calculando Fluxo de Água...", "Alocando Consórcios...").
* **Transição de Estado:** Concluído o processamento, a UI entra no modo "Visualização do Projeto".

---

## 3. Especificação do Modo "Visualização do Projeto" (Pós-Geração)

Neste estado, o Wizard desaparece e a interface retorna ao layout focado no WebGL (similar à Etapa 1, mas com o terreno povoado).

### 3.1. Controles Pós-Geração
* **Botão `[Editar Requisitos]`:** Reinicia a máquina de estado para a Etapa 1, mantendo os parâmetros atuais, permitindo edição e posterior re-geração.
* **Painel de Legenda:** Lista de estratos (Cores/Ícones para Emergente, Alto, Médio, Baixo) e infraestruturas alocadas.

### 3.2. Detalhamento Informativo (Click Interactivity)
Ao disparar um evento `onClick` em uma `InstancedMesh` (planta) ou `Mesh` (infraestrutura) no WebGL:

* **Comportamento:** A câmera centraliza levemente no objeto (opcional) e um `<OverlayCard>` HTML é renderizado na tela.
* **Estrutura do Componente `<OverlayCard>`:**
    * **Header:** Nome do Componente / Espécie.
    * **Badge:** Estrato botânico ou Categoria de Infraestrutura.
    * **Body:** Dados dinâmicos mapeados da resposta do motor procedural.
    * **Footer:** Botão `[Fechar]`.

**Exemplo de Payload para Overlay de Planta:**
```json
{
  "id": "eucalyptus-grandis",
  "nome": "Eucalipto",
  "estrato": "Emergente",
  "ciclo": "Placenta II",
  "funcao": "Geração de biomassa primária; bomba de nutrientes."
}
```

**Exemplo de Payload para Overlay de Infraestrutura:**
```json
{
  "id": "cisterna-geo",
  "nome": "Cisterna Ferrocimento",
  "capacidade_estimada": "15.000 Litros",
  "justificativa_posicionamento": "Alocada no ponto de convergência de keylines (cota altimétrica mínima da bacia local)."
}
```
```