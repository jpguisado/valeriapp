# Despliegue

Valeriapp es un único proceso Node que habla con un Postgres. Se despliega como
un contenedor detrás de un nginx que hace de proxy y termina el TLS. No asume
nada del servidor: cualquier máquina con Docker sirve, y está pensada para
acoplarse a una instalación que ya exista en vez de montar la suya.

```
Internet ──► nginx (80/443, certbot) ──► valeriapp:3000 ──► postgres:5432
                                              │
                                              └─► $BACKUP_DIR (copias)
```

Todo lo específico de tu servidor —dominio, rutas, credenciales— vive en el
`.env` y en los *secrets* del repositorio, nunca aquí.

## Requisitos

- Docker con Compose.
- Un Postgres accesible y una red docker externa donde alcanzarlo. Basta con
  crearla si no existe: `docker network create valeriapp`.
- Un nginx que haga de proxy, con `conf.d/` y un webroot para certbot.
- Un dominio apuntando a la máquina.

## Puesta en marcha

### 1. Configuración

```bash
cp .env.example .env
```

Rellena al menos `DATABASE_URL`, `PUBLIC_URL`, `VALERIAPP_NETWORK` y el par de
claves VAPID (`npx web-push generate-vapid-keys`). `VALERIAPP_IMAGE` decide qué
se despliega: la imagen del registro si usas CI, o `valeriapp:local` si compilas
en la propia máquina.

Crea la base y su rol antes del primer arranque; el contenedor aplica solo las
migraciones de `drizzle/` al levantarse.

### 2. Primer arranque y usuario inicial

```bash
docker compose up -d
docker compose exec app node dist/server/db/seed.js \
  --user <usuario> --password '<contraseña>' --name '<Nombre>' \
  --household 'Casa' --baby '<Bebé>' --birth AAAA-MM-DD
```

### 3. Dominio y certificado

Crea el registro A hacia la máquina. Si lo pones tras un proxy tipo Cloudflare,
el reto HTTP-01 sigue funcionando: `/.well-known/acme-challenge/` está exento de
"Always Use HTTPS".

Instala el vhost temporal de HTTP sustituyendo el dominio en la plantilla, y
lanza el script:

```bash
sed "s/__DOMAIN__/$APP_DOMAIN/g" deploy/nginx-http.conf > <conf.d>/valeriapp-http.conf

sudo APP_DOMAIN=app.ejemplo.com ACME_EMAIL=tu@ejemplo.com \
     NGINX_DIR=/ruta/a/tu/nginx bash deploy/enable-tls.sh
```

El script comprueba que el reto ACME llega de verdad desde internet antes de
pedir nada, emite el certificado, escribe el vhost definitivo (HTTP → HTTPS,
HSTS, `sw.js` sin caché) y recarga nginx.

> Hasta que exista HTTPS la app no es usable de verdad: la cookie de sesión es
> `Secure` y el service worker sólo se registra sobre TLS.

### 4. Despliegue continuo (opcional)

Con el repositorio en GitHub, en *Settings → Secrets and variables → Actions*:

| Secreto | Qué es |
|---|---|
| `SSH_HOST` | dirección del servidor |
| `SSH_USER` | usuario con acceso al directorio de la app |
| `SSH_KEY`  | clave privada SSH de ese usuario |
| `APP_DIR`  | ruta del checkout en el servidor, con su `.env` |
| `GHCR_TOKEN` | *personal access token* con `read:packages` |

Cada push a `main` compila, pasa los tests, publica la imagen en GHCR y hace
`docker compose pull && up -d` en el servidor. La compilación ocurre siempre en
GitHub: una instancia pequeña no tiene por qué cargar con ella.

### 5. Correo de las copias (opcional)

Con una API key de [Resend](https://resend.com) en `RESEND_API_KEY`, la copia
del domingo se envía por correo. Sin ella, las copias diarias se siguen
guardando en disco; sólo no se mandan.

## Operación diaria

```bash
docker compose logs -f app          # registro
docker compose restart app          # reiniciar
docker compose exec app node dist/server/db/seed.js --help
./scripts/backup-now.sh             # copia inmediata
DATABASE_URL=… ./scripts/restore.sh backups/valeriapp-AAAA-MM-DD.sql.gz
```

Copias: `pg_dump` diario a las 03:30 (hora local del servidor) en `$BACKUP_DIR`,
con la retención de `BACKUP_RETENTION_DAYS`.

## Monitorización

El contenedor tiene healthcheck y `restart: unless-stopped`, así que se levanta
solo. Para enterarte de una caída de la máquina entera hace falta mirar desde
fuera: un monitor HTTP contra `/api/health` cada pocos minutos, con alerta por
correo. Es lo único que un chequeo dentro de la propia máquina jamás detectará.

## Primer acceso

1. **Ajustes → Contraseña**: cambia la provisional del `seed`.
2. **Ajustes → Bebés**: añade al bebé con su fecha de nacimiento y su sexo (el
   sexo sólo se usa para la banda de referencia de la OMS en el peso).
3. **Ajustes → Notificaciones**: activa los avisos en cada móvil. En iPhone hay
   que añadir antes la app a la pantalla de inicio.
4. **Ajustes → Hogar → Generar código de invitación**: para el segundo cuidador.

## Seguridad

Si pones el dominio tras un proxy que oculta la IP de origen, cierra el origen a
las redes de ese proxy. Si no, la IP sigue siendo alcanzable directamente y el
proxy es decorativo.
