import { lastBreastSide, SIDE_LABELS, type BabyEvent, type SingleSide } from '@shared/events'
import { EVENT_ACCENTS } from './event-meta'
import { EventIcon, X } from './icons'

/**
 * Por qué pecho empieza esta toma.
 *
 * La app no elige por ti: marca cuál fue el último con registro y decides. La
 * versión anterior proponía un lado a partir de sus propias propuestas —guardaba
 * el que había sugerido, no el que la bebé tomó— y acababa atascada siempre en
 * el mismo.
 */
export function BreastSideSheet({
  events,
  onPick,
  onClose,
}: {
  events: BabyEvent[]
  onPick: (side: SingleSide) => void
  onClose: () => void
}) {
  const last = lastBreastSide(events)

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Por qué pecho empieza">
        <div className="sheet-handle" />
        <div className="row between">
          <h2 className="row" style={{ gap: 10 }}>
            <span
              className="bullet sm"
              style={{ ['--accent' as string]: EVENT_ACCENTS.breast }}
            >
              <EventIcon type="breast" size={18} />
            </span>
            ¿Por qué pecho?
          </h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Cerrar">
            <X size={19} />
          </button>
        </div>

        <div className="side-choice">
          {(['left', 'right'] as SingleSide[]).map((side) => (
            <button
              key={side}
              className="side-button"
              onClick={() => onPick(side)}
              aria-label={SIDE_LABELS[side]}
            >
              <span className="letter">{side === 'left' ? 'I' : 'D'}</span>
              <span className="mark">{last === side ? 'último' : ' '}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
