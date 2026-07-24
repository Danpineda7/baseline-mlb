# Baseline application foundation

## Product contract

Baseline is a transparent MLB forecasting workspace. The primary workflow is: refresh data, resolve quality warnings, review priced markets, inspect the evidence, and track closing-line value and calibration. A likely outcome is never automatically a recommended bet.

## Application areas

- **Today:** decision board, filters, fair price, edge, uncertainty, correlation, explanation and watch items.
- **Matchup:** projected lineups, starter workload, bullpen availability, park/weather, score distribution and market history.
- **Models:** versions, training cutoff, calibration, feature importance, backtests and drift.
- **Data health:** source freshness, coverage, duplicate hashes, schema checks, pagination and lineage.
- **Performance:** CLV, ROI, Brier score, log loss, calibration, drawdown and results by market.

## Data principles

1. Raw responses are immutable and timestamped.
2. Every derived row retains source lineage.
3. Features are computed as-of first pitch; future data cannot enter training rows.
4. Missing, duplicated, stale or ignored-filter responses fail validation.
5. Probabilities are calibrated out-of-sample and reported with uncertainty.
6. Recommendations require a real offered price and a configurable minimum edge.
7. Correlated positions share an exposure group and bankroll limit.

## Service boundaries

- `ingestion`: source clients, retries, manifests and raw snapshots.
- `validation`: schemas, coverage, duplicate detection and quarantine.
- `warehouse`: normalized teams, players, games, lineups and events.
- `features`: timestamp-safe team, starter, bullpen, lineup and environment features.
- `models`: separate full-game, first-five, first-inning and prop estimators.
- `pricing`: vig removal, fair odds, edge, expected value and max-playable prices.
- `portfolio`: correlation, fractional Kelly caps and exposure controls.
- `settlement`: grading, closing prices, CLV and performance metrics.

## Initial delivery sequence

1. Complete historical game and result ingestion.
2. Add source manifests and validation gates.
3. Add lineups, probable pitchers, weather, parks and bullpen workload.
4. Add timestamped consensus odds.
5. Train and calibrate full-game score, moneyline and total models.
6. Add first-five and first-inning models.
7. Add strikeout and hit prop models only after granular data validates.

The dashboard currently uses representative content to establish interaction and visual contracts. It must not be presented as live betting output until the ingestion, pricing and model services are connected.
