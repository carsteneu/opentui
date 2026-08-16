# Wave 1 — Lifecycle-/Fault-Abnahme und Performance

Stand: 2026-08-17  
Branch: `yesloop/wave1-lifecycle`  
Worktree: `home/user/projects/opentui/.worktrees/wave1-integration`  
Baseline: `f3ef5a19` (`yesloop/wave0-observability`)  
Gemessener Code-Head: `2f2b0b70`

## Ergebnis

G1–G3 und C7/C8/C10 sind funktional implementiert und gegen Fehler-/Lifecycle-Races abgesichert. Die früher
unbegrenzten Callback-, Feed-, Debounce-, Timer- und Workerpfade enden jetzt definiert; späte Ergebnisse dürfen keinen
neuen nativen Commit auslösen. Der callback-freie Framepfad und der Framepfad mit Callback halten das vereinbarte
p95-Budget. Das Gesamt-Go-Gate der Welle bleibt dennoch offen: die für G2 notwendige JS-Eigentumskopie auf dem
Custom-Writable-Pfad kostet in der seriellen Messung p95 +3,71 % und im 25k-Burst p95 +11,26 %.

Die Kopie darf nicht einfach entfernt werden. Ohne sie könnte `destroy()` einen nativen Chunk freigeben, während ein
unzuverlässiger Sink noch dessen geborgten `Uint8Array` hält (Use-after-free). Ein weiterer Umbau braucht daher
begrenztes Feed-Draining/Pinned-Byte-Budget oder eine echte native Ownership-Übergabe, nicht wieder Zero-Copy mit
vorzeitigem Refcount-Release.

## Übernommene Änderungen

- G1: Destroy-abortbarer, weiterhin serieller Frame-Callback-Wait; keine Layout-/Nativearbeit nach Destroy; späte
  Rejections bleiben beobachtet. Callback-freie Frames allozieren keinen Abortowner.
- G2: JS-eigene Feedbytes; exactly-once Settlement über Callback, `error`, `close`, `finish` oder Destroy; terminale
  Sinks erhalten keine neuen Writes; Fehler bleiben sichtbar.
- G3: ein gemeinsamer Delayed-Activation-Owner für Full/Partial; cancelbares Timerhandle und Generation gegen stale
  `nextTick`-/Finally-Races.
- C7: ersetzte/gelöschte Debounces settlen mit definiertem Superseded-Vertrag; echte Workfehler werden nicht
  verschluckt; Debounce-Scope ist pro Client statt global.
- C8: Dispose-Timer besitzt genau einen Owner und wird bei Antwort, Fehler oder Destroy gecancelt.
- C10: unerwarteter Worker-Exit propagiert; Terminate-Fehler behalten den Worker für Retry; maximal fünf konsekutive
  Recreates, Rücksetzung erst nach erfolgreicher post-init Antwort.

## Review-Korrekturen gegenüber den vier Agentenästen

- synchrone JavaScript-Framecallbacks wieder unterstützt;
- alte `activateFrame()`-Completion kann keine neuere Generation löschen;
- direkter interner `activateFrame()`-Aufruf bleibt kompatibel;
- Sinkfehler werden einmalig gemeldet statt verschluckt;
- `stopWorker()` restauriert `onexit` auch nach fehlgeschlagenem Terminate;
- Restartbudget wird durch echte Fehlergenerationen getestet, nicht durch privaten Testzustand;
- ein Tree-sitter-Client kann den Debounce eines anderen Clients nicht mehr abbrechen.

## Performance: gepaarte A/B-Messung

Beide Arme nutzten dasselbe Native-Artefakt
`e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`. Die längeren Läufe liefen alternierend,
auf CPU 15 gepinnt, auf einem 16-Core-Host bei anfänglicher Load Average 9,57. Zeiten messen nur den warmen
Operationskörper; Import/Setup liegen außerhalb. Wegen sichtbarer Hoststreuung werden absolute Werte und Delta offen
angegeben.

