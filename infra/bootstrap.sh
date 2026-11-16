#!/bin/bash
set -e

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET_NAME="nudgee-tf-state-${ACCOUNT_ID}"

echo "Creando stack persistente en la cuenta ${ACCOUNT_ID}..."

# 1. Crear el bucket S3 si no existe
if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    echo "El bucket $BUCKET_NAME ya existe."
else
    echo "Creando bucket S3: $BUCKET_NAME"
    aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION"
fi

# 2. Habilitar el versionado del bucket (crítico para recuperar estados corruptos)
aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --versioning-configuration Status=Enabled

# 3. Generar y guardar claves VAPID en SSM (si no existen)
# Una llave pública VAPID válida es un punto P-256 sin comprimir: 87 caracteres base64url.
EXISTING_VAPID=$(aws ssm get-parameter --name "/nudgee/VAPID_PUBLIC_KEY" --with-decryption \
    --query Parameter.Value --output text 2>/dev/null || true)
if [[ "$EXISTING_VAPID" =~ ^B[A-Za-z0-9_-]{86}$ ]]; then
    echo "Las claves VAPID ya existen en SSM."
else
    echo "Generando claves VAPID con web-push..."
    VAPID_KEYS=$(npx -y web-push generate-vapid-keys --json 2>&1)

    VAPID_PUBLIC=$(echo "$VAPID_KEYS" | grep -o '"publicKey":"[^"]*' | cut -d'"' -f4)
    VAPID_PRIVATE=$(echo "$VAPID_KEYS" | grep -o '"privateKey":"[^"]*' | cut -d'"' -f4)

    if [ -z "$VAPID_PUBLIC" ] || [ -z "$VAPID_PRIVATE" ]; then
        echo "Error: No se pudieron generar las claves VAPID. Verifica que web-push esté disponible."
        exit 1
    fi

    echo "Guardando claves VAPID en SSM..."
    aws ssm put-parameter \
        --name "/nudgee/VAPID_PUBLIC_KEY" \
        --value "$VAPID_PUBLIC" \
        --type "String" \
        --overwrite

    aws ssm put-parameter \
        --name "/nudgee/VAPID_PRIVATE_KEY" \
        --value "$VAPID_PRIVATE" \
        --type "SecureString" \
        --overwrite

    echo "✓ Claves VAPID generadas y guardadas."
fi

# 4. Crear GEMINI_API_KEY vacío en SSM (si no existe)
if aws ssm get-parameter --name "/nudgee/GEMINI_API_KEY" > /dev/null 2>&1; then
    echo "El parámetro GEMINI_API_KEY ya existe."
else
    echo "Creando parámetro GEMINI_API_KEY en SSM (requiere actualización manual)"
    aws ssm put-parameter \
        --name "/nudgee/GEMINI_API_KEY" \
        --value "DUMMY_VALUE_CHANGE_ME" \
        --type "SecureString"
fi

# 5. Dominio propio vía Cloudflare (opcional — NFR-09): Cloudflare es el CDN/TLS del dominio
# (Learner Lab niega cloudfront:CreateDistribution, así que CloudFront no es viable en esta
# cuenta y ya no hace falta ningún certificado ACM: Cloudflare da su propio TLS en modo proxied).
# Sin DOMAIN_NAME exportado, este paso y el bucket del frontend se saltan — el backend (lo de
# arriba) queda listo igual; el frontend solo se puede correr en local (npm run dev).
if [ -z "$DOMAIN_NAME" ]; then
    echo "DOMAIN_NAME no está exportado: se omite el dominio propio y el bucket del frontend."
    echo "(el backend ya quedó listo; corre el frontend en local con npm run dev)"
else
    : "${CLOUDFLARE_ZONE_ID:?Exporta CLOUDFLARE_ZONE_ID (Overview de la zona en el dashboard de Cloudflare)}"
    : "${CLOUDFLARE_API_TOKEN:?Exporta CLOUDFLARE_API_TOKEN (My Profile > API Tokens, plantilla \"Edit zone DNS\", restringido a tu zona)}"

    echo "Guardando el token de Cloudflare en SSM..."
    aws ssm put-parameter \
        --name "/nudgee/CLOUDFLARE_API_TOKEN" \
        --value "$CLOUDFLARE_API_TOKEN" \
        --type "SecureString" \
        --overwrite > /dev/null

    # 6. Bucket del frontend: Learner Lab niega cloudfront:CreateOriginAccessControl (no hay
    # forma de que algo privado se sirva sin CloudFront) y el recurso aws_s3_bucket de Terraform
    # siempre falla por una denegación explícita de la SCP al leer la config de object lock —
    # así que este bucket se crea aquí, no en el apply normal, como sitio estático público (S3
    # website hosting). error_document = index.html hace de SPA fallback (sin CloudFront
    # Function, también denegada). El nombre tiene que ser EXACTAMENTE el dominio (ver el
    # comentario largo en main.tf: el endpoint de sitio web de S3 identifica el bucket por el
    # Host de la petición, y Cloudflare proxied lo reenvía tal cual — reescribirlo con una
    # Origin Rule es función de pago).
    FRONTEND_BUCKET="${DOMAIN_NAME}"

    if aws s3api head-bucket --bucket "$FRONTEND_BUCKET" 2>/dev/null; then
        echo "El bucket $FRONTEND_BUCKET ya existe."
    else
        echo "Creando bucket S3 del frontend: $FRONTEND_BUCKET"
        aws s3api create-bucket --bucket "$FRONTEND_BUCKET" --region "$REGION"
    fi

    aws s3api put-public-access-block --bucket "$FRONTEND_BUCKET" --public-access-block-configuration \
        BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

    aws s3api put-bucket-website --bucket "$FRONTEND_BUCKET" --website-configuration \
        '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"index.html"}}'

    aws s3api put-bucket-policy --bucket "$FRONTEND_BUCKET" --policy "$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadOnly",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${FRONTEND_BUCKET}/*"
  }]
}
EOF
)"

    echo "✓ Bucket del frontend listo: ${FRONTEND_BUCKET}"
fi

echo "=================================================="
echo "Stack persistente creado con éxito."
echo "Bucket de estado: $BUCKET_NAME"
if [ -n "$DOMAIN_NAME" ]; then
    echo "Bucket del frontend: ${DOMAIN_NAME}"
    echo "Dominio: https://${DOMAIN_NAME} (tras el terraform apply, que crea el CNAME proxied en Cloudflare)"
fi
echo "ACTUALIZA EL NOMBRE DEL BUCKET EN infra/providers.tf"
echo "=================================================="