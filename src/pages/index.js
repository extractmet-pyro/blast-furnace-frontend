// Display hierarchy (ISA-101): L1 plant overview -> L2 process units -> L3 engineering detail -> L4 decision support.
import overview from "./overview.js";
import furnace3d from "./furnace3d.js";
import schematic from "./schematic.js";
import trends from "./trends.js";
import { burden, blast, gas, hearth, refractory } from "./units.js";
import { profiles, balance, streams, thermo } from "./detail.js";
import forecasts from "./forecasts.js";
import mpc from "./mpc.js";
import scenarios from "./scenarios.js";
import alarms from "./alarms.js";
import { data, energy, config, admin, help } from "./system.js";

export const PAGES = {
  overview, furnace3d, schematic, trends,
  burden, blast, gas, hearth, refractory,
  profiles, balance, streams, thermo,
  forecasts, mpc, scenarios, alarms,
  data, energy, config, admin, help,
};

export const NAV = [
  ["L1 Plant overview", ["overview", "furnace3d", "schematic", "trends"]],
  ["L2 Process units", ["burden", "blast", "gas", "hearth", "refractory"]],
  ["L3 Engineering detail", ["profiles", "balance", "streams", "thermo"]],
  ["L4 Decision support", ["forecasts", "mpc", "scenarios", "alarms"]],
  ["System", ["data", "energy", "config", "admin", "help"]],
];