| Szenario                            | Paare |      Baseline |        Wave 1 |     Delta | Bewertung                      |
| ----------------------------------- | ----: | ------------: | ------------: | --------: | ------------------------------ |
| Frame ohne Callback, Median         |    15 |     27,711 µs |     27,609 µs |   −0,37 % | neutral/leicht besser          |
| Frame ohne Callback, p95            |    15 |     29,224 µs |     28,716 µs |   −1,74 % | 3-%-Gate erfüllt               |
| Frame mit resolved Callback, Median |    10 |     38,462 µs |     39,472 µs |   +2,63 % | im Budget                      |
| Frame mit resolved Callback, p95    |    10 |     43,414 µs |     42,849 µs |   −1,30 % | 3-%-Gate erfüllt               |
| Custom Feed seriell, Median         |    15 |     41,191 µs |     44,960 µs |   +9,15 % | Sicherheitskosten              |
| Custom Feed seriell, p95            |    15 |     45,606 µs |     47,300 µs |   +3,71 % | Gate um 0,71 pp verfehlt       |
| Custom Feed 25k-Burst, p95          |    15 | 117,125 µs/op | 130,311 µs/op |  +11,26 % | Tail-/GC-Follow-up             |
| One-shot Scheduler, p95             |    10 |      3,196 µs |      3,424 µs | +0,229 µs | relativ +7,15 %, absolut klein |

Der Feed-Burst ist kein normaler 60-Hz-Framepfad, aber ein realer Memory-/GC-Stressbefund: alle sicheren Kopien
bleiben bis zum jeweiligen Sinkcallback lebendig. Er bleibt deshalb als K1/K3-/G2-Follow-up erhalten.

## Beseitigte Hänger und unnötige Arbeit

| Fault/Resource                              | Baseline                    | Wave 1                         | Gewinn                                    |
| ------------------------------------------- | --------------------------- | ------------------------------ | ----------------------------------------- |
| nie settlender Framecallback + Destroy      | nach 200 ms weiter pending  | 3–5 ms                         | unbounded → bounded; im Messfenster >98 % |
| gepinnter Feedwrite + Destroy               | nach 200 ms weiter gepinnt  | <7 ms, nicht backpressured     | unbounded → bounded; im Messfenster >96 % |
| stale Delayed-Activation-Timer nach Destroy | 1 Wakeup                    | 0 Wakeups                      | 100 % eliminiert                          |
| ersetzter Reset-Debounce                    | alte Promise bleibt pending | alte Promise settlet definiert | 100 % der Dead-End-Promises eliminiert    |
| erfolgreicher Buffer-Dispose                | 3-s-Timer bleibt aktiv      | Timer gecancelt                | 1 unnötiger Wakeup je Dispose eliminiert  |
| Worker-Crashkaskade                         | Recreate unbegrenzt         | maximal 5 konsekutive Fehler   | Kaskade hart begrenzt                     |

Diese Werte sind Resilienz-/Tail-Latency-Gewinne, keine addierbaren Marketing-Prozente für normalen Durchsatz.

## Verifikation

- fokussierte Wave-1-/Reviewtests: 243/243 grün;
- vollständiges `packages/core`-JS-Gate: 5.494 pass, 23 skip, 0 fail (5.517 total);
- `bun run build:lib`: grün;
- `bun run test:dist --skip-build` mit Node v26.4.0: Node ESM/CommonJS und gepackte Bun-Dist grün;
- Root `bun run lint`: 0 Warnungen/0 Fehler; `bun run fmt:check`: grün;
- `test:js:node`: Kandidat und Baseline scheitern identisch nur an zwei vorbestehenden
  `Code.test.ts`-Typfehlern (Zeilen 1457/1479, `requestPartialRender` gegen `keyof CodeRenderable`), keine neue
  Wave-1-Abweichung;
- Root-Build bleibt lokal durch Zig 0.15.2 gegen ältere Build-APIs (`std.Io.Dir`, `std.mem.find`, uucode Build API)
  blockiert; keine Nativequelle wurde in Wave 1 geändert.

## Nächster Schritt

Vor dem formalen Wave-1-Go entweder den G2-Tail mit begrenztem Drain-/Pinned-Byte-Budget beziehungsweise sicherer
Ownership-Übergabe unter 3 % bringen oder die eng begründete Custom-Writable-Ausnahme explizit akzeptieren. Der nächste
große Optimierungsblock bleibt danach Welle 2: B1–B6 (Cold-Start, lean/lazy FFI, UI-first); dessen Ziel ist der erste
große sichtbare Performancegewinn (Cold-TTFMF mindestens −30 %).
