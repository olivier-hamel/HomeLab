export default function Switch({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className="media-switch">
    <span className="min-w-0 text-left"><span className="block text-sm font-medium text-white">{label}</span>{description && <span className="mt-1 block text-xs text-neutral-400">{description}</span>}</span>
    <span className="media-switch-track" aria-hidden="true"><span /></span>
  </button>;
}
