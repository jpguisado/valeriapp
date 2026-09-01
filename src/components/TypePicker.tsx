import { useState } from 'react'
import { EVENT_LABELS, type EventType } from '@shared/events'
import { EVENT_ACCENTS, PICKER_ORDER } from './event-meta'
import { BedDouble, EventIcon, X } from './icons'

/** Si lo que se registra está pasando ahora o ya ocurrió. */
export type PickMode = 'now' | 'past'

/**
 * Everything that can be recorded, including the rare ones that do not earn a
 * place on the home grid (talla, perímetro, extracción…).
 */
export function TypePicker({
  onPick,
  onStartNight,
  nightActive = false,
  onClose,
}: {
  onPick: (type: EventType, mode: PickMode) => void
  onStartNight?: () => void
  nightActive?: boolean
  onClose: () => void
}) {
  // Abre siempre en "ahora", que es el caso de nueve de cada diez registros.
  const [mode, setMode] = useState<PickMode>('now')

  // Un desvelo es un corte de la noche: en "ahora" no significa nada sin noche
  // en marcha, pero apuntando algo pasado sí — la noche de ayer ya está cerrada.
  const showWakeup = nightActive || mode === 'past'
  const types = showWakeup ? PICKER_ORDER : PICKER_ORDER.filter((type) => type !== 'wakeup')

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Qué quieres registrar">
        <div className="sheet-handle" />
        <div className="row between">
          <h2>Registrar</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Cerrar">
            <X size={19} />
          </button>
        </div>
        <div className="segmented" role="tablist" aria-label="Cuándo ocurrió">
          <button role="tab" aria-selected={mode === 'now'} onClick={() => setMode('now')}>
            Ahora
          </button>
          <button role="tab" aria-selected={mode === 'past'} onClick={() => setMode('past')}>
            Ya ha pasado
          </button>
        </div>

        <div className="quick-grid">
          {types.map((type) => (
            <button
              key={type}
              className="quick"
              style={{ ['--accent' as string]: EVENT_ACCENTS[type] }}
              onClick={() => onPick(type, mode)}
            >
              <span className="glyph">
                <EventIcon type={type} size={22} />
              </span>
              <span>{EVENT_LABELS[type]}</span>
            </button>
          ))}

          {/* La noche no es un evento suelto: envuelve a los demás. */}
          {mode === 'now' && onStartNight && !nightActive && (
            <button
              className="quick"
              style={{ ['--accent' as string]: 'var(--sleep)' }}
              onClick={onStartNight}
            >
              <span className="glyph">
                <BedDouble size={22} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <span>Nos acostamos</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
