export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="flex h-12 items-center gap-2 border-b bg-background px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">C</span>
        <span className="text-sm font-semibold tracking-tight">Campus Ops</span>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5 pb-16">{children}</main>
    </div>
  );
}
