# credential flow

## database and credential routing (security protocol)

sensitive third-party store credentials and keys are stored using row-level encryption in the database. they are decrypted in memory only during the lifecycle of the webhook execution and injected directly into the github action environment variables as single-use secrets.

## the concrete path a credential takes

1. **capture.** the user pastes an apple `.p8` key + key id + issuer id (ios) or a play service account json (android) in the dashboard. this is the only time plaintext crosses a request boundary; the request body is never logged.

2. **seal.** `vault.putCredential()` seals the credential object with envelope encryption (`src/vault/crypto.js`):
   - a random 256-bit data encryption key (dek) is generated per row
   - the payload is aes-256-gcm encrypted under the dek
   - the dek is itself aes-256-gcm wrapped under the master key (kms-provided in production)
   - only the envelope string `v1:<wrapped_dek>:<iv>:<ciphertext>:<tag>` is written to the store
   
   self-test 02 proves plaintext never reaches the store; self-test 01 proves tampering or a wrong master key fails authentication.

3. **mint.** on deploy, `pipeline.dispatch()` mints a single-use handoff token bound to the job id with a 15-minute ttl. the token's hash (not the token) is stored; the token travels inside the `repository_dispatch` client payload.

4. **redeem.** the runner's first step posts the token to `POST /redeem` with its job id. the vault verifies the hash, job binding, and ttl, marks the token used, and returns the merged env object. the runner:
   - writes `.p8` / service-account entries to files under `/tmp` and exports their paths
   - exports everything else directly into `$GITHUB_ENV`
   - never echoes any redeemed value to the log

   redemption is exactly once: a replay of the same token gets a 400 (`handoff token already redeemed`). the ttl and job binding are enforced server-side (self-tests 03, 04, 09).

5. **use.** fastlane consumes the env vars: `app_store_connect_api_key`, `match` (readonly), `gym`, `deliver`.

6. **burn.** the workflow's cleanup step (runs `if: always()`) deletes every secret file, every `.p8` / `.mobileprovision` artifact, and the keychain. the status callback then drives the pipeline state machine.

## invariants

- plaintext credentials exist only (a) at capture, in the request handler, and (b) between `issueHandoff()` and `redeemHandoff()` in memory.
- github dispatch payloads never contain credential material (self-test 07 asserts this).
- the logger scrubs anything whose key looks like a secret or that matches long base64 blobs (self-test 10).
- the handoff server exposes exactly two routes: `/redeem` and `/report`.
