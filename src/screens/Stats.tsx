import { useMemo, useState } from 'react'
import {
  computeDailyStats,
  computeNights,
  measurementSeries,
  summarise,
  weightProgress,
} from '@shared/stats'
import { addDays, dayKeyOf } from '@shared/time'
import { BarChart, ChartCard, ComparisonRow, LineChart, SleepBandChart } from '@/components/charts'
import { EventSheet } from '@/components/EventSheet'
import { GrowthChart, currentPercentile } from '@/components/GrowthChart'
import { PageHeader } from '@/components/PageHeader'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { useEvents, useNow } from '@/lib/hooks'
import { useSession } from '@/lib/session'
import { birthLabel, celsius, cm, grams, hours, ml, number, rangeLabel } from '@/lib/format'

/**
 * Ventanas móviles que acaban hoy, no periodos naturales.
 *
 * Con semanas de lunes a domingo, cada lunes de madrugada las estadísticas se
 * vaciaban y el historial entero pasaba a "la semana pasada". Lo que interesa
 * aquí es la tendencia, y para eso los últimos siete días son siempre los
 * últimos siete días.
 */
type Period = 'week' | 'month'
const WINDOW: Record<Period, number> = { week: 7, month: 30 }

export function Stats() {
  const { activeBabyId, babies, timezone } = useSession()
  const baby = babies.find((candidate) => candidate.id === activeBabyId) ?? babies[0]
  const events = useEvents(activeBabyId)
  const now = useNow(60_000)
  const tz = timezone.fixed
  const [period, setPeriod] = useState<Period>('week')
  const [offset, setOffset] = useState(0)
  const [missingWeighAt, setMissingWeighAt] = useState<string | null>(null)

  const range = useMemo(() => {
    const today = dayKeyOf(now, tz)
    const length = WINDOW[period]
    const to = addDays(today, offset * length)
    const from = addDays(to, -(length - 1))
    return {
      from,
      to,
      previousFrom: addDays(from, -length),
      previousTo: addDays(from, -1),
      // Solo la ventana que llega hasta hoy tiene un día a medias.
      partialDay: offset === 0 ? today : null,
    }
  }, [period, offset, now, tz])

  const current = useMemo(
    () => summarise(events, range.from, range.to, { timezone }, now),
    [events, range, timezone, now],
  )
  const previous = useMemo(
    () => summarise(events, range.previousFrom, range.previousTo, { timezone }, now),
    [events, range, timezone, now],
  )
  const daily = useMemo(
    () => computeDailyStats(events, range.from, range.to, { timezone }, now),
    [events, range, timezone, now],
  )
  const nights = useMemo(
    () => computeNights(events, range.from, range.to, { timezone }, now),
    [events, range, timezone, now],
  )

  const weights = useMemo(() => measurementSeries(events, 'weight', { timezone }), [events, timezone])
  const heights = useMemo(() => measurementSeries(events, 'height', { timezone }), [events, timezone])
  const heads = useMemo(() => measurementSeries(events, 'head', { timezone }), [events, timezone])

  const title = rangeLabel(range.from, range.to)
  const periodDays = `${current.days} días`

  return (
    <div className="page">
      <PageHeader
        title="Datos"
        subtitle={`Media: ${number(current.perDay.feeds, 1)} tomas/día · ${number(
          current.perDay.sleepSeconds / 3600,
          1,
        )} h de sueño/día`}
      />

      <div className="segmented" role="tablist" aria-label="Periodo">
        <button
          role="tab"
          aria-selected={period === 'week'}
          onClick={() => {
            setPeriod('week')
            setOffset(0)
          }}
        >
          Últimos 7 días
        </button>
        <button
          role="tab"
          aria-selected={period === 'month'}
          onClick={() => {
            setPeriod('month')
            setOffset(0)
          }}
        >
          Últimos 30 días
        </button>
      </div>

      <div className="row between">
        <button
          className="btn ghost icon"
          onClick={() => setOffset((value) => value - 1)}
          aria-label="Periodo anterior"
        >
          <ChevronLeft size={20} />
        </button>
        <strong className="period-label">{title}</strong>
        <button
          className="btn ghost icon"
          onClick={() => setOffset((value) => Math.min(0, value + 1))}
          disabled={offset >= 0}
          aria-label="Periodo siguiente"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {current.hasEstimates && (
        <p className="banner warn tiny">
          Algún temporizador se cerró solo: hay duraciones estimadas en este periodo.
        </p>
      )}

      <ChartCard title="Tomas por día" meta={`${current.totals.feeds} tomas · ${periodDays}`}>
        <BarChart
          days={daily}
          pick={(day) => day.feeds}
          partialDay={range.partialDay}
          color="var(--breast)"
          format={(value) => `${Math.round(value)}`}
          tz={tz}
          now={now}
          label="Número de tomas por día"
        />
      </ChartCard>

      <ChartCard title="Horas de sueño" meta={`${hours(current.totals.sleepSeconds)} · ${periodDays}`}>
        <BarChart
          days={daily}
          pick={(day) => day.sleepSeconds / 3600}
          partialDay={range.partialDay}
          color="var(--sleep)"
          format={(value) => number(value, 1)}
          tz={tz}
          now={now}
          label="Horas de sueño por día"
        />
      </ChartCard>

      <ChartCard title="Pañales por día" meta={`${current.totals.diapers.total} pañales · ${periodDays}`}>
        <BarChart
          days={daily}
          pick={(day) => day.diapers.total}
          partialDay={range.partialDay}
          color="var(--diaper)"
          format={(value) => `${Math.round(value)}`}
          tz={tz}
          now={now}
          label="Pañales por día"
        />
      </ChartCard>

      {current.totals.bottleMl + current.totals.supplementMl > 0 && (
        <ChartCard
          title="Leche"
          meta={`${ml(current.totals.bottleMl + current.totals.supplementMl)} · ${periodDays}`}
        >
          <BarChart
            days={daily}
            pick={(day) => day.bottleMl}
            partialDay={range.partialDay}
            stack={{
              pick: (day) => day.supplementMl,
              color: 'var(--breast)',
              label: 'Suplemento en la toma',
            }}
            baseLabel="Biberón"
            color="var(--bottle)"
            format={(value) => `${Math.round(value)}`}
            tz={tz}
            now={now}
            label="Mililitros de leche por día, biberón y suplemento"
          />
        </ChartCard>
      )}

      <ChartCard
        title="Sueño por hora"
        meta={`racha máx. ${number(
          Math.max(0, ...nights.map((night) => night.longestStretchSeconds)) / 3600,
          1,
        )} h`}
      >
        <SleepBandChart days={daily} tz={tz} now={now} />
      </ChartCard>

      <ChartCard title="Comparación" meta="frente al periodo anterior">
        <div className="col" style={{ gap: 12 }}>
          <ComparisonRow
            label="Tomas al día"
            value={current.perDay.feeds}
            previous={previous.perDay.feeds}
            format={(value) => number(value, 1)}
          />
          <ComparisonRow
            label="Leche al día"
            value={current.perDay.milkMl}
            previous={previous.perDay.milkMl}
            format={(value) => ml(value)}
          />
          <ComparisonRow
            label="Sueño al día"
            value={current.perDay.sleepSeconds}
            previous={previous.perDay.sleepSeconds}
            format={(value) => hours(value)}
          />
          <ComparisonRow
            label="Sueño nocturno"
            value={current.perDay.nightSleepSeconds}
            previous={previous.perDay.nightSleepSeconds}
            format={(value) => hours(value)}
          />
          <ComparisonRow
            label="Despertares nocturnos"
            value={current.perDay.nightWakings}
            previous={previous.perDay.nightWakings}
            format={(value) => number(value, 1)}
            invert
          />
          <ComparisonRow
            label="Pañales al día"
            value={current.perDay.diapers}
            previous={previous.perDay.diapers}
            format={(value) => number(value, 1)}
          />
        </div>
      </ChartCard>

      <ChartCard title="Detalle" meta={title}>
        <div className="col" style={{ gap: 10 }}>
          <Fact label="Tomas totales" value={String(current.totals.feeds)} />
          <Fact
            label="Leche total"
            value={
              current.totals.supplementMl > 0
                ? `${ml(current.totals.bottleMl + current.totals.supplementMl)}`
                : ml(current.totals.bottleMl)
            }
          />
          {current.totals.supplementMl > 0 && (
            <Fact
              label="· de la cual"
              value={`${ml(current.totals.bottleMl)} biberón · ${ml(current.totals.supplementMl)} suplemento`}
            />
          )}
          <Fact
            label="Media por biberón"
            value={current.averages.mlPerBottle === null ? '—' : ml(current.averages.mlPerBottle)}
          />
          <Fact
            label="Minutos por toma de pecho"
            value={
              current.averages.minutesPerBreastFeed === null
                ? '—'
                : `${number(current.averages.minutesPerBreastFeed, 0)} min`
            }
          />
          <Fact
            label="Intervalo entre tomas"
            value={
              current.averages.minutesBetweenFeeds === null
                ? '—'
                : `${number(current.averages.minutesBetweenFeeds / 60, 1)} h`
            }
          />
          <Fact
            label="Pecho izquierdo / derecho"
            value={`${number(current.totals.leftSeconds / 60, 0)} / ${number(
              current.totals.rightSeconds / 60,
              0,
            )} min`}
          />
          <Fact label="Extracción total" value={ml(current.totals.pumpMl)} />
          <Fact
            label="Pañales"
            value={`${current.totals.diapers.pee} pis · ${current.totals.diapers.poo} caca · ${current.totals.diapers.mixed} mixtos`}
          />
          <Fact label="Medicación" value={String(current.totals.medications)} />
          <Fact
            label="Temperatura máxima"
            value={current.maxTemperature === null ? '—' : celsius(current.maxTemperature)}
          />
        </div>
      </ChartCard>

      <ChartCard title="Crecimiento" meta="todo el histórico">
        <div className="col" style={{ gap: 18 }}>
          <Measurement label="Peso">
            {baby ? (
              <>
                <WeightProgressLine
                  points={weights}
                  birthDate={baby.birthDate}
                  sex={baby.sex}
                  tz={tz}
                  onAddMissing={setMissingWeighAt}
                />
                <GrowthChart points={weights} birthDate={baby.birthDate} sex={baby.sex} />
                {!baby.sex && (
                  <p className="tiny faint">
                    Indica en Ajustes si es niña o niño y aparecerá la banda de referencia de la
                    OMS.
                  </p>
                )}
              </>
            ) : (
              <LineChart points={weights} color="var(--measure)" format={grams} label="Peso" />
            )}
          </Measurement>
          <Measurement label="Talla">
            <LineChart points={heights} color="var(--diaper)" format={cm} label="Talla" />
          </Measurement>
          <Measurement label="Perímetro cefálico">
            <LineChart points={heads} color="var(--pump)" format={cm} label="Perímetro cefálico" />
          </Measurement>
        </div>
      </ChartCard>

      {missingWeighAt && activeBabyId && (
        <EventSheet
          type="weight"
          babyId={activeBabyId}
          initialAt={missingWeighAt}
          onClose={() => setMissingWeighAt(null)}
        />
      )}
    </div>
  )
}

