# Gültigkeitskorrektur

Der Rohdatensatz bleibt append-only erhalten. Das Szenario `cold-1000` und sämtliche Output-Digests sind gültig.

`warm-1000-append100` war in diesem Lauf falsch konstruiert: Der Marker in der ersten Zeile wechselte bei jedem
Update. Damit konnte kein Update ein Präfix seines Vorgängers sein; `CodeBufferedHighlightSource` musste den Buffer
releasen und neu erstellen. Die Warm-Zahlen messen Full-Replacement plus Same-turn-Koaleszierung und dürfen nicht als
inkrementeller Append-Gewinn zitiert werden.

Der korrigierte Workload ist ab dem Gate-Harness-Commit nach `08f9b4a4` per Prefix-Invariantentest abgesichert.
