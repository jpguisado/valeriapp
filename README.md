# Valeriapp

Registro diario de la vida de un bebé — tomas, sueño, pañales, medicación y
medidas — como **PWA offline-first** en español, autoalojada.

No es una app nativa: se abre en el navegador, se añade a la pantalla de inicio
y funciona sin conexión. Sin App Store, sin firmas, sin caducidades.

## Qué hace

- **Registro rápido**: pantalla de estado (“última toma hace 2 h 15 min · pecho
  izq→der · durmiendo desde 14:30”) y botonera grande. Un toque inicia o para un
  temporizador; mantener pulsado abre el formulario completo.
- **Una toma, dos pechos**: si el bebé empieza en el izquierdo y termina en el
  derecho, se cambia de lado sin cortar el temporizador. Queda **una sola toma**
  con el tiempo repartido por lado, no dos registros.
- **Pausas**: si hay que despertar a la bebé a mitad de la toma, se pausa el
  temporizador. La toma sigue abierta y el rato de pausa no cuenta como tiempo
  mamando.
- **Offline de verdad**: todo se escribe primero en IndexedDB y una cola lo
  envía cuando hay red. Los eventos llevan UUID de cliente, así que reenviar es
  idempotente.
- **Multiusuario**: varios cuidadores en un hogar, cada evento firmado por quien
  lo registró, temporizadores visibles y parables desde cualquier móvil.
- **Zonas horarias**: cada evento guarda su instante UTC, la zona del
  dispositivo y su hora local. Una toma a las 03:00 en Lisboa se lee a las 03:00.
- **Estadísticas** semanales y mensuales: números, gráficas (incluida la de
  franjas de sueño por hora del día) y comparación con el periodo anterior.
- **Calendario mensual** coloreado por la métrica que elijas.
- **Recordatorios** por Web Push a todos los dispositivos del hogar, que se
  cancelan solos cuando alguien registra el evento esperado.
- **Copias de seguridad**: dump diario, envío semanal por correo y botón de
  exportación completa (JSON + CSV en un zip).

## Arquitectura

```
navegador ──► IndexedDB (Dexie) ──► cola outbox ──► POST /api/sync ──► Postgres
     ▲                                                   │
     └────────────── eventos desde serverSeq ◄────────────┘
```

| Capa | Tecnología |
|---|---|
| Cliente | React 19 + TypeScript + Vite, PWA con service worker propio |
| Local | Dexie (IndexedDB) con patrón outbox |
| Servidor | Hono + Drizzle sobre Postgres 16, un único proceso Node |
| Compartido | `shared/` — modelo, zonas horarias, estadísticas y recordatorios |

`shared/` es la pieza clave: las estadísticas se calculan con el mismo código en
el cliente (offline) y en el servidor (resumen diario), así que no pueden
discrepar.

## Desarrollo

```bash
pnpm install
cp .env.example .env          # apunta DATABASE_URL a un Postgres local
pnpm db:migrate
pnpm seed --user <usuario> --password "…" --name "<Nombre>" \
          --baby "<Bebé>" --birth AAAA-MM-DD
pnpm dev                      # cliente en :5173, API en :3000
```

Otros comandos:

```bash
pnpm typecheck    # tipos del cliente, servidor y service worker
pnpm test         # estadísticas, zonas horarias, recordatorios y cola offline
pnpm build        # dist/client + dist/server
```

## Estructura

```
shared/     modelo de eventos, tiempo, estadísticas y recordatorios (sin E/S)
server/     API Hono, esquema Drizzle, sincronización, push, backups
src/        PWA React: pantallas, componentes, motor de sincronización
drizzle/    migraciones SQL escritas a mano
deploy/     vhost de nginx
scripts/    iconos, restauración y copia manual
```

## Decisiones que conviene conocer

- **Sin motor de sincronización de terceros.** Los eventos son hechos
  inmutables; last-write-wins sobre `updatedAt` basta y cabe en un fichero.
- **Borrado lógico con historial.** Nada desaparece de verdad: cada cambio deja
  una revisión con autor y momento.
- **Los temporizadores olvidados se cierran solos** (1 h toma, 14 h sueño, 45
  min extracción) y quedan marcados como *estimados* hasta que se confirmen.
- **La alternancia mira el pecho por el que se empieza**, no por el que se
  acaba: una toma que ya cambió de lado se ha equilibrado sola.
- **Una toma mide tiempo al pecho, no tiempo de reloj**: las estadísticas suman
  los segmentos por lado, así que las pausas no inflan las medias.
- **La medicación es texto libre**, sin pautas ni avisos: solo registra qué se
  dio y cuándo.
- **Nada de percentiles ni cálculo de dosis.** Eso es del pediatra.

Despliegue: [DEPLOY.md](DEPLOY.md). Ideas aparcadas: [V2.md](V2.md).
