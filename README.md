# STREAM

**Simulator of Train Response for Evaluating Aerosol Measurements**

STREAM predicts what a complete aerosol measurement setup will record. Users describe their system exactly, from the aerosol source through tubing, bends, splitters, impactors, dryers, diluters and neutralizers to the instruments themselves. STREAM then simulates the signal each instrument would produce, with realistic noise. The same tool can generate the system kernel needed to invert multi-instrument data, and the large, physically faithful training sets needed for AI-based inversion.

STREAM is developed by the AIR Lab at Clarkson University. It is an early research prototype; see [Project status](#project-status).

## Why STREAM

Aerosol measurements are rarely made with a single instrument under ideal conditions. What the instruments report is the true aerosol transformed by every element of the sampling train, and by each instrument's own response. Three problems follow:

- **No common tool composes the physics.** Loss and transfer calculations are assembled by hand, setup by setup, in private spreadsheets and scripts. Assumptions are rarely documented and results are hard to reproduce.
- **Inversions assume ideal particles.** Real particles are nonspherical, chemically mixed and variable in density, refractive index and hygroscopicity. Most inversions still assume spheres of one density, and properties that are known or measured alongside are rarely carried into the inversion.
- **Better instrument knowledge reaches practice slowly.** Improved transfer functions, charging models, counting efficiencies and lens transmission curves are published across many journals, and much of this never reaches the whole aerosol community. Instrument software is often not updated for years, sometimes decades.

STREAM brings these developments to users as selectable, referenced models. Once a model is validated, every user can apply it, including to archived raw data.

## What the prototype does

- **Builds the setup.** Start from a template, draw the setup in a drag-and-connect diagram editor, or upload an image of a schematic for Claude to read and convert into a diagram you can check and correct.
- **Handles branching trains.** One source or neutralizer can feed several instruments. Each branch has its own tubing, flows, humidity and dilution.
- **Probes any point.** Select a block or tube to see the aerosol there: the local size distribution at local humidity, transmission so far, impactor cut, charge state after the neutralizer, and what the DMA passes at a chosen voltage.
- **Shows each block's transfer function.** For any tube or block, plot the fraction of particles of each size it passes, counts or selects under the chosen models: diffusion, settling and bend losses; impactor penetration against particle and aerodynamic size; charge fractions; the DMA transfer function at a chosen voltage, with multiple charging; CPC and APS counting efficiency; and dryer growth factors.
- **Lets you choose the physics.** Pick among published models for each component. The reference list for your selection is generated automatically.
- **Compares assumptions.** The same simulated raw data are inverted with two sets of assumptions, side by side, so you can see what each assumption costs.
- **Hosts a community library.** Users upload measured instrument performance curves and published model parameters, which become selectable models right away, marked unreviewed until checked.

## Components modeled

| Component | Models available |
| --- | --- |
| Particle drag | Slip correction: Kim et al. (2005), Davies (1945); dynamic shape factor |
| Sampling lines | Diffusion: Gormley & Kennedy (1949); settling: Thomas (1958); bends: Pui et al. (1987), Crane & Evans (1977) |
| Inlet impactor | Cut from nozzle diameter and flow (Stk50 = 0.24), applied to aerodynamic size; or a rated d50 |
| Water uptake | κ-Köhler growth (Petters & Kreidenweis, 2007) through dryers and humid lines |
| Bipolar charging | Wiedensohler (1988) with Gunn for three or more charges; multiple charging |
| DMA | Triangular (Knutson & Whitby, 1975) or diffusing (Stolzenburg, 1988) transfer function; scanning approximation; diffusion losses |
| CPC | Counting efficiency curve; plumbing delay and first-order mixing |
| APS | Time-of-flight sizing with density and shape conversion (Stokes regime); counting efficiency |

Planned: full scanning DMA transfer functions (Dubey & Dhaniyala, 2008, 2011), integrated DMA–CPC response (Mai et al., 2018), non-Stokes APS correction, optical particle counters, low-cost sensors, and composition instruments including aerosol mass spectrometer lens transmission and collection efficiency.

## Getting started

Open `index.html` in a web browser. No installation is needed; all calculations run in the browser.

The shared community library, saved setups and schematic reading need the hosted version of STREAM. Opened from this repository, the simulator, diagram editor and probes all work.

To work on the code:

| Path | Contents |
| --- | --- |
| `src/engine.js` | Physics engine (reference version). Runs in the browser and in Node. |
| `src/page.src.html`, `src/diagram.*` | Page layout, setup-diagram editor and probe panel |
| `build.py` | Rebuilds `index.html` after editing `src/`: `python3 build.py` |
| `tests/engine_check.js` | Quick engine check: `node tests/engine_check.js` |
| `python/stream.py` | Earlier Python version of the engine; lacks the dryer, APS, impactor and probe updates |

## Project status

This is an unvalidated research prototype. The models implement the cited papers but have not yet been checked against experiments. When an inversion uses the same models that generated the data, it recovers the input by construction; the comparisons show what assumptions cost, not that the models are correct. Validating each component and full multi-instrument systems in the laboratory is the next phase of the project.

## Contributing

We welcome measured instrument performance data, published model parameters and proposals for new models. During the prototype phase, please contact us before opening pull requests.

## Citing STREAM

See `CITATION.cff`. A DOI will be issued with the first public release.

## License

To be decided before the repository is made public.

## Contact

Suresh Dhaniyala, AIR Lab, Clarkson University
