#!/usr/bin/env bash
# Regenerates the test APKs in ../apk/ (dev-only; needs aapt2, apksigner,
# zipalign, keytool, python3+Pillow and an android.jar). The app itself never
# uses these tools. On Ubuntu: apt install aapt apksigner zipalign android-sdk-platform-23
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
OUT=../apk
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android \
  -alias test -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Test Fixtures" >/dev/null 2>&1

python3 make_icons.py "$WORK/res"

sign() { zipalign -f 4 "$1" "$1.aligned" && apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out "$2" "$1.aligned"; rm -f "$2.idsig"; }
add_libs() { # zip, abi...
  local zip=$1; shift
  (cd "$WORK" && rm -rf lib && for abi in "$@"; do mkdir -p "lib/$abi" && printf '\x7fELF-fake' > "lib/$abi/libfixture.so"; done && zip -q -r "$zip" lib)
}

build() { # name manifest res-dirs...
  local name=$1 manifest=$2; shift 2
  rm -rf "$WORK/flat-$name" && mkdir -p "$WORK/flat-$name"
  for d in "$@"; do aapt2 compile --dir "$d" -o "$WORK/flat-$name/"; done
  aapt2 link -o "$WORK/$name.unsigned.apk" -I "$ANDROID_JAR" --manifest "$manifest" "$WORK/flat-$name"/*.flat "${LINK_EXTRA[@]}"
}

# 1. A proper TV app with native libs for two ARM ABIs.
LINK_EXTRA=()
build tv tv/AndroidManifest.xml tv/res "$WORK/res"
add_libs "$WORK/tv.unsigned.apk" armeabi-v7a arm64-v8a
sign "$WORK/tv.unsigned.apk" "$OUT/tv-app.apk"

# 2. A phone-only, test-only app targeting an old SDK, x86_64 libs only.
build phone phone/AndroidManifest.xml phone/res "$WORK/res"
add_libs "$WORK/phone.unsigned.apk" x86_64
sign "$WORK/phone.unsigned.apk" "$OUT/phone-app.apk"

# 3. Same TV app, but unsigned.
cp "$WORK/tv.unsigned.apk" "$OUT/unsigned.apk"

# 4. Split APKs (base + density/ABI/language splits) for bundle tests.
LINK_EXTRA=(--split "$WORK/split.xhdpi.apk:xhdpi" --split "$WORK/split.mdpi.apk:mdpi" --split "$WORK/split.de.apk:de" --split "$WORK/split.fr.apk:fr")
build split split/AndroidManifest.xml tv/res "$WORK/res"
LINK_EXTRA=()
sign "$WORK/split.unsigned.apk" "$WORK/base.apk"
for s in xhdpi mdpi de fr; do sign "$WORK/split.$s.apk" "$WORK/split_config.$s.apk"; done
for abi in arm64_v8a armeabi_v7a x86; do
  dir=${abi//_v8a/-v8a}; dir=${dir//_v7a/-v7a}
  sed "s/@SPLIT@/config.$abi/" split/split-abi.xml > "$WORK/abi-$abi.xml"
  aapt2 link -o "$WORK/abi-$abi.unsigned.apk" -I "$ANDROID_JAR" --manifest "$WORK/abi-$abi.xml"
  add_libs "$WORK/abi-$abi.unsigned.apk" "$dir"
  sign "$WORK/abi-$abi.unsigned.apk" "$WORK/split_config.$abi.apk"
done
python3 make_bundles.py "$WORK" "$OUT"
echo "Fixtures written to $OUT"
