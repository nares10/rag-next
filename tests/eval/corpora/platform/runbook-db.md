# Database runbook

## Failover
The primary fails over automatically after 30 seconds of unresponsiveness. Failover drops
in-flight transactions, so an application that cannot retry will show errors for a few
seconds and that is expected.

## Connection limits
The primary accepts 400 connections. Services connect through a pooler rather than directly;
a service that opens its own connections will exhaust the limit for everyone during a
restart storm.

## Slow queries
Any query over one second is logged with its plan. The usual cause is a missing index on a
column added in a recent migration, so check the newest migration first when a slow query
appears without a deploy that explains it.
