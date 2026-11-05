# Manual user-acceptance checklist

Run this on a deployed pair (backend + desk) before a demonstration or a site pilot. The
automated suites (`docs/TEST_RESULTS.md` in both repositories) cover the model, API and display
mounting; this list covers what a person has to look at. In this build every value is
**synthetic**; a pass here says nothing about accuracy on a real furnace.

Record the backend URL, desk URL, model version (status strip, *Model* chip) and the tester's
role for every run. Mark each row Pass, Fail or N/A and note anything unexpected.

## A. Access, roles and safety labelling

| # | Step | Expected result | Result |
|---|---|---|---|
| A1 | Open the desk without signing in | Displays load read-only; *Synthetic demo data* chip and *Plant writes none* visible on every page | |
| A2 | Sign in as `viewer`, then `operator`, `metallurgist`, `engineer`, `admin` (password from the backend's `DEMO_USER_PASSWORD`) | Role shown in the status strip; forms you may not use are disabled or hidden | |
| A3 | As `viewer`, try *Compute advisory* (Advisory MPC) | Refused with a clear role message; nothing is recorded | |
| A4 | Wrong password three times | Clear error, no detail about which part was wrong | |
| A5 | Status strip | Mode `DEMO_SIMULATION`, data clock green, balance OK, data-quality score, stream *live* (or *polling*) | |
| A6 | Leave the desk open 20 minutes, then use it | Stream reconnects or falls back to polling without a reload; sign-in expires after the configured time, not earlier | |

## B. L1 displays

| # | Step | Expected result | Result |
|---|---|---|---|
| B1 | Plant overview | Tiles carry a *Model*, *Measured*, *Hybrid*, *Derived* or *Proxy* mark; trends show targets and limits | |
| B2 | Furnace 3D: switch fields (gas T, solids T, reduction, CO, H2, velocity, softening) | Section plane recolours, legend changes units; labels match the overview tiles (HMT, Si, RAFT, top gas uptake) | |
| B3 | Furnace 3D: rotate, zoom, toggle layers | Scene stays responsive; labels do not overlap the furnace body | |
| B4 | Furnace schematic | Dimensions match *Furnace design*; lining layers and cooling zones drawn to scale; values sit at their locations | |
| B5 | Trends and replay | Measured tags show quality; twin variables as small multiples (one y-axis per panel) | |

## C. L2 and L3 displays

| # | Step | Expected result | Result |
|---|---|---|---|
| C1 | Burden and charging | Charge matrix, ore mix and batches sum to the configured burden; layer descent time shown | |
| C2 | Blast, PCI and raceway | RAFT, raceway depth, bosh gas and tuyere velocity consistent with the overview | |
| C3 | Gas flow and permeability | Pressure falls monotonically from bosh to top; flooding and fluidisation marked *Proxy* | |
| C4 | Hearth, hot metal and slag | Liquid levels below the tuyeres; casts logged; lab values at their sampling time, not at receipt | |
| C5 | Refractory and cooling | Temperature falls through every lining layer; 1150 degC isotherm labelled as a proxy, not a life prediction | |
| C6 | Mass and energy balance | Element residuals near zero; energy closure shown; Sankey totals equal the table | |
| C7 | Inputs and outputs: export CSV and XLSX | Files open; header carries data origin, model and configuration version, UTC time, input hash, units | |
| C8 | Thermochemistry and kinetics | Reaction catalogue, Ellingham and Baur-Glaessner diagrams render | |

## D. L4 decision support

| # | Step | Expected result | Result |
|---|---|---|---|
| D1 | Forecasts: *Run forecast* | 1, 2, 4, 8 h forecasts with intervals; ML values marked *ML shadow* unless promoted; registry shows *not approved for plant use* | |
| D2 | Advisory MPC as `operator`: default request | Trust gate table all pass, moves within limits, explanation, three trajectories (free, ROM, physics re-simulation) | |
| D3 | Advisory MPC: untick every lever, then untick only PCI | First: no move, status says no lever is available. Second: no move on PCI | |
| D4 | Data and sensors: inject a stuck blast-flow sensor, then request advice | *Advice suppressed* with the failing trust-gate check named; clear the fault afterwards | |
| D5 | *Acknowledge* and *Reject* a recommendation with a comment | Entry appears in Administration > audit trail; nothing else changes | |
| D6 | What-if: run S03 (hot blast +50 degC) | Job progresses to done; KPI trajectories baseline vs case, deltas, cumulative tonnages, compositions; CSV/JSON downloads carry the provenance header | |
| D7 | What-if: custom scenario with two timed changes | Change lines at the right times; result consistent in sign with the library case | |
| D8 | What-if: *Compare* three scenarios; *Sensitivity* (ROM and physics) | Comparison table and tornado charts render | |
| D9 | Alarms: acknowledge an alarm as `operator` | Moves to acknowledged; evidence and *possible* causes shown; logged | |

## E. System pages

| # | Step | Expected result | Result |
|---|---|---|---|
| E1 | Furnace design as `engineer`: switch preset (mini, medium, large, mega) | Twin rebuilds; schematic, 3D and tiles follow the new size; a configuration version is recorded | |
| E2 | Edit a lining layer thickness, save | Planar flux check shown; saving creates a version; a stale edit gets a version-conflict message | |
| E3 | Roll back: *Load* the version before your edits, review it in the JSON editor, *Validate and save* | A new version with the earlier content; displays reload by themselves; on the large preset the advisory MPC stays available (the other presets need a ROM identification first) | |
| E4 | Energy, carbon and cost | Supply equals demand plus losses; CO2 labelled as a model estimate | |
| E5 | Administration as `admin` | Status, accounts (no passwords shown), safety case, jobs, audit trail with filter and CSV export | |

## F. Deployment and operations

| # | Step | Expected result | Result |
|---|---|---|---|
| F1 | `GET /health`, `/ready`, `/metrics` on the backend | 200; `bf_plant_writes_enabled 0`; `bf_persistence_errors_total` absent or zero | |
| F2 | Open the desk from an origin not in `CORS_ORIGINS` | Browser blocks the API calls | |
| F3 | Restart the backend (Render: *Manual deploy* or wait for sleep) | Desk recovers; free-plan data loss expected and stated (ephemeral disk) | |
| F4 | Phone width | Single column, status strip wraps, no horizontal scroll | |
| F5 | Night theme | Every page readable; charts keep their series colours | |

## Sign-off

| Role | Name | Date | Decision and conditions |
|---|---|---|---|
| Process metallurgist | | | |
| Plant operator | | | |
| Automation / control engineer | | | |
| OT cybersecurity | | | |
| Plant safety authority (site pilot only) | | | |

Sign-off approves a demonstration or a shadow-mode pilot only. Closed-loop use needs the site's
own management of change, functional-safety assessment and approval, which this checklist does
not replace.
