import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface group-[.toaster]:text-text-primary group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-text-muted",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-background",
          cancelButton:
            "group-[.toast]:bg-surface-hover group-[.toast]:text-text-primary",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
