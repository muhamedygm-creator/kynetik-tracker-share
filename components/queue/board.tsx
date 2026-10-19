"use client";
/** Task Queue board: drag within a column to set priority, across columns to reassign (dnd-kit). */
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  deleteQueueTask, duplicateQueueTask, moveQueueTask, moveQueueTaskToTop, nudgeQueueTask, saveQueueTask, setQueueStatus,
} from "@/app/(console)/queue/actions";
import { btn } from "@/components/ui/dialog";
import { DurationField } from "@/components/ui/duration-field";
import { ActionForm, Field, input, type Result } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";

type Status = "todo" | "doing" | "blocked" | "done";
export interface QueueCard {
  id: string; version: number; title: string; durValue: number; durUnit: "hours" | "days"; duration: string; status: Status;
  notes: string; colour: string | null; fixedStart: string | null; link: string; linkLabel: string | null; when: string;
  overrun: boolean; lateStart: boolean;
}
export interface QueueColumn {
  personId: string; name: string; initials: string; photoUrl: string | null; departmentId: string | null; colour: string; cards: QueueCard[];
}
interface Props {
  canWrite: boolean;
  departments: { id: string | null; name: string; emoji: string; colour: string }[];
  columns: QueueColumn[];
  links: { label: string; options: { value: string; label: string }[] }[];
  statusLabels: Record<Status, { label: string; colour: string }>;
  /** Working hours in one day, for the Days unit (AM-28). */
  dayHours: number;
}

function Avatar({ c, size = 36 }: { c: Pick<QueueColumn, "name" | "initials" | "photoUrl" | "colour">; size?: number }) {
  return c.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.photoUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full text-sm font-bold text-on-colour" style={{ width: size, height: size, background: c.colour }}>{c.initials}</span>
  );
}