/** Lo que ha ganado desde el pesaje anterior, y dónde cae en la referencia. */
function WeightProgressLine({
  points,
  birthDate,
  sex,
  tz,
  onAddMissing,
}: {
  points: ReturnType<typeof measurementSeries>
  birthDate: string
  sex: 'female' | 'male' | null
  tz: string
  onAddMissing: (isoDate: string) => void
}) {
  const progress = weightProgress(points)
  const percentile = currentPercentile(points, birthDate, sex)
  const last = points.at(-1)
  if (!last) return null

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 10, alignItems: 'baseline' }}>
        <span className="mono strong" style={{ fontSize: '1.25rem' }}>
          {grams(last.value)}
        </span>
        {progress?.status === 'ok' && (
          <span className={progress.deltaGrams >= 0 ? 'trend-up small' : 'trend-down small'}>
            {progress.deltaGrams >= 0 ? '+' : '−'}
            {Math.abs(progress.deltaGrams)} g esta semana
            {progress.days !== 7 && <span className="faint"> · {progress.days} días</span>}
          </span>
        )}
        {percentile !== null && <span className="badge">percentil {Math.round(percentile)}</span>}
      </div>

      {progress?.status === 'missing' && (
        <div className="banner" style={{ alignItems: 'center' }}>
          <span className="grow">
            Falta el pesaje de hace una semana, el {birthLabel(dayKeyOf(progress.expectedAt, tz))}.
            Sin él no se puede decir cuánto ha ganado.
          </span>
          <button
            className="btn ghost"
            style={{ minHeight: 36, padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={() => onAddMissing(new Date(progress.expectedAt).toISOString())}
          >
            Añadirlo
          </button>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="row between">
      <span className="small dim">{label}</span>
      <span className="mono">{value}</span>
    </div>
  )
}

function Measurement({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <h3>{label}</h3>
      {children}
    </div>
  )
}
