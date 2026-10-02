# Caching

## Lifetimes
Read-through caches use a 60 second lifetime by default. Anything longer than five minutes
needs an invalidation path, because the gap between the data changing and the cache noticing
becomes visible to customers.

## Invalidation
Invalidation is by tag, not by key, so one write can clear every view that depended on it.
Tags are cheap; a write that clears the whole cache is not and shows up immediately as a
latency spike.

## Stampedes
When a popular entry expires, one request refreshes it and the others serve the stale value
for up to 10 seconds. Without that, expiry of a hot key sends every request to the database
at once.
