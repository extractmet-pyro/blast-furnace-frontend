# Changelog

## 1.0.0 - 2026-11-05

First demonstration release (synthetic data, advisory only).

- Physics twin of the blast furnace (fast 1-D and hi-fi 2-D fidelity) with exact element and
  energy conservation, four furnace-size presets, editable geometry, operating point and
  refractory lining.
- Synthetic plant with sensor noise, lags, lab delays and injectable instrument faults.
- Data quality engine, WLS reconciliation, parameter EKF observer.
- Forecasts (physics + observer, hybrid ML in shadow unless promoted), model registry with
  provenance and approval labels.
- Advisory MPC (ROM + OSQP, optional physics NMPC), trust gate, physics verification,
  acknowledgement as audit record only.
- 19 what-if scenarios, comparisons, sensitivities, cost Pareto.
- Operator desk with 22 displays, 3-D furnace, to-scale schematic, day/night themes.
- Render blueprints for both repositories; documentation set; automated tests.
- Display smoke tests: all 22 pages mount against recorded backend payloads; the 3-D scene is
  checked to carry backend values (labels, section-plane colours).
- CI: tests with coverage, static build and `npm audit` of production dependencies.
- Configuration versions: *Load* an earlier version into the JSON editor for roll-back.
- Displays reload by themselves while the twin initialises (start-up, new configuration).
- Manual user-acceptance checklist (`docs/UAT_CHECKLIST.md`).
