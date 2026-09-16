#!/bin/sh
# Печатает только тело компонента (JS), без шаблона и без base64.
D="$(dirname "$0")/.."
S=$(grep -n '</x-dc>' "$D/src/page.html" | head -1 | cut -d: -f1)
sed -n "$((S+1)),11092p" "$D/src/page.html"
