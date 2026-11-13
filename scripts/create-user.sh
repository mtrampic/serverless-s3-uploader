#!/bin/bash
# Usage: ./scripts/create-user.sh <username> <password> [profile] [region] [table]
set -euo pipefail
USERNAME=$1; PASSWORD=$2
PROFILE=${3:-spoke-1-ada}; REGION=${4:-eu-central-1}
TABLE=${5:-serverless-s3-uploader-UsersTable-IVP4JRYN853H}
HASH=$(printf '%s' "$USERNAME:$PASSWORD" | shasum -a 256 | cut -d' ' -f1)
aws dynamodb put-item --table-name "$TABLE" --region "$REGION" --profile "$PROFILE" \
  --item "{\"username\":{\"S\":\"$USERNAME\"},\"passwordHash\":{\"S\":\"$HASH\"}}"
echo "Created user: $USERNAME"
