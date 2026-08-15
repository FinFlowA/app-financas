export default function DashboardLoading() {
  return (
    <div className="max-w-4xl animate-pulse">
      <div className="h-4 w-28 rounded bg-surface-muted" />
      <div className="mt-2 h-10 w-56 rounded bg-surface-muted" />

      <div className="mt-5 h-24 rounded-ff-lg border border-border bg-surface p-5">
        <div className="flex gap-8">
          <div className="h-10 w-32 rounded bg-surface-muted" />
          <div className="h-10 w-32 rounded bg-surface-muted" />
        </div>
      </div>

      <div className="mt-8 h-6 w-24 rounded bg-surface-muted" />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="h-20 rounded-ff-md bg-surface-muted" />
        <div className="h-20 rounded-ff-md bg-surface-muted" />
      </div>
    </div>
  );
}
