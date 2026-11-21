# Feschtkässle

*Die einfache Kasse für Vereine & Feste.*

**Zur App: <https://tiliavir.github.io/feschtkaessle/>**

Artikel antippen, Summe sehen, Rückgeld ablesen. Jede Helferin und jeder
Helfer kassiert auf dem eigenen Handy – ohne Anmeldung, ohne Internet am
Stand. Am Ende gibt es eine Abrechnung für die Kasse des Vereins.

## So geht's

1. **Öffnen** – Link im Browser auf dem Handy öffnen und über das Browser-Menü
   *Zum Startbildschirm hinzufügen*. Dann startet die Kasse wie eine App.
2. **Preisliste anlegen** – fotografieren, als Text einfügen, eintippen oder
   vom Verein übernehmen. Zum Ausprobieren gibt es ein fertiges Beispiel-Fest.
3. **Teilen** – unter *Artikel bearbeiten → Mit anderen Geräten teilen* einen
   Link schicken. Die anderen starten mit denselben Artikeln und Preisen.
4. **Kassieren** – Artikel antippen, erhaltenen Betrag eingeben, Rückgeld
   ablesen.
5. **Abrechnen** – nach dem Fest unter *Statistik → Abrechnung* die Verkäufe
   der anderen Geräte importieren und die Abrechnung als Tabelle (CSV)
   herunterladen.

## Gut zu wissen

- **Daten bleiben auf dem Gerät.** Es gibt keinen Server und kein Konto.
  Wer die Website-Daten im Browser löscht, löscht auch die Verkäufe –
  vorher exportieren.
- **Kein Live-Abgleich.** Die Geräte werden erst beim Abrechnen
  zusammengeführt.
- **Foto der Preisliste (optional):** einmal kostenlos mit
  [OpenRouter](https://openrouter.ai/) verbinden – oder ohne Konto über eine
  KI-App auf dem Handy. Nur dafür wird das Foto verschickt.

---

## Development

Static site: [Hugo](https://gohugo.io/) + plain TypeScript, data in
`localStorage`, deployed to GitHub Pages.

Needs Hugo ≥ 0.169, the standalone [Dart Sass](https://sass-lang.com/install/)
binary on `PATH` (the npm `sass` package does not work with Hugo) and
Node.js ≥ 24.

```bash
npm install
npm run dev     # live-reload server at http://localhost:1313/
npm run build   # compile + lint + validate + test
```

Architecture, commands and conventions: [AGENTS.md](AGENTS.md).
Releases and deployment: [docs/arc42/07-deployment-view.md](docs/arc42/07-deployment-view.md).

## License

See [LICENSE](LICENSE).
