# Data retention

## Logs
Application logs are kept for 30 days and access logs for 180 days. Nothing containing a
request body is retained beyond 7 days, which is why debugging old reports often has to
start from metrics instead.

## Backups
Database backups run nightly and are kept for 35 days. A restore is tested monthly against a
scratch environment; an untested backup is treated as no backup.

## Deletion requests
A customer deletion request is satisfied within 30 days. Backups are not rewritten; the
record is suppressed on restore instead, and that suppression list is itself backed up.
