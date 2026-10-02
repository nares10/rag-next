# Object storage

## Buckets
Each service owns its buckets and no service reads another's directly; sharing happens
through a signed URL with a short expiry. Bucket names include the environment so a staging
credential cannot address production data.

## Lifecycle
Objects move to cold storage after 90 days and are deleted after two years unless the bucket
is marked for retention. Lifecycle rules are defined in code alongside the service, not in
the console.

## Encryption
Everything is encrypted at rest with keys managed by the platform team. A service that needs
its own key can have one, at the cost of handling its own rotation.
