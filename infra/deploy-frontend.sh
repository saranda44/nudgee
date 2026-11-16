#!/bin/bash
# Sube frontend/dist a S3 (ARQ §4.1: assets con hash cacheables 1 año; index.html, sw.js y el
# manifest sin caché) y purga la caché de Cloudflare (reemplaza la invalidación de CloudFront,
# no viable en Learner Lab — ver infra/main.tf).
# Uso: infra/deploy-frontend.sh <bucket> <cognito_domain> <api_base_url> <cloudflare_zone_id> <cloudflare_api_token>
# (bucket/cognito_domain/api_base_url son los outputs frontend_bucket/cognito_domain/api_endpoint
# de `terraform output` — api_base_url ya debe incluir el esquema https://)
set -e

BUCKET="$1"
COGNITO_DOMAIN="$2"
API_BASE_URL="$3"
CLOUDFLARE_ZONE_ID="$4"
CLOUDFLARE_API_TOKEN="$5"
DIST_DIR="$(cd "$(dirname "$0")/../frontend/dist" && pwd)"

if [ -z "$BUCKET" ] || [ -z "$COGNITO_DOMAIN" ] || [ -z "$API_BASE_URL" ] || [ -z "$CLOUDFLARE_ZONE_ID" ] || [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "Uso: $0 <bucket> <cognito_domain> <api_base_url> <cloudflare_zone_id> <cloudflare_api_token>"
    exit 1
fi

if [ ! -f "$DIST_DIR/index.html" ]; then
    echo "No hay build en frontend/dist. Corre antes: cd frontend && npm run build"
    exit 1
fi

# CSP por <meta> tag, no por header de CloudFront/Cloudflare (NFR-06): se inyecta solo acá,
# sobre una copia de dist/index.html — el index.html del repo queda intacto, porque un <meta>
# ahí rompería el HMR de Vite en dev. frame-ancestors/HSTS/X-Content-Type-Options no se pueden
# poner por <meta> — quedan fuera, documentado como limitación de Learner Lab, no de diseño.
# connect-src necesita Cognito Y la API: la API ya no es mismo origen (VITE_API_BASE_URL).
CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://i.ytimg.com data:; font-src 'self'; connect-src 'self' https://${COGNITO_DOMAIN} ${API_BASE_URL}; base-uri 'self'; form-action 'self'"
INDEX_TMP="$(mktemp)"
sed "s#<head>#<head>\n    <meta http-equiv=\"Content-Security-Policy\" content=\"${CSP}\">#" \
    "$DIST_DIR/index.html" > "$INDEX_TMP"

echo "Subiendo assets con hash (cache 1 año, immutable)..."
aws s3 sync "$DIST_DIR" "s3://$BUCKET" \
    --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "index.html" --exclude "sw.js" --exclude "manifest.webmanifest"

echo "Subiendo index.html (con el CSP inyectado), sw.js y el manifest (sin caché)..."
aws s3 cp "$INDEX_TMP" "s3://$BUCKET/index.html" --cache-control "no-cache" --content-type "text/html"
aws s3 cp "$DIST_DIR/sw.js" "s3://$BUCKET/sw.js" --cache-control "no-cache"
aws s3 cp "$DIST_DIR/manifest.webmanifest" "s3://$BUCKET/manifest.webmanifest" --cache-control "no-cache"
rm -f "$INDEX_TMP"

echo "Purgando la caché de Cloudflare..."
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' > /dev/null

echo "✓ Listo."
