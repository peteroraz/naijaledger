#!/usr/bin/env bash
set -euo pipefail
set +x

PROJECT=naijaledger-ed044
REGION=europe-west1
SERVICE=naijaledger
SECRET=naijaledger-meta-api-key

read -r -s -p 'Paste your PRIVATE Meta Model API key (input hidden), then press Enter: ' NAIJALEDGER_META_KEY
printf '\n'
if [[ -z "$NAIJALEDGER_META_KEY" ]]; then
  printf 'No key entered; nothing changed.\n' >&2
  exit 1
fi
export NAIJALEDGER_META_KEY
trap 'unset NAIJALEDGER_META_KEY' EXIT

# Validate a minimal synthetic request before changing the running service.
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
request = urllib.request.Request(
    'https://api.meta.ai/v1/chat/completions',
    data=json.dumps({
        'model': 'muse-spark-1.3',
        'messages': [{'role': 'user', 'content': 'Reply with the single word: ready'}],
    }).encode(),
    headers={'Authorization': 'Bearer ' + os.environ['NAIJALEDGER_META_KEY'], 'Content-Type': 'application/json'},
)
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)
    content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
    if not content or 'ready' not in content.lower():
        print('Meta responded, but the connectivity test did not return ready. No cloud settings changed.', file=sys.stderr)
        sys.exit(1)
    print('Meta Muse Spark 1.3 connectivity test passed.')
except urllib.error.HTTPError as error:
    print(f'Meta returned HTTP {error.code}; no cloud settings changed.', file=sys.stderr)
    try:
        body = json.loads(error.read(16000))
        detail = body.get('error', {})
        if isinstance(detail, dict):
            message = str(detail.get('message', 'No error message provided'))
            message = message.replace(os.environ['NAIJALEDGER_META_KEY'], '[REDACTED]')
            print('Meta error: ' + message[:600], file=sys.stderr)
    except Exception:
        print('Meta did not return a readable error description.', file=sys.stderr)
    sys.exit(1)
except Exception:
    print('Meta connectivity test failed; no cloud settings changed. Check the network and retry.', file=sys.stderr)
    sys.exit(1)
PY

gcloud services enable secretmanager.googleapis.com --project "$PROJECT" --quiet
if ! gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --replication-policy automatic --project "$PROJECT" --quiet
fi
VERSION_RESOURCE=$(printf '%s' "$NAIJALEDGER_META_KEY" | gcloud secrets versions add "$SECRET" --data-file=- --project "$PROJECT" --format='value(name)')
unset NAIJALEDGER_META_KEY
VERSION="${VERSION_RESOURCE##*/}"
RUNTIME_IDENTITY=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')
if [[ -z "$RUNTIME_IDENTITY" ]]; then
  printf 'Could not determine the service identity; no Cloud Run update was made.\n' >&2
  exit 1
fi
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
  --member="serviceAccount:${RUNTIME_IDENTITY}" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --update-secrets="MODEL_API_KEY=${SECRET}:${VERSION}" --quiet
printf '\nMeta key connected to Cloud Run using Secret Manager version %s.\n' "$VERSION"
printf 'Open NaijaLedger, choose a synthetic unresolved invoice, and click Investigate with Meta.\n'
printf 'Success means a cited evidence brief appears and remains after refresh.\n'
