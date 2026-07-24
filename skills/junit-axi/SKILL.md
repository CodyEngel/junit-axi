---
name: junit-axi
description: "Run JUnit tests through Gradle and read the results without the build-output noise"
---

# junit-axi

Run JUnit tests through Gradle and read the results without the build-output noise (built against AXI spec axi/1.0-2026-07). Run the commands below with npx — no install needed.

```
items[2]{id,title,status}:
  1,Replace this demo with live content,open
  2,Wire your first real command,open
help[2]:
  npx -y junit-axi items list --status open
  npx -y junit-axi items list --help
```

Every command supports `--help`. Exit codes: 0 success/no-op, 1 error, 2 usage error. All output is TOON on stdout.
