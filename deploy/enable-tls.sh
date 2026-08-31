#!/usr/bin/env bash
# Emite el certificado de Let's Encrypt para el dominio de la app y sustituye
# el vhost temporal de HTTP por el definitivo de HTTPS.
#
# Requisito: el dominio debe resolver públicamente y llegar a este nginx por el
# puerto 80. Sirve tanto un registro A directo como uno proxeado por Cloudflare:
# Cloudflare exime /.well-known/acme-challenge/ del "Always Use HTTPS".
#
# En el servidor:
#
#   sudo APP_DOMAIN=app.ejemplo.com ACME_EMAIL=tu@ejemplo.com \
#        NGINX_DIR=/ruta/a/tu/nginx bash deploy/enable-tls.sh
set -euo pipefail

DOMAIN="${APP_DOMAIN:?Define APP_DOMAIN, el dominio público de la app}"
EMAIL="${ACME_EMAIL:?Define ACME_EMAIL, el correo de aviso del certificado}"
# Directorio del nginx que hace de proxy: dentro esperamos conf.d/ y certbot/.
NGINX_DIR="${NGINX_DIR:-/srv/nginx}"
# Nombre del contenedor de nginx, para recargarlo al terminar.
NGINX_CONTAINER="${NGINX_CONTAINER:-proxy}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

CONF_DIR="$NGINX_DIR/conf.d"
WEBROOT="$NGINX_DIR/certbot/www"

# El resolver de la instancia cachea las respuestas negativas durante mucho
# rato, así que preguntamos a uno público por DoH en vez de fiarnos de getent.
resolved=$(curl -sS -m 10 -H 'accept: application/dns-json' \
  "https://cloudflare-dns.com/dns-query?name=$DOMAIN&type=A" |
  python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(a["data"] for a in d.get("Answer",[]) if a["type"]==1))')

if [[ -z "$resolved" ]]; then
  echo "· $DOMAIN no resuelve todavía en DNS público. Crea el registro A." >&2
  exit 1
fi
echo "· $DOMAIN resuelve a: $resolved"

# Lo que importa no es qué IP conteste, sino si el fichero del reto que vamos a
# escribir se lee desde internet. Lo probamos de verdad, fijando la dirección
# que dio DoH: el resolver de la instancia puede no conocer este nombre.
first_ip=$(echo "$resolved" | awk '{print $1}')
token="precheck-$(date +%s)"
mkdir -p "$WEBROOT/.well-known/acme-challenge"
echo "$token" > "$WEBROOT/.well-known/acme-challenge/$token"
reachable=$(curl -sS -m 15 --resolve "$DOMAIN:80:$first_ip" \
  "http://$DOMAIN/.well-known/acme-challenge/$token" || true)
rm -f "$WEBROOT/.well-known/acme-challenge/$token"

if [[ "$reachable" != "$token" ]]; then
  echo "· el reto ACME no llega a este nginx desde internet." >&2
  echo "  Comprueba que el puerto 80 está abierto y que, si usas el proxy de" >&2
  echo "  Cloudflare, no hay una regla que redirija /.well-known a HTTPS." >&2
  exit 1
fi
echo "· el reto ACME llega correctamente a este servidor"

docker run --rm \
  -v "$NGINX_DIR/certbot/conf:/etc/letsencrypt" \
  -v "$NGINX_DIR/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive

# La plantilla lleva __DOMAIN__: el vhost se escribe ya con el dominio puesto.
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx-tls.conf" > "$CONF_DIR/valeriapp.conf"
rm -f "$CONF_DIR/valeriapp-http.conf"

docker exec "$NGINX_CONTAINER" nginx -t
docker exec "$NGINX_CONTAINER" nginx -s reload
echo "· listo: https://$DOMAIN"
