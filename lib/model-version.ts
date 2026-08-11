// Version stamp written onto every frozen forecast and projection archive.
// Bump this whenever modeling, calibration, or freezing logic changes so that
// forecasts produced by different code never mix under one version label.
// v2.0: binomial hit/strikeout distributions, backtest-consistent baseline,
// market-line totals, 6-hour freeze window.
export const MODEL_VERSION = "multi-market-research-v2.0";
