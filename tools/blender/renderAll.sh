#!/bin/sh
# Render every clip: one body pass each, plus the eye passes each clip needs.
# Frames already on disk are skipped, so an interrupted run can just be started again.
# Usage (from tools/blender):  sh renderAll.sh            -> out/anim/<clip>/<pass>/fNNN.png
# Takes ~45 min on a 2-core CPU (body ~5 s/frame, eyes ~1.2 s/frame).
cd "$(dirname "$0")"
PY=${PYTHON:-python}
R=out/anim
run() {
  mkdir -p "$R/$1/$2"
  echo "$(date +%T) start $1 $2"
  $PY renderClip.py "$1" "$3" 0 "$4" "$R/$1/$2"
  echo "$(date +%T) done $1 $2"
}
run idle body body 95
run sleep body body 95
run eat body body 47
run play body body 47
for mood in calm happy sad grumpy; do
  for ph in day night; do run idle "eyes_${mood}_$ph" "eyes:$mood:$ph" 95; done
done
run sleep eyes_closed_day eyes:closed:day 95
for ph in day night; do run eat "eyes_content_$ph" "eyes:content:$ph" 47; done
for ph in day night; do run play "eyes_happy_$ph" "eyes:happy:$ph" 47; done
echo "$(date +%T) ALL DONE"
