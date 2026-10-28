#!/usr/bin/env bash
set -euo pipefail

# Run in Google Cloud Shell from this repository. Billing must already be linked.
# No private key files are created. Cloud Run uses its attached service identity.
PROJECT=naijaledger-ed044
REGION=europe-west1
SERVICE=naijaledger
SERVICE_ACCOUNT=naijaledger-runtime
IDENTITY="${SERVICE_ACCOUNT}@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com

if ! gcloud iam service-accounts describe "$IDENTITY" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT" --display-name 'NaijaLedger runtime' --project "$PROJECT"
fi
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${IDENTITY}" --role=roles/datastore.user --condition=None --quiet >/dev/null

# Cloud Build's default identity needs permission to build source deployments.
BUILD_IDENTITY=$(gcloud builds get-default-service-account --project "$PROJECT")
BUILD_EMAIL="${BUILD_IDENTITY##*/}"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${BUILD_EMAIL}" --role=roles/run.builder --condition=None --quiet >/dev/null

gcloud run deploy "$SERVICE" --source . --project "$PROJECT" --region "$REGION" \
  --service-account "$IDENTITY" --allow-unauthenticated \
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT}" \
  --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1 --concurrency 20 --timeout 60 --quiet

SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')
printf '\nCloud Run URL: %s\n' "$SERVICE_URL"
printf 'Add this hostname to Firebase Authentication > Settings > Authorized domains: %s\n' "${SERVICE_URL#https://}"
printf 'The /api/health endpoint should return {"status":"ok"}.\n'
printf 'Meta investigations require a MODEL_API_KEY secret on this service. See README.\n'
