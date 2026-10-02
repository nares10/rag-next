# Authentication

## Tokens
API tokens are issued per service, never per person, and are shown once at creation. A
service that needs access from two environments gets two tokens so one can be revoked
without the other.

## Scopes
Scopes are additive and default to read-only. Write scopes are granted per resource type and
reviewed quarterly; a scope nobody used in the previous quarter is removed automatically.

## Rotation
Tokens expire 90 days after they are issued. Rotation is a create-then-revoke operation, so
there is always a window where both tokens work and no request is dropped.
