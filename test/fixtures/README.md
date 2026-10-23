# Test fixtures

`adb/` holds adb output used by the parser and service tests.

* **Recorded** with platform-tools 34.0.4 on Linux (no device attached):
  `version.txt`, `devices-empty.txt`, `connect-refused.txt`, `connect-bad-host.txt`,
  `pair-cannot-start.txt`, `mdns-services-empty.txt`.
* **Representative**, written to match the exact formats adb prints (see the adb
  sources: `adb_client`, `transport_mdns`, `adb_wifi`), for outputs that need a real
  TV: everything else. Replace them with real recordings when you capture some —
  run the same command and save stdout+stderr (`adb … > file.txt 2>&1`).
