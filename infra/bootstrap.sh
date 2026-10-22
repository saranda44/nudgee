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

# 3. Crear secretos vacíos en SSM (si no existen)
parametros=(
    "/nudgee/GEMINI_API_KEY"
    "/nudgee/VAPID_PRIVATE_KEY"
    "/nudgee/VAPID_PUBLIC_KEY"
)

for param in "${parametros[@]}"; do
    if aws ssm get-parameter --name "$param" > /dev/null 2>&1; then
        echo "El parámetro $param ya existe."
    else
        echo "Creando parámetro vacío en SSM: $param"
        aws ssm put-parameter \
            --name "$param" \
            --value "DUMMY_VALUE_CHANGE_ME" \
            --type "SecureString"
    fi
done

echo "=================================================="
echo "Stack persistente creado con éxito."
echo "Bucket de estado: $BUCKET_NAME"
echo "ACTUALIZA EL NOMBRE DEL BUCKET EN infra/providers.tf"
echo "=================================================="