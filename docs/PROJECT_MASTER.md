# SYSTEM SPECIFICATION: SSI - Sistema Sintrópico Inteligente (Provisório)

## 1. SYSTEM CONTEXT & CORE OBJECTIVES
**Objective:** Develop a browser-based application for designing syntropic agriculture layouts with topographic precision. 
**Mechanism:** The system collects terrain data and user requirements via a Sequential Wizard, processes the data through deterministic procedural algorithms, and generates optimized planting and infrastructure layouts adhering to syntropic principles.

### 1.1. DEVELOPMENT CONSTRAINTS [CRITICAL FOR AI AGENTS]
* **[CONSTRAINT: DETERMINISTIC LOGIC]:** The procedural generation is strictly based on hardcoded, rule-based, deterministic algorithms.
* **[CONSTRAINT: PERFORMANCE]:** The system must handle 1x1m resolution terrain meshes up to 500 hectares seamlessly.
* **[CONSTRAINT: REVERSIBILITY]:** UI and logic must be purely state-driven. Users must be able to return to previous Wizard states, edit parameters, and regenerate layouts deterministically.

---

## 2. MACRO ARCHITECTURE (UNIDIRECTIONAL DATA FLOW)
The architecture dictates a strict separation of concerns:

1.  **Persistence Layer (Database):** Stores botanical/infrastructure component data and user project states.
2.  **Core Data Layer (Terrain Matrix):** Highly efficient data structures (e.g., `Float32Array`) representing altimetry meshes and biological occupation matrices.
3.  **Procedural Engine (Core Logic):** The deterministic algorithmic module. Processes inputs (Core Data + Wizard State) to output the final spatial layout.
4.  **Renderer Layer (WebGL):** Visual representation of the Core Data. Handles 2D and Isometric projections.
5.  **Interface Layer (React/UI):** Manages user interactions, the Wizard state machine, and control panels.

---

## 3. MODULAR DOCUMENTATION REFERENCES
Agents must consult the following modules for granular implementation details:
* `TECH_STACK_AND_DATA.md`: Technology stack, DB schemas, spatial data structures.
* `UI_WIZARD_SPEC.md`: UI flow, control mapping, Wizard step definitions (Residence, Climate, Preferences).
* `PROCEDURAL_GEN_ENGINE.md`: Algorithmic logic for topographic analysis, botanical consortiums, and infrastructure placement.

---

## 4. UI/UX SPECIFICATIONS: TERRAIN MODULE (Based on Ref: image_0.png)

### 4.1. Existing Functional Mapping
* **Tool Controls (Top Left):**
    * `[Draw]`: Activates polygon vertex insertion mode.
    * `[Move]`: Activates manipulation of existing vertices.
    * `[Altitude]`: Activates the WebGL elevation brush system.
* **Core Parameters (Center):**
    * `Scale Selector`: Fixed at "1m / square" (1x1m mesh resolution).
    * `North Selector`: Defines solar orientation (Crucial input for syntropic/solar algorithms).
    * `Edit Actions`: Undo, Clear.
* **Telemetry (Top Right):** Displays current state metrics (e.g., Vertex count: 6, Total Area: 655.0 m²).
* **Navigation (Bottom):** Coordinate/Zoom indicator (Left) and `[Confirm Terrain ->]` state progression button (Right).

### 4.2. New Implementation Requirements
* **Visual Toggle:** Add an `[Isometric/3D]` vs `[2D]` toggle button adjacent to the `[Altitude]` control.
* **Altimetry Visual Feedback:** The altitude brush must dynamically apply a color gradient (Heatmap) and contour lines directly onto the WebGL mesh during interaction.

---

## 5. USER FLOW: SEQUENTIAL STATE MACHINE (WIZARD)

### [STATE 1]: TERRAIN DEFINITION
* **Inputs:** Polygon outline definition, North orientation definition, Altimetry sculpting (manual brush or data upload).
* **Transition:** User confirms state to proceed.

### [STATE 2]: RESIDENCE & ENERGY SIZING
* **Inputs:** House square footage (`Number`). Checkbox/Select array for electrical load components (e.g., Electric Shower, Laptop, AC, Refrigerator, etc.).
* **Deterministic Processing:** System calculates total electrical load and automatically sizes the required quantity and spatial area for solar panels.

### [STATE 3]: CLIMATE DEFINITION
* **Inputs:** Single selection from predefined climate types (e.g., Dry Tropical, Humid Tropical, Semiarid, Temperate).
* **Processing:** Selection acts as a strict filter for querying the botanical database.

### [STATE 4]: INFRASTRUCTURE PREFERENCES
* **Inputs:** Checkbox array for desired components (Aquaculture, Mobile Chicken Coop, Composting, Solar Panels, Nursery, Cistern, Biodigester, Apiary, etc.).
* **Data Source Rules:** Each component inherently possesses hardcoded spatial placement rules (e.g., *Apiary: Distance > X from house, Proximity < Y to flora*; *Cistern: Lowest topographic point*).

### [STATE 5]: FINAL GENERATION & RENDERING
* **Process:** User views parameter summary and triggers `[Generate Project]`. The Procedural Engine executes deterministic calculations based on States 1-4.
* **Output:** WebGL rendering of the layout (plants, infrastructure) in 2D/Isometric.
* **State Reversal:** `[Edit Requirements]` button available globally to revert to previous states and trigger regeneration.

---

## 6. INTERACTION LOGIC: ENTITY INSPECTION (POPUP SYSTEM)

### 6.1. Event Flow
1.  **Trigger:** Click event on a rendered instance (WebGL).
2.  **Identification:** Renderer passes the instance `ID` to the UI Layer.
3.  **Fetch:** UI queries the database for the detailed schema.
4.  **Render:** Popup overlay displayed on top of the WebGL canvas.

### 6.2. Data Schemas (Inspection Output Examples)

**Schema A: Botanical Component (Syntropic)**
* `Popular Name`: Eucalyptus (Biomass example)
* `Stratum`: Emergent
* `Syntropic Function`: Biomass production and initial shading
* `Cycle`: Placenta II (Removal targeted after *x* years)

**Schema B: Infrastructure Component**
* `Popular Name`: Apiary
* `Quantity`: 1 unit
* `Function`: Pollination and Honey Production
* `Procedural Placement Rationale`: "Placed 100m from residence and adjacent to medium-stratum consortium line."