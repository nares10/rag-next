# Rate limits

## Tiers
Free keys allow 60 requests a minute. Team keys allow 600, and enterprise agreements are
negotiated individually. Limits are per key, not per account, so splitting traffic across
keys is a supported way to raise headroom.

## Headers
Every response carries the remaining quota and the reset time as headers. Clients should
read those rather than counting their own requests, because quota is shared across the
replicas serving a key.

## Bursts
A burst of up to twice the per-minute limit is allowed for 10 seconds, after which requests
are rejected with 429 until the window resets. Retries should back off exponentially with
jitter.
