#!/usr/bin/env bash
# Seed viewable placeholder documents for every rider profile in the dev database.
#
# Why this exists: with no AWS configured, uploads go to the local dev sink. Any
# profile created by API tests (rather than by the real app) has junk bytes or no
# document at all, so the admin panel's verification screen has nothing to show.
# This pushes real images through the actual presign → PUT flow, then points the
# dev rows at them.
#
# Dev only. It rewrites document URLs on every rider_profile row.
set -euo pipefail

API=${API:-http://localhost:3000/api/v1}
EMAIL=${ADMIN_EMAIL:-admin@uniride.app}
PASSWORD=${ADMIN_PASSWORD:-UniRide!Admin2026}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

command -v python3 >/dev/null || { echo "python3 required"; exit 1; }
python3 -c "import PIL" 2>/dev/null || { echo "Pillow required: pip install Pillow"; exit 1; }

echo "→ generating placeholder documents"
python3 - "$OUT" <<'PY'
from PIL import Image, ImageDraw
import sys
out = sys.argv[1]
docs = {
    "license":       ("#1F3A5F", "DRIVING\nLICENCE"),
    "student_id":    ("#3D2B56", "STUDENT\nID CARD"),
    "vehicle_photo": ("#2E4A3A", "VEHICLE\nPHOTO"),
    "license_plate": ("#4A3B1F", "NUMBER\nPLATE"),
    "selfie":        ("#5A2E3A", "FACE\nCHECK"),
}
for name, (bg, label) in docs.items():
    img = Image.new("RGB", (640, 800), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([24, 24, 616, 776], outline="#ffffff", width=3)
    d.multiline_text((320, 360), label, fill="#ffffff", anchor="mm", align="center")
    d.multiline_text((320, 470), "SAMPLE — dev seed", fill="#c9c9c9", anchor="mm")
    img.save(f"{out}/{name}.jpg", "JPEG", quality=85)
PY

echo "→ signing in as $EMAIL"
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | grep -oE '"accessToken":"[^"]+"' | cut -d'"' -f4)
[ -n "$TOKEN" ] || { echo "login failed — is the API up, and does that account exist?"; exit 1; }

declare -A URL
for DOC in license student_id vehicle_photo license_plate selfie; do
  PRESIGN=$(curl -s -X POST "$API/uploads/presign" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d "{\"folder\":\"$DOC\",\"contentType\":\"image/jpeg\"}")
  UPLOAD=$(echo "$PRESIGN" | grep -oE '"uploadUrl":"[^"]+"' | cut -d'"' -f4)
  URL[$DOC]=$(echo "$PRESIGN" | grep -oE '"publicUrl":"[^"]+"' | cut -d'"' -f4)
  curl -s -o /dev/null -X PUT "$UPLOAD" -H 'Content-Type: image/jpeg' --data-binary "@$OUT/$DOC.jpg"
  echo "  uploaded $DOC"
done

echo "→ pointing dev rider profiles at them"
docker compose exec -T postgres psql -U postgres -d uniride_dev -c "
UPDATE rider_profiles SET
  license_doc_url         = '${URL[license]}',
  student_id_doc_url      = '${URL[student_id]}',
  vehicle_photo_url       = '${URL[vehicle_photo]}',
  license_plate_photo_url = '${URL[license_plate]}',
  selfie_url              = '${URL[selfie]}',
  face_verified_at        = COALESCE(face_verified_at, now());"

echo "✓ done — reload /verifications in the admin panel"
