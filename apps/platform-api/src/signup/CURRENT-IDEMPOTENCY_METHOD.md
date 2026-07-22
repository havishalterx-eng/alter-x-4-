# Current signup idempotency method

Signup currently uses `ProcessLocalSignupIdempotencyStore`.

- Same key and same request replays the original result.
- Same key and different request returns `409 IDEMPOTENCY_KEY_REUSED`.
- Concurrent duplicate requests share one in-flight operation.
- Failed operations remove the key so a retry can run again.

This is a temporary, signup-scoped method. State lives in one platform-api
process and is lost on restart. It does not deduplicate across multiple
platform-api instances. Product Core must replace it with the planned durable
PostgreSQL idempotency-key store before multi-instance production deployment.
