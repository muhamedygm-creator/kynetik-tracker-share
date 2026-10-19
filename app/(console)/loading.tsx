/** Shown at once while a console page loads on the server, so a tap answers immediately. */
export default function Loading() {
  return (
    <div className="grid animate-pulse gap-5" aria-busy="true" aria-label="Loading">
      <div className="grid gap-2">
        <div className="h-3 w-40 rounded bg-panel2" />
        <div className="h-7 w-64 rounded bg-panel2" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl border border-line bg-panel" />)}
      </div>
      <div className="h-72 rounded-xl border border-line bg-panel" />
    </div>
  );
}
