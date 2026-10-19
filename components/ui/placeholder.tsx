export function Placeholder({ title, phase, children }: { title: string; phase: number; children?: React.ReactNode }) {
  return (
    <section>
      <p className="eyebrow mb-2">Coming in phase {phase}</p>
      <h1 className="display mb-5 text-2xl">{title}</h1>
      {children}
    </section>
  );
}
