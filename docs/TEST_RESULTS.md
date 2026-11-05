# Test results - frontend

Recorded on 5 November 2026 in the build environment (Linux, Node 22.23.4, npm 10.9.9). The run
used a **fresh unzip of `blast-furnace-frontend.zip`** into an empty directory and `npm ci`
from the committed lockfile. All payloads are synthetic.

After this run only this file was added; no source or test changed.

## Summary

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | added 88 packages in 2s |
| Unit and display smoke tests | `npx vitest run --coverage` | **Test Files  2 passed (2), Tests  38 passed (38)** |
| Statement coverage of `src/` | v8 | 65.72 % |
| Dependency vulnerabilities | `npm audit`, `npm audit --omit=dev` | 0 vulnerabilities |
| Production build | `npm run build` | succeeded (see below) |
| End-to-end with the backend | Playwright, Chromium, production CSP | 11/11 checks passed, 0 browser errors |

`tests/frontend.test.js` checks formatting and units, provenance marks (a model value is never
rendered as measured), limit flags, markup safety, the API client (error envelope, bearer
token, roles), the event stream (sequence, stale events, resync), the to-scale schematic, the
page registry, and that no page contains a plant-write call. `tests/pages.test.js` mounts all
22 displays in jsdom against API payloads recorded from the backend (`tests/fixtures/api_recording.json.gz`)
and checks that the 3-D scene's labels and section-plane colours come from the backend state and
field payloads. Plotly and the WebGL renderer are stubbed in jsdom; the charts and the rendered
3-D view were checked in Chromium (end-to-end check below and the screenshots in `docs/`).
Results views behind a job (MPC result, scenario result) are covered by the end-to-end check,
not by unit tests, which is why their modules show lower coverage.

## Tests

```
✓ tests/frontend.test.js > formatting > formats numbers, missing values and large values 2ms
✓ tests/frontend.test.js > formatting > infers units from the API key-suffix convention 0ms
✓ tests/frontend.test.js > formatting > labels keys and prints UTC times 0ms
✓ tests/frontend.test.js > provenance and faceplates > never renders a model value as measured 11ms
✓ tests/frontend.test.js > provenance and faceplates > flags alarm and hard limits on tiles 1ms
✓ tests/frontend.test.js > provenance and faceplates > tables escape nothing they should not and show '-' for missing cells 3ms
✓ tests/frontend.test.js > provenance and faceplates > h() does not treat data as markup 0ms
✓ tests/frontend.test.js > API client > maps the backend error envelope into ApiError 4ms
✓ tests/frontend.test.js > API client > sends the bearer token only when signed in and ranks roles 1ms
✓ tests/frontend.test.js > event stream (polling fallback) > tracks sequence numbers, ignores stale events and signals resync 1ms
✓ tests/frontend.test.js > furnace schematic > draws the furnace to scale from the geometry payload with model and measured tags 36ms
✓ tests/frontend.test.js > furnace schematic > maps field values onto the colour ramps 1ms
✓ tests/frontend.test.js > page registry > every navigation entry resolves to a page with title, purpose and mount() 1ms
✓ tests/frontend.test.js > page registry > no page source contains a plant-write call 1ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > covers the whole page registry 2ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > overview 217ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > furnace3d 152ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > schematic 102ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > trends 82ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > burden 93ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > blast 110ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > gas 71ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > hearth 78ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > refractory 87ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > profiles 72ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > balance 109ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > streams 69ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > thermo 155ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > forecasts 66ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > mpc 70ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > scenarios 72ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > alarms 71ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > data 130ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > energy 73ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > config 138ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > admin 71ms
✓ tests/pages.test.js > every display mounts against recorded backend payloads > help 67ms
✓ tests/pages.test.js > 3-D furnace is built from backend values > labels and the section plane come from the twin state and field payloads 62ms

Test Files  2 passed (2)
Tests  38 passed (38)
```

## Coverage