function TaskForm({ personId, card, p, onDone }: { personId: string; card: QueueCard | null; p: Props; onDone: () => void }) {
  const [ownColour, setOwnColour] = useState(!!card?.colour);
  const [hours, setHours] = useState(card ? (card.durUnit === "days" ? card.durValue * p.dayHours : card.durValue) : 2);
  const action = async (prev: Result, f: FormData) => {
    const r = await saveQueueTask(prev, f);
    if (r.ok) onDone();
    return r;
  };
  return (
    <ActionForm action={action} keepOpen submit={card ? "Save task" : "Add task"}>
      <input type="hidden" name="personId" value={personId} />
      {card && <input type="hidden" name="id" value={card.id} />}
      {card && <input type="hidden" name="version" value={card.version} />}
      <Field label="Title"><input name="title" defaultValue={card?.title} className={input} autoFocus required /></Field>
      {/* AM-28: minutes, hours or days; saved as working hours to the minute. */}
      <DurationField hours={hours} onChange={setHours} dayHours={p.dayHours} name="durValue" />
      <input type="hidden" name="durUnit" value="hours" />
      <Field label="Link to a build, stage or part (optional)" hint="A part-step link shares its status and counts in scores.">
        <select name="link" defaultValue={card?.link ?? ""} className={input}>
          <option value="">— not linked —</option>
          {p.links.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
        </select>
      </Field>
      <Field label="Fixed start (optional)" hint="Leave empty to follow the previous task. If the queue runs late it is pushed and marked late start.">
        <input type="datetime-local" name="fixedStart" defaultValue={card?.fixedStart ?? ""} className={`${input} font-mono`} />
      </Field>
      <div className="flex items-end gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ownColour} onChange={(e) => setOwnColour(e.target.checked)} /> Own colour</label>
        {ownColour ? <input type="color" name="colour" defaultValue={card?.colour ?? "#E9BE5F"} className="h-9 w-14 rounded border border-line2 bg-panel2" />
          : <input type="hidden" name="colour" value="" />}
        {!ownColour && <span className="text-xs text-grey">Uses the department colour</span>}
      </div>
      <Field label="Notes"><textarea name="notes" rows={2} defaultValue={card?.notes} className={input} /></Field>
    </ActionForm>
  );
}

function Card({ card, col, idx, count, p, onEdit, onError, overlay }: {
  card: QueueCard; col: QueueColumn; idx: number; count: number; p: Props; onEdit: () => void; onError: (m: string) => void; overlay?: boolean;
}) {
  const sortable = useSortable({ id: card.id, disabled: !p.canWrite });
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); if (r.error) onError(r.error); });
  const st = p.statusLabels[card.status];
  const style = overlay ? undefined : { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.35 : 1 };
  return (
    <li ref={overlay ? undefined : sortable.setNodeRef} style={style}
      className={`min-w-0 rounded-md border bg-panel2 p-2.5 text-sm ${card.status === "doing" ? "border-gold" : "border-line"} ${pending ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        {p.canWrite && (
          <button ref={sortable.setActivatorNodeRef} {...sortable.attributes} {...sortable.listeners} aria-label={`Drag ${card.title}`}
            className="mt-0.5 cursor-grab touch-none select-none px-0.5 font-mono text-grey hover:text-gold active:cursor-grabbing">⋮⋮</button>
        )}
        <span className="mt-1 h-3 w-1 shrink-0 rounded" style={{ background: card.colour ?? col.colour }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate">{card.title}</span>
            <span className="shrink-0 font-mono text-xs text-grey">{card.duration}</span>
          </div>
          {card.linkLabel && <div className="truncate font-mono text-xs text-gold/80">{card.linkLabel}</div>}
          <div className="truncate font-mono text-xs text-grey">{card.when}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: st.colour }} />{st.label}</span>
            {card.overrun && <span className="text-bad">running over</span>}
            {card.lateStart && <span className="text-warn">late start</span>}
          </div>
        </div>
      </div>
      {p.canWrite && !overlay && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
          <button className="rounded border border-line2 px-1.5 font-mono text-xs disabled:opacity-30" disabled={idx === 0 || pending} aria-label="Move to top" onClick={() => act(() => moveQueueTaskToTop(card.id, card.version))}>⤒</button>
          <button className="rounded border border-line2 px-1.5 font-mono text-xs disabled:opacity-30" disabled={idx === 0 || pending} aria-label="Move up" onClick={() => act(() => nudgeQueueTask(card.id, card.version, -1))}>↑</button>
          <button className="rounded border border-line2 px-1.5 font-mono text-xs disabled:opacity-30" disabled={idx === count - 1 || pending} aria-label="Move down" onClick={() => act(() => nudgeQueueTask(card.id, card.version, 1))}>↓</button>
          <select aria-label="Status" value={card.status} disabled={pending} onChange={(e) => act(() => setQueueStatus(card.id, card.version, e.target.value as Status))}
            className="ml-auto max-w-[7.5rem] rounded border border-line2 bg-panel px-1 py-0.5 text-xs">
            {(Object.keys(p.statusLabels) as Status[]).map((s) => <option key={s} value={s}>{p.statusLabels[s].label}</option>)}
          </select>
          <button className={`${btn.link} text-xs`} onClick={onEdit}>Edit</button>
          <button className={`${btn.link} text-xs`} disabled={pending} onClick={() => act(() => duplicateQueueTask(card.id))}>Duplicate</button>
          <button className="text-xs text-bad hover:underline" disabled={pending} onClick={() => act(() => deleteQueueTask(card.id, card.version))}>Delete</button>
        </div>
      )}
    </li>
  );
}

function Column({ col, ids, cards, p, onAdd, onEdit, onError }: {
  col: QueueColumn; ids: string[]; cards: Map<string, QueueCard>; p: Props; onAdd: () => void; onEdit: (c: QueueCard) => void; onError: (m: string) => void;
}) {
  const drop = useDroppable({ id: col.personId, disabled: !p.canWrite });
  return (
    <section ref={drop.setNodeRef} className={`flex w-72 shrink-0 flex-col rounded-[10px] border bg-panel ${drop.isOver ? "border-gold" : "border-line"}`}>
      <header className="flex items-center gap-2 border-b border-line p-3">
        <Avatar c={col} />
        <div className="min-w-0 flex-1">
          <div className="truncate">{col.name}</div>
          <div className="font-mono text-xs text-grey">{ids.length} task{ids.length === 1 ? "" : "s"}</div>
        </div>
        {p.canWrite && <button className={`${btn.ghost} !px-2 !py-1`} onClick={onAdd} aria-label={`Add task for ${col.name}`}>+ Task</button>}
      </header>
      <SortableContext id={col.personId} items={ids} strategy={verticalListSortingStrategy}>
        <ol className="grid min-h-16 grid-cols-[minmax(0,1fr)] gap-2 p-2">
          {ids.map((id, i) => cards.get(id) && (
            <Card key={id} card={cards.get(id)!} col={col} idx={i} count={ids.length} p={p} onEdit={() => onEdit(cards.get(id)!)} onError={onError} />
          ))}
          {!ids.length && <li className="rounded border border-dashed border-line2 p-3 text-center text-xs text-grey">Empty — drop a task here</li>}
        </ol>
      </SortableContext>
    </section>
  );
}

export function QueueBoard(p: Props) {
  const fromProps = () => Object.fromEntries(p.columns.map((c) => [c.personId, c.cards.map((x) => x.id)]));
  const [order, setOrder] = useState<Record<string, string[]>>(fromProps);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ personId: string; card: QueueCard | null } | null>(null);
  const [, start] = useTransition();
  const origin = useRef<{ container: string; snapshot: Record<string, string[]> } | null>(null);
  const cards = useMemo(() => new Map(p.columns.flatMap((c) => c.cards.map((x) => [x.id, x] as const))), [p.columns]);
  const colOf = useMemo(() => new Map(p.columns.map((c) => [c.personId, c])), [p.columns]);

  // Server refresh (realtime or after a save) replaces the local order unless a drag is in progress.
  useEffect(() => { if (!active) setOrder(fromProps()); }, [p.columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const find = (id: string) => (id in order ? id : Object.keys(order).find((k) => order[k].includes(id)));

  const onStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setActive(id);
    setError(null);
    origin.current = { container: find(id)!, snapshot: order };
  };
  const onOver = (e: DragOverEvent) => {
    if (!e.over) return;
    const id = String(e.active.id), overId = String(e.over.id);
    const from = find(id), to = find(overId);
    if (!from || !to || from === to) return;
    setOrder((o) => {
      const src = o[from].filter((x) => x !== id);
      const dst = [...o[to]];
      const at = overId in o ? dst.length : Math.max(0, dst.indexOf(overId));
      dst.splice(at, 0, id);
      return { ...o, [from]: src, [to]: dst };
    });
  };
  const onEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    setActive(null);
    const o0 = origin.current;
    origin.current = null;
    if (!o0) return;
    const to = find(id);
    if (!to) return;
    let list = order[to];
    if (e.over && to === find(String(e.over.id)) && String(e.over.id) !== id && !(String(e.over.id) in order)) {
      list = arrayMove(list, list.indexOf(id), list.indexOf(String(e.over.id)));
      setOrder((o) => ({ ...o, [to]: list }));
    }
    const i = list.indexOf(id);
    const was = o0.snapshot[o0.container].indexOf(id);
    if (to === o0.container && i === was) return;
    const card = cards.get(id)!;
    start(async () => {
      const r = await moveQueueTask(id, card.version, to, list[i + 1] ?? null, list[i - 1] ?? null);
      if (r.error) { setOrder(o0.snapshot); setError(r.error); }
    });
  };

  const groups = p.departments.map((d) => ({ d, cols: p.columns.filter((c) => c.departmentId === d.id) })).filter((g) => g.cols.length);
  return (
    <>
      {error && <p role="alert" className="rounded-md border border-bad bg-panel p-3 text-sm text-bad">{error}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd}
        onDragCancel={() => { if (origin.current) setOrder(origin.current.snapshot); setActive(null); }}>
        <div className="grid min-w-0 gap-6">
          {groups.map(({ d, cols }) => (
            <div key={d.id ?? "none"} className="min-w-0">
              <h2 className="eyebrow mb-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: d.colour }} />{d.emoji} {d.name}</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {cols.map((c) => (
                  <Column key={c.personId} col={c} ids={order[c.personId] ?? []} cards={cards} p={p}
                    onAdd={() => setDialog({ personId: c.personId, card: null })} onEdit={(card) => setDialog({ personId: c.personId, card })} onError={setError} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <DragOverlay>
          {active && cards.get(active) ? (
            <ul className="w-72 rotate-1 shadow-2xl"><Card card={cards.get(active)!} col={colOf.get(find(active) ?? "") ?? p.columns[0]} idx={0} count={1} p={p} onEdit={() => {}} onError={() => {}} overlay /></ul>
          ) : null}
        </DragOverlay>
      </DndContext>
      <Modal open={!!dialog} onClose={() => setDialog(null)} wide
        title={dialog ? `${dialog.card ? "Edit task" : "Add task"} · ${colOf.get(dialog.personId)?.name ?? ""}` : ""}>
        {dialog && <TaskForm key={dialog.card ? `${dialog.card.id}:${dialog.card.version}` : `new:${dialog.personId}`} personId={dialog.personId} card={dialog.card} p={p} onDone={() => setDialog(null)} />}
      </Modal>
    </>
  );
}

/** "Add task" for one employee, usable outside the board (Crew page). */
export function AddQueueTask({ personId, name, links, dayHours = 0 }: { personId: string; name: string; links: Props["links"]; dayHours?: number }) {
  const [open, setOpen] = useState(false);
  const p = { canWrite: true, departments: [], columns: [], links, statusLabels: {} as Props["statusLabels"], dayHours };
  return (
    <>
      <button className={`${btn.ghost} !px-2 !py-1`} onClick={() => setOpen(true)}>+ Task</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Add task · ${name}`} wide>
        <TaskForm personId={personId} card={null} p={p} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
