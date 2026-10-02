# Queues

## Delivery
Delivery is at-least-once, so every consumer must be idempotent. The message carries an
idempotency key; storing the processed keys for 24 hours is enough for every consumer we
run.

## Retries
A failed message is retried with exponential backoff for one hour. Retries preserve order
only within a partition key, which is why work that must stay ordered has to share one.

## Dead letters
After the retry budget is exhausted the message moves to a dead letter queue, where it is
kept for 14 days. Draining a dead letter queue is a deliberate operation with a written
reason, never a reflex.
