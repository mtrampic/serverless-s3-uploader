#!/bin/bash
# Usage: ./scripts/create-user.sh <username> <password> [profile] [region] [table]
# profile: optional - omit to use default credentials (e.g. CloudShell)
# table:   optional - auto-resolved from the CloudFormation stack output
set -euo pipefail
USERNAME=$1; PASSWORD=$2
PROFILE=${3:-}; REGION=${4:-eu-central-1}; TABLE=${5:-}
ARGS=(--region "$REGION"); [ -n "$PROFILE" ] && ARGS+=(--profile "$PROFILE")

if [ -z "$TABLE" ]; then
  TABLE=$(aws cloudformation describe-stacks --stack-name serverless-s3-uploader "${ARGS[@]}" \
    --query "Stacks[0].Outputs[?OutputKey=='UsersTableName'].OutputValue" --output text)
fi

if command -v sha256sum >/dev/null 2>&1; then
  HASH=$(printf '%s' "$USERNAME:$PASSWORD" | sha256sum | cut -d' ' -f1)
else
  HASH=$(printf '%s' "$USERNAME:$PASSWORD" | shasum -a 256 | cut -d' ' -f1)
fi

aws dynamodb put-item --table-name "$TABLE" "${ARGS[@]}" \
  --item "{\"username\":{\"S\":\"$USERNAME\"},\"passwordHash\":{\"S\":\"$HASH\"}}"
echo "Created user: $USERNAME (table: $TABLE)"
