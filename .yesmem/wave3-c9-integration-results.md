# Wave 3 C9 – finaler Integrationsnachweis

Stand: 2026-08-18

## Referenzen

- Branch/Worktree: `yesloop/wave3-streaming-integration` / `.worktrees/wave3-integration`
- integrierter Runtime-Commit: `b4e6d8b18e68f769abfedbdc7b070a761bdfdc15`
- gemessener C9-Commit: `11b1fdec1d56282237bd068f798fa139a66deb19`
- C9-Baseline: `fcf1cb70659c9b39b0b7d9f3168e2d894b16a0b3`
- Paketversion: `@opentui/core@0.5.3`
- Runtime-Git-Describe: `v0.5.3-100-gb4e6d8b1`

`git diff --exit-code 11b1fdec b4e6d8b1 -- packages/core/src` ist leer. Die auf dem
Integrationsbranch verifizierte Runtime ist damit bytegleich mit dem formal gemessenen C9-
Kandidaten; spätere Commits betreffen ausschließlich Harness und Dokumentation.

## Funktionale Abschlussgates

| Gate                                 | Ergebnis                                         |
| ------------------------------------ | ------------------------------------------------ |
| fokussierte JS-/Streaming-/FFI-Suite | 249 Passes, 1 intentionaler Skip, 0 Fails        |
| vollständige Core-JS-Suite           | 5.618 Passes, 23 Skips, 0 Fails; 206 Dateien     |
| fokussierte native StyledText-Suite  | 9 Passes, 0 Fails                                |
| vollständige native Suite            | 2.009 Passes, 8 Skips, 0 Fails                   |
| Root-Build mit Zig 0.16              | PASS                                             |
| Packed Distribution                  | Node ESM, Node CommonJS und Bun PASS             |
| Lint                                 | 0 Warnungen, 0 Fehler                            |
| Format und `git diff --check`        | PASS nach Formatkorrektur zweier Wave-3-Berichte |

Die native Vollsuite wurde zusätzlich in der Sandbox ausgeführt. Dort scheiterten nur fünf
X11-Listener-Tests an verweigerten Unix-/TCP-Sockets; derselbe Build bestand außerhalb der
Socket-Sandbox vollständig. Das lokal für die Integrationsprüfung neu gebaute Native-Artefakt
hat die SHA-256 `2c3f3cef268a62ef331b33d1f98d5eae03f3dd561aebfbb174f82673c466de01`
und exportiert `textBufferAppendStyledText`.

## Performanceurteil

Das formale C9-Gate lief mit 30 balancierten Paaren je Szenario, drei Warmups je Arm und
Szenario sowie 20.000 Bootstrap-Samples. Baseline und Candidate verwendeten getrennt gepinnte
Native-Artefakte. Frame-, Span- und Chunk-Digests waren in allen Paaren identisch.

| Szenario                                  | gepaarter Wall-Win |  p95-Win | familywise 95-%-CI |
| ----------------------------------------- | -----------------: | -------: | -----------------: |
| Cold, 1.000 TypeScript-Zeilen             |           -59,43 % | -62,15 % |  -61,31 … -57,23 % |
| Warm, 1.000 Zeilen + 100 monotone Appends |           -87,58 % | -87,28 % |  -88,71 … -86,29 % |

C9 ist damit funktional und für Update→gestylter-nativer-Commit-Walltime `PASS`. Das gesamte
Wave-3-Programm bleibt für die noch nicht disjunkt gemessene reine Mainthread-CPU, den
Rolling-10k-Memory-Test und das direkte 30-Paar-Gesamtgate gegen `fccae215` weiterhin `OPEN`.

Rohdaten und ausführlicher Report:
`.yesmem/bench/wave3-c9-native-final-runs-2026-08-18/`.
