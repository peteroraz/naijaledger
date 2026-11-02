#!/usr/bin/env bash
set -euo pipefail

# Run in Google Cloud Shell from this repository. Billing must already be linked.
# No private key files are created. Cloud Run uses its attached service identity.
PROJECT=naijaledger-ed044
REGION=europe-west1
SERVICE=naijaledger
SERVICE_ACCOUNT=naijaledger-runtime
IDENTITY="${SERVICE_ACCOUNT}@${PROJECT}.iam.gserviceaccount.com"
COMMIT_SHA=$(git rev-parse --short=12 HEAD)
read -r -p 'Paste the public Firebase Web apiKey from your Firebase app config: ' FIREBASE_WEB_API_KEY
if [[ -z "$FIREBASE_WEB_API_KEY" ]]; then
  printf 'Firebase Web API key is required.\n' >&2
  exit 1
fi

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
  --update-env-vars "FIREBASE_PROJECT_ID=${PROJECT},FIREBASE_WEB_API_KEY=${FIREBASE_WEB_API_KEY},FIREBASE_WEB_APP_ID=1:793831462989:web:348988662e1b2adc8e6404,APP_COMMIT_SHA=${COMMIT_SHA}" \
  --min-instances 0 --max-instances 2 --memory 1Gi --cpu 1 --concurrency 8 --timeout 300 --quiet

# Keep the browser locked out of Firestore. All data access must pass through
# the authenticated Cloud Run API and Firebase Admin SDK.
npx --yes firebase-tools@14.22.0 deploy --only firestore:rules --project "$PROJECT" --non-interactive

SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')
printf '\nCloud Run URL: %s\n' "$SERVICE_URL"
printf 'Add this hostname to Firebase Authentication > Settings > Authorized domains: %s\n' "${SERVICE_URL#https://}"
printf 'The /api/health endpoint should return {"status":"ok"}.\n'
printf 'Meta investigations require a MODEL_API_KEY secret on this service. See README.\n'
