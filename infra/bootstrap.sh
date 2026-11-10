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
if aws ssm get-parameter --name "/nudgee/VAPID_PUBLIC_KEY" > /dev/null 2>&1; then
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
        --type "String"

    aws ssm put-parameter \
        --name "/nudgee/VAPID_PRIVATE_KEY" \
        --value "$VAPID_PRIVATE" \
        --type "SecureString"

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

echo "=================================================="
echo "Stack persistente creado con éxito."
echo "Bucket de estado: $BUCKET_NAME"
echo "ACTUALIZA EL NOMBRE DEL BUCKET EN infra/providers.tf"
echo "=================================================="