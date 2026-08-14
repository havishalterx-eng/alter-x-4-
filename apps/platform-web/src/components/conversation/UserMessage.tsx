export function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-surface-raised px-4 py-2.5 text-sm border border-border">
        {children}
      </div>
    </div>
  )
}
