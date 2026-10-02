# Observability

## Metrics
Every service exports request rate, error rate and latency percentiles. Dashboards show p50,
p95 and p99; averages are deliberately not shown because they hide the tail that users feel.

## Tracing
Traces are sampled at one percent in normal operation and at one hundred percent for any
request that errors. A trace ID appears in every log line, which is the fastest way from a
customer report to the failing call.

## Alerts
An alert that fires without a documented action is deleted, not tuned. Alert thresholds are
set from the service objective rather than from whatever looked normal last week.
