import { useId } from 'react'
import type { MasteryDifficulty, MasteryPresets, StudyConfig } from './types'

const choices: { id: MasteryDifficulty; label: string; help: string }[] = [
  { id: 'relaxed', label: 'Facile / Relax', help: 'Environ deux bons rappels pour maîtriser une carte.' },
  { id: 'normal', label: 'Normal', help: 'Le rythme habituel, avec des réussites répétées et espacées.' },
  { id: 'strict', label: 'Strict', help: 'Plus de répétitions, davantage d’espacement et un score plus élevé.' },
]

export function difficultyFor(config: StudyConfig, presets: MasteryPresets): MasteryDifficulty | null {
  return choices.find(({ id }) => Object.entries(presets[id]).every(([key, value]) => config[key as keyof StudyConfig] === value))?.id ?? null
}

export default function MasteryDifficultySelector({ value, busy, onChange }: {
  value: MasteryDifficulty | null; busy: boolean; onChange: (value: MasteryDifficulty) => void
}) {
  const helpId = useId()
  return <div className="mastery-difficulty">
    <div className="mastery-difficulty-heading"><span>Difficulté de maîtrise</span>{value === null && <small>Personnalisée</small>}</div>
    <div className="mastery-difficulty-options" role="group" aria-label="Difficulté de maîtrise" aria-describedby={helpId} onKeyDown={event => event.stopPropagation()}>
      {choices.map(choice => <button type="button" key={choice.id} aria-pressed={value === choice.id} disabled={busy}
        onClick={() => onChange(choice.id)}>{choice.label}</button>)}
    </div>
    <p id={helpId}>{choices.find(choice => choice.id === value)?.help ?? 'Les critères de maîtrise ont été ajustés dans les paramètres.'}</p>
  </div>
}
