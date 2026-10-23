"""Packs the split APKs built by build.sh into .apks / .xapk / .apkm containers."""
import json, os, struct, sys, zipfile

work, out = sys.argv[1], sys.argv[2]
splits = ['arm64_v8a', 'armeabi_v7a', 'x86', 'xhdpi', 'mdpi', 'de', 'fr']
icon = os.path.join(work, 'res', 'mipmap-xhdpi', 'ic_launcher.png')
pkg = 'com.example.splitapp'
read = lambda p: open(os.path.join(work, p), 'rb').read()

def write(name, entries):
    with zipfile.ZipFile(os.path.join(out, name), 'w', zipfile.ZIP_DEFLATED) as z:
        for arc, data in entries:
            z.writestr(arc, data)

# SAI-style .apks: flat file names.
write('sai.apks', [('base.apk', read('base.apk'))] + [(f'split_config.{s}.apk', read(f'split_config.{s}.apk')) for s in splits]
      + [('icon.png', open(icon, 'rb').read())])

# bundletool .apks: toc.pb + splits/ directory.
write('bundletool.apks', [('toc.pb', b'\x0a\x00'), ('splits/base-master.apk', read('base.apk'))]
      + [(f'splits/base-{s}.apk', read(f'split_config.{s}.apk')) for s in splits])

# APKPure .xapk with an OBB expansion file.
manifest = {
    'xapk_version': 2, 'package_name': pkg, 'name': 'Split App', 'version_code': '12', 'version_name': '1.2.0',
    'min_sdk_version': '21', 'target_sdk_version': '33',
    'split_apks': [{'file': f'{pkg}.apk', 'id': 'base'}] + [{'file': f'config.{s}.apk', 'id': f'config.{s}'} for s in splits],
    'expansions': [{'file': f'Android/obb/{pkg}/main.12.{pkg}.obb', 'install_location': 'EXTERNAL_STORAGE',
                    'install_path': f'Android/obb/{pkg}/main.12.{pkg}.obb'}],
}
write('app.xapk', [('manifest.json', json.dumps(manifest).encode()), (f'{pkg}.apk', read('base.apk'))]
      + [(f'config.{s}.apk', read(f'split_config.{s}.apk')) for s in splits]
      + [('icon.png', open(icon, 'rb').read()), (f'Android/obb/{pkg}/main.12.{pkg}.obb', b'OBBDATA' * 100)])

# APKMirror .apkm.
info = {'pname': pkg, 'versioncode': '12', 'release_version': '1.2.0', 'min_api': '21', 'apkm_version': 5}
apkm = [('info.json', json.dumps(info).encode()), ('base.apk', read('base.apk'))] \
       + [(f'split_config.{s}.apk', read(f'split_config.{s}.apk')) for s in splits] + [('icon.png', open(icon, 'rb').read())]
write('app.apkm', apkm)

# An "encrypted" .apkm: same layout with the encryption flag set on the APK entries
# (enough for detection; the payload is not real ciphertext).
write('encrypted.apkm', apkm)
p = os.path.join(out, 'encrypted.apkm')
data = bytearray(open(p, 'rb').read())
for sig, flag_off, name_len_off, hdr in ((b'PK\x03\x04', 6, 26, 30), (b'PK\x01\x02', 8, 28, 46)):
    i = 0
    while (i := data.find(sig, i)) >= 0:
        n = struct.unpack_from('<H', data, i + name_len_off)[0]
        name = bytes(data[i + hdr:i + hdr + n])
        if name.endswith(b'.apk'):
            struct.pack_into('<H', data, i + flag_off, struct.unpack_from('<H', data, i + flag_off)[0] | 1)
        i += 4
open(p, 'wb').write(data)
