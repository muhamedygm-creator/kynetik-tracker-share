/** Domain shapes. Times are shop-local LocalDT strings (see time.ts); ids are opaque strings. */
import type { LocalDT, LocalDate } from "./time";

export type ItemStatus = "todo" | "doing" | "blocked" | "done";
export type ProjectStatus = "planned" | "active" | "hold" | "done";
export type Health = "late" | "risk" | "unset" | "ok" | "hold" | "done";

export interface Person {
  id: string;
  name: string;
  crew: string;
  costClass: "production" | "admin";
  active: boolean;
}

export interface Station {
  id: string;
  name: string;
  type: string;
}

export interface Stage {
  id: string;
  name: string;
  stationType: string;
  stationId: string | null;
  partHours: number;
  /** New workflow: which of the 10 stages this is (modelling, premold, mold …); null on old projects. */
  step?: string | null;
}

export interface Part {
  id: string;
  name: string;
  /** Amends 2026-10-12: serial-numbered parts (new workflow). Old parts have none of these. */
  serial?: string | null;
  /** Set on a sub-part; its parent is a folder (Project.folders). */
  parentId?: string | null;
  description?: string;
  material?: string | null;
  finishColour?: string | null;
  finishSheen?: string | null;
  unitNo?: number | null;
  sort?: number;
  /** Model data (amends AM-05), entered when the Modelling step is finished. */
  model?: PartModel | null;
  /** AM-24: print data, entered on the 3D Printing page. */
  print?: PartPrint | null;
  /** AM-23: sub-part names the modeller planned (applied when the model passes QC), and when it was applied. */
  splitPlan?: string[] | null;
  splitAt?: string | null;
}

export interface PartPrint {
  filamentG: number | null;
  minutes: number | null;
  slices: number | null;
}

export interface PartModel {
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
  weightG: number | null;
  surfaceM2: number | null;
  volumeM3: number | null;
  renderPath: string | null;
  at: string | null;
}

export interface Task {
  id: string;
  num: number;
  stageId: string;
  name: string;
  assignee: string | null;
  status: ItemStatus;
  durH: number;
  pct: number; // 0–100
  start: LocalDT | null; // computed plan
  end: LocalDT | null;
  pinnedStart: LocalDT | null;
  actualStart: LocalDT | null;
  actualEnd: LocalDT | null;
  notes: string;
}

export interface WorkItem {
  id: string;
  stageId: string;
  partId: string;
  status: ItemStatus;
  tech: string | null;
  start: LocalDT | null;
  end: LocalDT | null;
  /** Start of the current segment (after a rework, the moment it was sent back). */
  segStart: LocalDT | null;
  /** Closed segments from before reworks: [start, end]. */
  prevSegs: [LocalDT, LocalDT][];
  planH: number | null;
  rework: number;
  reworkLog: { at: LocalDT; why: string; by: string }[];
  notes: string;
  /** Floor-log hours on this item, total and per person (derived from hour logs). */
  hours: number;
  hoursBy: Record<string, number>;
  /** Owner only. Undefined for everyone else. */
  cost?: number;
  /** New workflow (amends AM-07): set while the step waits for admin QC. It stays In Progress meanwhile. */
  qcSince?: LocalDT | null;
  /** 1 for the first try; +1 each time QC (or a later rework) sends it back. */
  attempt?: number;
  /** Attempt number of each closed segment in prevSegs (same order). */
  prevSegAttempts?: number[];
  /** Mold production (AM-06): this step is component n of total. */
  componentNo?: number | null;
  componentTotal?: number | null;
}

export interface Project {
  id: string;
  serial: string;
  name: string;
  status: ProjectStatus;
  startDate: LocalDate;
  deliveryDate: LocalDate | null;
  deliveredOn: LocalDate | null;
  stages: Stage[];
  /** Trackable parts: every part that goes through the stages (sub-parts included, folders not). */
  parts: Part[];
  /** Amends 2026-10-12: parts split into sub-parts. A folder has no stages of its own. */
  folders?: Part[];
  /** New workflow (Exterior panels): serial-numbered parts, admin QC between stages. */
  gated?: boolean;
  tasks: Task[];
  /** taskId → baseline window */
  baseline: Record<string, { start: LocalDT; end: LocalDT }>;
  work: WorkItem[];
}