```
---------------|---------|----------|---------|---------|-----------------------
File           | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s     
---------------|---------|----------|---------|---------|-----------------------
All files      |   65.72 |     48.9 |    64.3 |   70.76 |                       
 src           |       0 |        0 |       0 |       0 |                       
  main.js      |       0 |        0 |       0 |       0 | 13-145                
 src/lib       |   60.18 |     63.2 |   61.36 |   64.48 |                       
  api.js       |   44.44 |    40.98 |   41.02 |   47.89 | ...25-155,166,170-172 
  charts.js    |    86.2 |       75 |   86.84 |   87.93 | 23,75,109,113-116     
  store.js     |   36.84 |    45.45 |   44.44 |   42.85 | 16,20-32,41,55        
  ui.js        |   71.21 |    77.35 |   60.86 |   78.82 | 85,99-103,111-128     
 src/pages     |   64.34 |    42.59 |   65.25 |   69.05 |                       
  alarms.js    |   62.06 |    29.62 |   30.43 |   76.47 | 48,56,61-75           
  common.js    |   66.66 |       75 |   66.66 |   83.33 | 19                    
  detail.js    |   95.86 |     75.4 |   91.66 |   95.83 | 70,109-110            
  forecasts.js |    87.2 |    68.51 |   95.12 |   92.15 | 48,75-77              
  furnace3d.js |   75.86 |    16.66 |   66.66 |   89.47 | 21,31                 
  mpc.js       |   41.17 |    22.22 |    46.8 |   41.12 | ...-56,76-157,165-166 
  overview.js  |   92.85 |    61.76 |    92.3 |   93.44 | 20,49,70,98           
  scenarios.js |   21.25 |     9.69 |   16.81 |   25.13 | ...03,214-236,244-277 
  schematic.js |   87.09 |       80 |   83.33 |   91.66 | 20,44                 
  system.js    |   70.11 |    58.94 |   75.55 |    79.9 | ...09,321-328,365,367 
  trends.js    |   78.94 |       72 |   75.86 |      84 | 29,49,54,66,75-80     
  units.js     |   85.29 |    68.75 |    90.9 |   87.73 | 18-23,50,68-73        
 src/viz       |   95.41 |    70.24 |   90.69 |   98.36 |                       
  furnace3d.js |   94.22 |       63 |    87.5 |   97.72 | 86,226-228            
  schematic.js |   97.02 |    75.35 |   94.73 |   99.23 | 47                    
---------------|---------|----------|---------|---------|-----------------------
```

## Build

```
$ VITE_API_BASE_URL=https://bf-twin-backend.onrender.com npm run build
# clean room; started 2026-11-05T12:44:59Z

> blast-furnace-frontend@1.0.0 build
> vite build

vite v8.3.4 building client environment for production...
transforming...
✓ 34 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                                        1.20 kB │ gzip:     0.61 kB
dist/assets/barlow-condensed-latin-500-normal-HIEiP5Ov.woff           18.60 kB
dist/assets/barlow-condensed-latin-600-normal-BFJEwTuo.woff           18.89 kB
dist/assets/barlow-semi-condensed-latin-400-normal-CwTnoNB3.woff      19.65 kB
dist/assets/barlow-semi-condensed-latin-500-normal-CFOoVYFH.woff      19.72 kB
dist/assets/barlow-semi-condensed-latin-600-normal-DyOfdMBA.woff      20.02 kB
dist/assets/barlow-condensed-latin-500-normal-BgYH2mbd.woff2          21.42 kB
dist/assets/barlow-semi-condensed-latin-400-normal-DlzeKIMS.woff2     22.30 kB
dist/assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2          22.30 kB
dist/assets/barlow-semi-condensed-latin-500-normal-G0uxJNrM.woff2     22.42 kB
dist/assets/barlow-semi-condensed-latin-600-normal-BkLiAYu4.woff2     22.98 kB
dist/assets/index-D15pzmca.css                                        12.83 kB │ gzip:     3.57 kB
dist/assets/rolldown-runtime-WkwZ5CU-.js                               0.59 kB │ gzip:     0.36 kB
dist/assets/index-RkiLMxle.js                                        152.99 kB │ gzip:    51.91 kB
dist/assets/three-CIOAm4E5.js                                        557.94 kB │ gzip:   138.68 kB
dist/assets/plotly-DhAsPp-K.js                                     4,643.75 kB │ gzip: 1,419.41 kB

✓ built in 1.98s
EXIT 0
```

## End-to-end check

| Check | Result |
|---|---|
| status strip shows synthetic data and no plant writes | PASS |
| all 22 pages render signed out | PASS |
| sign-in dialog works (operator) | PASS |
| advisory MPC returns a recommendation with trust gate | PASS |
| acknowledgement recorded | PASS |
| scenario S03 completes and renders | PASS |
| Load puts the earlier version into the editor | PASS |
| desk recovers by itself after the rebuild | PASS |
| roll-back saved as a new version with the earlier content | PASS |
| advisory MPC still available after the roll-back (shipped ROM kept) | PASS |
| audit trail lists acknowledgement and configuration changes | PASS |

## Not covered

Firefox and Safari; real devices (phone layout checked at emulated width in Chromium). CI
(`.github/workflows/ci.yml`) repeats install, tests with coverage, build and audit on every push.
