#!/usr/bin/env bash
set -euo pipefail

# Run in Google Cloud Shell from this repository. Billing must already be linked.
# No private key files are created. Cloud Run uses its attached service identity.
PROJECT=naijaledger-ed044
REGION=europe-west1
SERVICE=naijaledger
SERVICE_ACCOUNT=naijaledger-runtime
IDENTITY="${SERVICE_ACCOUNT}@${PROJECT}.iam.gserviceaccount.com"
read -r -p 'Paste the public Firebase Web apiKey from your Firebase app config: ' FIREBASE_WEB_API_KEY
if [[ -z "$FIREBASE_WEB_API_KEY" ]]; then
  printf 'Firebase Web API key is required.\n' >&2
  exit 1
fi

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com aiplatform.googleapis.com

if ! gcloud iam service-accounts describe "$IDENTITY" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT" --display-name 'NaijaLedger runtime' --project "$PROJECT"
fi
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${IDENTITY}" --role=roles/datastore.user --condition=None --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${IDENTITY}" --role=roles/aiplatform.user --condition=None --quiet >/dev/null

# The Evidence Agent works immediately with structured lexical retrieval. This
# vector index upgrades it to semantic hybrid retrieval as soon as Firestore
# finishes building the index.
if ! gcloud firestore indexes composite list --project "$PROJECT" --database='(default)' --filter='collectionGroup:ragChunks' --format='value(fields.fieldPath)' | grep -q embedding; then
  gcloud firestore indexes composite create \
    --project="$PROJECT" --database='(default)' --collection-group=ragChunks --query-scope=COLLECTION \
    --field-config=field-path=embedding,vector-config='{"dimension":"768","flat": "{}"}' \
    --async
fi

# Cloud Build's default identity needs permission to build source deployments.
BUILD_IDENTITY=$(gcloud builds get-default-service-account --project "$PROJECT")
BUILD_EMAIL="${BUILD_IDENTITY##*/}"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${BUILD_EMAIL}" --role=roles/run.builder --condition=None --quiet >/dev/null

gcloud run deploy "$SERVICE" --source . --project "$PROJECT" --region "$REGION" \
  --service-account "$IDENTITY" --allow-unauthenticated \
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT},FIREBASE_WEB_API_KEY=${FIREBASE_WEB_API_KEY},FIREBASE_WEB_APP_ID=1:793831462989:web:348988662e1b2adc8e6404,VERTEX_EMBEDDING_LOCATION=us-central1,VERTEX_EMBEDDING_MODEL=gemini-embedding-001" \
  --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1 --concurrency 20 --timeout 60 --quiet

SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')
printf '\nCloud Run URL: %s\n' "$SERVICE_URL"
printf 'Add this hostname to Firebase Authentication > Settings > Authorized domains: %s\n' "${SERVICE_URL#https://}"
printf 'The /api/health endpoint should return {"status":"ok"}.\n'
printf 'Meta investigations require a MODEL_API_KEY secret on this service. See README.\n'
